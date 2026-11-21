import {
  createSignalHandle,
  isTracking,
  type SignalHandle,
} from "./graph.js";

type CollectionKind = "map" | "set";

interface CollectionSlot {
  readonly present: boolean;
  readonly value: unknown;
}

const ABSENT_SLOT: CollectionSlot = { present: false, value: undefined };

interface ReactiveRecord {
  readonly raw: object;
  proxy: object;
  readonly isArray: boolean;
  readonly collection: CollectionKind | null;
  readonly fields: Map<PropertyKey, SignalHandle<unknown>>;
  readonly slots: Map<unknown, SignalHandle<CollectionSlot>>;
  readonly keysSignal: SignalHandle<number>;
  readonly lengthSignal: SignalHandle<number> | null;
  readonly sizeSignal: SignalHandle<number> | null;
  arrayMethods: Map<string, (...args: unknown[]) => unknown> | null;
  collectionMethods: Map<PropertyKey, (...args: unknown[]) => unknown> | null;
  keysVersion: number;
}

interface ReadonlyRecord {
  readonly raw: object;
  readonly inner: object;
  readonly kind: "object" | "array" | "map" | "set";
  proxy: object;
}

type ReactiveMethod = (...args: unknown[]) => unknown;

const MAX_ARRAY_INDEX = 4294967295;
const SPLICE_INSERT_CHUNK = 8192;

const ARRAY_MUTATORS: ReadonlySet<string> = new Set<string>([
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "sort",
  "reverse",
  "fill",
  "copyWithin",
]);

const MAP_MUTATORS: ReadonlySet<PropertyKey> = new Set<PropertyKey>([
  "set",
  "delete",
  "clear",
]);

const SET_MUTATORS: ReadonlySet<PropertyKey> = new Set<PropertyKey>([
  "add",
  "delete",
  "clear",
]);

const rawToRecord = new WeakMap<object, ReactiveRecord>();
const proxyToRecord = new WeakMap<object, ReactiveRecord>();
const reactiveClasses = new WeakSet<Function>();
const rawValues = new WeakSet<object>();
const rawClasses = new WeakSet<Function>();

const readonlyByRaw = new WeakMap<object, ReadonlyRecord>();
const readonlyToRaw = new WeakMap<object, object>();
const readonlyProxies = new WeakSet<object>();

function hasOwn(target: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(target, key);
}

function toArrayIndex(key: string): number | null {
  if (key === "") {
    return null;
  }
  const index = Number(key);
  if (!Number.isInteger(index) || index < 0 || index >= MAX_ARRAY_INDEX) {
    return null;
  }
  if (String(index) !== key) {
    return null;
  }
  return index;
}

function toIntegerOrInfinity(value: unknown): number {
  const numeric = Number(value);
  if (Number.isNaN(numeric) || numeric === 0) {
    return 0;
  }
  if (!Number.isFinite(numeric)) {
    return numeric;
  }
  return Math.trunc(numeric);
}

function normalizeRelativeIndex(relative: number, length: number): number {
  if (relative === Infinity) {
    return length;
  }
  if (relative === -Infinity) {
    return 0;
  }
  if (relative < 0) {
    return Math.max(length + relative, 0);
  }
  return Math.min(relative, length);
}

function collectionKindOf(value: object): CollectionKind | null {
  const tag = Object.prototype.toString.call(value);
  if (tag === "[object Map]") {
    return "map";
  }
  if (tag === "[object Set]") {
    return "set";
  }
  return null;
}

function collectionSize(value: object): number {
  return (value as Map<unknown, unknown> | Set<unknown>).size;
}

function findInheritedDescriptor(
  target: object,
  key: PropertyKey,
): PropertyDescriptor | undefined {
  let current: object | null = Object.getPrototypeOf(target) as object | null;
  while (current !== null) {
    const descriptor = Reflect.getOwnPropertyDescriptor(current, key);
    if (descriptor !== undefined) {
      return descriptor;
    }
    current = Object.getPrototypeOf(current) as object | null;
  }
  return undefined;
}

function getField(record: ReactiveRecord, key: PropertyKey): SignalHandle<unknown> {
  const existing = record.fields.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const field = createSignalHandle<unknown>(Reflect.get(record.raw, key, record.raw));
  record.fields.set(key, field);
  return field;
}

function updateField(
  record: ReactiveRecord,
  key: PropertyKey,
  value: unknown,
): void {
  const field = record.fields.get(key);
  if (field === undefined) {
    return;
  }
  if (field.hasObservers() || isTracking()) {
    field.write(value);
  } else {
    record.fields.delete(key);
  }
}

function clearField(record: ReactiveRecord, key: PropertyKey): void {
  const field = record.fields.get(key);
  if (field === undefined) {
    return;
  }
  if (field.hasObservers() || isTracking()) {
    field.write(undefined);
  } else {
    record.fields.delete(key);
  }
}

function bumpKeys(record: ReactiveRecord): void {
  record.keysVersion += 1;
  record.keysSignal.write(record.keysVersion);
}

function notifyLength(record: ReactiveRecord, value: number): void {
  const signal = record.lengthSignal;
  if (signal !== null) {
    signal.write(value);
  }
}

function writeIndex(
  record: ReactiveRecord,
  index: number,
  _oldValue: unknown,
  newValue: unknown,
): void {
  updateField(record, index, newValue);
}

