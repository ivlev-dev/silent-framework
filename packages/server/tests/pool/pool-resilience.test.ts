import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPool,
  type RenderPool,
  type StreamHandle,
} from "../../src/pool/pool.js";
import { PoolError } from "../../src/pool/errors.js";
import { POOL_PROTOCOL } from "../../src/pool/protocol.js";
import type { RenderResult } from "../../src/render.js";
import {
  createFakeHarness,
  type FakeHarness,
} from "./fake-worker.js";

const ENTRY = new URL("file:///virtual/entry.js");
const pools: RenderPool[] = [];

afterEach(async () => {
  vi.useRealTimers();
  delete process.env.SILENT_POOL_DEBUG;
  for (const pool of pools.splice(0)) {
    await pool.close({ force: true });
  }
});

function makePool(
  harness: FakeHarness,
  options: Parameters<typeof createPool>[1] = {},
): RenderPool {
  const pool = createPool(ENTRY, options, {
    workerFactory: harness.factory,
  });
  pools.push(pool);
  return pool;
}

function respondWith(harness: FakeHarness): void {
  harness.handler = (message, worker) => {
    if (message.type === "render") {
      worker.sendResult(message.id, "ok", "head");
    }
  };
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2000,
): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("waitFor: условие не выполнилось за отведённое время");
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Ожидалось отклонение промиса");
}

// Контракт: render() не бросает синхронно ни при каких args.
function renderNoThrow(
  pool: RenderPool,
  args: readonly unknown[],
): Promise<unknown> {
  let result: Promise<RenderResult> | undefined;
  expect(() => {
    result = pool.render(args);
  }).not.toThrow();
  return result as Promise<unknown>;
}

function renderStreamNoThrow(
  pool: RenderPool,
  args: readonly unknown[],
): StreamHandle {
  let result: StreamHandle | undefined;
  expect(() => {
    result = pool.renderStream(args);
  }).not.toThrow();
  return result as StreamHandle;
}

