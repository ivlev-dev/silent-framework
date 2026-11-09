import { createSignalHandle, type SignalHandle } from "./graph";

interface ReactiveRecord {
  readonly raw: object;
  proxy: object;
  readonly isArray: boolean;
  readonly fields: Map<PropertyKey, SignalHandle<unknown>>;
  readonly keysSignal: SignalHandle<number>;
  readonly lengthSignal: SignalHandle<number> | null;
  arrayMethods: Map<string, (...args: unknown[]) => unknown> | null;
  keysVersion: number;
}

const MAX_ARRAY_INDEX = 4294967295;

const rawToRecord = new WeakMap<object, ReactiveRecord>();
const proxyToRecord = new WeakMap<object, ReactiveRecord>();
const reactiveClasses = new WeakSet<Function>();

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

function getPropertyDescriptor(
  target: object,
  key: PropertyKey,
): PropertyDescriptor | undefined {
  let current: object | null = target;
  while (current !== null) {
    const descriptor = Reflect.getOwnPropertyDescriptor(current, key);
    if (descriptor !== undefined) {
      return descriptor;
    }
    current = Object.getPrototypeOf(current) as object | null;
  }
  return undefined;
}

function ensureField(
  record: ReactiveRecord,
  key: PropertyKey,
  initial: unknown,
): SignalHandle<unknown> {
  const existing = record.fields.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const field = createSignalHandle<unknown>(initial);
  record.fields.set(key, field);
  return field;
}

function getField(record: ReactiveRecord, key: PropertyKey): SignalHandle<unknown> {
  const existing = record.fields.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const initial = Reflect.get(record.raw, key, record.raw);
  return ensureField(record, key, initial);
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
  oldValue: unknown,
  newValue: unknown,
): void {
  ensureField(record, index, oldValue).write(newValue);
}

function notifyChangedIndices(
  record: ReactiveRecord,
  previous: readonly unknown[],
): void {
  const array = record.raw as unknown[];
  const length = Math.max(previous.length, array.length);
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
  const values = items.map(unwrapValue);
  const result = array.push(...values);
  for (let offset = 0; offset < values.length; offset += 1) {
    writeIndex(record, start + offset, undefined, values[offset]);
  }
  notifyLength(record, array.length);
  if (values.length > 0) {
    bumpKeys(record);
  }
  return result;
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
  const values = items.map(unwrapValue);
  const result = array.unshift(...values);
  const length = array.length;
  for (let index = 0; index < length; index += 1) {
    writeIndex(record, index, previous[index], array[index]);
  }
  notifyLength(record, length);
  if (values.length > 0) {
    bumpKeys(record);
  }
  return result;
}

