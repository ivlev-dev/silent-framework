import {
  isMainThread,
  parentPort,
  workerData as rawWorkerData,
} from "node:worker_threads";
import type { MessagePort } from "node:worker_threads";
import type {
  RenderStreamHandlers,
  ServerEntryModule,
} from "../stream-contract.js";
import { PoolError } from "./errors.js";
import {
  POOL_PROTOCOL,
  isProtocolCompatible,
  serializeError,
  type MainToWorker,
  type RenderResultWire,
  type StreamMainMessage,
  type StreamWorkerMessage,
  type WorkerData,
} from "./protocol.js";

/** Минимальная поверхность MessagePort, нужная воркеру (удобно мокать). */
export interface WorkerPortLike {
  on(event: "message", listener: (message: unknown) => void): unknown;
  off?(event: "message", listener: (message: unknown) => void): unknown;
  removeListener?(
    event: "message",
    listener: (message: unknown) => void,
  ): unknown;
  postMessage(message: unknown): void;
  close(): void;
  start?(): void;
}

export interface WorkerStartOptions {
  readonly loadEntry?: ((entryUrl: string) => Promise<unknown>) | undefined;
}

interface StreamState {
  cancelled: boolean;
  paused: boolean;
  resume: (() => void) | null;
  headSeen: boolean;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function post(port: WorkerPortLike, message: unknown): void {
  try {
    port.postMessage(message);
  } catch {
    // Порт уже закрыт: отправлять некуда.
  }
}

function closePort(port: WorkerPortLike): void {
  try {
    port.close();
  } catch {
    // Порт уже закрыт.
  }
}

function detachMessageListener(
  port: WorkerPortLike,
  listener: (message: unknown) => void,
): void {
  if (typeof port.off === "function") {
    port.off("message", listener);
    return;
  }
  port.removeListener?.("message", listener);
}

function toResultWire(value: unknown): RenderResultWire {
  if (!isObject(value)) {
    throw new PoolError(
      "protocol-mismatch",
      "render() должен вернуть объект { html, head }",
    );
  }
  if (typeof value.html !== "string" || typeof value.head !== "string") {
    throw new PoolError(
      "protocol-mismatch",
      "render() должен вернуть строковые поля html и head",
    );
  }
  return { html: value.html, head: value.head };
}

function isStreamLike(value: unknown): value is ReadableStream<string> {
  if (!isObject(value)) {
    return false;
  }
  const candidate = value as {
    getReader?: unknown;
    [Symbol.asyncIterator]?: unknown;
  };
  return (
    typeof candidate.getReader === "function" ||
    typeof candidate[Symbol.asyncIterator] === "function"
  );
}

function waitForResume(state: StreamState): Promise<void> {
  if (!state.paused || state.cancelled) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    state.resume = resolve;
  });
}

function sendStream(port: WorkerPortLike, message: StreamWorkerMessage): void {
  post(port, message);
}

function pauseGate(state: StreamState): void {
  state.paused = false;
  const resume = state.resume;
  state.resume = null;
  resume?.();
}

