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
  collectBetween,
  currentWindow,
  isHydrating,
  isItemMarker,
  isMarker,
  mismatch,
  withWindow,
} from "./hydration.js";

interface IndexState<T> {
  item: Accessor<T>;
  setItem: Setter<T>;
  index: Accessor<number>;
  setIndex: Setter<number>;
  anchor: Comment;
  nodes: Node[];
  cleanup: () => void;
  disposed: boolean;
}

export interface IndexProps<T> {
  each: readonly T[] | (() => readonly T[]);
  children: (item: Accessor<T>, index: Accessor<number>) => Node;
  fallback?: unknown;
}

function resolve(value: unknown): unknown {
  let current = value;
  while (typeof current === "function") {
    current = (current as () => unknown)();
  }
  return current;
}

export function Index<T>(props: IndexProps<T>): Node {
  const hydrating = isHydrating();
  const outer = hydrating ? currentWindow() : null;
  const container = document.createDocumentFragment();
  const fallback = props.fallback;
  const parentOwner = getOwner();
  let states: IndexState<T>[] = [];
  let endAnchor: Comment;
  let fallbackSeed: Node[] = [];

  const detachNode = (node: Node): void => {
    if (node.parentNode !== null) {
      node.parentNode.removeChild(node);
    }
  };

  const removeState = (state: IndexState<T>): void => {
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
    value: T,
    anchor: Comment,
    nodes: Node[],
    itemEnd: Node | null,
    position: number,
  ): IndexState<T> => {
    const [item, setItem] = createSignal<T>(value);
    const [index, setIndex] = createSignal(position);
    const state: IndexState<T> = {
      item,
      setItem,
      index,
      setIndex,
      anchor,
      nodes,
      cleanup: () => {},
      disposed: false,
    };

    state.cleanup = runWithOwner(parentOwner, () =>
      createRoot((dispose) => {
        if (itemEnd !== null) {
          const window = {
            start: anchor,
            end: itemEnd,
            cursor: anchor.nextSibling,
          };
          const rendered = withWindow(window, () => props.children(item, index));
          if (outer !== null) {
            outer.cursor = window.cursor;
          }
          settleNodes(itemEnd, rendered);
          if (window.cursor !== itemEnd) {
            mismatch("содержимое элемента списка не совпало");
          }
          return dispose;
        }
        const parent = anchor.parentNode;
        if (parent === null) {
          return dispose;
        }
        const rendered = props.children(item, index);
        const placed: Node[] = extractMetadata(
          rendered instanceof Node && !(rendered instanceof DocumentFragment)
            ? [rendered]
            : collectNodes(rendered as Children),
        );
        const reference = anchor.nextSibling;
        for (const node of placed) {
          parent.insertBefore(node, reference);
        }
        state.nodes = placed;
        return dispose;
      }),
    );

    attachDisposer(anchor, () => removeState(state));
    return state;
  };

  const createState = (
    value: T,
    parent: Node,
    position: number,
  ): IndexState<T> => {
    const anchor = document.createComment(ITEM);
    parent.insertBefore(anchor, endAnchor);
    return makeState(value, anchor, [], null, position);
  };

  if (hydrating) {
    if (outer === null) {
      return mismatch("Index вне окна гидрации");
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
        if (outer !== null) {
          outer.cursor = window.cursor;
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
    outer.cursor = endAnchor.nextSibling;
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

    while (states.length > items.length) {
      const state = states.pop();
      if (state !== undefined) {
        removeState(state);
      }
    }

    for (let position = 0; position < items.length; position += 1) {
      const item = items[position] as T;
      const state = states[position];
      if (state === undefined) {
        states.push(createState(item, parent, position));
        continue;
      }
      state.setItem(item);
      state.setIndex(position);
    }

    fallbackMount.render(
      items.length === 0 && fallback !== undefined ? resolve(fallback) : null,
    );
  });

  onCleanup(removeAll);

  return hydrating ? document.createDocumentFragment() : container;
}