function notifyChangedIndices(
  record: ReactiveRecord,
  previous: readonly unknown[],
): void {
  const array = record.raw as unknown[];
  const length = Math.max(previous.length, array.length);
  if (length === 0) {
    return;
  }
  for (let index = 0; index < length; index += 1) {
    const before = previous[index];
    const after = array[index];
    if (!Object.is(before, after)) {
      writeIndex(record, index, before, after);
    }
  }
}

function unwrapValue(value: unknown): unknown {
  return unwrap(value);
}

function arrayPush(record: ReactiveRecord, items: unknown[]): number {
  const array = record.raw as unknown[];
  const start = array.length;
  const count = items.length;
  // Поиндексная запись без spread: push(...items) на больших наборах
  // переполняет стек вызовов (RangeError).
  for (let offset = 0; offset < count; offset += 1) {
    const value = unwrapValue(items[offset]);
    array[start + offset] = value;
    writeIndex(record, start + offset, undefined, value);
  }
  notifyLength(record, array.length);
  if (count > 0) {
    bumpKeys(record);
  }
  return array.length;
}

function arrayPop(record: ReactiveRecord): unknown {
  const array = record.raw as unknown[];
  if (array.length === 0) {
    return undefined;
  }
  const index = array.length - 1;
  const hadOwn = hasOwn(array, index);
  const previous = array[index];
  const removed = array.pop();
  writeIndex(record, index, previous, undefined);
  notifyLength(record, array.length);
  if (hadOwn) {
    bumpKeys(record);
  }
  return deepReactive(removed);
}

function arrayShift(record: ReactiveRecord): unknown {
  const array = record.raw as unknown[];
  if (array.length === 0) {
    return undefined;
  }
  const previous = array.slice();
  const removed = array.shift();
  const length = array.length;
  for (let index = 0; index < length; index += 1) {
    writeIndex(record, index, previous[index], array[index]);
  }
  writeIndex(record, length, previous[length], undefined);
  notifyLength(record, length);
  bumpKeys(record);
  return deepReactive(removed);
}

function arrayUnshift(record: ReactiveRecord, items: unknown[]): number {
  const array = record.raw as unknown[];
  const previous = array.slice();
  const count = items.length;
  if (count > 0) {
    const previousLength = array.length;
    const previousOwn: boolean[] = new Array<boolean>(previousLength);
    for (let index = 0; index < previousLength; index += 1) {
      previousOwn[index] = hasOwn(array, index);
    }
    // Сдвиг вправо без spread: unshift(...items) переполняет стек на больших
    // наборах. Дырки в разреженных массивах сохраняются: переносим только
    // собственные элементы, а слоты, пришедшие из дырок, освобождаем.
    for (let index = previousLength - 1; index >= 0; index -= 1) {
      if (previousOwn[index] === true) {
        array[index + count] = array[index];
      }
    }
    array.length = previousLength + count;
    for (let index = count; index < previousLength; index += 1) {
      if (previousOwn[index - count] !== true && hasOwn(array, index)) {
        delete array[index];
      }
    }
    for (let offset = 0; offset < count; offset += 1) {
      array[offset] = unwrapValue(items[offset]);
    }
  }
  const length = array.length;
  for (let index = 0; index < length; index += 1) {
    writeIndex(record, index, previous[index], array[index]);
  }
  notifyLength(record, length);
  if (count > 0) {
    bumpKeys(record);
  }
  return length;
}

function toSpliceIndex(value: unknown): number {
  if (typeof value === "bigint") {
    throw new TypeError("Cannot convert a BigInt value to a number");
  }
  return toIntegerOrInfinity(value);
}

function arraySplice(record: ReactiveRecord, args: unknown[]): unknown {
  const array = record.raw as unknown[];
  const previousLength = array.length;
  const previous = array.slice();
  const previousOwn: boolean[] = [];
  for (let index = 0; index < previousLength; index += 1) {
    previousOwn[index] = hasOwn(array, index);
  }
  const inserted = args.length > 2 ? args.slice(2).map(unwrapValue) : [];
  let startIndex = 0;
  let deleteCount = 0;
  if (args.length > 0) {
    startIndex = normalizeRelativeIndex(
      toSpliceIndex(args[0]),
      previousLength,
    );
    if (args.length === 1) {
      deleteCount = previousLength - startIndex;
    } else {
      deleteCount = Math.min(
        Math.max(toSpliceIndex(args[1]), 0),
        previousLength - startIndex,
      );
    }
  }
  const removed = array.slice(startIndex, startIndex + deleteCount);
  // Вставка чанками: array.splice(start, 0, ...inserted) переполняет стек
  // вызовов на больших наборах. После вставки удаляем исходные элементы,
  // которые сдвинулись вправо на inserted.length.
  for (
    let offset = 0;
    offset < inserted.length;
    offset += SPLICE_INSERT_CHUNK
  ) {
    const chunk = inserted.slice(offset, offset + SPLICE_INSERT_CHUNK);
    array.splice(startIndex + offset, 0, ...chunk);
  }
  if (deleteCount > 0) {
    array.splice(startIndex + inserted.length, deleteCount);
  }
  const length = array.length;
  const limit = Math.max(previousLength, length);
  let keysChanged = previousLength !== length;
  for (let index = 0; index < limit; index += 1) {
    const before = previous[index];
    const after = array[index];
    const owned = hasOwn(array, index);
    const wasOwn = previousOwn[index] === true;
    if (!Object.is(before, after) || wasOwn !== owned) {
      writeIndex(record, index, before, after);
    }
    if (!keysChanged && wasOwn !== owned) {
      keysChanged = true;
    }
  }
  notifyLength(record, length);
  if (keysChanged) {
    bumpKeys(record);
  }
  return deepReactive(removed);
}

