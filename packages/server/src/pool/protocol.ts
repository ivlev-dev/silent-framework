import type { MessagePort } from "node:worker_threads";

export const POOL_PROTOCOL = 1;

const MAX_CAUSE_DEPTH = 3;

export interface WireError {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
  readonly code?: string;
  readonly cause?: WireError;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Сериализует ошибку для передачи между потоками (cause не глубже 3). */
export function serializeError(error: unknown, depth = 0): WireError {
  if (!isObject(error)) {
    return {
      name: "Error",
      message: typeof error === "string" ? error : String(error),
    };
  }
  const name =
    typeof error.name === "string" && error.name.length > 0
      ? error.name
      : "Error";
  const message =
    typeof error.message === "string" ? error.message : String(error);
  const wire: {
    name: string;
    message: string;
    stack?: string;
    code?: string;
    cause?: WireError;
  } = { name, message };
  if (typeof error.stack === "string") {
    wire.stack = error.stack;
  }
  if (typeof error.code === "string") {
    wire.code = error.code;
  }
  if (depth < MAX_CAUSE_DEPTH && "cause" in error && error.cause !== undefined) {
    wire.cause = serializeError(error.cause, depth + 1);
  }
  return wire;
}

/** Восстанавливает ошибку с сохранением name/message/stack/code/cause. */
export function reviveError(wire: WireError): Error {
  const error = new Error(wire.message);
  error.name = wire.name;
  if (wire.stack !== undefined) {
    error.stack = wire.stack;
  }
  if (wire.code !== undefined) {
    (error as Error & { code?: string }).code = wire.code;
  }
  if (wire.cause !== undefined) {
    error.cause = reviveError(wire.cause);
  }
  return error;
}

export interface RenderResultWire {
  readonly html: string;
  readonly head: string;
}

export interface EntryCapabilities {
  readonly render: boolean;
  readonly renderStream: boolean;
}

export interface WorkerData {
  readonly protocol: number;
  readonly entryUrl: string;
  readonly name?: string;
}

export type MainToWorker =
  | {
      readonly type: "render";
      readonly protocol: number;
      readonly id: number;
      readonly args: readonly unknown[];
    }
  | {
      readonly type: "render-stream";
      readonly protocol: number;
      readonly id: number;
      readonly args: readonly unknown[];
      readonly port: MessagePort;
    }
  | { readonly type: "shutdown"; readonly protocol: number };

export type WorkerToMain =
  | {
      readonly type: "ready";
      readonly protocol: number;
      readonly capabilities: EntryCapabilities;
    }
  | {
      readonly type: "result";
      readonly protocol: number;
      readonly id: number;
      readonly result: RenderResultWire;
    }
  | {
      readonly type: "error";
      readonly protocol: number;
      readonly id: number;
      readonly error: WireError;
    }
  | {
      readonly type: "entry-error";
      readonly protocol: number;
      readonly error: WireError;
    }
  | {
      readonly type: "protocol-error";
      readonly protocol: number;
      readonly id?: number;
      readonly error: WireError;
    }
  | { readonly type: "shutdown-complete"; readonly protocol: number };

export type StreamWorkerMessage =
  | { readonly type: "head"; readonly head: string; readonly final: boolean }
  | { readonly type: "shell"; readonly bytes: number }
  | { readonly type: "chunk"; readonly chunk: string }
  | { readonly type: "end" }
  | { readonly type: "error"; readonly error: WireError };

export type StreamMainMessage =
  | { readonly type: "cancel"; readonly reason?: string }
  | { readonly type: "pause" }
  | { readonly type: "resume" };

/** Проверяет, что сообщение принадлежит текущей версии протокола пула. */
export function isProtocolCompatible(value: unknown): value is { protocol: number } {
  return isObject(value) && value.protocol === POOL_PROTOCOL;
}

/**
 * Проверяет форму wire-ошибки перед `reviveError`. Защищает main-поток от
 * `TypeError` на повреждённых сообщениях воркера (defense-in-depth).
 */
export function isWireError(value: unknown): value is WireError {
  if (!isObject(value)) {
    return false;
  }
  if (typeof value.name !== "string" || typeof value.message !== "string") {
    return false;
  }
  if (value.stack !== undefined && typeof value.stack !== "string") {
    return false;
  }
  if (value.code !== undefined && typeof value.code !== "string") {
    return false;
  }
  if (value.cause !== undefined && !isWireError(value.cause)) {
    return false;
  }
  return true;
}