async function runStream(
  port: WorkerPortLike,
  module: ServerEntryModule,
  capabilities: { render: boolean; renderStream: boolean },
  id: number,
  args: readonly unknown[],
  streamPort: WorkerPortLike,
  active: { id: number | null },
): Promise<void> {
  const state: StreamState = {
    cancelled: false,
    paused: false,
    resume: null,
    headSeen: false,
  };
  const controller = new AbortController();

  const onControl = (message: unknown): void => {
    if (!isObject(message) || typeof message.type !== "string") {
      return;
    }
    const control = message as StreamMainMessage;
    if (control.type === "cancel") {
      state.cancelled = true;
      if (!controller.signal.aborted) {
        controller.abort(
          new DOMException("Стриминг отменён worker pool", "AbortError"),
        );
      }
      pauseGate(state);
      return;
    }
    if (control.type === "pause") {
      state.paused = true;
      return;
    }
    if (control.type === "resume") {
      pauseGate(state);
    }
  };

  streamPort.on("message", onControl);
  streamPort.start?.();

  const handlers: RenderStreamHandlers = {
    signal: controller.signal,
    onHead(head, info): void {
      if (state.cancelled) {
        return;
      }
      state.headSeen = true;
      sendStream(streamPort, {
        type: "head",
        head: String(head),
        final: info?.final === true,
      });
    },
    onShell(html): void {
      if (state.cancelled) {
        return;
      }
      const value = typeof html === "string" ? html : "";
      sendStream(streamPort, {
        type: "shell",
        bytes: Buffer.byteLength(value, "utf8"),
      });
    },
  };

  const emitChunk = async (chunk: string): Promise<void> => {
    if (state.cancelled || chunk.length === 0) {
      return;
    }
    await waitForResume(state);
    if (state.cancelled) {
      return;
    }
    sendStream(streamPort, { type: "chunk", chunk });
  };

  let reader: ReadableStreamDefaultReader<string> | null = null;
  try {
    if (!capabilities.renderStream || typeof module.renderStream !== "function") {
      throw new PoolError(
        "stream-unsupported",
        "Entry-модуль не экспортирует renderStream",
      );
    }
    const stream = await module.renderStream(...args, handlers);
    if (!isStreamLike(stream)) {
      throw new PoolError(
        "stream-contract",
        "renderStream() должен вернуть ReadableStream<string>",
      );
    }

    if (typeof stream.getReader === "function") {
      reader = stream.getReader();
      for (;;) {
        const next = await reader.read();
        if (next.done === true) {
          break;
        }
        await emitChunk(next.value);
      }
    } else {
      for await (const chunk of stream as AsyncIterable<string>) {
        await emitChunk(chunk);
      }
    }

    if (state.cancelled) {
      return;
    }
    if (!state.headSeen) {
      throw new PoolError(
        "stream-head-missing",
        "renderStream() завершился без вызова onHead",
      );
    }
    sendStream(streamPort, { type: "end" });
  } catch (error) {
    if (!state.cancelled) {
      sendStream(streamPort, { type: "error", error: serializeError(error) });
    }
  } finally {
    if (reader !== null) {
      try {
        reader.releaseLock();
      } catch {
        // Поток уже закрыт.
      }
    }
    detachMessageListener(streamPort, onControl);
    closePort(streamPort);
    if (active.id === id) {
      active.id = null;
    }
  }
}

async function runUnary(
  port: WorkerPortLike,
  module: ServerEntryModule,
  capabilities: { render: boolean; renderStream: boolean },
  id: number,
  args: readonly unknown[],
  active: { id: number | null },
): Promise<void> {
  try {
    if (!capabilities.render || typeof module.render !== "function") {
      throw new PoolError(
        "render-unsupported",
        "Entry-модуль не экспортирует render",
      );
    }
    const result = toResultWire(await module.render(...args));
    post(port, {
      type: "result",
      protocol: POOL_PROTOCOL,
      id,
      result,
    });
  } catch (error) {
    post(port, {
      type: "error",
      protocol: POOL_PROTOCOL,
      id,
      error: serializeError(error),
    });
  } finally {
    if (active.id === id) {
      active.id = null;
    }
  }
}

/**
 * Запускает цикл воркера. Экспортируется для тестов: в реальном worker
 * потоке вызывается автоматически внизу файла.
 */
