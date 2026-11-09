import { createEffect, untrack } from "./graph";
import type { Accessor, OnOptions } from "./types";

export function on<T>(
  deps: Accessor<T> | Accessor<T>[],
  fn: (value: T, prev: T) => void,
  options?: OnOptions,
): void {
  let initialized = false;
  let prev: T | undefined;
  createEffect(() => {
    let value: T;
    if (Array.isArray(deps)) {
      value = deps.map((dep) => dep()) as T;
    } else {
      value = deps();
    }
    if (!initialized) {
      initialized = true;
      prev = value;
      if (options?.defer === true) {
        return;
      }
      untrack(() => fn(value, value));
      return;
    }
    const previous = prev as T;
    prev = value;
    untrack(() => fn(value, previous));
  });
}
