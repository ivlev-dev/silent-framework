/** Служебные чистые утилиты формы. */

/** Общие пустые значения ошибок (не аллоцируем на каждое чтение). */
export const EMPTY_ERRORS: readonly string[] = Object.freeze([]);
export const EMPTY_ERRORS_MAP: ReadonlyMap<string, readonly string[]> = new Map();

export interface EventTargetLike {
  readonly value?: unknown;
  readonly checked?: unknown;
  readonly type?: unknown;
  readonly multiple?: unknown;
  readonly selectedOptions?: unknown;
  readonly options?: unknown;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof (value as { readonly then?: unknown }).then === "function"
  );
}

/**
 * Глубокая копия снимка значения: массивы и plain-объекты клонируются
 * рекурсивно, `Map`/`Set`/`Date` — копируются, экземпляры классов
 * (включая вложенные формы) возвращаются как есть.
 */
export function cloneValue(
  value: unknown,
  seen = new WeakMap<object, unknown>(),
): unknown {
  if (Array.isArray(value)) {
    const cached = seen.get(value);
    if (cached !== undefined) {
      return cached;
    }
    const copy: unknown[] = [];
    seen.set(value, copy);
    for (const item of value) {
      copy.push(cloneValue(item, seen));
    }
    return copy;
  }
  if (value instanceof Date) {
    return new Date(value.getTime());
  }
  if (value instanceof Map) {
    return new Map(value);
  }
  if (value instanceof Set) {
    return new Set(value);
  }
  if (isPlainObject(value)) {
    const cached = seen.get(value);
    if (cached !== undefined) {
      return cached;
    }
    const copy: Record<string, unknown> = {};
    seen.set(value, copy);
    for (const [key, item] of Object.entries(value)) {
      copy[key] = cloneValue(item, seen);
    }
    return copy;
  }
  return value;
}

export function rootSegment(path: string): string {
  let index = 0;
  while (index < path.length) {
    const char = path[index];
    if (char === "." || char === "[") {
      break;
    }
    index += 1;
  }
  return path.slice(0, index);
}

export function lastSegment(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? path : path.slice(dot + 1);
}

export function isFieldKey(key: string, name: string): boolean {
  return (
    key === name ||
    key.startsWith(`${name}.`) ||
    key.startsWith(`${name}[`)
  );
}

export function sameMessages(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left === right) {
    return true;
  }
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

export function eventTarget(
  event: { readonly currentTarget?: unknown; readonly target?: unknown },
): EventTargetLike | undefined {
  const current = event.currentTarget ?? event.target;
  if (typeof current !== "object" || current === null) {
    return undefined;
  }
  return current;
}

export function coerceValue(current: unknown, raw: unknown): unknown {
  if (typeof current === "number" && typeof raw === "string") {
    if (raw.trim() === "") {
      return raw;
    }
    return Number(raw);
  }
  return raw;
}

function isIterable(value: unknown): value is Iterable<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { readonly [Symbol.iterator]?: unknown })[Symbol.iterator] ===
      "function"
  );
}

function optionValues(
  options: Iterable<unknown>,
  onlySelected: boolean,
): readonly string[] {
  const values: string[] = [];
  for (const option of options) {
    if (typeof option !== "object" || option === null) {
      continue;
    }
    const record = option as {
      readonly value?: unknown;
      readonly selected?: unknown;
    };
    if (onlySelected && record.selected !== true) {
      continue;
    }
    if (typeof record.value === "string") {
      values.push(record.value);
    }
  }
  return values;
}

export function selectedValues(
  target: EventTargetLike,
): readonly string[] | undefined {
  if (isIterable(target.selectedOptions)) {
    return optionValues(target.selectedOptions, false);
  }
  if (isIterable(target.options)) {
    return optionValues(target.options, true);
  }
  return undefined;
}

export function isRequiredEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

export function normalizeErrorMessages(
  errors: string | readonly (string | { readonly message: string })[],
): readonly string[] {
  if (typeof errors === "string") {
    return [errors];
  }
  const messages: string[] = [];
  for (const entry of errors) {
    if (typeof entry === "string") {
      messages.push(entry);
      continue;
    }
    if (
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as { readonly message?: unknown }).message === "string"
    ) {
      messages.push((entry as { readonly message: string }).message);
      continue;
    }
    throw new TypeError("Ошибка поля должна быть строкой или объектом с полем message");
  }
  return messages;
}
