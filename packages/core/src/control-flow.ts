import type { Accessor, Setter } from "@ivlev-dev/silent-reactivity";
import {
  createRenderEffect,
  createRoot,
  createSignal,
  getOwner,
  onCleanup,
  runWithOwner,
  untrack,
} from "@ivlev-dev/silent-reactivity";
import type { Children } from "./jsx.js";
import {
  attachDisposer,
  collectNodes,
  createMountPoint,
  disposeNode,
  settleNodes,
} from "./dom.js";
import { extractMetadata } from "./metadata.js";
import {
  ITEM,
  LIST_END,
  SHOW,
  collectBetween,
  currentWindow,
  isHydrating,
  isItemMarker,
  isMarker,
  mismatch,
  withWindow,
} from "./hydration.js";

interface ItemState<T> {
  item: T;
  index: Accessor<number>;
  setIndex: Setter<number>;
  anchor: Comment;
  nodes: Node[];
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
  const hydrating = isHydrating();
  const outer = hydrating ? currentWindow() : null;
  const container = document.createDocumentFragment();
  const fallback = props.fallback;
  const parentOwner = getOwner();
  let states: ItemState<T>[] = [];
  let endAnchor: Comment;

  const detachNode = (node: Node): void => {
    if (node.parentNode !== null) {
      node.parentNode.removeChild(node);
    }
  };

  const renderItem = (
    state: ItemState<T>,
    value: unknown,
    mountParent: Node | null = null,
  ): void => {
    for (const node of state.nodes) {
      disposeNode(node);
      detachNode(node);
    }
    state.nodes = [];
    const parent = mountParent ?? state.anchor.parentNode;
    if (parent === null) {
      return;
    }
    const nodes: Node[] =
      value instanceof Node && !(value instanceof DocumentFragment)
        ? [value]
        : collectNodes(value as Children);
    const reference = state.anchor.nextSibling;
    const placed = extractMetadata(nodes);
    for (const node of placed) {
      parent.insertBefore(node, reference);
    }
    state.nodes = placed;
  };

