import type { VirtualKey } from "./types.js";

/**
 * Ключ элемента по умолчанию — сам индекс.
 *
 * @param index Индекс элемента.
 * @returns Тот же индекс в качестве ключа.
 */
export function defaultKey(index: number): number {
  return index;
}

/**
 * Приводит результат `getItemKey` к допустимому ключу. Всё, что не является
 * строкой или конечным числом, заменяется индексом.
 *
 * @param value Сырое значение, вернувшееся из `getItemKey`.
 * @param index Индекс элемента — запасной ключ.
 * @returns Строковый или числовой ключ.
 */
export function normalizeKey(value: unknown, index: number): VirtualKey {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return index;
}