function arraySort(record: ReactiveRecord, args: unknown[]): unknown {
  const array = record.raw as unknown[];
  const previous = array.slice();
  const comparator = args[0];
  if (typeof comparator === "function") {
    array.sort(comparator as (a: unknown, b: unknown) => number);
  } else {
    array.sort();
  }
  notifyChangedIndices(record, previous);
  return record.proxy;
}

function arrayReverse(record: ReactiveRecord): unknown {
  const array = record.raw as unknown[];
  const length = array.length;
  array.reverse();
  // После reverse значение на позиции index — это прежнее значение
  // на позиции length - 1 - index. Снимок массива не нужен.
  for (let index = 0; index < length; index += 1) {
    const before = array[length - 1 - index];
    const after = array[index];
    if (!Object.is(before, after)) {
      writeIndex(record, index, before, after);
    }
  }
  return record.proxy;
}

function arrayFill(record: ReactiveRecord, args: unknown[]): unknown {
  const array = record.raw as unknown[];
  const length = array.length;
  const value = unwrapValue(args[0]);
  const start = args.length > 1
    ? normalizeRelativeIndex(toIntegerOrInfinity(args[1]), length)
    : 0;
  const end = args.length > 2
    ? normalizeRelativeIndex(toIntegerOrInfinity(args[2]), length)
    : length;
  let keysChanged = false;
  for (let index = start; index < end; index += 1) {
    const wasOwn = hasOwn(array, index);
    const before = array[index];
    array[index] = value;
    if (!wasOwn && hasOwn(array, index)) {
      keysChanged = true;
    }
    if (!Object.is(before, value)) {
      writeIndex(record, index, before, value);
    }
  }
  if (keysChanged) {
    bumpKeys(record);
  }
  return record.proxy;
}

function arrayCopyWithin(record: ReactiveRecord, args: unknown[]): unknown {
  const array = record.raw as unknown[];
  const length = array.length;
  const to = normalizeRelativeIndex(toIntegerOrInfinity(args[0]), length);
  const from = args.length > 1
    ? normalizeRelativeIndex(toIntegerOrInfinity(args[1]), length)
    : 0;
  const final = args.length > 2
    ? normalizeRelativeIndex(toIntegerOrInfinity(args[2]), length)
    : length;
  const count = Math.min(final - from, length - to);
  if (count <= 0 || to === from) {
    return record.proxy;
  }
  // Снимок нужен только для диапазона-источника: дырки сохраняются slice.
  const source = array.slice(from, from + count);
  let keysChanged = false;
  for (let offset = 0; offset < count; offset += 1) {
    const index = to + offset;
    const wasOwn = hasOwn(array, index);
    const before = array[index];
    if (hasOwn(source, offset)) {
      array[index] = source[offset];
    } else if (wasOwn) {
      delete array[index];
    }
    if (!wasOwn && hasOwn(array, index)) {
      keysChanged = true;
    }
    const after = array[index];
    if (!Object.is(before, after)) {
      writeIndex(record, index, before, after);
    }
  }
  if (keysChanged) {
    bumpKeys(record);
  }
  return record.proxy;
}

function createArrayMethods(
  record: ReactiveRecord,
): Map<string, (...args: unknown[]) => unknown> {
  const methods = new Map<string, (...args: unknown[]) => unknown>();
  methods.set("push", (...items: unknown[]) => arrayPush(record, items));
  methods.set("pop", () => arrayPop(record));
  methods.set("shift", () => arrayShift(record));
  methods.set("unshift", (...items: unknown[]) => arrayUnshift(record, items));
  methods.set("splice", (...args: unknown[]) => arraySplice(record, args));
  methods.set("sort", (...args: unknown[]) => arraySort(record, args));
  methods.set("reverse", () => arrayReverse(record));
  methods.set("fill", (...args: unknown[]) => arrayFill(record, args));
  methods.set("copyWithin", (...args: unknown[]) => arrayCopyWithin(record, args));
  return methods;
}

function getSlot(
  record: ReactiveRecord,
  key: unknown,
): SignalHandle<CollectionSlot> {
  const existing = record.slots.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const raw = record.raw as Map<unknown, unknown> | Set<unknown>;
  const present = raw.has(key);
  let value: unknown;
  if (present && record.collection === "map") {
    value = (raw as Map<unknown, unknown>).get(key);
  } else if (record.collection === "set") {
    value = key;
  } else {
    value = undefined;
  }
  const slot = createSignalHandle<CollectionSlot>({ present, value });
  record.slots.set(key, slot);
  return slot;
}

function readSlot(record: ReactiveRecord, key: unknown): CollectionSlot {
  return getSlot(record, key).read();
}

function releaseSlot(record: ReactiveRecord, key: unknown): void {
  const slot = record.slots.get(key);
  if (slot === undefined) {
    return;
  }
  if (slot.hasObservers() || isTracking()) {
    slot.write(ABSENT_SLOT);
  } else {
    record.slots.delete(key);
  }
}

