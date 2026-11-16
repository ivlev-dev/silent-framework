import { For, type ForProps } from "./control-flow.js";
import type { ListSource } from "./list-items.js";

export type KeySelector<T> = (item: T, index: number) => unknown;

export type KeyedRender<T> = (item: T, index: () => number) => Node;

export interface KeyedProps<T> {
  each: ListSource<T> | (() => ListSource<T>);
  keyOf: KeySelector<T>;
  children: KeyedRender<T>;
  fallback?: unknown;
}

export function mapKeyed<T>(
  each: ListSource<T> | (() => ListSource<T>),
  keyOf: KeySelector<T>,
  children: KeyedRender<T>,
): Node {
  return For<T>({ each, keyOf, children });
}

export function Keyed<T>(props: KeyedProps<T>): Node {
  return For<T>(props as ForProps<T>);
}
