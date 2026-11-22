import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const example = join(root, "examples", "ssr-pool");
const serverEntry = join(example, "dist", "server", "entry-server.js");
const clientIndex = join(example, "dist", "client", "index.html");

function requireBuild() {
  const missing = [serverEntry, clientIndex].filter((path) => !existsSync(path));
  if (missing.length > 0) {
    throw new Error(
      `ssr-pool e2e: не найдены ${missing.join(", ")}. ` +
        "Сначала выполните `pnpm --filter @ivlev-dev/silent-example-ssr-pool build`.",
    );
  }
}

function startServer() {
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: example,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: "0",
      WEB_CONCURRENCY: "2",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          `сервер не напечатал URL за 20 с.\nstdout:\n${stdout}\nstderr:\n${stderr}`,
        ),
      );
    }, 20_000);
    const onExit = (code, signal) => {
      cleanup();
      reject(
        new Error(
          `сервер завершился до старта (code=${String(code)}, signal=${String(signal)}).\n` +
            `stdout:\n${stdout}\nstderr:\n${stderr}`,
        ),
      );
    };
    const onData = () => {
      const match = stdout.match(/ssr-pool: (http:\/\/localhost:\d+\/)/);
      if (match !== null) {
        const parsed = new URL(match[1]);
        if (parsed.port === "" || Number(parsed.port) === 0) {
          cleanup();
          reject(new Error(`сервер напечатал некорректный порт: ${match[1]}`));
          return;
        }
        cleanup();
        resolve(match[1]);
      }
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout.off("data", onData);
      child.off("exit", onExit);
    };
    child.stdout.on("data", onData);
    child.once("exit", onExit);
  });

  return {
    child,
    ready,
    logs: () => `stdout:\n${stdout}\nstderr:\n${stderr}`,
  };
}

function waitExit(child, timeoutMs) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve({ code: child.exitCode, signal: child.signalCode, timeout: false });
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve({ code: null, signal: null, timeout: true });
    }, timeoutMs);
    const onExit = (code, signal) => {
      cleanup();
      resolve({ code, signal, timeout: false });
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.off("exit", onExit);
    };
    child.once("exit", onExit);
  });
}

// HTTP-запрос с таймаутом: зависший стрим не должен вешать весь e2e.
function request(url, { timeoutMs = 20_000, ...init } = {}) {
  return globalThis.fetch(url, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(timeoutMs),
  });
}

