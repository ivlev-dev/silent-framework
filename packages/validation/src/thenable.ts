export function isThenable(value: unknown): value is PromiseLike<unknown> {
  if (
    (typeof value !== "object" && typeof value !== "function")
    || value === null
  ) {
    return false;
  }
  return typeof (value as { then?: unknown }).then === "function";
}

export function suppressThenable(value: PromiseLike<unknown>): void {
  void Promise.resolve(value).catch(() => {});
}

export function suppress<T>(value: T): void {
  if (isThenable(value)) {
    suppressThenable(value);
  }
}
