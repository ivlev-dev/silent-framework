import type { Accessor, Setter } from "@ivlev-dev/silent-reactivity";
import {
  createRenderEffect,
  createSignal,
  getOwner,
  onCleanup,
  runWithOwner,
  untrack,
} from "@ivlev-dev/silent-reactivity";
import { createEffectUnlessStatic } from "./static-effect.js";
import type { Children } from "./jsx.js";
import {
  attachDisposer,
  attachItemDisposer,
  clearItemDisposer,
  collectNodes,
  createMountPoint,
  disposeNode,
  isServerMode,
} from "./dom.js";
import { getServerBackend, serializeServerValue } from "./server-proxy.js";
import { settleNodes } from "./dom-hydration-state.js";
import { extractMetadata, extractMetadataNode, isMetadataFree } from "./metadata.js";
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
} from "./hydration-proxy.js";

declare const __SILENT_SERVER__: boolean | undefined;

const SERVER = typeof __SILENT_SERVER__ === "undefined" || __SILENT_SERVER__;

const ITEM_MARKER = `<!--${ITEM}-->`;
const LIST_END_MARKER = `<!--${LIST_END}-->`;

const noopCleanup = (): void => {};

interface IndexState<T> {
  item: Accessor<T>;
  setItem: Setter<T>;
  index: Accessor<number>;
  setIndex: Setter<number>;
  anchor: Comment | null;
  nodes: Node[];
  cleanup: () => void;
  disposed: boolean;
}

interface MutableWindow {
  start: Node;
  end: Node;
  cursor: Node | null;
}

class IndexedState<T> implements IndexState<T> {
  anchor: Comment | null;
  nodes: Node[];
  cleanup: () => void = noopCleanup;
  disposed = false;
  item: Accessor<T>;
  index: Accessor<number>;
  private itemHandle: [Accessor<T>, Setter<T>] | null = null;
  private indexHandle: [Accessor<number>, Setter<number>] | null = null;
  private currentItem: T;
  private position: number;

  constructor(value: T, anchor: Comment | null, nodes: Node[], position: number) {
    this.anchor = anchor;
    this.nodes = nodes;
    this.currentItem = value;
    this.position = position;
    this.item = () => {
      let handle = this.itemHandle;
      if (handle === null) {
        handle = createSignal(this.currentItem);
        this.itemHandle = handle;
      }
      return handle[0]();
    };
    this.index = () => {
      let handle = this.indexHandle;
      if (handle === null) {
        handle = createSignal(this.position);
        this.indexHandle = handle;
      }
      return handle[0]();
    };
  }

  setItem(value: T | ((previous: T) => T)): T {
    const next: T = typeof value === "function" ? (value as (previous: T) => T)(this.currentItem) : value;
    this.currentItem = next;
    const handle = this.itemHandle;
    if (handle !== null) {
      handle[1](next);
    }
    return next;
  }