function writeCollectionSize(record: ReactiveRecord): void {
  const signal = record.sizeSignal;
  if (signal === null) {
    return;
  }
  signal.write(collectionSize(record.raw));
}

function projectIterator<T>(
  iterator: Iterator<unknown>,
  project: (value: unknown) => T,
): IterableIterator<T> {
  const projected: IterableIterator<T> = {
    next(): IteratorResult<T> {
      const step = iterator.next();
      if (step.done === true) {
        return { done: true, value: undefined };
      }
      return { done: false, value: project(step.value) };
    },
    [Symbol.iterator](): IterableIterator<T> {
      return projected;
    },
  };
  return projected;
}

function mapKeys(record: ReactiveRecord): IterableIterator<unknown> {
  record.keysSignal.read();
  const raw = record.raw as Map<unknown, unknown>;
  return projectIterator(raw.keys(), (key) => deepReactive(key));
}

function mapValues(record: ReactiveRecord): IterableIterator<unknown> {
  record.keysSignal.read();
  const raw = record.raw as Map<unknown, unknown>;
  return projectIterator(raw.entries(), (entry) => {
    const pair = entry as readonly [unknown, unknown];
    readSlot(record, pair[0]);
    return deepReactive(pair[1]);
  });
}

function mapEntries(record: ReactiveRecord): IterableIterator<unknown> {
  record.keysSignal.read();
  const raw = record.raw as Map<unknown, unknown>;
  return projectIterator(raw.entries(), (entry) => {
    const pair = entry as readonly [unknown, unknown];
    readSlot(record, pair[0]);
    return [deepReactive(pair[0]), deepReactive(pair[1])] as const;
  });
}

function setValues(record: ReactiveRecord): IterableIterator<unknown> {
  record.keysSignal.read();
  const raw = record.raw as Set<unknown>;
  return projectIterator(raw.values(), (value) => deepReactive(value));
}

function setEntries(record: ReactiveRecord): IterableIterator<unknown> {
  record.keysSignal.read();
  const raw = record.raw as Set<unknown>;
  return projectIterator(raw.values(), (value) => {
    const item = deepReactive(value);
    return [item, item] as const;
  });
}

function setMapEntry(
  record: ReactiveRecord,
  key: unknown,
  value: unknown,
): unknown {
  const raw = record.raw as Map<unknown, unknown>;
  const rawKey = unwrap(key);
  const rawValue = unwrap(value);
  const slot = getSlot(record, rawKey);
  const current = slot.peek();
  const exists = raw.has(rawKey);
  if (current.present && exists && Object.is(current.value, rawValue)) {
    return record.proxy;
  }
  const isNew = !exists;
  raw.set(rawKey, rawValue);
  slot.write({ present: true, value: rawValue });
  if (isNew) {
    bumpKeys(record);
    writeCollectionSize(record);
  }
  return record.proxy;
}

function deleteMapEntry(record: ReactiveRecord, key: unknown): boolean {
  const raw = record.raw as Map<unknown, unknown>;
  const rawKey = unwrap(key);
  if (!raw.delete(rawKey)) {
    return false;
  }
  releaseSlot(record, rawKey);
  bumpKeys(record);
  writeCollectionSize(record);
  return true;
}

function addSetValue(record: ReactiveRecord, value: unknown): unknown {
  const raw = record.raw as Set<unknown>;
  const rawValue = unwrap(value);
  const slot = getSlot(record, rawValue);
  const current = slot.peek();
  const exists = raw.has(rawValue);
  if (current.present && exists) {
    return record.proxy;
  }
  raw.add(rawValue);
  slot.write({ present: true, value: rawValue });
  if (!exists) {
    bumpKeys(record);
    writeCollectionSize(record);
  }
  return record.proxy;
}

function deleteSetValue(record: ReactiveRecord, value: unknown): boolean {
  const raw = record.raw as Set<unknown>;
  const rawValue = unwrap(value);
  if (!raw.delete(rawValue)) {
    return false;
  }
  releaseSlot(record, rawValue);
  bumpKeys(record);
  writeCollectionSize(record);
  return true;
}

function clearCollection(record: ReactiveRecord): void {
  const raw = record.raw as Map<unknown, unknown> | Set<unknown>;
  if (raw.size === 0) {
    return;
  }
  if (record.collection === "map") {
    for (const key of (raw as Map<unknown, unknown>).keys()) {
      releaseSlot(record, key);
    }
  } else {
    for (const value of (raw as Set<unknown>).values()) {
      releaseSlot(record, value);
    }
  }
  raw.clear();
  bumpKeys(record);
  writeCollectionSize(record);
}

