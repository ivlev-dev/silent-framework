import { createSignalHandle } from "@ivlev-dev/silent-reactivity";

export interface PropsProxy {
  readonly value: Record<string, unknown>;
  readonly current: Record<string, unknown>;
  update(next: Record<string, unknown>): boolean;
}

export function createPropsProxy(initial: Record<string, unknown>): PropsProxy {
  const handle = createSignalHandle<Record<string, unknown>>(initial);
  const target: Record<PropertyKey, unknown> = {};
  const value = new Proxy(target, {
    get(_target, key, receiver): unknown {
      return Reflect.get(handle.read(), key, receiver);
    },
    has(_target, key): boolean {
      return key in handle.read();
    },
    ownKeys(): ArrayLike<string | symbol> {
      return Reflect.ownKeys(handle.read());
    },
    getOwnPropertyDescriptor(_target, key): PropertyDescriptor | undefined {
      const descriptor = Reflect.getOwnPropertyDescriptor(handle.read(), key);
      return descriptor === undefined
        ? undefined
        : { ...descriptor, configurable: true };
    },
    set(_target, key, next): boolean {
      return Reflect.set(handle.read(), key, next);
    },
    deleteProperty(_target, key): boolean {
      return Reflect.deleteProperty(handle.read(), key);
    },
  }) as Record<string, unknown>;
  return {
    value,
    get current(): Record<string, unknown> {
      return handle.peek();
    },
    update(next: Record<string, unknown>): boolean {
      handle.write(next);
      return handle.hasObservers();
    },
  };
}