  const removeState = (state: ItemState<T>): void => {
    if (state.disposed) {
      return;
    }
    state.disposed = true;
    for (const node of state.nodes) {
      disposeNode(node);
      detachNode(node);
    }
    state.nodes = [];
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

  const makeState = (
    item: T,
    anchor: Comment,
    nodes: Node[],
    itemEnd: Node | null,
    position: number,
    mountParent: Node | null = null,
  ): ItemState<T> => {
    let handle: [Accessor<number>, Setter<number>] | null = null;
    let current = position;
    let initialMount: Node | null = mountParent;
    const index: Accessor<number> = () => {
      if (handle === null) {
        handle = createSignal(current);
      }
      return handle[0]();
    };
    const setIndex: Setter<number> = (value) => {
      const next: number = typeof value === "function" ? value(current) : value;
      current = next;
      if (handle !== null) {
        handle[1](next);
      }
      return next;
    };

    const state: ItemState<T> = {
      item,
      index,
      setIndex,
      anchor,
      nodes,
      cleanup: () => {},
      disposed: false,
    };

    let seeded = itemEnd !== null;
    state.cleanup = runWithOwner(parentOwner, () =>
      createRoot((dispose) => {
        createRenderEffect(() => {
          if (seeded) {
            seeded = false;
            const window = {
              start: anchor,
              end: itemEnd as Node,
              cursor: anchor.nextSibling,
            };
            const value = withWindow(window, () => props.children(item, index));
            settleNodes(itemEnd, value);
            if (window.cursor !== itemEnd) {
              mismatch("содержимое элемента списка не совпало");
            }
            return;
          }
          renderItem(state, props.children(item, index), initialMount);
          initialMount = null;
        });
        return dispose;
      }),
    );

    attachDisposer(anchor, () => removeState(state));
    return state;
  };

  const createState = (
    item: T,
    position: number,
    sink: DocumentFragment,
  ): ItemState<T> => {
    const anchor = document.createComment(ITEM);
    const fragment = document.createDocumentFragment();
    fragment.appendChild(anchor);
    const state = makeState(item, anchor, [], null, position, fragment);
    sink.appendChild(fragment);
    return state;
  };

  let fallbackSeed: Node[] = [];

  if (hydrating) {
    if (outer === null) {
      return mismatch("For вне окна гидрации");
    }
    const candidate = outer.end.previousSibling;
    if (!isMarker(candidate, LIST_END)) {
      return mismatch("не найден конец списка");
    }
    endAnchor = candidate;
    const items: readonly T[] = untrack(() =>
      typeof props.each === "function" ? props.each() : props.each,
    );
    if (items.length === 0) {
      if (fallback !== undefined) {
        const window = {
          start: outer.start,
          end: endAnchor,
          cursor: outer.start.nextSibling,
        };
        withWindow(window, () => resolve(fallback));
        if (window.cursor !== endAnchor) {
          return mismatch("содержимое fallback списка не совпало");
        }
        fallbackSeed = collectBetween(outer.start, endAnchor);
      }
    }
    let cursor: Node | null = items.length === 0 ? endAnchor : outer.start.nextSibling;
    let position = 0;
    while (cursor !== null && cursor !== endAnchor) {
      if (!isItemMarker(cursor)) {
        return mismatch("ожидался маркер элемента списка");
      }
      const anchor = cursor;
      const nodes: Node[] = [];
      let node = cursor.nextSibling;
      while (node !== null && node !== endAnchor && !isItemMarker(node)) {
        nodes.push(node);
        node = node.nextSibling;
      }
      const item = items[position];
      if (item === undefined) {
        return mismatch("лишний элемент списка");
      }
      states.push(makeState(item, anchor, nodes, node ?? endAnchor, position));
      position += 1;
      cursor = node;
    }
    if (position !== items.length) {
      return mismatch("число элементов списка не совпало");
    }
  } else {
    endAnchor = document.createComment(LIST_END);
    container.appendChild(endAnchor);
  }

  const fallbackParent = hydrating ? endAnchor.parentNode : null;
  if (hydrating && fallbackParent === null) {
    return mismatch("список отсоединён от документа");
  }
  const fallbackMount = hydrating
    ? createMountPoint(fallbackParent as Node, endAnchor, fallbackSeed)
    : createMountPoint(container, endAnchor);
  const skipFirst = { value: hydrating };

  createRenderEffect(() => {
    const parent = endAnchor.parentNode;
    if (parent === null) {
      removeAll();
      return;
    }

    const { each } = props;
    const items: readonly T[] = typeof each === "function" ? each() : each;
    if (skipFirst.value) {
      skipFirst.value = false;
      return;
    }
    const previous = states;

    const pool = new Map<T, ItemState<T> | ItemState<T>[]>();
    for (const state of previous) {
      const existing = pool.get(state.item);
      if (existing === undefined) {
        pool.set(state.item, state);
        continue;
      }
      if (Array.isArray(existing)) {
        existing.push(state);
        continue;
      }
      pool.set(state.item, [existing, state]);
    }

    const next: ItemState<T>[] = [];
    const created: ItemState<T>[] = [];
    const batch = document.createDocumentFragment();
    let batchUsed = false;
    const used = new Set<ItemState<T>>();
    for (const item of items) {
      const entry = pool.get(item);
      const state =
        entry === undefined
          ? undefined
          : Array.isArray(entry)
            ? entry.shift()
            : entry;
      if (state === undefined) {
        const fresh = createState(item, next.length, batch);
        batchUsed = true;
        created.push(fresh);
        next.push(fresh);
        continue;
      }
      used.add(state);
      next.push(state);
    }

    for (const state of previous) {
      if (!used.has(state)) {
        removeState(state);
      }
    }

    if (batchUsed) {
      parent.insertBefore(batch, endAnchor);
    }

    states = next;

    for (let position = 0; position < next.length; position += 1) {
      next[position]!.setIndex(position);
    }

    let inOrder = true;
    let cursor = 0;
    for (const state of previous) {
      if (!used.has(state)) {
        continue;
      }
      if (next[cursor] !== state) {
        inOrder = false;
        break;
      }
      cursor += 1;
    }
    if (inOrder) {
      for (const state of created) {
        if (next[cursor] !== state) {
          inOrder = false;
          break;
        }
        cursor += 1;
      }
    }
    if (inOrder && cursor !== next.length) {
      inOrder = false;
    }

    if (!inOrder) {
      const previousOrder = new Map<ItemState<T>, number>();
      for (let position = 0; position < previous.length; position += 1) {
        previousOrder.set(previous[position]!, position);
      }

      const positions: number[] = [];
      const slots: number[] = [];
      for (let position = 0; position < next.length; position += 1) {
        const previousPosition = previousOrder.get(next[position]!);
        if (previousPosition !== undefined) {
          positions.push(previousPosition);
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
        const block: Node[] = [state.anchor, ...state.nodes];
        const parent = reference.parentNode;
        if (parent !== null && !stableSlots.has(position) && !precedes(block, reference)) {
          for (const node of block) {
            parent.insertBefore(node, reference);
          }
        }
        reference = state.anchor;
      }
    }

    fallbackMount.render(
      items.length === 0 && fallback !== undefined ? resolve(fallback) : null,
    );
  });

  onCleanup(removeAll);

  return hydrating ? document.createDocumentFragment() : container;
}

export function Show(props: ShowProps): Node {
  if (isHydrating()) {
    const outer = currentWindow();
    if (outer === null) {
      return mismatch("Show вне окна гидрации");
    }
    const anchor = outer.end.previousSibling;
    if (!isMarker(anchor, SHOW)) {
      return mismatch("не найден якорь Show");
    }
    const parent = anchor.parentNode;
    if (parent === null) {
      return mismatch("якорь Show отсоединён");
    }
    const mount = createMountPoint(parent, anchor, collectBetween(outer.start, anchor));
    let initialized = false;
    createRenderEffect(() => {
      const when = resolve(props.when);
      const active = truthy(when);
      if (!initialized) {
        initialized = true;
        const window = {
          start: outer.start,
          end: anchor,
          cursor: outer.start.nextSibling,
        };
        const value = withWindow(window, () =>
          resolve(active ? props.children : props.fallback),
        );
        settleNodes(anchor, value);
        if (window.cursor !== anchor) {
          mismatch("содержимое Show не совпало");
        }
        return;
      }
      mount.render(active ? resolve(props.children) : resolve(props.fallback));
    });
    onCleanup(() => mount.clear());
    return document.createDocumentFragment();
  }

  const container = document.createDocumentFragment();
  const anchor = document.createComment(SHOW);
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