function createCollectionMethods(
  record: ReactiveRecord,
): Map<PropertyKey, ReactiveMethod> {
  const methods = new Map<PropertyKey, ReactiveMethod>();
  if (record.collection === "map") {
    methods.set("get", (key: unknown) => {
      const slot = readSlot(record, unwrap(key));
      return slot.present ? deepReactive(slot.value) : undefined;
    });
    methods.set("has", (key: unknown) => readSlot(record, unwrap(key)).present);
    methods.set("set", (key: unknown, value: unknown) =>
      setMapEntry(record, key, value),
    );
    methods.set("delete", (key: unknown) => deleteMapEntry(record, key));
    methods.set("clear", () => {
      clearCollection(record);
    });
    methods.set(
      "forEach",
      (callback: unknown, thisArg: unknown) => {
        const fn = callback as (
          value: unknown,
          key: unknown,
          map: unknown,
        ) => void;
        const raw = record.raw as Map<unknown, unknown>;
        record.keysSignal.read();
        for (const [key, value] of raw) {
          const slot = readSlot(record, key);
          fn.call(
            thisArg,
            deepReactive(slot.present ? slot.value : value),
            deepReactive(key),
            record.proxy,
          );
        }
      },
    );
    methods.set("keys", () => mapKeys(record));
    methods.set("values", () => mapValues(record));
    methods.set("entries", () => mapEntries(record));
    methods.set(Symbol.iterator, () => mapEntries(record));
    return methods;
  }
  methods.set("add", (value: unknown) => addSetValue(record, value));
  methods.set("has", (value: unknown) => readSlot(record, unwrap(value)).present);
  methods.set("delete", (value: unknown) => deleteSetValue(record, value));
  methods.set("clear", () => {
    clearCollection(record);
  });
  methods.set("forEach", (callback: unknown, thisArg: unknown) => {
    const fn = callback as (
      value: unknown,
      key: unknown,
      set: unknown,
    ) => void;
    const raw = record.raw as Set<unknown>;
    record.keysSignal.read();
    for (const value of raw) {
      const item = deepReactive(value);
      fn.call(thisArg, item, item, record.proxy);
    }
  });
  methods.set("keys", () => setValues(record));
  methods.set("values", () => setValues(record));
  methods.set("entries", () => setEntries(record));
  methods.set(Symbol.iterator, () => setValues(record));
  return methods;
}

function setObjectField(
  record: ReactiveRecord,
  key: PropertyKey,
  value: unknown,
  hadOwn: boolean,
): boolean {
  const raw = record.raw;
  const success = Reflect.set(raw, key, value, raw);
  if (!success) {
    return false;
  }
  updateField(record, key, Reflect.get(raw, key, raw));
  if (!hadOwn) {
    bumpKeys(record);
  }
  return true;
}

function setArrayIndex(
  record: ReactiveRecord,
  index: number,
  value: unknown,
): boolean {
  const array = record.raw as unknown[];
  const hadOwn = hasOwn(array, index);
  const previousLength = array.length;
  const previous = hadOwn ? array[index] : undefined;
  const success = Reflect.set(array, index, value, array);
  if (!success) {
    return false;
  }
  writeIndex(record, index, previous, array[index]);
  const length = array.length;
  if (length !== previousLength) {
    notifyLength(record, length);
  }
  if (!hadOwn) {
    bumpKeys(record);
  }
  return true;
}

function setArrayLength(record: ReactiveRecord, value: unknown): boolean {
  const array = record.raw as unknown[];
  const previousLength = array.length;
  const previous = array.slice();
  const previousOwn: boolean[] = [];
  for (let index = 0; index < previousLength; index += 1) {
    previousOwn[index] = hasOwn(array, index);
  }
  const success = Reflect.set(array, "length", value, array);
  if (!success) {
    return false;
  }
  const length = array.length;
  if (length < previousLength) {
    let keysChanged = false;
    for (let index = length; index < previousLength; index += 1) {
      writeIndex(record, index, previous[index], undefined);
      if (previousOwn[index] === true) {
        keysChanged = true;
      }
    }
    if (keysChanged) {
      bumpKeys(record);
    }
  }
  notifyLength(record, length);
  return true;
}

function isDomNode(value: object): boolean {
  return typeof Node !== "undefined" && value instanceof Node;
}

function hasReactivePrototype(value: object): boolean {
  let current: object | null = Object.getPrototypeOf(value) as object | null;
  while (current !== null) {
    const descriptor = Reflect.getOwnPropertyDescriptor(current, "constructor");
    if (
      descriptor !== undefined &&
      typeof descriptor.value === "function" &&
      reactiveClasses.has(descriptor.value)
    ) {
      return true;
    }
    current = Object.getPrototypeOf(current) as object | null;
  }
  return false;
}

function hasRawPrototype(value: object): boolean {
  let current: object | null = Object.getPrototypeOf(value) as object | null;
  while (current !== null) {
    const descriptor = Reflect.getOwnPropertyDescriptor(current, "constructor");
    if (
      descriptor !== undefined &&
      typeof descriptor.value === "function" &&
      rawClasses.has(descriptor.value)
    ) {
      return true;
    }
    current = Object.getPrototypeOf(current) as object | null;
  }
  return false;
}

function isNonReactiveTag(tag: string): boolean {
  switch (tag) {
    case "[object Date]":
    case "[object WeakMap]":
    case "[object WeakSet]":
    case "[object Promise]":
    case "[object RegExp]":
    case "[object Error]":
    case "[object ArrayBuffer]":
    case "[object SharedArrayBuffer]":
    case "[object DataView]":
    case "[object Number]":
    case "[object String]":
    case "[object Boolean]":
    case "[object BigInt]":
    case "[object Symbol]":
    case "[object WeakRef]":
    case "[object FinalizationRegistry]":
      return true;
    default:
      return false;
  }
}

function isRawMarked(value: object): boolean {
  if (rawValues.has(value)) {
    return true;
  }
  return hasRawPrototype(value);
}

