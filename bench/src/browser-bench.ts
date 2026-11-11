import assert from "node:assert/strict";
import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { homedir, cpus } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Browser } from "playwright-core";
import { build } from "vite";
import { ROWS, TITLE } from "../browser/shared/app-data";

type AppName = "silent" | "solid";

interface BenchApp {
  readonly name: AppName;
  readonly root: string;
  readonly ssrEntry: string;
}

interface ServerRenderResult {
  readonly html: string;
  readonly head: string;
}

interface ServerModule {
  render(): Promise<ServerRenderResult> | ServerRenderResult;
}

interface RunOptions {
  readonly ssrHtml: string;
  readonly warmup: number;
  readonly iterations: number;
  readonly rows: number;
  readonly batch: number;
}

interface RunResult {
  readonly samples: readonly number[];
  readonly checks: number;
}

interface AppMetrics {
  readonly app: BenchApp;
  readonly samples: readonly number[];
  readonly checks: number;
}

const WARMUP = 20;
const ITERATIONS = 300;
const BATCH = 20;
const benchRoot = join(import.meta.dirname, "..");
const cacheRoot = join(benchRoot, "node_modules", ".silent-bench", "browser");

const APPS: readonly BenchApp[] = [
  {
    name: "silent",
    root: join(benchRoot, "browser", "silent"),
    ssrEntry: "src/entry-server.tsx",
  },
  {
    name: "solid",
    root: join(benchRoot, "browser", "solid"),
    ssrEntry: "src/entry-server.tsx",
  },
];

const CONTENT_TYPES = new Map<string, string>([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
]);

function findChrome(): string {
  const base = join(homedir(), ".cache", "ms-playwright");
  for (const entry of readdirSync(base)) {
    if (!entry.startsWith("chromium-")) {
      continue;
    }
    for (const candidate of [
      join(base, entry, "chrome-linux64", "chrome"),
      join(base, entry, "chrome-linux", "chrome"),
    ]) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  throw new Error("Chromium не найден в ~/.cache/ms-playwright");
}

function clientDirectory(app: BenchApp): string {
  return join(cacheRoot, app.name, "client");
}

function ssrDirectory(app: BenchApp): string {
  return join(cacheRoot, app.name, "ssr");
}

async function buildApp(app: BenchApp): Promise<void> {
  const configFile = join(app.root, "vite.config.ts");
  await build({
    root: app.root,
    configFile,
    logLevel: "silent",
    build: { outDir: clientDirectory(app), emptyOutDir: true },
  });
  await build({
    root: app.root,
    configFile,
    logLevel: "silent",
    build: {
      ssr: app.ssrEntry,
      outDir: ssrDirectory(app),
      emptyOutDir: true,
    },
  });
}

async function renderSsr(app: BenchApp): Promise<string> {
  const file = join(ssrDirectory(app), "entry-server.js");
  if (!existsSync(file)) {
    throw new Error(`Нет SSR-сборки: ${file}`);
  }
  const module = (await import(
    `${pathToFileURL(file).href}?v=${String(Date.now())}`
  )) as ServerModule;
  const result = await module.render();
  return result.html;
}

function canonicalMarkup(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\sdata-hk="[^"]*"/g, "")
    .replace(/\sdata-silent-[a-z0-9-]+="[^"]*"/g, "");
}

function countOccurrences(value: string, fragment: string): number {
  let count = 0;
  let position = value.indexOf(fragment);
  while (position !== -1) {
    count += 1;
    position = value.indexOf(fragment, position + fragment.length);
  }
  return count;
}

async function startStaticServer(
  directory: string,
): Promise<{ readonly url: string; close(): Promise<void> }> {
  const root = resolve(directory);
  const prefix = `${root}${sep}`;
  const server = createServer((request, response) => {
    const pathname = decodeURIComponent(
      new URL(request.url ?? "/", "http://127.0.0.1").pathname,
    );
    const relative = pathname === "/" ? "index.html" : pathname.slice(1);
    if (pathname === "/favicon.ico") {
      response.statusCode = 204;
      response.end();
      return;
    }
    const file = resolve(root, relative);
    if (!file.startsWith(prefix) || !existsSync(file) || !statSync(file).isFile()) {
      response.statusCode = 404;
      response.end("Not found");
      return;
    }
    response.setHeader(
      "content-type",
      CONTENT_TYPES.get(extname(file)) ?? "application/octet-stream",
    );
    createReadStream(file).pipe(response);
  });

  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolveListen();
    });
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Не удалось определить порт статического сервера");
  }

  return {
    url: `http://127.0.0.1:${String(address.port)}/`,
    close: () =>
      new Promise<void>((resolveClose, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolveClose();
        });
      }),
  };
}

