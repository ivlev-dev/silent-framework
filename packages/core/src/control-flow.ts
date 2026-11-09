import type { Accessor, Setter } from "@silent/reactivity";
import {
  createRenderEffect,
  createRoot,
  createSignal,
  getOwner,
  onCleanup,
  runWithOwner,
} from "@silent/reactivity";
import { attachDisposer, createMountPoint, type MountPoint } from "./dom";

interface ItemState<T> {
  item: T;
  index: Accessor<number>;
  setIndex: Setter<number>;
  anchor: Node;
  tail: Node;
  mount: MountPoint;
  cleanup: () => void;
  disposed: boolean;
}

export interface ForProps<T> {
  each: readonly T[] | (() => readonly T[]);
  children: (item: T, index: () => number) => Node;
  fallback?: unknown;
}

export interface ShowProps {
  when: unknown | (() => unknown);
  fallback?: unknown;
  children: unknown | (() => unknown);
}

function truthy(value: unknown): boolean {
  return value !== null && value !== undefined && value !== false && value !== 0 && value !== "";
}

function resolve(value: unknown): unknown {
  let current = value;
  while (typeof current === "function") {
    current = (current as () => unknown)();
  }
  return current;
}

function precedes(block: readonly Node[], reference: Node): boolean {
  let cursor: Node | null = reference.previousSibling;
  for (let index = block.length - 1; index >= 0; index -= 1) {
    const node = block[index];
    if (node === undefined || cursor === null || node !== cursor) {
      return false;
    }
    cursor = cursor.previousSibling;
  }
  return true;
}

function longestIncreasingSubsequence(values: readonly number[]): Set<number> {
  const tails: number[] = [];
  const previous: number[] = new Array<number>(values.length).fill(-1);
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!;
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (values[tails[middle]!]! < value) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    if (low > 0) {
      previous[index] = tails[low - 1]!;
    }
    tails[low] = index;
  }
  const result = new Set<number>();
  let cursor = tails.length === 0 ? -1 : tails[tails.length - 1]!;
  while (cursor !== -1) {
    result.add(cursor);
    cursor = previous[cursor]!;
  }
  return result;
}

export function For<T>(props: ForProps<T>): Node {
  const container = document.createDocumentFragment();
  const endAnchor = document.createComment("silent-end");
  container.appendChild(endAnchor);
  const fallbackMount = createMountPoint(container, endAnchor);
  const fallback = props.fallback;

  const parentOwner = getOwner();
  let states: ItemState<T>[] = [];

  const detachNode = (node: Node): void => {
    if (node.parentNode !== null) {
      node.parentNode.removeChild(node);
    }
  };

  const removeState = (state: ItemState<T>): void => {
    if (state.disposed) {
      return;
    }
    state.disposed = true;
    state.mount.clear();
    detachNode(state.tail);
    detachNode(state.anchor);
    state.cleanup();
  };

  const removeAll = (): void => {
    for (const state of states) {
      removeState(state);
    }
    states = [];
    fallbackMount.clear();
  };

  const createState = (item: T): ItemState<T> => {
    const anchor = document.createComment("silent-item");
    const tail = document.createComment("silent-tail");
    container.appendChild(anchor);
    container.appendChild(tail);
    const [index, setIndex] = createSignal(0);
    const mount = createMountPoint(container, tail);
    let cleanup: () => void = () => {};
    runWithOwner(parentOwner, () => {
      createRoot((dispose) => {
        cleanup = dispose;
        createRenderEffect(() => {
          mount.render(props.children(item, index));
        });
      });
    });
    const state: ItemState<T> = {
      item,
      index,
      setIndex,
      anchor,
      tail,
      mount,
      cleanup,
      disposed: false,
    };
    attachDisposer(anchor, () => removeState(state));
    return state;
  };

  createRenderEffect(() => {
    if (endAnchor.parentNode === null) {
      removeAll();
      return;
    }

    const { each } = props;
    const items: readonly T[] = typeof each === "function" ? each() : each;

    const previousOrder = new Map<ItemState<T>, number>();
    for (let position = 0; position < states.length; position += 1) {
      previousOrder.set(states[position]!, position);
    }

    const pool = new Map<T, ItemState<T>[]>();
    for (const state of states) {
      const bucket = pool.get(state.item);
      if (bucket === undefined) {
        pool.set(state.item, [state]);
        continue;
      }
      bucket.push(state);
    }

    const next: ItemState<T>[] = [];
    const used = new Set<ItemState<T>>();
    for (const item of items) {
      const bucket = pool.get(item);
      const state = bucket === undefined || bucket.length === 0 ? undefined : bucket.shift();
      if (state === undefined) {
        next.push(createState(item));
        continue;
      }
      used.add(state);
      next.push(state);
    }

    for (const state of states) {
      if (!used.has(state)) {
        removeState(state);
      }
    }

    states = next;

    for (let position = 0; position < next.length; position += 1) {
      next[position]!.setIndex(position);
    }

    const positions: number[] = [];
    const slots: number[] = [];
    for (let position = 0; position < next.length; position += 1) {
      const previous = previousOrder.get(next[position]!);
      if (previous !== undefined) {
        positions.push(previous);
        slots.push(position);
      }
    }

    const stableSlots = new Set<number>();
    for (const index of longestIncreasingSubsequence(positions)) {
      const slot = slots[index];
      if (slot !== undefined) {
        stableSlots.add(slot);
      }
    }

    let reference: Node = endAnchor;
    for (let position = next.length - 1; position >= 0; position -= 1) {
      const state = next[position]!;
      const block: Node[] = [state.anchor, ...state.mount.nodes(), state.tail];
      const parent = reference.parentNode;
      if (parent !== null && !stableSlots.has(position) && !precedes(block, reference)) {
        for (const node of block) {
          parent.insertBefore(node, reference);
        }
      }
      reference = state.anchor;
    }

    fallbackMount.render(
      items.length === 0 && fallback !== undefined ? resolve(fallback) : null,
    );
  });

  onCleanup(removeAll);

  return container;
}

export function Show(props: ShowProps): Node {
  const container = document.createDocumentFragment();
  const anchor = document.createComment("silent-show");
  container.appendChild(anchor);
  const mount = createMountPoint(container, anchor);
  createRenderEffect(() => {
    const when = resolve(props.when);
    const next: unknown = truthy(when) ? resolve(props.children) : resolve(props.fallback);
    mount.render(next);
  });
  onCleanup(() => mount.clear());
  return container;
}