function hasClassPrototype(value: object): boolean {
  let current = Object.getPrototypeOf(value) as object | null;
  while (current !== null) {
    const descriptor = Reflect.getOwnPropertyDescriptor(current, "constructor");
    if (
      descriptor !== undefined &&
      typeof descriptor.value === "function" &&
      descriptor.value !== Object
    ) {
      return true;
    }
    current = Object.getPrototypeOf(current) as object | null;
  }
  return false;
}

function shouldWrap(value: object): boolean {
  if (isRawMarked(value)) {
    return false;
  }
  if (hasReactivePrototype(value)) {
    return false;
  }
  if (Array.isArray(value)) {
    return true;
  }
  if (isDomNode(value)) {
    return false;
  }
  const tag = Object.prototype.toString.call(value);
  if (tag === "[object Map]" || tag === "[object Set]") {
    return true;
  }
  if (isNonReactiveTag(tag)) {
    return false;
  }
  // Авто-обёртка только для plain-объектов (Object.prototype/null и объекты
  // с литеральным прототипом). Экземпляры пользовательских классов не
  // оборачиваются: прокси ломает `#private`-поля и accessor-декораторы
  // (`@reactive`/`@Field` сами управляют реактивностью через store).
  return tag === "[object Object]" && !hasClassPrototype(value);
}

function objectGet(record: ReactiveRecord, key: PropertyKey): unknown {
  const raw = record.raw;
  const own = Reflect.getOwnPropertyDescriptor(raw, key);
  if (own !== undefined) {
    if (own.get !== undefined) {
      return deepReactive(Reflect.get(raw, key, record.proxy));
    }
    if (
      own.configurable === false &&
      own.writable === false &&
      own.set === undefined
    ) {
      return own.value;
    }
    return deepReactive(getField(record, key).read());
  }
  const inherited = findInheritedDescriptor(raw, key);
  if (inherited !== undefined) {
    if (inherited.get !== undefined) {
      return deepReactive(Reflect.get(raw, key, record.proxy));
    }
    if (
      inherited.configurable === false &&
      inherited.writable === false &&
      inherited.set === undefined
    ) {
      return inherited.value;
    }
    // Методы прототипа (map/filter/toString/Symbol.iterator и т.п.) —
    // неизменяемые функции: не создаём на них сигналы.
    if (typeof inherited.value === "function" || typeof key === "symbol") {
      return Reflect.get(raw, key, record.proxy);
    }
  }
  if (typeof key === "symbol") {
    // Отсутствующие/унаследованные символы не трекаем: сигналы нужны
    // только для собственных данных и строковых полей.
    return Reflect.get(raw, key, record.proxy);
  }
  return deepReactive(getField(record, key).read());
}

function arrayGet(record: ReactiveRecord, key: PropertyKey): unknown {
  if (key === "length") {
    const signal = record.lengthSignal;
    if (signal !== null) {
      return signal.read();
    }
  }
  if (typeof key === "string") {
    const index = toArrayIndex(key);
    if (index !== null) {
      return deepReactive(getField(record, index).read());
    }
    const methods = record.arrayMethods;
    if (methods !== null) {
      const method = methods.get(key);
      const raw = record.raw;
      if (method !== undefined && !hasOwn(raw, key)) {
        return method;
      }
    }
  }
  return objectGet(record, key);
}

function collectionGet(record: ReactiveRecord, key: PropertyKey): unknown {
  const raw = record.raw;
  if (key === "size" && !hasOwn(raw, key)) {
    const signal = record.sizeSignal;
    if (signal !== null) {
      return signal.read();
    }
  }
  if (!hasOwn(raw, key)) {
    const methods = record.collectionMethods;
    if (methods !== null) {
      const method = methods.get(key);
      if (method !== undefined) {
        return method;
      }
    }
  }
  return objectGet(record, key);
}

