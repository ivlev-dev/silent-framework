import { afterEach, describe, expect, it } from "vitest";
import {
  PoolError,
  type PoolEvent,
  type RenderPool,
} from "../../src/pool.js";
import { createPool } from "../../src/pool/pool.js";
import { POOL_PROTOCOL } from "../../src/pool/protocol.js";
import {
  createFakeHarness,
  type FakeHarness,
  type FakeWorker,
} from "./fake-worker.js";

const ENTRY = new URL("file:///virtual/entry.js");
const pools: RenderPool[] = [];

afterEach(async () => {
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

function respondWith(
  harness: FakeHarness,
  htmlFor: (args: readonly unknown[]) => string = () => "ok",
): void {
  harness.handler = (message, worker) => {
    if (message.type !== "render") {
      return;
    }
    worker.sendResult(message.id, htmlFor(message.args), "head");
  };
}

function renderJob(message: { type: string }): message is {
  type: "render";
  id: number;
  args: readonly unknown[];
} {
  return message.type === "render";
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

describe("render pool: unary", () => {
  it("стартует лениво: первый render создаёт один воркер", async () => {
    const harness = createFakeHarness();
    respondWith(harness);
    const pool = makePool(harness, { workers: 2 });

    expect(harness.workers).toHaveLength(0);
    const result = await pool.render(["a"]);
    expect(result).toEqual({ html: "ok", head: "head" });
    expect(harness.workers).toHaveLength(1);
    expect(pool.stats()).toMatchObject({ completed: 1, failed: 0 });
  });

  it("warmup eager поднимает всех воркеров и ready ждёт их", async () => {
    const harness = createFakeHarness();
    respondWith(harness);
    const pool = makePool(harness, { workers: 2, warmup: "eager" });

    await pool.ready();
    expect(harness.workers).toHaveLength(2);
    expect(pool.state).toBe("ready");
    expect(pool.stats().workers).toMatchObject({ total: 2, idle: 2, busy: 0 });
  });

  it("соблюдает FIFO при одном воркере", async () => {
    const harness = createFakeHarness();
    const pool = makePool(harness, { workers: 1 });

    const first = pool.render(["first"]);
    const second = pool.render(["second"]);
    const worker = harness.workers[0];
    expect(worker).toBeDefined();

    const firstMessage = await worker!.waitForMessage(
      (message) => renderJob(message) && message.args[0] === "first",
    );
    expect(
      worker!.received.some(
        (message) => renderJob(message) && message.args[0] === "second",
      ),
    ).toBe(false);

    worker!.sendResult((firstMessage as { id: number }).id, "one", "h1");
    await expect(first).resolves.toEqual({ html: "one", head: "h1" });

    const secondMessage = await worker!.waitForMessage(
      (message) => renderJob(message) && message.args[0] === "second",
    );
    worker!.sendResult((secondMessage as { id: number }).id, "two", "h2");
    await expect(second).resolves.toEqual({ html: "two", head: "h2" });
  });

  it("коррелирует ответы двух воркеров в обратном порядке", async () => {
    const harness = createFakeHarness();
    const pool = makePool(harness, { workers: 2 });

    const first = pool.render(["first"]);
    const second = pool.render(["second"]);
    await waitFor(
      () =>
        harness.workers.length === 2 &&
        ["first", "second"].every((value) =>
          harness.workers.some((worker) =>
            worker.received.some(
              (message) => renderJob(message) && message.args[0] === value,
            ),
          ),
        ),
    );

    const findJob = (
      value: string,
    ): { readonly worker: FakeWorker; readonly id: number } => {
      for (const worker of harness.workers) {
        const message = worker.received.find(
          (candidate) => renderJob(candidate) && candidate.args[0] === value,
        );
        if (message !== undefined) {
          return { worker, id: (message as { id: number }).id };
        }
      }
      throw new Error(`Не нашли задачу ${value}`);
    };

    const firstJob = findJob("first");
    const secondJob = findJob("second");

    secondJob.worker.sendResult(secondJob.id, "second-html", "second-head");
    await expect(second).resolves.toEqual({
      html: "second-html",
      head: "second-head",
    });

    firstJob.worker.sendResult(firstJob.id, "first-html", "first-head");
    await expect(first).resolves.toEqual({
      html: "first-html",
      head: "first-head",
    });
  });

  it("timeout завершает воркер и следующий render поднимает новый", async () => {
    const harness = createFakeHarness();
    const pool = makePool(harness, { workers: 1 });

    await expect(pool.render([], { timeoutMs: 20 })).rejects.toMatchObject({
      name: "TimeoutError",
      code: "timeout",
    });
    const firstWorker = harness.workers[0];
    expect(firstWorker?.isExited).toBe(true);
    expect(pool.stats()).toMatchObject({ timedOut: 1, failed: 1 });

    respondWith(harness);
    await expect(pool.render(["after-timeout"])).resolves.toEqual({
      html: "ok",
      head: "head",
    });
    expect(harness.workers).toHaveLength(2);
  });

  it("abort отклоняет задачу и завершает воркер", async () => {
    const harness = createFakeHarness();
    const pool = makePool(harness, { workers: 1 });
    const controller = new AbortController();

    const result = pool.render([], { signal: controller.signal });
    const worker = harness.workers[0];
    await worker!.waitForMessage(renderJob);
    controller.abort();

    await expect(result).rejects.toMatchObject({
      name: "AbortError",
      code: "aborted",
    });
    expect(harness.workers[0]?.isExited).toBe(true);
    expect(pool.stats()).toMatchObject({ aborted: 1, failed: 1 });
  });

  it("abort задачи в очереди даёт aborted и job:abort", async () => {
    const harness = createFakeHarness();
    const events: PoolEvent[] = [];
    const pool = makePool(harness, {
      workers: 1,
      onEvent: (event) => events.push(event),
    });

    const first = pool.render(["first"]);
    const worker = harness.workers[0];
    const firstMessage = (await worker!.waitForMessage(
      renderJob,
    )) as { id: number };

    const controller = new AbortController();
    const second = pool.render(["second"], { signal: controller.signal });
    controller.abort();

    await expect(second).rejects.toMatchObject({
      name: "AbortError",
      code: "aborted",
    });
    expect(pool.stats()).toMatchObject({ aborted: 1, failed: 0 });
    expect(pool.stats().queueDepth).toBe(0);
    expect(
      events.some(
        (event) => event.type === "job:abort" && event.kind === "render",
      ),
    ).toBe(true);

    worker!.sendResult(firstMessage.id, "one", "h1");
    await expect(first).resolves.toEqual({ html: "one", head: "h1" });
  });

  it("timeout задачи в очереди срабатывает при зависшем boot", async () => {
    const harness = createFakeHarness({ autoReady: false });
    const pool = makePool(harness, { workers: 1 });

    await expect(pool.render([], { timeoutMs: 20 })).rejects.toMatchObject({
      name: "TimeoutError",
      code: "timeout",
    });
    expect(pool.stats().queueDepth).toBe(0);
    expect(pool.stats()).toMatchObject({ timedOut: 1, completed: 0 });

    const worker = harness.workers[0];
    worker?.send({
      type: "ready",
      protocol: POOL_PROTOCOL,
      capabilities: { render: true, renderStream: true },
    });
    await waitFor(() => pool.stats().workers.idle === 1);
    expect(worker?.received.some(renderJob)).toBe(false);

    respondWith(harness);
    await expect(pool.render([])).resolves.toEqual({
      html: "ok",
      head: "head",
    });
  });

  it("игнорирует чужие и дублирующие result, staleMessages растёт", async () => {
    const harness = createFakeHarness();
    const pool = makePool(harness, { workers: 1 });

    const first = pool.render(["first"]);
    let firstSettled = false;
    void first.then(
      () => {
        firstSettled = true;
      },
      () => {
        firstSettled = true;
      },
    );
    const worker = harness.workers[0]!;
    const firstMessage = (await worker.waitForMessage(
      renderJob,
    )) as { id: number };

    worker.send({
      type: "result",
      protocol: POOL_PROTOCOL,
      id: firstMessage.id + 1000,
      result: { html: "foreign", head: "" },
    });
    await waitFor(() => pool.stats().staleMessages === 1);
    expect(firstSettled).toBe(false);

    worker.sendResult(firstMessage.id, "real", "");
    await expect(first).resolves.toEqual({ html: "real", head: "" });

    worker.sendResult(firstMessage.id, "late", "");
    await waitFor(() => pool.stats().staleMessages === 2);
    expect(pool.stats().completed).toBe(1);

    const second = pool.render(["second"]);
    let secondSettled = false;
    void second.then(
      () => {
        secondSettled = true;
      },
      () => {
        secondSettled = true;
      },
    );
    const secondMessage = (await worker.waitForMessage(
      (message) => renderJob(message) && message.args[0] === "second",
    )) as { id: number };

    worker.sendResult(firstMessage.id, "foreign-for-second", "");
    await waitFor(() => pool.stats().staleMessages === 3);
    expect(secondSettled).toBe(false);

    worker.sendResult(secondMessage.id, "second-ok", "");
    await expect(second).resolves.toEqual({
      html: "second-ok",
      head: "",
    });
  });

  it("не падает на error без корректной wire-ошибки и переводит пул в failed", async () => {
    const malformed: unknown[] = [
      { type: "error", protocol: POOL_PROTOCOL },
      { type: "error", protocol: POOL_PROTOCOL, error: { name: 42 } },
    ];

    for (const payload of malformed) {
      const harness = createFakeHarness();
      const errors: unknown[] = [];
      const pool = makePool(harness, {
        workers: 1,
        onError: (error) => errors.push(error),
      });
      const result = pool.render([]);
      const worker = harness.workers[0]!;
      const message = (await worker.waitForMessage(renderJob)) as {
        id: number;
      };

      worker.send({ ...(payload as Record<string, unknown>), id: message.id });

      const failure = await result.then(
        () => null,
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(PoolError);
      expect((failure as PoolError).code).toBe("protocol-mismatch");
      expect(pool.state).toBe("failed");
      expect(errors.length).toBeGreaterThan(0);
    }
  });

  it("close() без force дожидается активного unary", async () => {
    const harness = createFakeHarness();
    const pool = makePool(harness, { workers: 1, terminateGraceMs: 10 });
    const pending = pool.render([]);
    const worker = harness.workers[0]!;
    const message = (await worker.waitForMessage(renderJob)) as { id: number };

    const closing = pool.close();
    expect(pool.state).toBe("closing");
    expect(worker.isExited).toBe(false);

    worker.sendResult(message.id, "done", "h");
    await expect(pending).resolves.toEqual({ html: "done", head: "h" });
    await closing;
    expect(pool.state).toBe("closed");
  });

  it("передаёт name/message/stack ошибки entry", async () => {
    const harness = createFakeHarness();
    const pool = makePool(harness, { workers: 1 });
    harness.handler = (message, worker) => {
      if (!renderJob(message)) {
        return;
      }
      const error = new Error("упало внутри entry");
      error.name = "EntryFailure";
      worker.sendError(message.id, error);
    };

    const failure = await pool.render([]).then(
      () => null,
      (error: unknown) => error as Error & { code?: string },
    );
    expect(failure).toBeInstanceOf(Error);
    expect(failure?.name).toBe("EntryFailure");
    expect(failure?.message).toBe("упало внутри entry");
    expect(failure?.stack).toContain("EntryFailure");
    expect(failure?.code).toBeUndefined();
  });

  it("переживает crash: активная задача падает, следующий render рестартит", async () => {
    const harness = createFakeHarness();
    const pool = makePool(harness, { workers: 1 });

    const crashed = pool.render(["crash"]);
    const firstWorker = harness.workers[0];
    await firstWorker!.waitForMessage(renderJob);
    firstWorker?.exit(1);

    await expect(crashed).rejects.toMatchObject({ code: "worker-exited" });
    expect(pool.stats()).toMatchObject({ deaths: 1, restarts: 1 });

    respondWith(harness);
    await expect(pool.render(["after-crash"])).resolves.toEqual({
      html: "ok",
      head: "head",
    });
    expect(harness.workers).toHaveLength(2);
    expect(pool.stats()).toMatchObject({ deaths: 1, restarts: 1 });
  });

  it("отклоняет задачу при переполнении очереди", async () => {
    const harness = createFakeHarness();
    const pool = makePool(harness, { workers: 1, maxQueue: 0 });

    const first = pool.render(["first"]);
    await expect(pool.render(["second"])).rejects.toMatchObject({
      code: "queue-full",
    });
    expect(pool.stats()).toMatchObject({ rejectedOverflow: 1 });

    const worker = harness.workers[0];
    const message = await worker!.waitForMessage(renderJob);
    worker!.sendResult((message as { id: number }).id, "ok");
    await expect(first).resolves.toEqual({ html: "ok", head: "" });
  });

  it("заменяет воркер после maxTasksPerWorker", async () => {
    const harness = createFakeHarness();
    respondWith(harness);
    const pool = makePool(harness, { workers: 1, maxTasksPerWorker: 1 });

    await expect(pool.render([])).resolves.toEqual({ html: "ok", head: "head" });
    await expect(pool.render([])).resolves.toEqual({ html: "ok", head: "head" });
    expect(harness.workers).toHaveLength(2);
    expect(harness.workers[0]?.isExited).toBe(true);
  });

  it("close идемпотентен и отклоняет новые вызовы", async () => {
    const harness = createFakeHarness();
    respondWith(harness);
    const pool = makePool(harness, { workers: 1 });
    await pool.render([]);

    const first = pool.close();
    const second = pool.close();
    expect(first).toBe(second);

    await expect(pool.render([])).rejects.toMatchObject({
      code: "pool-closed",
    });
    await first;
    expect(pool.state).toBe("closed");
    expect(pool.stats().workers.total).toBe(0);
  });

  it("собирает статистику и события, не ломаясь от исключения onEvent", async () => {
    const harness = createFakeHarness();
    respondWith(harness);
    const events: PoolEvent[] = [];
    const errors: unknown[] = [];
    const pool = createPool(ENTRY, {
      workers: 1,
      onEvent: (event) => {
        events.push(event);
        if (event.type === "worker:ready") {
          throw new Error("onEvent упал");
        }
      },
      onError: (error) => {
        errors.push(error);
      },
    }, { workerFactory: harness.factory });
    pools.push(pool);

    await expect(pool.render([])).resolves.toEqual({ html: "ok", head: "head" });
    const types = events.map((event) => event.type);
    expect(types).toContain("worker:spawn");
    expect(types).toContain("worker:ready");
    expect(types).toContain("job:queued");
    expect(types).toContain("job:start");
    expect(types).toContain("job:finish");
    expect(errors).toHaveLength(1);
    expect(pool.stats()).toMatchObject({ completed: 1, failed: 0 });
  });

  it("ловит не-клонируемые аргументы без спавна воркера", async () => {
    const harness = createFakeHarness();
    const pool = makePool(harness, { workers: 2 });

    await expect(pool.render([() => 1] as never)).rejects.toMatchObject({
      code: "args-not-cloneable",
    });
    expect(harness.workers).toHaveLength(0);
  });

  it("возвращает render-unsupported без render в entry", async () => {
    const harness = createFakeHarness({
      capabilities: { render: false, renderStream: true },
    });
    const pool = makePool(harness, { workers: 1 });

    await expect(pool.render([])).rejects.toMatchObject({
      code: "render-unsupported",
    });
    expect(pool.stats()).toMatchObject({ failed: 1 });
  });

  it("переводит пул в failed при несовместимом протоколе", async () => {
    const harness = createFakeHarness({ protocol: 99 });
    const pool = makePool(harness, { workers: 2 });

    await expect(pool.render([])).rejects.toMatchObject({
      code: "protocol-mismatch",
    });
    expect(pool.state).toBe("failed");
    await expect(pool.render([])).rejects.toMatchObject({
      code: "protocol-mismatch",
    });
  });

  it("переводит пул в failed при ошибке загрузки entry", async () => {
    const harness = createFakeHarness({ autoReady: false });
    const pool = makePool(harness, { workers: 2 });

    const result = pool.render([]);
    const worker = harness.workers[0];
    worker?.send({
      type: "entry-error",
      protocol: 1,
      error: {
        name: "Error",
        message: "entry сломан",
        code: "entry-load-failed",
      },
    });

    await expect(result).rejects.toMatchObject({
      code: "entry-load-failed",
    });
    expect(pool.state).toBe("failed");
    expect(harness.workers.length).toBeLessThanOrEqual(2);
  });

  it("учитывает abort до вызова render без создания воркера", async () => {
    const harness = createFakeHarness();
    const pool = makePool(harness, { workers: 1 });
    const controller = new AbortController();
    controller.abort();

    await expect(
      pool.render([], { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError", code: "aborted" });
    expect(harness.workers).toHaveLength(0);
  });

  it("валидирует опции", () => {
    expect(() =>
      createPool(ENTRY, { workers: 0 }, { workerFactory: createFakeHarness().factory }),
    ).toThrow(TypeError);
    expect(() =>
      createPool(ENTRY, { maxQueue: -1 }, { workerFactory: createFakeHarness().factory }),
    ).toThrow(TypeError);
    expect(() =>
      createPool(ENTRY, { timeoutMs: -1 }, { workerFactory: createFakeHarness().factory }),
    ).toThrow(TypeError);
  });
});