export async function startWorker(
  port: WorkerPortLike,
  data: WorkerData,
  options: WorkerStartOptions = {},
): Promise<void> {
  if (data.protocol !== POOL_PROTOCOL) {
    post(port, {
      type: "protocol-error",
      protocol: POOL_PROTOCOL,
      error: serializeError(
        new PoolError(
          "protocol-mismatch",
          `Несовместимая версия протокола worker pool: ожидается ${POOL_PROTOCOL}`,
        ),
      ),
    });
    closePort(port);
    return;
  }
  const loadEntry =
    options.loadEntry ?? ((entryUrl: string) => import(entryUrl));
  let module: ServerEntryModule;
  try {
    module = (await loadEntry(data.entryUrl)) as ServerEntryModule;
  } catch (error) {
    post(port, {
      type: "entry-error",
      protocol: POOL_PROTOCOL,
      error: serializeError(
        new PoolError(
          "entry-load-failed",
          `Не удалось загрузить entry ${data.entryUrl}`,
          { cause: error },
        ),
      ),
    });
    closePort(port);
    return;
  }

  const capabilities = {
    render: typeof module.render === "function",
    renderStream: typeof module.renderStream === "function",
  } satisfies { render: boolean; renderStream: boolean };

  post(port, {
    type: "ready",
    protocol: POOL_PROTOCOL,
    capabilities,
  });

  const active: { id: number | null } = { id: null };
  let stopped = false;

  const onMessage = (message: unknown): void => {
    if (stopped) {
      return;
    }
    if (!isProtocolCompatible(message)) {
      post(port, {
        type: "protocol-error",
        protocol: POOL_PROTOCOL,
        ...(isObject(message) && typeof message.id === "number"
          ? { id: message.id }
          : {}),
        error: serializeError(
          new PoolError(
            "protocol-mismatch",
            `Несовместимая версия протокола worker pool: ожидается ${POOL_PROTOCOL}`,
          ),
        ),
      });
      stopped = true;
      detachMessageListener(port, onMessage);
      closePort(port);
      return;
    }

    const msg = message as MainToWorker;
    if (msg.type === "shutdown") {
      stopped = true;
      detachMessageListener(port, onMessage);
      post(port, { type: "shutdown-complete", protocol: POOL_PROTOCOL });
      closePort(port);
      return;
    }

    if (active.id !== null) {
      const busy = new PoolError(
        "busy",
        `Воркер уже выполняет задачу #${active.id}`,
      );
      if (msg.type === "render") {
        post(port, {
          type: "error",
          protocol: POOL_PROTOCOL,
          id: msg.id,
          error: serializeError(busy),
        });
      } else {
        post(port, {
          type: "error",
          protocol: POOL_PROTOCOL,
          id: msg.id,
          error: serializeError(busy),
        });
        closePort(msg.port as unknown as WorkerPortLike);
      }
      return;
    }

    if (msg.type === "render") {
      active.id = msg.id;
      void runUnary(port, module, capabilities, msg.id, msg.args, active);
      return;
    }

    if (msg.type === "render-stream") {
      active.id = msg.id;
      void runStream(
        port,
        module,
        capabilities,
        msg.id,
        msg.args,
        msg.port as unknown as WorkerPortLike,
        active,
      );
    }
  };

  port.on("message", onMessage);
  port.start?.();
}

function normalizeWorkerData(value: unknown): WorkerData | null {
  if (!isObject(value)) {
    return null;
  }
  if (typeof value.protocol !== "number" || typeof value.entryUrl !== "string") {
    return null;
  }
  return {
    protocol: value.protocol,
    entryUrl: value.entryUrl,
    ...(typeof value.name === "string" ? { name: value.name } : {}),
  };
}

if (!isMainThread && parentPort !== null) {
  const data = normalizeWorkerData(rawWorkerData);
  if (data !== null) {
    const port = parentPort as unknown as WorkerPortLike;
    void startWorker(port, data).catch((error: unknown) => {
      post(port, {
        type: "entry-error",
        protocol: POOL_PROTOCOL,
        error: serializeError(
          new PoolError(
            "worker-start-failed",
            "Не удалось запустить цикл воркера",
            { cause: error },
          ),
        ),
      });
      closePort(port);
    });
  }
}