function createHandler(record: ReactiveRecord): ProxyHandler<object> {
  return {
    get(_target, key): unknown {
      if (record.isArray) {
        return arrayGet(record, key);
      }
      if (record.collection !== null) {
        return collectionGet(record, key);
      }
      return objectGet(record, key);
    },
    set(target, key, value, receiver): boolean {
      const raw = record.raw;
      if (receiver !== record.proxy) {
        return Reflect.set(target, key, value, receiver);
      }
      const own = Reflect.getOwnPropertyDescriptor(raw, key);
      if (own !== undefined) {
        if (own.set !== undefined) {
          return Reflect.set(raw, key, value, record.proxy);
        }
      } else {
        const inherited = findInheritedDescriptor(raw, key);
        if (inherited !== undefined && inherited.set !== undefined) {
          return Reflect.set(raw, key, value, record.proxy);
        }
      }
      const rawValue = unwrapValue(value);
      if (record.isArray) {
        if (key === "length") {
          return setArrayLength(record, rawValue);
        }
        if (typeof key === "string") {
          const index = toArrayIndex(key);
          if (index !== null) {
            return setArrayIndex(record, index, rawValue);
          }
        }
      }
      return setObjectField(record, key, rawValue, own !== undefined);
    },
    has(target, key): boolean {
      const own = hasOwn(target, key);
      const exists = Reflect.has(target, key);
      if (own || !exists) {
        record.keysSignal.read();
      }
      return exists;
    },
    ownKeys(target): ArrayLike<string | symbol> {
      record.keysSignal.read();
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor(target, key): PropertyDescriptor | undefined {
      record.keysSignal.read();
      const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
      if (descriptor === undefined) {
        return undefined;
      }
      if (descriptor.get !== undefined || descriptor.set !== undefined) {
        return descriptor;
      }
      // Инвариант Proxy: для non-configurable + non-writable свойства нельзя
      // подменять value, поэтому frozen/sealed-слоты отдаём как есть.
      if (descriptor.configurable === false && descriptor.writable === false) {
        return descriptor;
      }
      return { ...descriptor, value: deepReactive(descriptor.value) };
    },
    deleteProperty(target, key): boolean {
      const own = Reflect.getOwnPropertyDescriptor(target, key);
      if (own === undefined) {
        return Reflect.deleteProperty(target, key);
      }
      const deleted = Reflect.deleteProperty(target, key);
      if (deleted) {
        let fieldKey: PropertyKey = key;
        if (record.isArray && typeof key === "string") {
          const index = toArrayIndex(key);
          if (index !== null) {
            fieldKey = index;
          }
        }
        clearField(record, fieldKey);
        bumpKeys(record);
      }
      return deleted;
    },
    defineProperty(target, key, descriptor): boolean {
      const raw = record.raw;
      if (record.isArray && key === "length" && "value" in descriptor) {
        return setArrayLength(record, descriptor.value);
      }
      if (record.isArray && typeof key === "string" && "value" in descriptor) {
        const index = toArrayIndex(key);
        if (index !== null) {
          const hadOwn = hasOwn(raw, index);
          const previousLength = (raw as unknown[]).length;
          const previousValue = hadOwn ? Reflect.get(raw, index, raw) : undefined;
          const nextDescriptor: PropertyDescriptor = {
            ...descriptor,
            value: unwrapValue(descriptor.value),
          };
          const success = Reflect.defineProperty(raw, index, nextDescriptor);
          if (!success) {
            return false;
          }
          writeIndex(record, index, previousValue, Reflect.get(raw, index, raw));
          const length = (raw as unknown[]).length;
          if (length !== previousLength) {
            notifyLength(record, length);
          }
          if (!hadOwn) {
            bumpKeys(record);
          }
          return true;
        }
      }
      const hadOwn = hasOwn(raw, key);
      const normalized: PropertyDescriptor =
        "value" in descriptor
          ? { ...descriptor, value: unwrapValue(descriptor.value) }
          : descriptor;
      const success = Reflect.defineProperty(raw, key, normalized);
      if (!success) {
        return false;
      }
      if ("value" in normalized) {
        updateField(record, key, Reflect.get(raw, key, raw));
      }
      if (!hadOwn) {
        bumpKeys(record);
      }
      return true;
    },
  };
}

function createRecord(raw: object): ReactiveRecord {
  const collection = collectionKindOf(raw);
  const record: ReactiveRecord = {
    raw,
    proxy: raw,
    isArray: Array.isArray(raw),
    collection,
    fields: new Map<PropertyKey, SignalHandle<unknown>>(),
    slots: new Map<unknown, SignalHandle<CollectionSlot>>(),
    keysSignal: createSignalHandle<number>(0),
    lengthSignal: Array.isArray(raw)
      ? createSignalHandle<number>((raw as unknown[]).length)
      : null,
    sizeSignal:
      collection === null
        ? null
        : createSignalHandle<number>(collectionSize(raw)),
    arrayMethods: null,
    collectionMethods: null,
    keysVersion: 0,
  };
  const proxy = new Proxy(raw, createHandler(record));
  record.proxy = proxy;
  if (record.isArray) {
    record.arrayMethods = createArrayMethods(record);
  }
  if (collection !== null) {
    record.collectionMethods = createCollectionMethods(record);
  }
  rawToRecord.set(raw, record);
  proxyToRecord.set(proxy, record);
  return record;
}

function readonlyMutator(
  record: ReadonlyRecord,
  key: PropertyKey,
): ReactiveMethod {
  return () => {
    throw new ReadonlyMutationError(record.kind, key);
  };
}

function toReadonlyValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  return readonly(value);
}

function toReadonlyIterator(iterator: Iterator<unknown>): IterableIterator<unknown> {
  return projectIterator(iterator, (value) => {
    if (Array.isArray(value)) {
      return value.map((entry) => toReadonlyValue(entry));
    }
    return toReadonlyValue(value);
  });
}

function isCollectionMutator(
  kind: "map" | "set",
  key: PropertyKey,
): boolean {
  return kind === "map" ? MAP_MUTATORS.has(key) : SET_MUTATORS.has(key);
}

