import { deepReactive, unwrap } from "./deep";
import {
  createMemo,
  createRoot,
  createSignalHandle,
  runWithOwner,
  untrack,
  type SignalHandle,
} from "./graph";
import type { Accessor, ReactiveStore } from "./types";

interface ComputedRecord {
  readonly accessor: Accessor<unknown>;
  readonly dispose: () => void;
}

class ReactiveStoreImpl implements ReactiveStore {
  private disposedFlag = false;
  readonly fieldSignals = new Map<PropertyKey, SignalHandle<unknown>>();
  readonly computeds = new Map<PropertyKey, ComputedRecord>();
  readonly cleanups: (() => void)[] = [];

  get disposed(): boolean {
    return this.disposedFlag;
  }

  dispose(): void {
    if (this.disposedFlag) {
      return;
    }
    this.disposedFlag = true;
    const cleanups = this.cleanups.splice(0);
    for (let index = cleanups.length - 1; index >= 0; index -= 1) {
      const cleanup = cleanups[index];
      if (cleanup !== undefined) {
        cleanup();
      }
    }
    this.computeds.clear();
    this.fieldSignals.clear();
  }
}

const stores = new WeakMap<object, ReactiveStoreImpl>();

function toImpl(store: ReactiveStore): ReactiveStoreImpl {
  if (store instanceof ReactiveStoreImpl) {
    return store;
  }
  throw new TypeError("Unknown reactive store");
}

function getFieldSignal(
  store: ReactiveStoreImpl,
  key: PropertyKey,
  getRaw: () => unknown,
): SignalHandle<unknown> {
  const existing = store.fieldSignals.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const signal = createSignalHandle<unknown>(getRaw());
  store.fieldSignals.set(key, signal);
  return signal;
}

export function createReactiveStore(): ReactiveStore {
  return new ReactiveStoreImpl();
}

export function storeFor(instance: object): ReactiveStore {
  const existing = stores.get(instance);
  if (existing !== undefined) {
    return existing;
  }
  const store = new ReactiveStoreImpl();
  stores.set(instance, store);
  return store;
}

export function readField<T>(
  instance: object,
  key: PropertyKey,
  getRaw: () => T,
): T {
  const store = toImpl(storeFor(instance));
  if (store.disposed) {
    return deepReactive(getRaw());
  }
  const signal = getFieldSignal(store, key, getRaw);
  return deepReactive(signal.read() as T);
}

export function writeField<T>(
  instance: object,
  key: PropertyKey,
  value: T,
  setRaw: (value: T) => void,
): T {
  const store = toImpl(storeFor(instance));
  const raw = unwrap(value);
  if (store.disposed) {
    setRaw(raw);
    return value;
  }
  setRaw(raw);
  const signal = getFieldSignal(store, key, () => raw);
  signal.write(raw);
  return value;
}

export function registerCleanup(store: ReactiveStore, fn: () => void): void {
  const impl = toImpl(store);
  if (impl.disposed) {
    fn();
    return;
  }
  impl.cleanups.push(fn);
}

export function copyReactiveState(source: object, target: object): void {
  const sourceStore = stores.get(source);
  if (sourceStore === undefined || sourceStore.disposed) {
    return;
  }
  const targetStore = toImpl(storeFor(target));
  for (const [key, signal] of sourceStore.fieldSignals) {
    const value = untrack(() => signal.read());
    const existing = targetStore.fieldSignals.get(key);
    if (existing !== undefined) {
      existing.write(value);
    } else {
      targetStore.fieldSignals.set(key, createSignalHandle(value));
    }
  }
}

export function getComputed<T>(
  instance: object,
  key: PropertyKey,
  compute: () => T,
): T {
  const store = toImpl(storeFor(instance));
  if (store.disposed) {
    return untrack(compute);
  }
  const existing = store.computeds.get(key);
  if (existing !== undefined) {
    return existing.accessor() as T;
  }
  const created = runWithOwner(null, () =>
    createRoot((dispose) => {
      const memo = createMemo(compute as () => unknown);
      return { memo, dispose };
    }),
  );
  store.computeds.set(key, {
    accessor: created.memo,
    dispose: created.dispose,
  });
  registerCleanup(store, () => {
    store.computeds.delete(key);
    created.dispose();
  });
  return created.memo() as T;
}