  setIndex(value: number | ((previous: number) => number)): number {
    const next: number = typeof value === "function" ? value(this.position) : value;
    this.position = next;
    const handle = this.indexHandle;
    if (handle !== null) {
      handle[1](next);
    }
    return next;
  }
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

function renderIndexServer<T>(props: IndexProps<T>): Node {
  const fallback = props.fallback;
  const hasFallback = fallback !== undefined;
  const items: readonly T[] =
    typeof props.each === "function" ? props.each() : props.each;
  const backend = getServerBackend();
  if (backend?.createRaw !== undefined) {
    if (items.length === 0) {
      const out = hasFallback
        ? serializeServerValue(resolve(fallback)) + LIST_END_MARKER
        : LIST_END_MARKER;
      return backend.createRaw(out) as Node;
    }
    let out = "";
    let currentIndex = 0;
    const indexOf = (): number => currentIndex;
    for (let position = 0; position < items.length; position += 1) {
      const item = items[position];
      if (item === undefined) {
        break;
      }
      currentIndex = position;
      out += ITEM_MARKER;
      out += serializeServerValue(props.children(() => item, indexOf));
    }
    out += LIST_END_MARKER;
    return backend.createRaw(out) as Node;
  }
  if (backend?.createFragment !== undefined) {
    const total = items.length;
    const values: unknown[] = new Array(total);
    let currentIndex = 0;
    const indexOf = (): number => currentIndex;
    let count = 0;
    for (let position = 0; position < total; position += 1) {
      const item = items[position];
      if (item === undefined) {
        break;
      }
      currentIndex = position;
      values[position] = props.children(() => item, indexOf);
      count = position + 1;
    }
    values.length = count;
    let parts: string[];
    if (total === 0) {
      if (hasFallback) {
        values.push(resolve(fallback));
        parts = ["", LIST_END_MARKER];
      } else {
        parts = [LIST_END_MARKER];
      }
    } else if (count === 0) {
      parts = [ITEM_MARKER];
    } else {
      parts = new Array<string>(count + 1);
      parts[0] = ITEM_MARKER;
      if (count > 1) {
        parts.fill(ITEM_MARKER, 1, count);
      }
      parts[count] = LIST_END_MARKER;
    }
    const fragment = backend.createFragment(parts, values);
    if (fragment !== null) {
      return fragment.node as Node;
    }
  }
  const endAnchor = document.createComment(LIST_END);
  const sink = document.createDocumentFragment();
  sink.appendChild(endAnchor);
  let fallbackIndex = 0;
  const indexOf = (): number => fallbackIndex;
  for (let position = 0; position < items.length; position += 1) {
    const item = items[position];
    if (item === undefined) {
      break;
    }
    const anchor = document.createComment(ITEM);
    sink.insertBefore(anchor, endAnchor);
    fallbackIndex = position;
    const value = props.children(() => item, indexOf);
    if (value instanceof Node && !(value instanceof DocumentFragment) && isMetadataFree(value)) {
      sink.insertBefore(value, endAnchor);
      continue;
    }
    const nodes = extractMetadata(collectNodes(value as Children));
    for (const node of nodes) {
      sink.insertBefore(node, endAnchor);
    }
  }
  if (items.length === 0 && hasFallback) {
    const nodes = extractMetadata(collectNodes(resolve(fallback) as Children));
    for (const node of nodes) {
      sink.insertBefore(node, endAnchor);
    }
  }
  return sink;
}

export function Index<T>(props: IndexProps<T>): Node {
  if (SERVER && isServerMode()) {
    return renderIndexServer(props);
  }
  const hydrating = isHydrating();
  const outer = hydrating ? currentWindow() : null;
  const container = document.createDocumentFragment();
  const fallback = props.fallback;
  const hasFallback = fallback !== undefined;
  const parentOwner = getOwner();
  let states: IndexState<T>[] = [];
  let endAnchor: Comment;
  let fallbackSeed: Node[] = [];
  let skipFirst = hydrating;

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
    const nodes = state.nodes;
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index]!;
      disposeNode(node);
      detachNode(node);
    }
    state.nodes = [];
    if (state.anchor !== null) {
      detachNode(state.anchor);
    }
    state.cleanup();
  };

  const removeAll = (): void => {
    for (const state of states) {
      removeState(state);
    }
    states = [];
    fallbackMount.clear();
  };

  let runWindow: MutableWindow | null = null;

  const makeState = (
    value: T,
    anchor: Comment | null,
    nodes: Node[],
    itemEnd: Node | null,
    position: number,
    mountParent: Node | null = null,
  ): IndexState<T> => {
    const state = new IndexedState<T>(value, anchor, nodes, position);
    let initialMount = mountParent;
    state.cleanup = createEffectUnlessStatic(() => {
      if (itemEnd !== null) {
        const start = anchor as Comment;
        let window = runWindow;
        if (window === null) {
          window = { start, end: itemEnd, cursor: start.nextSibling };
          runWindow = window;
        } else {
          window.start = start;
          window.end = itemEnd;
          window.cursor = start.nextSibling;
        }
        const rendered = withWindow(window, props.children, state.item, state.index);
        if (outer !== null) {
          outer.cursor = window.cursor;
        }
        settleNodes(itemEnd, rendered);
        if (window.cursor !== itemEnd) {
          mismatch("содержимое элемента списка не совпало");
        }
        return;
      }
      const current = state.nodes;
      let tail: Node | null = null;
      let parent: Node | null = initialMount;
      initialMount = null;
      if (current.length > 0) {
        tail = current[current.length - 1]!.nextSibling;
        parent ??= current[0]!.parentNode;
        clearItemDisposer(current[0]!);
        for (let position = 0; position < current.length; position += 1) {
          const node = current[position]!;
          disposeNode(node);
          detachNode(node);
        }
      } else if (anchor !== null) {
        tail = anchor.nextSibling;
        parent ??= anchor.parentNode;
      }
      state.nodes = [];
      if (parent === null) {
        return;
      }
      const rendered = props.children(state.item, state.index);
      let placed: Node[];
      if (rendered instanceof Node && !(rendered instanceof DocumentFragment)) {
        const kept = extractMetadataNode(rendered);
        placed = kept === null ? [] : [kept];
      } else {
        placed = extractMetadata(collectNodes(rendered as Children));
      }
      if (placed.length === 0) {
        if (state.anchor === null) {
          const marker = document.createComment(ITEM);
          if (tail === null) {
            parent.appendChild(marker);
          } else {
            parent.insertBefore(marker, tail);
          }
          state.anchor = marker;
          attachItemDisposer(marker, () => removeState(state));
        }
        return;
      }
      for (let index = 0; index < placed.length; index += 1) {
        parent.insertBefore(placed[index]!, tail);
      }
      state.nodes = placed;
      attachItemDisposer(placed[0]!, () => removeState(state));
    }) ?? noopCleanup;

    if (anchor !== null) {
      attachDisposer(anchor, () => removeState(state));
    }
    return state;
  };

  const createState = (
    value: T,
    sink: DocumentFragment,
    position: number,
  ): IndexState<T> => makeState(value, null, [], null, position, sink);

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
      if (hasFallback) {
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
    runWithOwner(parentOwner, () => {
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
    });
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

  createRenderEffect(() => {
    const parent = endAnchor.parentNode;
    if (parent === null) {
      removeAll();
      return;
    }

    const each = props.each;
    const items: readonly T[] = typeof each === "function" ? each() : each;
    if (skipFirst) {
      skipFirst = false;
      return;
    }

    while (states.length > items.length) {
      const state = states.pop();
      if (state !== undefined) {
        removeState(state);
      }
    }

    const previousLength = states.length;
    for (let position = 0; position < previousLength; position += 1) {
      states[position]!.setItem(items[position] as T);
    }
    if (items.length > previousLength) {
      const batch = document.createDocumentFragment();
      runWithOwner(parentOwner, () => {
        for (let position = previousLength; position < items.length; position += 1) {
          states.push(createState(items[position] as T, batch, position));
        }
      });
      parent.insertBefore(batch, endAnchor);
    }

    fallbackMount.render(items.length === 0 && hasFallback ? resolve(fallback) : null);
  });

  onCleanup(removeAll);

  return hydrating ? document.createDocumentFragment() : container;
}
