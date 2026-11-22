import type { MessagePort } from "node:worker_threads";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPool,
  type PoolEvent,
  type PoolStreamOptions,
  type RenderPool,
  type StreamHandle,
} from "../../src/pool/pool.js";
import {
  createFakeHarness,
  type FakeHarness,
  type FakeWorker,
} from "./fake-worker.js";
import { POOL_PROTOCOL, type MainToWorker } from "../../src/pool/protocol.js";

const ENTRY = new URL("file:///virtual/entry.js");
const pools: RenderPool[] = [];

afterEach(async () => {
  vi.useRealTimers();
  for (const pool of pools.splice(0)) {
    await pool.close({ force: true });
  }
});

// Управляемые таймеры: подменяем только setTimeout/clearTimeout, чтобы
// MessagePort и setImmediate продолжали работать по-настоящему.
function useControlledTimers(): void {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
}

async function flushTasks(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

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

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2000,
): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("waitFor: условие не выполнилось за отведённое время");
    }
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
}

interface StreamHarness {
  readonly handle: StreamHandle;
  readonly worker: FakeWorker;
  readonly port: MessagePort;
  readonly controlMessages: string[];
}

async function openStream(
  pool: RenderPool,
  harness: FakeHarness,
  options: PoolStreamOptions = {},
): Promise<StreamHarness> {
  const handle = pool.renderStream([], options);
  const worker = harness.workers[0];
  if (worker === undefined) {
    throw new Error("Воркер не создан");
  }
  const message = (await worker.waitForMessage(
    (candidate) => candidate.type === "render-stream",
  )) as MainToWorker & { readonly port: MessagePort };
  const controlMessages: string[] = [];
  message.port.on("message", (control: unknown) => {
    const typed = control as { type?: string };
    controlMessages.push(typed.type ?? "unknown");
  });
  message.port.start();
  return { handle, worker, port: message.port, controlMessages };
}

async function readAll(stream: ReadableStream<string>): Promise<string> {
  const reader = stream.getReader();
  let result = "";
  for (;;) {
    const next = await reader.read();
    if (next.done === true) {
      return result;
    }
    result += next.value;
  }
}

