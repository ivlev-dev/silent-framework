import type { KeySelector } from "@ivlev-dev/silent-core";
import { For } from "@ivlev-dev/silent-core";

export interface KeyedListProps<T> {
  readonly each: readonly T[] | (() => readonly T[]);
  readonly keyOf: KeySelector<T>;
  readonly children: (item: T, index: () => number) => Node;
}

/**
 * Список с ключами. Обёртка над `For` нужна, чтобы список не оказался
 * единственным ребёнком разметки: компилятор превращает такой `For` в
 * direct-компонент с `parent`/`marker`, и при SSR его результат теряется.
 */
export function KeyedList<T>(props: KeyedListProps<T>): Node {
  return (
    <For each={props.each} keyOf={props.keyOf}>
      {props.children}
    </For>
  );
}