async function runInBrowser(
  browser: Browser,
  appName: AppName,
  url: string,
  options: RunOptions,
): Promise<RunResult> {
  const page = await browser.newPage();
  await page.addInitScript(
    "globalThis.__name = globalThis.__name || ((value) => value);",
  );
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    errors.push(error.message);
  });

  try {
    await page.goto(url, { waitUntil: "load" });
    await page.waitForFunction(
      () =>
        (window as unknown as { __hydrateBench?: unknown }).__hydrateBench !==
        undefined,
    );

    const result = await page.evaluate(
      async (payload: RunOptions): Promise<RunResult> => {
        interface BrowserHydrationApi {
          prepare?(): void;
          hydrate(container: Element): Promise<() => void>;
        }

        interface Prepared {
          readonly container: HTMLElement;
          readonly app: Element;
          readonly list: Element;
          readonly value: Element;
          readonly plus: HTMLElement;
          readonly items: readonly Element[];
        }

        const api = (
          window as unknown as { __hydrateBench?: BrowserHydrationApi }
        ).__hydrateBench;
        if (api === undefined) {
          throw new Error("hydrate API не зарегистрирован");
        }

        const expectedLabels = Array.from(
          { length: payload.rows },
          (_, index) => `Item ${String(index)}`,
        );

        const readText = (element: Element): string => element.textContent ?? "";

        const prepare = (): Prepared => {
          const container = document.createElement("div");
          container.innerHTML = payload.ssrHtml;
          document.body.appendChild(container);

          const app = container.querySelector(".app");
          const list = container.querySelector(".list");
          const value = container.querySelector(".value");
          const buttons = Array.from(container.querySelectorAll("button"));
          const plus = buttons.find((button) => button.textContent === "+");
          const items = Array.from(container.querySelectorAll(".list > li"));

          if (
            app === null ||
            list === null ||
            value === null ||
            plus === undefined
          ) {
            throw new Error("SSR-разметка не содержит ожидаемых узлов");
          }
          if (items.length !== payload.rows) {
            throw new Error(
              `SSR-строк ${String(items.length)} вместо ${String(payload.rows)}`,
            );
          }

          return {
            container,
            app,
            list,
            value,
            plus: plus as HTMLElement,
            items,
          };
        };

        const validate = async (
          entry: Prepared,
          verifyInteraction: boolean,
        ): Promise<void> => {
          const hydratedApp = entry.container.querySelector(".app");
          const hydratedList = entry.container.querySelector(".list");
          const hydratedValue = entry.container.querySelector(".value");
          const hydratedItems = Array.from(
            entry.container.querySelectorAll(".list > li"),
          );

          if (hydratedApp !== entry.app) {
            throw new Error("узел .app не переиспользован при гидрации");
          }
          if (hydratedList !== entry.list) {
            throw new Error("узел .list не переиспользован при гидрации");
          }
          if (hydratedValue !== entry.value) {
            throw new Error("узел .value не переиспользован при гидрации");
          }
          if (hydratedItems.length !== payload.rows) {
            throw new Error("после гидрации изменилось число строк");
          }
          for (let index = 0; index < payload.rows; index += 1) {
            if (hydratedItems[index] !== entry.items[index]) {
              throw new Error(`узел строки ${String(index)} не переиспользован`);
            }
            if (hydratedItems[index]?.textContent !== expectedLabels[index]) {
              throw new Error(`текст строки ${String(index)} не совпал`);
            }
          }
          if (readText(entry.value) !== "0") {
            throw new Error("значение счётчика не совпало");
          }

          if (verifyInteraction) {
            entry.plus.click();
            await new Promise<void>((resolveTick) => {
              setTimeout(resolveTick, 0);
            });
            if (readText(entry.value) !== "1") {
              throw new Error("обработчик счётчика не подключён");
            }
          }
        };

        const runBatch = async (verifyInteraction: boolean): Promise<number> => {
          api.prepare?.();
          const prepared = Array.from({ length: payload.batch }, () => prepare());

          const started = performance.now();
          const disposers: (() => void)[] = [];
          for (const entry of prepared) {
            disposers.push(await api.hydrate(entry.container));
          }
          const elapsed = performance.now() - started;

          for (let index = 0; index < prepared.length; index += 1) {
            const entry = prepared[index];
            if (entry === undefined) {
              continue;
            }
            await validate(entry, verifyInteraction && index === 0);
            disposers[index]?.();
            entry.container.remove();
          }

          return elapsed;
        };

        for (let index = 0; index < payload.warmup; index += 1) {
          await runBatch(false);
        }

        const samples: number[] = [];
        for (let index = 0; index < payload.iterations; index += 1) {
          samples.push(await runBatch(index === 0));
        }

        return { samples, checks: payload.iterations * payload.batch };
      },
      options,
    );

    assert.deepEqual(errors, []);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${appName}: ${message}`, { cause: error });
  } finally {
    await page.close();
  }
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const left = sorted[middle - 1];
  const right = sorted[middle];
  if (left === undefined || right === undefined) {
    return sorted[middle] ?? 0;
  }
  return sorted.length % 2 === 1 ? right : (left + right) / 2;
}

function format(value: number, digits: number): string {
  return value.toLocaleString("ru-RU", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

async function main(): Promise<void> {
  const ssrHtml = new Map<AppName, string>();

  for (const app of APPS) {
    await buildApp(app);
    ssrHtml.set(app.name, await renderSsr(app));
  }

  const silentHtml = ssrHtml.get("silent");
  const solidHtml = ssrHtml.get("solid");
  if (silentHtml === undefined || solidHtml === undefined) {
    throw new Error("Не удалось получить SSR-разметку");
  }

  assert.equal(countOccurrences(silentHtml, "<li"), ROWS);
  assert.equal(countOccurrences(solidHtml, "<li"), ROWS);
  assert.ok(
    silentHtml.includes("silent-hole-"),
    "silent: SSR-разметка без маркеров гидрации",
  );
  assert.ok(
    solidHtml.includes('data-hk="'),
    "solid: SSR-разметка без data-hk",
  );
  assert.equal(
    canonicalMarkup(silentHtml),
    canonicalMarkup(solidHtml),
    "видимая разметка silent и solid различается",
  );
  assert.ok(silentHtml.includes(TITLE));
  assert.ok(solidHtml.includes(TITLE));

  const browser = await chromium.launch({
    executablePath: findChrome(),
    headless: true,
    args: ["--no-sandbox"],
  });

  const metrics: AppMetrics[] = [];
  try {
    for (const app of APPS) {
      const html = ssrHtml.get(app.name);
      if (html === undefined) {
        throw new Error(`Нет SSR-разметки для ${app.name}`);
      }
      const server = await startStaticServer(clientDirectory(app));
      try {
        const result = await runInBrowser(browser, app.name, server.url, {
          ssrHtml: html,
          warmup: WARMUP,
          iterations: ITERATIONS,
          rows: ROWS,
          batch: BATCH,
        });
        metrics.push({ app, samples: result.samples, checks: result.checks });
      } finally {
        await server.close();
      }
    }

    const silent = metrics.find((entry) => entry.app.name === "silent");
    const solid = metrics.find((entry) => entry.app.name === "solid");
    if (silent === undefined || solid === undefined) {
      throw new Error("Не хватает результатов замеров");
    }

    const silentOps = (1000 * BATCH) / mean(silent.samples);
    const solidOps = (1000 * BATCH) / mean(solid.samples);
    const ratio =
      solidOps === 0 ? "n/a" : `${format(silentOps / solidOps, 2)}x`;

    const rows = metrics.map((entry) => {
      const average = mean(entry.samples) / BATCH;
      return {
        приложение: entry.app.name,
        "mean, ms": format(average, 4),
        "p50, ms": format(median(entry.samples) / BATCH, 4),
        "ops/s": format(1000 / average, 1),
        "к solid": entry.app.name === "solid" ? "1.00x" : ratio,
      };
    });

    console.log(
      `Гидрация в Chromium: ${String(ROWS)} строк, ${String(ITERATIONS)} замеров по ${String(BATCH)} гидраций, warmup ${String(WARMUP)} замеров`,
    );
    console.log(
      `Chromium ${browser.version()}, Node.js ${process.version}, CPU: ${cpus()[0]?.model ?? "unknown"}`,
    );
    console.table(rows);
    console.log(
      `Корректность: ${String(silent.checks)} гидраций silent и ${String(solid.checks)} гидраций solid — узлы переиспользованы, значения и обработчик счётчика совпали.`,
    );
    console.log("Больше — лучше; silent/solid > 1 — silent быстрее.");
  } finally {
    await browser.close();
  }
}

await main();
