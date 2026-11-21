import type { Form } from "./form.js";
import type { NestedLink } from "./nested.js";
import { assignArrayItem, isNestedForm, releaseArrayItem } from "./nested.js";
import { isPlainObject } from "./utils.js";

/** Внутренний хост состояния массивов форм (реализуется `Form`). */
export interface ArrayStateHost {
  readonly link: NestedLink;
  readonly metadata: ReadonlyMap<string, unknown>;
  readonly initialValues: ReadonlyMap<string, unknown>;
  readonly arrayChildren: Map<string, Form[]>;
  readonly clearExternalOnChange: boolean;
  readValue(name: string): unknown;
  writeValue(name: string, value: unknown): void;
  setDirectValue(name: string, value: unknown): void;
  invalidateValidation(): void;
  markDirty(name: string): void;
  clearExternal(name: string): void;
  invalidateProps(name: string): void;
  ensureCanBind(item: Form, name: string, index: number): void;
}

export function arrayItems(
  host: ArrayStateHost,
  name: string,
): Form[] | undefined {
  const tracked = host.arrayChildren.get(name);
  if (tracked !== undefined) {
    return tracked;
  }
  const value = host.readValue(name);
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }
  const items: Form[] = [];
  for (const item of value) {
    if (!isNestedForm(item)) {
      return undefined;
    }
    items.push(item);
  }
  host.arrayChildren.set(name, items);
  return items;
}

export function requireArrayItem(
  host: ArrayStateHost,
  root: string,
  index: number,
): Form {
  const item = arrayItems(host, root)?.[index];
  if (item === undefined) {
    throw new Error(`Элемент массива "${root}[${index}]" не найден`);
  }
  return item;
}

export function requireArrayItems(
  host: ArrayStateHost,
  name: string,
): Form[] {
  const items = arrayItems(host, name);
  if (items === undefined) {
    throw new TypeError(`Поле "${name}" не является массивом форм`);
  }
  return items;
}

export function ensureArrayItems(
  host: ArrayStateHost,
  name: string,
): Form[] {
  const tracked = host.arrayChildren.get(name);
  if (tracked !== undefined) {
    return tracked;
  }
  const value = host.readValue(name);
  if (!Array.isArray(value)) {
    throw new TypeError(`Поле "${name}" не является массивом`);
  }
  const items: Form[] = [];
  for (const item of value) {
    if (!isNestedForm(item)) {
      throw new TypeError(`Поле "${name}" не является массивом форм`);
    }
    items.push(item);
  }
  host.arrayChildren.set(name, items);
  return items;
}

export function isBaselineArrayItem(
  host: ArrayStateHost,
  item: Form,
): boolean {
  for (const value of host.initialValues.values()) {
    if (Array.isArray(value) && value.includes(item)) {
      return true;
    }
  }
  return false;
}

export function commitArray(
  host: ArrayStateHost,
  name: string,
  next: Form[],
  removed: Form[],
): void {
  host.setDirectValue(name, next);
  host.arrayChildren.set(name, next);
  for (const item of removed) {
    releaseArrayItem(item);
  }
  for (let index = 0; index < next.length; index += 1) {
    assignArrayItem(host.link, next[index]!, name, index);
  }
  host.invalidateProps(name);
}

export function setArrayValues(
  host: ArrayStateHost,
  name: string,
  entries: readonly unknown[],
): void {
  const items = requireArrayItems(host, name);
  const limit = Math.min(items.length, entries.length);
  const next = [...items];
  const removed: Form[] = [];
  let replaced = false;
  let changed = false;
  for (let index = 0; index < limit; index += 1) {
    const entry = entries[index];
    const current = items[index]!;
    if (isNestedForm(entry)) {
      if (entry === current) {
        continue;
      }
      host.ensureCanBind(entry, name, index);
      next[index] = entry;
      removed.push(current);
      replaced = true;
      changed = true;
      continue;
    }
    if (isPlainObject(entry)) {
      current.setValues(entry);
      changed = true;
      continue;
    }
    throw new TypeError(
      `Элемент "${name}[${index}]" должен быть Form или plain-объектом`,
    );
  }
  if (replaced) {
    commitArray(host, name, next, removed);
  } else if (changed) {
    host.invalidateValidation();
    host.markDirty(name);
    if (host.clearExternalOnChange) {
      host.clearExternal(name);
    }
  }
}

export function restoreArray(
  host: ArrayStateHost,
  name: string,
  restored: readonly unknown[],
  current: unknown,
): void {
  const tracked = host.arrayChildren.get(name);
  const previous = tracked ?? (Array.isArray(current)
    ? current.filter((item): item is Form => isNestedForm(item))
    : []);
  const isFormArray = tracked !== undefined ||
    (restored.length > 0 && restored.every((item) => isNestedForm(item)));
  if (!isFormArray) {
    host.writeValue(name, restored);
    host.invalidateProps(name);
    return;
  }
  const items: Form[] = [];
  for (const item of restored) {
    if (!isNestedForm(item)) {
      throw new TypeError(`Массив "${name}" должен содержать только Form`);
    }
    items.push(item);
  }
  const nextSet = new Set<object>(items);
  for (const item of previous) {
    if (!nextSet.has(item)) {
      releaseArrayItem(item);
      if (!isBaselineArrayItem(host, item)) {
        item.dispose();
      }
    }
  }
  host.writeValue(name, [...items]);
  host.arrayChildren.set(name, items);
  for (let index = 0; index < items.length; index += 1) {
    assignArrayItem(host.link, items[index]!, name, index);
  }
  host.invalidateProps(name);
}

export function replaceArray(
  host: ArrayStateHost,
  name: string,
  value: unknown,
): void {
  if (!Array.isArray(value) || !value.every((item) => isNestedForm(item))) {
    throw new TypeError(`Поле "${name}" — массив форм: ожидался массив Form`);
  }
  const items = value as Form[];
  for (let index = 0; index < items.length; index += 1) {
    host.ensureCanBind(items[index]!, name, index);
  }
  const previous = requireArrayItems(host, name);
  const nextSet = new Set<object>(items);
  const removed = previous.filter((item) => !nextSet.has(item));
  commitArray(host, name, items, removed);
}

export function arrayErrors(
  host: ArrayStateHost,
  name: string,
  errors: Readonly<Record<string, readonly string[]>>,
): Readonly<Record<string, readonly string[]>> {
  const prefix = `${name}[`;
  const result: Record<string, readonly string[]> = {};
  for (const [key, messages] of Object.entries(errors)) {
    if (key.startsWith(prefix)) {
      result[key] = messages;
    }
  }
  return result;
}

