import type { Children } from "@ivlev-dev/silent-core";

/**
 * Разворачивает ленивый слот (`() => Children`) в значение. Ленивая форма
 * обязательна для SSR: JSX, созданный в родителе заранее, расходует окно
 * гидрации и ломает разметку списка.
 */
export function resolveSlot(value: Children): Children {
  let current: unknown = value;
  while (typeof current === "function") {
    current = (current as () => unknown)();
  }
  return current as Children;
}
