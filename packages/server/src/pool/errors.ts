export type PoolErrorCode =
  | "pool-closed"
  | "queue-full"
  | "args-not-cloneable"
  | "entry-load-failed"
  | "worker-start-failed"
  | "protocol-mismatch"
  | "render-unsupported"
  | "stream-unsupported"
  | "stream-contract"
  | "stream-head-missing"
  | "stream-overflow"
  | "worker-exited"
  | "busy"
  | "timeout"
  | "aborted";

export interface PoolErrorOptions {
  readonly cause?: unknown;
  readonly name?: string;
}

export class PoolError extends Error {
  readonly code: PoolErrorCode;

  constructor(code: PoolErrorCode, message: string, options: PoolErrorOptions = {}) {
    super(message);
    this.name = options.name ?? "PoolError";
    this.code = code;
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

export function poolError(
  code: PoolErrorCode,
  message: string,
  options: PoolErrorOptions = {},
): PoolError {
  return new PoolError(code, message, options);
}

export function timeoutPoolError(timeoutMs: number, detail?: string): PoolError {
  const suffix = detail === undefined ? "" : ` (${detail})`;
  return new PoolError(
    "timeout",
    `Операция превысила таймаут ${timeoutMs} мс${suffix}`,
    { name: "TimeoutError" },
  );
}

export function abortedPoolError(message = "Операция отменена"): PoolError {
  return new PoolError("aborted", message, { name: "AbortError" });
}

export function poolClosedError(): PoolError {
  return new PoolError("pool-closed", "Пул рендера закрыт");
}

export function poolClosedAbortError(): PoolError {
  return new PoolError("pool-closed", "Пул рендера закрыт во время стриминга", {
    name: "AbortError",
  });
}