async function readStats(base) {
  const response = await request(new URL("__stats", base), {
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(response.status, 200, "GET /__stats вернул не 200");
  return await response.json();
}

async function waitForStats(base, predicate, timeoutMs, label) {
  const deadline = performance.now() + timeoutMs;
  let last = null;
  while (performance.now() < deadline) {
    last = await readStats(base);
    if (predicate(last)) {
      return last;
    }
    // Это интервал опроса состояния, а не фиксированное ожидание:
    // цикл завершается сразу, как только предикат выполнился.
    await new Promise((resolve) => {
      setTimeout(resolve, 25);
    });
  }
  throw new Error(`${label}: ${JSON.stringify(last)}`);
}

async function main() {
  requireBuild();

  const server = startServer();
  const watchdog = setTimeout(() => {
    console.error("ssr-pool e2e: общий таймаут");
    console.error(server.logs());
    server.child.kill("SIGKILL");
    process.exit(1);
  }, 90_000);
  watchdog.unref();

  try {
    const base = await server.ready;

    // 1. Unary-рендер через пул.
    {
      const response = await request(base);
      assert.equal(response.status, 200, "GET / вернул не 200");
      const html = await response.text();
      assert.match(html, /<title>Silent SSR Pool<\/title>/, "в head нет title");
      assert.match(html, /class="app"/, "в ответе нет разметки Silent");
      assert.match(html, /class="panel-ready"/, "unary-рендер не дождался панели");
      assert.equal(server.child.exitCode, null, "процесс сервера завершился");
    }

    // 2. Стрим не буферизует: shell сразу, патч после задержки.
    {
      const started = performance.now();
      const response = await request(`${base}stream?delay=800`);
      const ttfb = performance.now() - started;
      assert.equal(response.status, 200, "GET /stream вернул не 200");
      const body = await response.text();
      const total = performance.now() - started;

      assert.ok(ttfb < 400, `TTFB ${ttfb.toFixed(0)} мс, ожидалось < 400 мс`);
      assert.ok(total >= 800, `полное время ${total.toFixed(0)} мс, ожидалось ≥ 800 мс`);

      const fallbackIndex = body.indexOf("panel-fallback");
      const patchIndex = body.indexOf("panel-ready");
      assert.ok(fallbackIndex > 0, "в теле нет fallback панели");
      assert.ok(patchIndex > fallbackIndex, "панель не пришла патчем после fallback");
      assert.match(
        body.slice(0, fallbackIndex),
        /<title>Silent SSR Pool<\/title>/,
        "shell-head не содержит title",
      );
      assert.ok(
        body.includes("data-silent-stream"),
        "в патче нет маркера stream-рантайма",
      );
    }

    // 3. Поздний head приходит после заголовков и учитывается в статистике.
    {
      const response = await request(`${base}stream?delay=200&late=1&req=late`);
      assert.equal(response.status, 200, "GET /stream?late=1 вернул не 200");
      const body = await response.text();
      assert.match(body, /panel-ready/);
      assert.match(body, /head обновлён в final/);

      const stats = await waitForStats(
        base,
        (value) => value.activeStreams === 0 && value.headUpdates >= 1,
        3_000,
        "статистика после late-стрима",
      );
      assert.ok(stats.headUpdates >= 1, "headUpdates не вырос");
      assert.equal(stats.activeStreams, 0, "activeStreams не вернулся к нулю");
    }

    // 4. Параллельные стримы изолированы по воркерам.
    {
      const requests = Array.from({ length: 6 }, (_, index) =>
        request(`${base}stream?delay=50&req=${index}`).then(async (response) => {
          assert.equal(response.status, 200, `req=${index}: не 200`);
          return await response.text();
        }),
      );
      const bodies = await Promise.all(requests);
      bodies.forEach((body, index) => {
        assert.ok(body.includes(`req="${index}"`), `req=${index}: нет своей метки`);
        for (let other = 0; other < bodies.length; other += 1) {
          if (other !== index) {
            assert.ok(
              !body.includes(`req="${other}"`),
              `req=${index}: смешение с req=${other}`,
            );
          }
        }
        assert.match(body, /panel-ready/, `req=${index}: панель не отрендерена`);
      });
    }

    // 5. Отмена клиентом освобождает воркер.
    {
      const controller = new AbortController();
      const response = await request(`${base}stream?delay=3000`, {
        signal: controller.signal,
      });
      assert.equal(response.status, 200, "GET /stream?delay=3000 вернул не 200");
      const reader = response.body.getReader();
      const first = await reader.read();
      assert.equal(first.done, false, "стрим завершился до первого чанка");
      assert.ok((first.value?.byteLength ?? 0) > 0, "первый чанк пуст");

      controller.abort();
      void reader.cancel().catch(() => undefined);

      await waitForStats(
        base,
        (value) => value.activeStreams === 0,
        3_000,
        "activeStreams после отмены",
      );

      const next = await request(base);
      assert.equal(next.status, 200, "запрос после отмены вернул не 200");
      await next.text();
    }

    // 6. Ошибка после shell обрывает соединение, но не процесс.
    {
      const response = await request(`${base}stream?delay=100&fail=1`);
      let aborted = response.status !== 200;
      if (!aborted) {
        try {
          await response.text();
        } catch {
          aborted = true;
        }
      }
      assert.ok(aborted, "ожидался обрыв стрима после shell, а не успешный ответ");
      assert.equal(server.child.exitCode, null, "процесс сервера упал после ошибки");

      const next = await request(base);
      assert.equal(next.status, 200, "запрос после ошибки вернул не 200");
      const html = await next.text();
      assert.match(html, /class="panel-ready"/);
    }

    // 7. SIGTERM при открытом медленном стриме: выход 0 за ≤ 5 с.
    //    На Windows SIGTERM транслируется в принудительное завершение,
    //    поэтому строгая проверка кода выхода актуальна для Linux CI.
    {
      const response = await request(`${base}stream?delay=5000`);
      assert.equal(response.status, 200, "медленный стрим не стартовал");
      const reader = response.body.getReader();
      await reader.read();

      server.child.kill("SIGTERM");
      const exit = await waitExit(server.child, 5_000);
      assert.equal(exit.timeout, false, "SIGTERM: сервер не завершился за 5 с");
      assert.equal(
        exit.code,
        0,
        `SIGTERM: код выхода ${String(exit.code)} (signal=${String(exit.signal)})\n${server.logs()}`,
      );
    }

    console.log("ssr-pool: ok");
  } finally {
    clearTimeout(watchdog);
    if (server.child.exitCode === null && server.child.signalCode === null) {
      // Сначала даём серверу штатно закрыть пул воркеров, затем — SIGKILL.
      server.child.kill("SIGTERM");
      const graceful = await waitExit(server.child, 5_000);
      if (graceful.timeout) {
        server.child.kill("SIGKILL");
        await waitExit(server.child, 2_000);
      }
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
