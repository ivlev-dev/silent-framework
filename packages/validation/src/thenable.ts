export function isThenable(value: unknown): value is PromiseLike<unknown> {
  if (
    (typeof value !== "object" && typeof value !== "function")
    || value === null
  ) {
    return false;
  }
  return typeof (value as { then?: unknown }).then === "function";
}

export function suppress<T>(value: T): void {
  if (isThenable(value)) {
    void Promise.resolve(value).catch(() => {});
  }
}