describe("render pool: streaming", () => {
  it("отдаёт head до чанков, финальный head и end", async () => {
    const harness = createFakeHarness();
    const pool = makePool(harness, { workers: 1 });
    const events: string[] = [];
    let shellBytes = 0;

    const stream = await openStream(pool, harness, {
      onHead(head, info) {
        events.push(`${info.final ? "final" : "shell"}:${head}`);
      },
      onShell(info) {
        shellBytes = info.bytes;
      },
    });

    stream.port.postMessage({
      type: "head",
      head: "<title>shell</title>",
      final: false,
    });
    stream.port.postMessage({ type: "shell", bytes: 13 });
    stream.port.postMessage({ type: "chunk", chunk: "a" });
    stream.port.postMessage({ type: "chunk", chunk: "b" });
    stream.port.postMessage({
      type: "head",
      head: "<title>final</title>",
      final: true,
    });
    stream.port.postMessage({ type: "end" });

    await expect(stream.handle.head).resolves.toBe("<title>shell</title>");
    await expect(readAll(stream.handle.stream)).resolves.toBe("ab");
    const summary = await stream.handle.done;
    expect(summary).toMatchObject({
      head: "<title>shell</title>",
      finalHead: "<title>final</title>",
      chunks: 2,
      chars: 2,
      workerId: 1,
    });
    expect(events).toEqual([
      "shell:<title>shell</title>",
      "final:<title>final</title>",
    ]);
    expect(shellBytes).toBe(13);
  });

  it("использует единственный head как finalHead", async () => {
    const harness = createFakeHarness();
    const pool = makePool(harness, { workers: 1 });
    const stream = await openStream(pool, harness);

    stream.port.postMessage({ type: "head", head: "only", final: false });
    stream.port.postMessage({ type: "end" });

    const summary = await stream.handle.done;
    expect(summary.head).toBe("only");
    expect(summary.finalHead).toBe("only");
    await expect(stream.handle.finalHead).resolves.toBe("only");
  });

  it("stream-head-missing: тело закрывается, done reject", async () => {
    const harness = createFakeHarness();
    const pool = makePool(harness, { workers: 1 });
    const stream = await openStream(pool, harness);

    stream.port.postMessage({ type: "chunk", chunk: "body" });
    stream.port.postMessage({ type: "end" });

    const body = await readAll(stream.handle.stream);
    expect(body).toBe("body");
    await expect(stream.handle.done).rejects.toMatchObject({
      code: "stream-head-missing",
    });
    await expect(stream.handle.head).rejects.toMatchObject({
      code: "stream-head-missing",
    });
    expect(pool.stats()).toMatchObject({ failed: 1 });
  });

  it("передаёт ошибку после shell и в поток, и в done", async () => {
    const harness = createFakeHarness();
    const pool = makePool(harness, { workers: 1 });
    const stream = await openStream(pool, harness);

    stream.port.postMessage({ type: "head", head: "h", final: false });
    stream.port.postMessage({ type: "shell", bytes: 1 });
    stream.port.postMessage({
      type: "error",
      error: { name: "BoomError", message: "boom", code: "boom" },
    });

    await expect(readAll(stream.handle.stream)).rejects.toMatchObject({
      name: "BoomError",
      message: "boom",
      code: "boom",
    });
    await expect(stream.handle.done).rejects.toMatchObject({ name: "BoomError" });
  });

  it("handle.cancel отправляет cancel воркеру и отклоняет done", async () => {
    const harness = createFakeHarness();
    const pool = makePool(harness, { workers: 1, terminateGraceMs: 30 });
    const stream = await openStream(pool, harness);

    stream.port.postMessage({ type: "head", head: "h", final: false });
    stream.port.postMessage({ type: "chunk", chunk: "a" });
    stream.handle.cancel();

    await expect(stream.handle.done).rejects.toMatchObject({
      name: "AbortError",
      code: "aborted",
    });
    await waitFor(() => stream.controlMessages.includes("cancel"));
    await waitFor(() => stream.worker.isExited);
    expect(pool.stats()).toMatchObject({ aborted: 1 });
  });

  it("reader.cancel отменяет стрим", async () => {
    const harness = createFakeHarness();
    const pool = makePool(harness, { workers: 1, terminateGraceMs: 0 });
    const stream = await openStream(pool, harness);

    stream.port.postMessage({ type: "head", head: "h", final: false });
    stream.port.postMessage({ type: "chunk", chunk: "a" });

    const reader = stream.handle.stream.getReader();
    await expect(reader.read()).resolves.toEqual({ done: false, value: "a" });
    await reader.cancel();

    await expect(stream.handle.done).rejects.toMatchObject({
      name: "AbortError",
      code: "aborted",
    });
    await waitFor(() => stream.worker.isExited);
  });

  it("signal aborted до вызова даёт errored-поток без воркера", async () => {
    const harness = createFakeHarness();
    const pool = makePool(harness, { workers: 1 });
    const controller = new AbortController();
    controller.abort();

    const handle = pool.renderStream([], { signal: controller.signal });
    await expect(handle.done).rejects.toMatchObject({
      name: "AbortError",
      code: "aborted",
    });
    await expect(readAll(handle.stream)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(harness.workers).toHaveLength(0);
  });

  it("общий timeout завершает стрим и воркер", async () => {
    const harness = createFakeHarness();
    const pool = makePool(harness, { workers: 1, terminateGraceMs: 0 });
    const stream = await openStream(pool, harness, { timeoutMs: 20 });

    stream.port.postMessage({ type: "head", head: "h", final: false });

    await expect(stream.handle.done).rejects.toMatchObject({
      name: "TimeoutError",
      code: "timeout",
    });
    await waitFor(() => stream.worker.isExited);
    expect(pool.stats()).toMatchObject({ timedOut: 1 });
  });

  it("idle timeout срабатывает без новых сообщений", async () => {
    const harness = createFakeHarness();
    const pool = makePool(harness, { workers: 1, terminateGraceMs: 0 });
    const stream = await openStream(pool, harness, {
      timeoutMs: 0,
      idleTimeoutMs: 20,
    });

    stream.port.postMessage({ type: "head", head: "h", final: false });

    await expect(stream.handle.done).rejects.toMatchObject({
      name: "TimeoutError",
      code: "timeout",
    });
    expect(pool.stats()).toMatchObject({ timedOut: 1 });
  });

  it("пауза не отключает idle timeout: медленный читатель продлевает стрим", async () => {
    useControlledTimers();
    const harness = createFakeHarness();
    const pool = makePool(harness, { workers: 1, terminateGraceMs: 0 });
    const stream = await openStream(pool, harness, {
      timeoutMs: 0,
      idleTimeoutMs: 50,
      highWaterMark: 4,
    });

    stream.port.postMessage({ type: "head", head: "h", final: false });
    stream.port.postMessage({ type: "chunk", chunk: "aaaa" });
    stream.port.postMessage({ type: "chunk", chunk: "bbbb" });
    stream.port.postMessage({ type: "chunk", chunk: "cccc" });
    stream.port.postMessage({ type: "chunk", chunk: "dddd" });

    await waitFor(() => stream.controlMessages.includes("pause"));
    // На паузе idle-таймер обязан быть вооружён, иначе «мёртвый» consumer
    // удерживал бы воркер бесконечно.
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    const reader = stream.handle.stream.getReader();
    const values: string[] = [];
    // Суммарно проходит 160 мс > idleTimeoutMs (50 мс), но каждое чтение
    // сбрасывает таймер, поэтому стрим должен выжить.
    for (let index = 0; index < 4; index += 1) {
      await vi.advanceTimersByTimeAsync(40);
      expect(pool.stats().timedOut).toBe(0);
      const next = await reader.read();
      expect(next.done).toBe(false);
      values.push(next.value as string);
      await flushTasks();
    }

    expect(values).toEqual(["aaaa", "bbbb", "cccc", "dddd"]);
    expect(pool.stats().timedOut).toBe(0);

    stream.port.postMessage({ type: "end" });

    await expect(stream.handle.done).resolves.toMatchObject({
      chars: 16,
      chunks: 4,
    });
    await expect(reader.read()).resolves.toEqual({ done: true, value: undefined });
    expect(pool.stats().timedOut).toBe(0);
  });

  it("пауза без чтений: idle timeout срабатывает и завершает стрим", async () => {
    useControlledTimers();
    const harness = createFakeHarness();
    const pool = makePool(harness, { workers: 1, terminateGraceMs: 0 });
    const stream = await openStream(pool, harness, {
      timeoutMs: 0,
      idleTimeoutMs: 50,
      highWaterMark: 4,
    });

    stream.port.postMessage({ type: "head", head: "h", final: false });
    stream.port.postMessage({ type: "chunk", chunk: "aaaa" });
    stream.port.postMessage({ type: "chunk", chunk: "bbbb" });

    await waitFor(() => stream.controlMessages.includes("pause"));
    expect(pool.stats().timedOut).toBe(0);

    // Никто не читает: по idleTimeoutMs должен сработать таймаут.
    await vi.advanceTimersByTimeAsync(50);

    await expect(stream.handle.done).rejects.toMatchObject({
      name: "TimeoutError",
      code: "timeout",
    });
    expect(pool.stats()).toMatchObject({ timedOut: 1, failed: 1 });
    await waitFor(() => stream.worker.isExited);
  });

  it("idleTimeoutMs: 0 и timeoutMs: 0 отключают таймаут даже на паузе без чтений", async () => {
    useControlledTimers();
    const harness = createFakeHarness();
    const pool = makePool(harness, { workers: 1, terminateGraceMs: 0 });
    const stream = await openStream(pool, harness, {
      timeoutMs: 0,
      idleTimeoutMs: 0,
      highWaterMark: 4,
    });

    stream.port.postMessage({ type: "head", head: "h", final: false });
    stream.port.postMessage({ type: "chunk", chunk: "aaaa" });
    stream.port.postMessage({ type: "chunk", chunk: "bbbb" });

    await waitFor(() => stream.controlMessages.includes("pause"));
    expect(vi.getTimerCount()).toBe(0);

    let settled = false;
    void stream.handle.done.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    // Большой шаг управляемых таймеров: за это время не должно ничего
    // сработать, потому что idle timeout явно отключён.
    await vi.advanceTimersByTimeAsync(60_000);
    await flushTasks();

    expect(settled).toBe(false);
    expect(pool.stats().timedOut).toBe(0);
    expect(stream.controlMessages).not.toContain("cancel");

    // Отменяем стрим, чтобы тест не оставлял живой воркер.
    stream.handle.cancel("тест завершён");
    await expect(stream.handle.done).rejects.toMatchObject({
      name: "AbortError",
      code: "aborted",
    });
    await waitFor(() => stream.worker.isExited);
  });

  it("queue-full для stream отклоняет handle как PoolError", async () => {
    const harness = createFakeHarness();
    const pool = makePool(harness, { workers: 1, maxQueue: 0 });

    await openStream(pool, harness);
    const handle = pool.renderStream([]);

    await expect(handle.done).rejects.toMatchObject({
      code: "queue-full",
      name: "PoolError",
    });
    await expect(readAll(handle.stream)).rejects.toMatchObject({
      code: "queue-full",
    });
    expect(pool.stats().rejectedOverflow).toBe(1);
  });

  it("timeout стрима в очереди не ждёт boot и не спавнит задачу позже", async () => {
    const harness = createFakeHarness({ autoReady: false });
    const pool = makePool(harness, { workers: 1 });
    const handle = pool.renderStream([], { timeoutMs: 20 });

    await expect(handle.done).rejects.toMatchObject({
      name: "TimeoutError",
      code: "timeout",
    });
    await expect(readAll(handle.stream)).rejects.toMatchObject({
      code: "timeout",
    });
    expect(pool.stats().queueDepth).toBe(0);
    expect(pool.stats().timedOut).toBe(1);

    const worker = harness.workers[0];
    worker?.send({
      type: "ready",
      protocol: POOL_PROTOCOL,
      capabilities: { render: true, renderStream: true },
    });
    await waitFor(() => pool.stats().workers.idle === 1);
    expect(
      worker?.received.some((message) => message.type === "render-stream"),
    ).toBe(false);
  });

  it("не падает на stream error без корректной wire-ошибки", async () => {
    const harness = createFakeHarness();
    const errors: unknown[] = [];
    const pool = makePool(harness, {
      workers: 1,
      terminateGraceMs: 0,
      onError: (error) => errors.push(error),
    });
    const stream = await openStream(pool, harness);

    stream.port.postMessage({ type: "head", head: "h", final: false });
    stream.port.postMessage({ type: "error" });

    await expect(stream.handle.done).rejects.toMatchObject({
      name: "PoolError",
      code: "protocol-mismatch",
    });
    expect(pool.state).toBe("failed");
    expect(errors.length).toBeGreaterThan(0);
  });

  it("закрытие порта без end даёт worker-exited", async () => {
    const harness = createFakeHarness();
    const pool = makePool(harness, { workers: 1, terminateGraceMs: 0 });
    const stream = await openStream(pool, harness);

    stream.port.postMessage({ type: "head", head: "h", final: false });
    stream.port.close();

    await expect(stream.handle.done).rejects.toMatchObject({
      code: "worker-exited",
    });
  });

  it("stream-overflow при переполнении буфера", async () => {
    const harness = createFakeHarness();
    const pool = makePool(harness, { workers: 1, terminateGraceMs: 0 });
    const stream = await openStream(pool, harness, {
      highWaterMark: 1,
      maxBufferedChars: 5,
    });

    stream.port.postMessage({ type: "head", head: "h", final: false });
    stream.port.postMessage({ type: "chunk", chunk: "aaaa" });
    stream.port.postMessage({ type: "chunk", chunk: "bbbb" });
    stream.port.postMessage({ type: "chunk", chunk: "c" });
    stream.port.postMessage({ type: "chunk", chunk: "d" });

    await expect(stream.handle.done).rejects.toMatchObject({
      code: "stream-overflow",
    });
    await waitFor(() => stream.worker.isExited);
  });

  it("pool.close с активным стримом даёт AbortError pool-closed", async () => {
    const harness = createFakeHarness();
    const pool = makePool(harness, { workers: 1, terminateGraceMs: 0 });
    const stream = await openStream(pool, harness);
    stream.port.postMessage({ type: "head", head: "h", final: false });

    const closing = pool.close();
    await expect(stream.handle.done).rejects.toMatchObject({
      name: "AbortError",
      code: "pool-closed",
    });
    await closing;
    expect(pool.state).toBe("closed");
    await waitFor(() => stream.worker.isExited);
  });

  it("игнорирует сообщения после end", async () => {
    const harness = createFakeHarness();
    const pool = makePool(harness, { workers: 1 });
    const stream = await openStream(pool, harness);

    stream.port.postMessage({ type: "head", head: "h", final: false });
    stream.port.postMessage({ type: "chunk", chunk: "a" });
    stream.port.postMessage({ type: "end" });
    stream.port.postMessage({ type: "chunk", chunk: "late" });

    const summary = await stream.handle.done;
    expect(summary.chunks).toBe(1);
    await expect(readAll(stream.handle.stream)).resolves.toBe("a");
  });

  it("возвращает stream-unsupported без renderStream в entry", async () => {
    const harness = createFakeHarness({
      capabilities: { render: true, renderStream: false },
    });
    const pool = makePool(harness, { workers: 1 });
    const handle = pool.renderStream([]);

    await expect(handle.done).rejects.toMatchObject({
      code: "stream-unsupported",
    });
    await expect(readAll(handle.stream)).rejects.toMatchObject({
      code: "stream-unsupported",
    });
    expect(pool.stats()).toMatchObject({ failed: 1 });
  });

  it("эмитит события стрима", async () => {
    const harness = createFakeHarness();
    const events: PoolEvent[] = [];
    const pool = createPool(ENTRY, {
      workers: 1,
      onEvent: (event) => events.push(event),
    }, { workerFactory: harness.factory });
    pools.push(pool);

    const stream = await openStream(pool, harness);
    stream.port.postMessage({ type: "head", head: "h", final: false });
    stream.port.postMessage({ type: "end" });
    await stream.handle.done;

    const types = events.map((event) => event.type);
    expect(types).toContain("job:queued");
    expect(types).toContain("job:start");
    expect(types).toContain("job:finish");
  });

  it("не смешивает стрим с unary-корреляцией", async () => {
    const harness = createFakeHarness();
    const pool = makePool(harness, { workers: 1 });

    const stream = await openStream(pool, harness);
    stream.port.postMessage({ type: "head", head: "h", final: false });
    stream.port.postMessage({ type: "end" });
    await stream.handle.done;

    harness.handler = (message, worker) => {
      if (message.type === "render") {
        worker.sendResult(message.id, "unary", "h");
      }
    };
    await expect(pool.render([])).resolves.toEqual({ html: "unary", head: "h" });
    expect(pool.stats()).toMatchObject({ completed: 2 });
  });

  it("cancel до старта убирает стрим из очереди", async () => {
    const harness = createFakeHarness({ autoReady: false });
    const pool = makePool(harness, { workers: 1 });
    const handle = pool.renderStream([]);
    handle.cancel("передумали");

    await expect(handle.done).rejects.toMatchObject({
      name: "AbortError",
      code: "aborted",
    });
    const worker = harness.workers[0];
    expect(
      worker?.received.some((message) => message.type === "render-stream"),
    ).toBe(false);
    expect(harness.workers).toHaveLength(1);

    worker?.send({
      type: "ready",
      protocol: POOL_PROTOCOL,
      capabilities: { render: true, renderStream: true },
    });
    harness.handler = (message, current) => {
      if (message.type === "render") {
        current.sendResult(message.id, "ok", "");
      }
    };
    await expect(pool.render([])).resolves.toEqual({ html: "ok", head: "" });
  });
});
