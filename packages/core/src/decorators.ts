import {
  createEffect,
  createRoot,
  getComputed,
  markReactiveClass,
  readField,
  registerCleanup,
  storeFor,
  untrack,
  writeField,
} from "@silent/reactivity";

export function reactive<Instance extends object, Value>(
  target: ClassAccessorDecoratorTarget<Instance, Value>,
  context: ClassAccessorDecoratorContext<Instance, Value>,
): ClassAccessorDecoratorResult<Instance, Value> {
  context.addInitializer(function (this: Instance) {
    markReactiveClass(this.constructor);
  });
  return {
    get(this: Instance) {
      return readField(this, context.name, () => target.get.call(this));
    },
    set(this: Instance, value: Value) {
      writeField(this, context.name, value, (raw) => target.set.call(this, raw));
    },
    init(this: Instance, value: Value) {
      return value;
    },
  };
}

export function computed<Instance extends object, Value>(
  target: (this: Instance) => Value,
  context: ClassGetterDecoratorContext<Instance, Value>,
): (this: Instance) => Value {
  return function (this: Instance) {
    return getComputed(this, context.name, () => target.call(this));
  };
}

export interface WatchOptions<R> {
  immediate?: boolean;
  equals?: (a: R, b: R) => boolean;
  defer?: boolean;
}

type WatchMethodDecorator<C extends object, R> = <
  Next extends R,
  Prev extends R | undefined,
>(
  target: (this: C, next: Next, prev: Prev) => void,
  context: ClassMethodDecoratorContext<C, (this: C, next: Next, prev: Prev) => void>,
) => void;

export function watch<C extends object, R>(
  selector: (vm: C) => R,
  options?: WatchOptions<R>,
): WatchMethodDecorator<C, R> {
  return function (target, context) {
    const handler = target as (this: C, next: R, prev: R | undefined) => void;
    context.addInitializer(function (this: C) {
      const instance = this;
      const store = storeFor(instance);
      const equals = options?.equals ?? ((a: R, b: R) => Object.is(a, b));
      const immediate = options?.immediate === true;
      const defer = options?.defer === true;
      let first = true;
      let prev: R | undefined;
      const root = createRoot((dispose) => {
        registerCleanup(store, dispose);
        createEffect(() => {
          const next = selector(instance);
          if (first) {
            first = false;
            prev = next;
            if (immediate && !defer) {
              untrack(() => handler.call(instance, next, undefined));
            }
            return;
          }
          const previous = prev;
          prev = next;
          if (previous !== undefined && equals(previous, next)) {
            return;
          }
          untrack(() => handler.call(instance, next, previous));
        });
      });
      return root;
    });
  };
}
