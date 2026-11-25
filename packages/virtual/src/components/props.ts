import type { VirtualKey } from "../core/types.js";
import type { MaybeAccessor } from "../adapter/create-virtualizer.js";

/** Читает значение пропса, разворачивая аксессор. */
export function readProp<T>(value: MaybeAccessor<T> | undefined, fallback: T): T {
  if (value === undefined) {
    return fallback;
  }
  return typeof value === "function" ? (value as () => T)() : value;
}

/** Читает массив или аксессор массива. */
export function readEach<T>(
  value: readonly T[] | (() => readonly T[]),
): readonly T[] {
  return typeof value === "function" ? (value as () => readonly T[])() : value;
}

/** Приводит пользовательский ключ к сериализуемому `VirtualKey`. */
export function toKey(value: unknown, index: number): VirtualKey {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return index;
}