function arraySplice(record: ReactiveRecord, args: unknown[]): unknown {
  const array = record.raw as unknown[];
  const previousLength = array.length;
  const previous = array.slice();
  const previousOwn: boolean[] = [];
  for (let index = 0; index < previousLength; index += 1) {
    previousOwn[index] = hasOwn(array, index);
  }
  const start = args[0];
  const deleteCount = args[1];
  const inserted = args.length > 2 ? args.slice(2).map(unwrapValue) : [];
  let removed: unknown[];
  if (args.length === 0) {
    removed = [];
  } else if (args.length === 1) {
    removed = array.splice(start as number);
  } else {
    removed = array.splice(start as number, deleteCount as number, ...inserted);
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
  const previous = array.slice();
  array.reverse();
  notifyChangedIndices(record, previous);
  return record.proxy;
}

function arrayFill(record: ReactiveRecord, args: unknown[]): unknown {
  const array = record.raw as unknown[];
  const previous = array.slice();
  const wasOwn: boolean[] = [];
  for (let index = 0; index < previous.length; index += 1) {
    wasOwn[index] = hasOwn(array, index);
  }
  const value = unwrapValue(args[0]);
  if (args.length > 2) {
    array.fill(value, args[1] as number, args[2] as number);
  } else if (args.length > 1) {
    array.fill(value, args[1] as number);
  } else {
    array.fill(value);
  }
  notifyChangedIndices(record, previous);
  let keysChanged = false;
  for (let index = 0; index < array.length; index += 1) {
    if (wasOwn[index] === false && hasOwn(array, index)) {
      keysChanged = true;
      break;
    }
  }
  if (keysChanged) {
    bumpKeys(record);
  }
  return record.proxy;
}

function arrayCopyWithin(record: ReactiveRecord, args: unknown[]): unknown {
  const array = record.raw as unknown[];
  const previous = array.slice();
  const wasOwn: boolean[] = [];
  for (let index = 0; index < previous.length; index += 1) {
    wasOwn[index] = hasOwn(array, index);
  }
  if (args.length > 2) {
    array.copyWithin(args[0] as number, args[1] as number, args[2] as number);
  } else if (args.length > 1) {
    array.copyWithin(args[0] as number, args[1] as number);
  } else {
    array.copyWithin(args[0] as number, 0);
  }
  notifyChangedIndices(record, previous);
  let keysChanged = false;
  for (let index = 0; index < array.length; index += 1) {
    if (wasOwn[index] === false && hasOwn(array, index)) {
      keysChanged = true;
      break;
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

function setObjectField(
  record: ReactiveRecord,
  key: PropertyKey,
  value: unknown,
): boolean {
  const raw = record.raw;
  const hadOwn = hasOwn(raw, key);
  const previous = Reflect.get(raw, key, raw);
  const success = Reflect.set(raw, key, value, raw);
  if (!success) {
    return false;
  }
  const next = Reflect.get(raw, key, raw);
  ensureField(record, key, previous).write(next);
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

function isNonReactiveObject(value: object): boolean {
  if (isDomNode(value)) {
    return true;
  }
  const tag = Object.prototype.toString.call(value);
  switch (tag) {
    case "[object Date]":
    case "[object Map]":
    case "[object Set]":
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

function shouldWrap(value: object): boolean {
  if (hasReactivePrototype(value)) {
    return false;
  }
  if (Array.isArray(value)) {
    return true;
  }
  if (isNonReactiveObject(value)) {
    return false;
  }
  return Object.prototype.toString.call(value) === "[object Object]";
}

function createHandler(record: ReactiveRecord): ProxyHandler<object> {
  return {
    get(target, key, receiver): unknown {
      const raw = record.raw;
      if (record.isArray) {
        if (key === "length") {
          const signal = record.lengthSignal;
          if (signal !== null) {
            return signal.read();
          }
        }
        if (typeof key === "string") {
          const methods = record.arrayMethods;
          if (methods !== null && !hasOwn(raw, key)) {
            const method = methods.get(key);
            if (method !== undefined) {
              return method;
            }
          }
          const index = toArrayIndex(key);
          if (index !== null) {
            return deepReactive(getField(record, index).read());
          }
        }
      }
      const descriptor = getPropertyDescriptor(raw, key);
      if (descriptor !== undefined && descriptor.get !== undefined) {
        return deepReactive(Reflect.get(raw, key, record.proxy));
      }
      if (
        descriptor !== undefined &&
        descriptor.configurable === false &&
        descriptor.get === undefined &&
        descriptor.set === undefined &&
        descriptor.writable === false
      ) {
        return descriptor.value;
      }
      return deepReactive(getField(record, key).read());
    },
    set(target, key, value, receiver): boolean {
      const raw = record.raw;
      if (receiver !== record.proxy) {
        return Reflect.set(target, key, value, receiver);
      }
      const descriptor = getPropertyDescriptor(raw, key);
      if (descriptor !== undefined && descriptor.set !== undefined) {
        return Reflect.set(raw, key, value, record.proxy);
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
      return setObjectField(record, key, rawValue);
    },
    has(target, key): boolean {
      record.keysSignal.read();
      return Reflect.has(target, key);
    },
    ownKeys(target): ArrayLike<string | symbol> {
      record.keysSignal.read();
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor(target, key): PropertyDescriptor | undefined {
      record.keysSignal.read();
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
    deleteProperty(target, key): boolean {
      const hadOwn = hasOwn(target, key);
      const previous = hadOwn ? Reflect.get(target, key, target) : undefined;
      const deleted = Reflect.deleteProperty(target, key);
      if (deleted && hadOwn) {
        let fieldKey: PropertyKey = key;
        if (record.isArray && typeof key === "string") {
          const index = toArrayIndex(key);
          if (index !== null) {
            fieldKey = index;
          }
        }
        ensureField(record, fieldKey, previous).write(undefined);
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
      const previous = Reflect.get(raw, key, raw);
      const normalized: PropertyDescriptor =
        "value" in descriptor
          ? { ...descriptor, value: unwrapValue(descriptor.value) }
          : descriptor;
      const success = Reflect.defineProperty(raw, key, normalized);
      if (!success) {
        return false;
      }
      if ("value" in normalized) {
        ensureField(record, key, previous).write(Reflect.get(raw, key, raw));
      }
      if (!hadOwn) {
        bumpKeys(record);
      }
      return true;
    },
  };
}

function createRecord(raw: object): ReactiveRecord {
  const record: ReactiveRecord = {
    raw,
    proxy: raw,
    isArray: Array.isArray(raw),
    fields: new Map<PropertyKey, SignalHandle<unknown>>(),
    keysSignal: createSignalHandle<number>(0),
    lengthSignal: Array.isArray(raw)
      ? createSignalHandle<number>(raw.length)
      : null,
    arrayMethods: null,
    keysVersion: 0,
  };
  const proxy = new Proxy(raw, createHandler(record));
  record.proxy = proxy;
  if (record.isArray) {
    record.arrayMethods = createArrayMethods(record);
  }
  rawToRecord.set(raw, record);
  proxyToRecord.set(proxy, record);
  return record;
}

export function markReactiveClass(ctor: Function): void {
  reactiveClasses.add(ctor);
}

export function isReactiveClass(value: unknown): boolean {
  return typeof value === "function" && reactiveClasses.has(value);
}

export function isReactive(value: unknown): boolean {
  return typeof value === "object" && value !== null && proxyToRecord.has(value);
}

export function unwrap<T>(value: T): T {
  let current: unknown = value;
  while (typeof current === "object" && current !== null) {
    const record = proxyToRecord.get(current);
    if (record === undefined) {
      break;
    }
    current = record.raw;
  }
  return current as T;
}

export function deepReactive<T>(value: T): T {
  if (value === null || typeof value !== "object") {
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
