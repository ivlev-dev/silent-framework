import { afterEach, describe, expect, it } from "vitest";
import {
  PoolError,
  type EntryCapabilities,
  type PoolErrorCode,
  type RenderPool,
} from "../../src/pool.js";
import { createPool } from "../../src/pool/pool.js";
import { RenderReentrancyError } from "../../src/render.js";
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

function expectPoolError(error: unknown, code: PoolErrorCode): void {
  expect(error).toBeInstanceOf(PoolError);
  const poolError = error as PoolError;
  expect(poolError.code).toBe(code);
  expect(poolError.name).toBe("PoolError");
}

async function captureError(
  promise: Promise<unknown>,
): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Ожидалось отклонение промиса");
}

function renderJob(message: { type: string }): message is {
  type: "render";
  id: number;
  args: readonly unknown[];
} {
  return message.type === "render";
}

describe("публичная поверхность pool", () => {
  it("pool-closed приходит как PoolError с code", async () => {
    const harness = createFakeHarness();
    harness.handler = (message, worker) => {
      if (message.type === "render") {
        worker.sendResult(message.id, "ok");
      }
    };
    const pool = makePool(harness, { workers: 1 });
    await pool.render([]);
    await pool.close();

    const error = await captureError(pool.render([]));
    expectPoolError(error, "pool-closed");
  });

  it("queue-full приходит как PoolError с code", async () => {
    const harness = createFakeHarness();
    const pool = makePool(harness, { workers: 1, maxQueue: 0 });

    const first = pool.render(["first"]);
    const error = await captureError(pool.render(["second"]));
    expectPoolError(error, "queue-full");
    expect(pool.stats().rejectedOverflow).toBe(1);

    const worker = harness.workers[0];
    const message = await worker!.waitForMessage(renderJob);
    worker!.sendResult((message as { id: number }).id, "ok");
    await expect(first).resolves.toEqual({ html: "ok", head: "" });
  });

  it("ошибка entry не является PoolError и сохраняет name", async () => {
    const harness = createFakeHarness();
    harness.handler = (message: { type: string }, worker: FakeWorker) => {
      if (message.type !== "render") {
        return;
      }
      worker.sendError(
        (message as { id: number }).id,
        new RenderReentrancyError(),
      );
    };
    const pool = makePool(harness, { workers: 1 });

    const error = await captureError(pool.render([]));
    expect(error).not.toBeInstanceOf(PoolError);
    const entryError = error as Error & { code?: string };
    expect(entryError.name).toBe("RenderReentrancyError");
    expect(entryError.code).toBeUndefined();
  });

  it("worker:ready типизирован публичным EntryCapabilities", async () => {
    const harness = createFakeHarness();
    harness.handler = (message, worker) => {
      if (message.type === "render") {
        worker.sendResult(message.id, "ok");
      }
    };
    const seen: EntryCapabilities[] = [];
    const pool = makePool(harness, {
      workers: 1,
      onEvent: (event) => {
        if (event.type === "worker:ready") {
          const capabilities: EntryCapabilities = event.capabilities;
          seen.push(capabilities);
        }
      },
    });

    await pool.render([]);
    expect(seen).toEqual([{ render: true, renderStream: true }]);
  });
});