describe("render pool: устойчивость", () => {
  it("boot-краш дополнительного воркера не валит пул при живом ready", async () => {
    const harness = createFakeHarness({ autoReady: false });
    const pool = makePool(harness, { workers: 2, warmup: "eager" });
    const ready = pool.ready();

    await waitFor(() => harness.workers.length === 2);
    const first = harness.workers[0]!;
    const second = harness.workers[1]!;
    first.send({
      type: "ready",
      protocol: POOL_PROTOCOL,
      capabilities: { render: true, renderStream: true },
    });
    await waitFor(() => pool.stats().workers.idle === 1);
    second.exit(1);

    await expect(ready).resolves.toBeUndefined();
    expect(pool.state).toBe("ready");
    expect(pool.stats()).toMatchObject({ deaths: 1, restarts: 1 });

    respondWith(harness);
    await expect(pool.render([])).resolves.toEqual({ html: "ok", head: "head" });
  });

  it("валит пул через entry-load-failed, только если ready-воркеров нет", async () => {
    const harness = createFakeHarness({ autoReady: false });
    const pool = makePool(harness, { workers: 2, warmup: "eager" });

    await waitFor(() => harness.workers.length === 2);
    harness.workers[0]?.exit(1);
    await expect(pool.ready()).rejects.toMatchObject({ code: "entry-load-failed" });
    expect(pool.state).toBe("failed");
  });

  it("close({ timeoutMs: 0 }) не ждёт зависшую задачу", async () => {
    const harness = createFakeHarness();
    const pool = makePool(harness, { workers: 1 });
    const pending = pool.render(["never"]);
    await waitFor(() => harness.workers[0] !== undefined);

    const started = performance.now();
    await pool.close({ timeoutMs: 0 });
    expect(performance.now() - started).toBeLessThan(1000);
    expect(pool.state).toBe("closed");
    expect(harness.workers[0]?.isExited).toBe(true);
    await expect(pending).rejects.toBeInstanceOf(Error);
  });

  it("job.done резолвится после закрытия тела стрима", async () => {
    const harness = createFakeHarness();
    const pool = makePool(harness, { workers: 1 });
    const handle = pool.renderStream([], { highWaterMark: 1 });
    const worker = harness.workers[0];
    await waitFor(() => worker !== undefined);
    const message = await worker!.waitForMessage(
      (candidate) => candidate.type === "render-stream",
    );
    const port = (message as { port: import("node:worker_threads").MessagePort }).port;
    port.start();
    port.postMessage({ type: "head", head: "h", final: false });
    port.postMessage({ type: "chunk", chunk: "aaaa" });
    port.postMessage({ type: "chunk", chunk: "bbbb" });
    port.postMessage({ type: "end" });

    // end уже обработан пулом (job:finish отправлен), но тело не вычитано:
    // второй чанк лежит в буфере из-за backpressure (highWaterMark: 1).
    await waitFor(() => pool.stats().completed === 1);

    let settled = false;
    void handle.done.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);

    const reader = handle.stream.getReader();
    let body = "";
    for (;;) {
      const next = await reader.read();
      if (next.done === true) {
        break;
      }
      body += next.value;
    }
    expect(body).toBe("aaaabbbb");
    await expect(handle.done).resolves.toMatchObject({ chars: 8, chunks: 2 });
  });

  it("cancel до чтения тела не даёт успешный done", async () => {
    const harness = createFakeHarness();
    const pool = makePool(harness, { workers: 1 });
    const handle = pool.renderStream([], { highWaterMark: 1 });
    const worker = harness.workers[0];
    await waitFor(() => worker !== undefined);
    const message = await worker!.waitForMessage(
      (candidate) => candidate.type === "render-stream",
    );
    const port = (message as { port: import("node:worker_threads").MessagePort }).port;
    port.start();
    port.postMessage({ type: "head", head: "h", final: false });
    port.postMessage({ type: "chunk", chunk: "aaaa" });
    port.postMessage({ type: "chunk", chunk: "bbbb" });
    port.postMessage({ type: "end" });
    await waitFor(() => pool.stats().completed === 1);

    // Тело не читали: успешный done означал бы потерю чанка "bbbb".
    handle.cancel("не дочитали");

    await expect(handle.done).rejects.toMatchObject({
      name: "AbortError",
      code: "aborted",
    });
    await expect(handle.stream.getReader().read()).rejects.toMatchObject({
      code: "aborted",
    });
    expect(pool.stats()).toMatchObject({ completed: 1, aborted: 1 });
  });

  it("reader.cancel до чтения тела тоже не даёт успешный done", async () => {
    const harness = createFakeHarness();
    const pool = makePool(harness, { workers: 1 });
    const handle = pool.renderStream([], { highWaterMark: 1 });
    const worker = harness.workers[0];
    await waitFor(() => worker !== undefined);
    const message = await worker!.waitForMessage(
      (candidate) => candidate.type === "render-stream",
    );
    const port = (message as { port: import("node:worker_threads").MessagePort }).port;
    port.start();
    port.postMessage({ type: "head", head: "h", final: false });
    port.postMessage({ type: "chunk", chunk: "aaaa" });
    port.postMessage({ type: "chunk", chunk: "bbbb" });
    port.postMessage({ type: "end" });
    await waitFor(() => pool.stats().completed === 1);

    const reader = handle.stream.getReader();
    await reader.cancel();

    await expect(handle.done).rejects.toMatchObject({
      name: "AbortError",
      code: "aborted",
    });
    // После cancel() тот же reader уже закрыт — читать из него нечего.
    await expect(reader.read()).resolves.toMatchObject({ done: true });
    expect(pool.stats().aborted).toBe(1);
  });

  it("signal abort после end, но до чтения тела, отклоняет done", async () => {
    const harness = createFakeHarness();
    const pool = makePool(harness, { workers: 1 });
    const controller = new AbortController();
    const handle = pool.renderStream([], {
      highWaterMark: 1,
      signal: controller.signal,
    });
    const worker = harness.workers[0];
    await waitFor(() => worker !== undefined);
    const message = await worker!.waitForMessage(
      (candidate) => candidate.type === "render-stream",
    );
    const port = (message as { port: import("node:worker_threads").MessagePort }).port;
    port.start();
    port.postMessage({ type: "head", head: "h", final: false });
    port.postMessage({ type: "chunk", chunk: "aaaa" });
    port.postMessage({ type: "chunk", chunk: "bbbb" });
    port.postMessage({ type: "end" });
    await waitFor(() => pool.stats().completed === 1);

    controller.abort();

    await expect(handle.done).rejects.toMatchObject({
      name: "AbortError",
      code: "aborted",
    });
    expect(pool.stats().aborted).toBe(1);
  });

  it("запрещает data: entry", () => {
    expect(() =>
      createPool(new URL("data:text/javascript,export const render = () => 1")),
    ).toThrow(PoolError);
    expect(() =>
      createPool("data:text/javascript,export const render = () => 1"),
    ).toThrow(/data: entry запрещён/);
  });

  it("отклоняет слишком большие и глубокие args без спавна воркера", async () => {
    const harness = createFakeHarness();
    const pool = makePool(harness, { workers: 2 });

    await expect(pool.render(["x".repeat(9 * 1024 * 1024)])).rejects.toMatchObject({
      code: "args-not-cloneable",
    });

    let deep: unknown = "leaf";
    for (let index = 0; index < 100; index += 1) {
      deep = [deep];
    }
    await expect(pool.render([deep])).rejects.toMatchObject({
      code: "args-not-cloneable",
    });
    expect(harness.workers).toHaveLength(0);
  });

  it("args с бросающим getter: PoolError вместо синхронного throw", async () => {
    const harness = createFakeHarness();
    const pool = makePool(harness, { workers: 1 });
    const arg: Record<string, unknown> = { ok: 1 };
    Object.defineProperty(arg, "boom", {
      enumerable: true,
      configurable: true,
      get(): never {
        throw new Error("getter-boom");
      },
    });

    const error = await captureError(renderNoThrow(pool, [arg]));
    expect(error).toBeInstanceOf(PoolError);
    expect((error as PoolError).code).toBe("args-not-cloneable");
    expect(((error as PoolError).cause as Error).message).toBe("getter-boom");

    const stream = renderStreamNoThrow(pool, [arg]);
    await expect(stream.done).rejects.toMatchObject({
      code: "args-not-cloneable",
    });
    await expect(stream.stream.getReader().read()).rejects.toMatchObject({
      code: "args-not-cloneable",
    });
    expect(harness.workers).toHaveLength(0);
  });

  it("args с Proxy не бросают синхронно: PoolError в render и renderStream", async () => {
    const harness = createFakeHarness();
    const pool = makePool(harness, { workers: 1 });

    // Бросающий ownKeys-трап: падал ещё обход args в argsLimitFailure.
    const ownKeysProxy = new Proxy(
      { value: 1 },
      {
        ownKeys(): never {
          throw new Error("ownKeys-boom");
        },
      },
    );
    const ownKeysError = await captureError(renderNoThrow(pool, [ownKeysProxy]));
    expect(ownKeysError).toBeInstanceOf(PoolError);
    expect((ownKeysError as PoolError).code).toBe("args-not-cloneable");
    expect(((ownKeysError as PoolError).cause as Error).message).toBe(
      "ownKeys-boom",
    );

    const ownKeysStream = renderStreamNoThrow(pool, [ownKeysProxy]);
    await expect(ownKeysStream.done).rejects.toMatchObject({
      name: "PoolError",
      code: "args-not-cloneable",
    });
    await expect(ownKeysStream.stream.getReader().read()).rejects.toMatchObject({
      code: "args-not-cloneable",
    });

    // Proxy как таковой не клонируется: DataCloneError ловится в dataCloneFailure.
    const getProxy = new Proxy(
      { value: 1 },
      {
        get(): never {
          throw new Error("get-boom");
        },
      },
    );
    const getError = await captureError(renderNoThrow(pool, [getProxy]));
    expect(getError).toBeInstanceOf(PoolError);
    expect((getError as PoolError).code).toBe("args-not-cloneable");
    expect(((getError as PoolError).cause as Error).name).toBe("DataCloneError");

    const getStream = renderStreamNoThrow(pool, [getProxy]);
    await expect(getStream.done).rejects.toMatchObject({
      code: "args-not-cloneable",
    });

    // Сам массив args тоже может быть Proxy: for..of/итератор бросает внутри обхода.
    const argsProxy = new Proxy<unknown[]>([], {
      get(): never {
        throw new Error("args-get-boom");
      },
    });
    const argsError = await captureError(renderNoThrow(pool, argsProxy));
    expect(argsError).toBeInstanceOf(PoolError);
    expect((argsError as PoolError).code).toBe("args-not-cloneable");
    expect(((argsError as PoolError).cause as Error).message).toBe(
      "args-get-boom",
    );
    expect(harness.workers).toHaveLength(0);
  });

  it("debug-лог не печатает полный объект ошибки и props", async () => {
    process.env.SILENT_POOL_DEBUG = "1";
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    try {
      const harness = createFakeHarness();
      const pool = makePool(harness, { workers: 1 });
      const failure = Object.assign(new Error("boom"), {
        props: { secret: "token" },
        stack: "secret-stack",
      });

      const pending = pool.render([]);
      void pending.catch(() => undefined);
      await waitFor(() => harness.workers[0] !== undefined);
      harness.workers[0]?.emitError(failure);
      await new Promise<void>((resolve) => setImmediate(resolve));

      const errorLog = debug.mock.calls.find(
        (call) => typeof call[0] === "string" && call[0].includes("error"),
      );
      expect(errorLog).toBeDefined();
      const details = errorLog?.[1] as Record<string, unknown>;
      expect(Object.keys(details).sort()).toEqual(["message", "name"]);
      expect(details).not.toHaveProperty("props");
      expect(details).not.toHaveProperty("stack");
      const serialized = JSON.stringify(debug.mock.calls);
      expect(serialized).not.toContain("secret");
      expect(serialized).not.toContain("token");
    } finally {
      debug.mockRestore();
    }
  });
});
