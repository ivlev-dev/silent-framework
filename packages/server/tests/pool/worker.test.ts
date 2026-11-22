import { MessageChannel, type MessagePort } from "node:worker_threads";
import { afterEach, describe, expect, it } from "vitest";
import {
  POOL_PROTOCOL,
  serializeError,
  type WorkerData,
} from "../../src/pool/protocol.js";
import {
  startWorker,
  type WorkerPortLike,
} from "../../src/pool/worker-main.js";
import { deferred } from "./fake-worker.js";

class Inbox {
  private readonly queue: Record<string, unknown>[] = [];
  private readonly waiters: {
    readonly type: string;
    readonly resolve: (message: Record<string, unknown>) => void;
  }[] = [];

  constructor(port: MessagePort) {
    port.on("message", (message: unknown) => {
      const typed = message as Record<string, unknown>;
      const index = this.waiters.findIndex((waiter) => waiter.type === typed.type);
      if (index >= 0) {
        const waiter = this.waiters[index];
        this.waiters.splice(index, 1);
        waiter?.resolve(typed);
        return;
      }
      this.queue.push(typed);
    });
    port.start();
  }

  ofType(type: string): Promise<Record<string, unknown>> {
    const index = this.queue.findIndex((message) => message.type === type);
    if (index >= 0) {
      const message = this.queue.splice(index, 1)[0];
      if (message !== undefined) {
        return Promise.resolve(message);
      }
    }
    return new Promise((resolve) => {
      this.waiters.push({ type, resolve });
    });
  }

  drain(): Record<string, unknown>[] {
    return this.queue.splice(0, this.queue.length);
  }
}

interface Harness {
  readonly port: MessagePort;
  readonly inbox: Inbox;
}

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

function createHarness(
  entry: Record<string, unknown>,
  data: Partial<WorkerData> = {},
): Harness {
  const channel = new MessageChannel();
  const workerPort = channel.port1 as unknown as WorkerPortLike;
  const main = channel.port2;
  const inbox = new Inbox(main);
  void startWorker(
    workerPort,
    {
      protocol: POOL_PROTOCOL,
      entryUrl: "test://entry",
      ...data,
    },
    { loadEntry: async () => entry },
  );
  cleanups.push(() => {
    try {
      workerPort.close();
    } catch {
      // уже закрыт.
    }
    try {
      main.close();
    } catch {
      // уже закрыт.
    }
  });
  return {
    port: main,
    inbox,
  };
}

function streamChannel(): {
  readonly main: Inbox;
  readonly port: MessagePort;
} {
  const channel = new MessageChannel();
  const main = new Inbox(channel.port2);
  cleanups.push(() => {
    channel.port2.close();
  });
  return {
    main,
    port: channel.port1,
  };
}

