import type { Accessor, Owner } from "@ivlev-dev/silent-reactivity";
import type { ForProps } from "./control-flow.js";

export interface ListWindow {
  start: Node;
  end: Node;
  cursor: Node | null;
}

export interface ListItemHandle {
  readonly anchor: Comment | null;
  readonly index: Accessor<number>;
  cleanup: () => void;
}

export interface ListPreseed<S extends ListItemHandle> {
  readonly states: S[];
  readonly endAnchor: Comment;
  readonly fallbackParent: Node;
  readonly fallbackSeed: Node[];
}

export interface ListHydrationRuntime {
  preseed<T, S extends ListItemHandle>(
    props: ForProps<T>,
    fallback: () => unknown,
    hasFallback: boolean,
    outer: ListWindow | null,
    parentOwner: Owner | null,
    makeState: (
      item: T,
      anchor: Comment,
      itemEnd: Node,
      position: number,
      children: ForProps<T>["children"],
    ) => S,
  ): ListPreseed<S>;
  seedItem<T>(
    window: ListWindow | null,
    anchor: Comment,
    end: Node,
    children: ForProps<T>["children"],
    item: T,
    index: Accessor<number>,
  ): ListWindow;
  effect<T>(
    run: () => void,
    staticRows: boolean,
    anchor: Comment | null,
    itemEnd: Node | null,
    item: T,
  ): () => void;
}

let runtime: ListHydrationRuntime | null = null;

export function registerListHydration(next: ListHydrationRuntime): void {
  runtime = next;
}

export function getListHydration(): ListHydrationRuntime {
  if (runtime === null) {
    throw new Error("List hydration runtime не загружен");
  }
  return runtime;
}