function readonlyGet(record: ReadonlyRecord, key: PropertyKey): unknown {
  const inner = record.inner;
  if (record.kind === "array" && typeof key === "string") {
    if (ARRAY_MUTATORS.has(key)) {
      return readonlyMutator(record, key);
    }
  }
  if (record.kind === "map" || record.kind === "set") {
    if (isCollectionMutator(record.kind, key)) {
      return readonlyMutator(record, key);
    }
    if (key === "size") {
      return Reflect.get(inner, key, inner);
    }
    if (key === "get" && record.kind === "map") {
      const getter = Reflect.get(inner, key, inner) as (
        lookup: unknown,
      ) => unknown;
      return (lookup: unknown) => toReadonlyValue(getter(lookup));
    }
    if (key === "has") {
      return Reflect.get(inner, key, inner);
    }
    if (key === "forEach") {
      const forEach = Reflect.get(inner, key, inner) as (
        callback: (value: unknown, entryKey: unknown, container: unknown) => void,
        thisArg?: unknown,
      ) => void;
      return (callback: unknown, thisArg?: unknown) => {
        const fn = callback as (
          value: unknown,
          entryKey: unknown,
          container: unknown,
        ) => void;
        forEach((value, entryKey) => {
          fn.call(
            thisArg,
            toReadonlyValue(value),
            toReadonlyValue(entryKey),
            record.proxy,
          );
        });
      };
    }
    if (
      key === "keys" ||
      key === "values" ||
      key === "entries" ||
      key === Symbol.iterator
    ) {
      const factory = Reflect.get(inner, key, inner) as () => Iterator<unknown>;
      return () => toReadonlyIterator(factory());
    }
  }
  const own = Reflect.getOwnPropertyDescriptor(record.raw, key);
  if (
    own !== undefined &&
    own.get === undefined &&
    own.configurable === false &&
    own.writable === false
  ) {
    return own.value;
  }
  return toReadonlyValue(Reflect.get(inner, key, inner));
}

function createReadonlyHandler(record: ReadonlyRecord): ProxyHandler<object> {
  return {
    get(_target, key): unknown {
      return readonlyGet(record, key);
    },
    set(_target, key): boolean {
      throw new ReadonlyMutationError(record.kind, key);
    },
    deleteProperty(_target, key): boolean {
      throw new ReadonlyMutationError(record.kind, key);
    },
    defineProperty(_target, key): boolean {
      throw new ReadonlyMutationError(record.kind, key);
    },
    setPrototypeOf(): boolean {
      throw new ReadonlyMutationError(record.kind);
    },
    preventExtensions(): boolean {
      throw new ReadonlyMutationError(record.kind);
    },
    has(_target, key): boolean {
      return Reflect.has(record.inner, key);
    },
    ownKeys(): ArrayLike<string | symbol> {
      return Reflect.ownKeys(record.inner);
    },
    getOwnPropertyDescriptor(
      _target,
      key,
    ): PropertyDescriptor | undefined {
      return Reflect.getOwnPropertyDescriptor(record.inner, key);
    },
  };
}

function createReadonlyRecord(raw: object): ReadonlyRecord {
  const collection = collectionKindOf(raw);
  const kind: ReadonlyRecord["kind"] = Array.isArray(raw)
    ? "array"
    : collection ?? "object";
  const record: ReadonlyRecord = {
    raw,
    inner: deepReactive(raw),
    kind,
    proxy: raw,
  };
  const proxy = new Proxy(record.inner, createReadonlyHandler(record));
  record.proxy = proxy;
  readonlyByRaw.set(raw, record);
  readonlyToRaw.set(proxy, raw);
  readonlyProxies.add(proxy);
  return record;
}

export class ReadonlyMutationError extends TypeError {
  readonly key: PropertyKey | undefined;

  constructor(kind: string, key?: PropertyKey) {
    const target = key === undefined ? "" : ` "${String(key)}"`;
    super(`Cannot mutate readonly ${kind}${target}`);
    this.name = "ReadonlyMutationError";
    this.key = key;
  }
}

export function markReactiveClass(ctor: Function): void {
  reactiveClasses.add(ctor);
}

export function isReactiveClass(value: unknown): boolean {
  return typeof value === "function" && reactiveClasses.has(value);
}

export function markRaw<T>(value: T): T {
  if (typeof value === "function") {
    rawClasses.add(value);
  } else if (typeof value === "object" && value !== null) {
    rawValues.add(value);
  }
  return value;
}

export function isRaw(value: unknown): boolean {
  if (typeof value === "function") {
    return rawClasses.has(value);
  }
  if (typeof value !== "object" || value === null) {
    return false;
  }
  if (proxyToRecord.has(value)) {
    return false;
  }
  return isRawMarked(value);
}

export function isReactive(value: unknown): boolean {
  return typeof value === "object" && value !== null && proxyToRecord.has(value);
}

export function isReadonly(value: unknown): boolean {
  return typeof value === "object" && value !== null && readonlyProxies.has(value);
}

export function readonly<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (readonlyProxies.has(value)) {
    return value;
  }
  const raw = unwrap(value);
  const existing = readonlyByRaw.get(raw);
  if (existing !== undefined) {
    return existing.proxy as T;
  }
  if (!shouldWrap(raw)) {
    return value;
  }
  return createReadonlyRecord(raw).proxy as T;
}

export function unwrap<T>(value: T): T {
  let current: unknown = value;
  while (typeof current === "object" && current !== null) {
    const record = proxyToRecord.get(current);
    if (record !== undefined) {
      current = record.raw;
      continue;
    }
    const raw = readonlyToRaw.get(current);
    if (raw !== undefined) {
      current = raw;
      continue;
    }
    break;
  }
  return current as T;
}

export function deepReactive<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (readonlyProxies.has(value)) {
    return value;
  }
  const existingProxy = proxyToRecord.get(value);
  if (existingProxy !== undefined) {
    return existingProxy.proxy as T;
  }
  const existingRaw = rawToRecord.get(value);
  if (existingRaw !== undefined) {
    return existingRaw.proxy as T;
  }
  if (!shouldWrap(value)) {
    return value;
  }
  return createRecord(value).proxy as T;
}