describe("pool worker", () => {
  it("отправляет ready и отбрасывает лишние поля результата render", async () => {
    const harness = createHarness({
      render: (...args: unknown[]) => ({
        html: `<p>${String(args[0])}</p>`,
        head: "<title>ok</title>",
        extra: "ignore",
      }),
    });

    const ready = await harness.inbox.ofType("ready");
    expect(ready).toMatchObject({
      protocol: POOL_PROTOCOL,
      capabilities: { render: true, renderStream: false },
    });

    harness.port.postMessage({
      type: "render",
      protocol: POOL_PROTOCOL,
      id: 7,
      args: ["hi"],
    });
    const result = await harness.inbox.ofType("result");
    expect(result).toEqual({
      type: "result",
      protocol: POOL_PROTOCOL,
      id: 7,
      result: { html: "<p>hi</p>", head: "<title>ok</title>" },
    });
  });

  it("отвечает busy на второй render во время активной задачи", async () => {
    const gate = deferred<unknown>();
    const harness = createHarness({
      render: async () => gate.promise,
    });
    await harness.inbox.ofType("ready");

    harness.port.postMessage({
      type: "render",
      protocol: POOL_PROTOCOL,
      id: 1,
      args: [],
    });
    harness.port.postMessage({
      type: "render",
      protocol: POOL_PROTOCOL,
      id: 2,
      args: [],
    });

    const busy = await harness.inbox.ofType("error");
    expect(busy).toMatchObject({
      id: 2,
      error: { code: "busy" },
    });

    gate.resolve({ html: "ok", head: "" });
    const result = await harness.inbox.ofType("result");
    expect(result).toMatchObject({ id: 1, result: { html: "ok", head: "" } });
  });

  it("стримит head → shell → chunk* → head(final) → end", async () => {
    const harness = createHarness({
      renderStream: (
        handlers: {
          onHead(head: string, info: { final: boolean }): void;
          onShell?(html: string): void;
        },
      ) =>
        (async function* (): AsyncGenerator<string> {
          handlers.onHead("<title>shell</title>", { final: false });
          handlers.onShell?.("<html></html>");
          yield "a";
          yield "b";
          handlers.onHead("<title>final</title>", { final: true });
        })(),
    });
    await harness.inbox.ofType("ready");

    const stream = streamChannel();
    harness.port.postMessage(
      {
        type: "render-stream",
        protocol: POOL_PROTOCOL,
        id: 5,
        args: [],
        port: stream.port,
      },
      [stream.port],
    );

    const end = await stream.main.ofType("end");
    expect(end).toEqual({ type: "end" });
    expect(stream.main.drain()).toEqual([
      { type: "head", head: "<title>shell</title>", final: false },
      { type: "shell", bytes: "<html></html>".length },
      { type: "chunk", chunk: "a" },
      { type: "chunk", chunk: "b" },
      { type: "head", head: "<title>final</title>", final: true },
    ]);
  });

  it("передаёт ошибку стрима с name/message/code", async () => {
    const harness = createHarness({
      renderStream: (handlers: { onHead(head: string, info: { final: boolean }): void }) => {
        return new ReadableStream<string>({
          start(controller) {
            handlers.onHead("head", { final: false });
            const error = new Error("boom");
            error.name = "BoomError";
            (error as Error & { code?: string }).code = "boom-code";
            controller.error(error);
          },
        });
      },
    });
    await harness.inbox.ofType("ready");
    const stream = streamChannel();
    harness.port.postMessage(
      {
        type: "render-stream",
        protocol: POOL_PROTOCOL,
        id: 6,
        args: [],
        port: stream.port,
      },
      [stream.port],
    );
    await stream.main.ofType("head");
    expect(await stream.main.ofType("error")).toMatchObject({
      error: {
        name: "BoomError",
        message: "boom",
        code: "boom-code",
      },
    });
  });

  it("возвращает stream-head-missing, если onHead не вызван", async () => {
    const harness = createHarness({
      renderStream: () =>
        new ReadableStream<string>({
          start(controller) {
            controller.enqueue("x");
            controller.close();
          },
        }),
    });
    await harness.inbox.ofType("ready");
    const stream = streamChannel();
    harness.port.postMessage(
      {
        type: "render-stream",
        protocol: POOL_PROTOCOL,
        id: 7,
        args: [],
        port: stream.port,
      },
      [stream.port],
    );
    await stream.main.ofType("chunk");
    expect(await stream.main.ofType("error")).toMatchObject({
      error: { code: "stream-head-missing" },
    });
  });

  it("возвращает stream-contract для не-потока", async () => {
    const harness = createHarness({
      renderStream: () => 42,
    });
    await harness.inbox.ofType("ready");
    const stream = streamChannel();
    harness.port.postMessage(
      {
        type: "render-stream",
        protocol: POOL_PROTOCOL,
        id: 8,
        args: [],
        port: stream.port,
      },
      [stream.port],
    );
    expect(await stream.main.ofType("error")).toMatchObject({
      error: { code: "stream-contract" },
    });
  });

  it("возвращает stream-unsupported без renderStream", async () => {
    const harness = createHarness({});
    await harness.inbox.ofType("ready");
    const stream = streamChannel();
    harness.port.postMessage(
      {
        type: "render-stream",
        protocol: POOL_PROTOCOL,
        id: 9,
        args: [],
        port: stream.port,
      },
      [stream.port],
    );
    expect(await stream.main.ofType("error")).toMatchObject({
      error: { code: "stream-unsupported" },
    });
  });

  it("отвечает protocol-error на чужую версию протокола", async () => {
    const harness = createHarness({ render: () => ({ html: "", head: "" }) });
    await harness.inbox.ofType("ready");
    harness.port.postMessage({
      type: "render",
      protocol: POOL_PROTOCOL + 1,
      id: 1,
      args: [],
    });
    expect(await harness.inbox.ofType("protocol-error")).toMatchObject({
      protocol: POOL_PROTOCOL,
      error: { code: "protocol-mismatch" },
    });
  });

  it("завершает цикл по shutdown", async () => {
    const harness = createHarness({ render: () => ({ html: "", head: "" }) });
    await harness.inbox.ofType("ready");
    harness.port.postMessage({ type: "shutdown", protocol: POOL_PROTOCOL });
    expect(await harness.inbox.ofType("shutdown-complete")).toEqual({
      type: "shutdown-complete",
      protocol: POOL_PROTOCOL,
    });
  });

  it("сериализует ошибку entry при загрузке", async () => {
    const channel = new MessageChannel();
    const port = channel.port1 as unknown as WorkerPortLike;
    const inbox = new Inbox(channel.port2);
    cleanups.push(() => {
      port.close();
      channel.port2.close();
    });
    void startWorker(
      port,
      { protocol: POOL_PROTOCOL, entryUrl: "test://broken" },
      {
        loadEntry: async () => {
          throw new Error("не загрузилось");
        },
      },
    );
    expect(await inbox.ofType("entry-error")).toMatchObject({
      error: { code: "entry-load-failed", message: "Не удалось загрузить entry test://broken" },
    });
  });

  it("передаёт wire-ошибку при исключении render", async () => {
    const harness = createHarness({
      render: () => {
        const error = new Error("упало");
        error.name = "CustomError";
        throw error;
      },
    });
    await harness.inbox.ofType("ready");
    harness.port.postMessage({
      type: "render",
      protocol: POOL_PROTOCOL,
      id: 10,
      args: [],
    });
    const message = await harness.inbox.ofType("error");
    expect(message.error).toMatchObject({
      name: "CustomError",
      message: "упало",
    });
    expect((message.error as { stack?: string }).stack).toContain("CustomError");
  });

  it("serializeError пригоден для protocol-error", () => {
    expect(serializeError(new Error("x"))).toMatchObject({
      name: "Error",
      message: "x",
    });
  });
});
