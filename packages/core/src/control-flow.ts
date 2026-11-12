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
  collectNodes,
  createMountPoint,
  disposeNode,
  isServerMode,
} from "./dom.js";
import { hydratedEffect, settleNodes } from "./dom-hydration-state.js";
import { getServerBackend, serializeServerValue } from "./server-proxy.js";
import { extractMetadata, extractMetadataNode, isMetadataFree } from "./metadata.js";
import {
  ITEM,
  LIST_END,
  SHOW,
  collectBetween,
  currentWindow,
  isHydrating,
  isMarker,
  mismatch,
  withWindow,
} from "./hydration-proxy.js";

declare const __SILENT_SERVER__: boolean | undefined;

const SERVER = typeof __SILENT_SERVER__ === "undefined" || __SILENT_SERVER__;

const noopCleanup = (): void => {};

interface ItemState<T> {
  item: T;
  index: Accessor<number>;
  setIndex: Setter<number>;
  anchor: Comment;
  nodes: Node[];
  nodesEnd: Node | null;
  cleanup: () => void;
  disposed: boolean;
  previousIndex: number;
  generation: number;
}

const NO_NODES: Node[] = [];

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

function precedesBlock(nodes: readonly Node[], anchor: Node, reference: Node): boolean {
  let cursor: Node | null = reference.previousSibling;
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    if (cursor === null || nodes[index] !== cursor) {
      return false;
    }
    cursor = cursor.previousSibling;
  }
  return cursor === anchor;
}

function markStableSlots(
  positions: Int32Array,
  slots: Int32Array,
  count: number,
  stable: Uint8Array,
  tails: Int32Array,
  previous: Int32Array,
): void {
  let length = 0;
  for (let index = 0; index < count; index += 1) {
    const value = positions[index]!;
    let low = 0;
    let high = length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (positions[tails[middle]!]! < value) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    previous[index] = low > 0 ? tails[low - 1]! + 1 : 0;
    tails[low] = index;
    if (low + 1 > length) {
      length = low + 1;
    }
  }
  let cursor = length === 0 ? 0 : tails[length - 1]! + 1;
  while (cursor !== 0) {
    const index = cursor - 1;
    stable[slots[index]!] = 1;
    cursor = previous[index]!;
  }
}

const ITEM_MARKER = `<!--${ITEM}-->`;
const LIST_END_MARKER = `<!--${LIST_END}-->`;

function renderForServer<T>(props: ForProps<T>): Node {
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
      out += serializeServerValue(props.children(item, indexOf));
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
      values[position] = props.children(item, indexOf);
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
    const value = props.children(item, indexOf);
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

export function For<T>(props: ForProps<T>): Node {
  if (SERVER && isServerMode()) {
    return renderForServer(props);
  }
  const hydrating = isHydrating();
  const outer = hydrating ? currentWindow() : null;
  let container: DocumentFragment | null = null;
  const fallback = props.fallback;
  const hasFallback = fallback !== undefined;
  let states: ItemState<T>[] = [];
  let spare: ItemState<T>[] = [];
  const createdBuffer: ItemState<T>[] = [];
  let generation = 0;
  let endAnchor: Comment;

  let positions: Int32Array | null = null;
  let slots: Int32Array | null = null;
  let stable: Uint8Array | null = null;
  let lisTails: Int32Array | null = null;
  let lisPrevious: Int32Array | null = null;

  const ensureBuffers = (
    reused: number,
    length: number,
  ): readonly [Int32Array, Int32Array, Uint8Array, Int32Array, Int32Array] => {
    if (positions === null || slots === null || positions.length < reused) {
      const capacity = reused * 2;
      positions = new Int32Array(capacity);
      slots = new Int32Array(capacity);
    }
    if (stable === null || stable.length < length) {
      stable = new Uint8Array(length * 2);
    } else {
      stable.fill(0);
    }
    if (lisTails === null || lisPrevious === null || lisTails.length < reused) {
      const capacity = reused * 2;
      lisTails = new Int32Array(capacity);
      lisPrevious = new Int32Array(capacity);
    }
    return [positions, slots, stable, lisTails, lisPrevious];
  };

  const detachNode = (node: Node): void => {
    if (node.parentNode !== null) {
      node.parentNode.removeChild(node);
    }
  };

  const materializeNodes = (state: ItemState<T>): Node[] => {
    const nodes = state.nodes;
    if (nodes !== NO_NODES || state.nodesEnd === null) {
      return nodes;
    }
    const collected: Node[] = [];
    let cursor: Node | null = state.anchor.nextSibling;
    while (cursor !== null && cursor !== state.nodesEnd) {
      collected.push(cursor);
      cursor = cursor.nextSibling;
    }
    state.nodes = collected;
    return collected;
  };

  const renderItem = (
    state: ItemState<T>,
    value: unknown,
    mountParent: Node | null = null,
  ): void => {
    const nodes = materializeNodes(state);
    if (nodes.length > 0) {
      for (let index = 0; index < nodes.length; index += 1) {
        const node = nodes[index]!;
        disposeNode(node);
        detachNode(node);
      }
      state.nodes = [];
      state.nodesEnd = null;
    }
    const parent = mountParent ?? state.anchor.parentNode;
    if (parent === null) {
      return;
    }
    let placed: Node[];
    if (value instanceof Node && !(value instanceof DocumentFragment)) {
      const kept = extractMetadataNode(value);
      placed = kept === null ? [] : [kept];
    } else {
      placed = extractMetadata(collectNodes(value as Children));
    }
    const reference = state.anchor.nextSibling;
    for (let index = 0; index < placed.length; index += 1) {
      parent.insertBefore(placed[index]!, reference);
    }
    state.nodes = placed;
    state.nodesEnd = null;
  };

  const removeState = (state: ItemState<T>): void => {
    if (state.disposed) {
      return;
    }
    state.disposed = true;
    const nodes = materializeNodes(state);
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index]!;
      disposeNode(node);
      detachNode(node);
    }
    state.nodes = [];
    state.nodesEnd = null;
    detachNode(state.anchor);
    state.cleanup();
  };

  const removeAll = (): void => {
    for (const state of states) {
      removeState(state);
    }
    states = [];
    spare = [];
    createdBuffer.length = 0;
    fallbackMount.clear();
  };

  const makeState = (
    item: T,
    anchor: Comment,
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
      nodes: itemEnd === null ? [] : NO_NODES,
      nodesEnd: itemEnd,
      cleanup: () => {},
      disposed: false,
      previousIndex: -1,
      generation: -1,
    };

    let seeded = itemEnd !== null;
    const run = (): void => {
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
    };
    state.cleanup = hydrating
      ? hydratedEffect(run) ?? noopCleanup
      : createEffectUnlessStatic(run) ?? noopCleanup;

    attachDisposer(anchor, () => removeState(state));
    return state;
  };

  const createState = (
    item: T,
    position: number,
    sink: DocumentFragment,
  ): ItemState<T> => {
    const anchor = document.createComment(ITEM);
    sink.appendChild(anchor);
    return makeState(item, anchor, null, position, sink);
  };

  let fallbackSeed: Node[] = [];
  let skipFirst = hydrating;

  const parentOwner = getOwner();

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
        fallbackSeed = collectBetween(outer.start, endAnchor);
      }
    }
    let cursor: Node | null = items.length === 0 ? endAnchor : outer.start.nextSibling;
    let position = 0;
    runWithOwner(parentOwner, () => {
      while (cursor !== null && cursor !== endAnchor) {
        if (cursor.nodeType !== Node.COMMENT_NODE || (cursor as Comment).data !== ITEM) {
          return mismatch("ожидался маркер элемента списка");
        }
        const anchor = cursor as Comment;
        let node = cursor.nextSibling;
        while (node !== null && node !== endAnchor) {
          if (node.nodeType === Node.COMMENT_NODE && (node as Comment).data === ITEM) {
            break;
          }
          node = node.nextSibling;
        }
        const item = items[position];
        if (item === undefined) {
          return mismatch("лишний элемент списка");
        }
        states.push(makeState(item, anchor, node ?? endAnchor, position));
        position += 1;
        cursor = node;
      }
    });
    if (position !== items.length) {
      return mismatch("число элементов списка не совпало");
    }
  } else {
    endAnchor = document.createComment(LIST_END);
    const sink = container ?? (container = document.createDocumentFragment());
    sink.appendChild(endAnchor);
  }

  const fallbackParent = hydrating ? endAnchor.parentNode : null;
  if (hydrating && fallbackParent === null) {
    return mismatch("список отсоединён от документа");
  }
  const fallbackMount = hydrating
    ? createMountPoint(fallbackParent as Node, endAnchor, fallbackSeed)
    : createMountPoint(
        container ?? (container = document.createDocumentFragment()),
        endAnchor,
      );

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

    const previous = states;
    const previousLength = previous.length;
    const nextLength = items.length;
    const shared = previousLength < nextLength ? previousLength : nextLength;
    let prefix = 0;
    while (prefix < shared && previous[prefix]!.item === items[prefix]) {
      prefix += 1;
    }

    if (prefix === shared) {
      if (nextLength >= previousLength) {
        if (nextLength > previousLength) {
          const batch = document.createDocumentFragment();
          runWithOwner(parentOwner, () => {
            for (let position = previousLength; position < nextLength; position += 1) {
              previous.push(createState(items[position] as T, position, batch));
            }
          });
          parent.insertBefore(batch, endAnchor);
        }
        fallbackMount.render(nextLength === 0 && hasFallback ? resolve(fallback) : null);
        return;
      }
      for (let index = nextLength; index < previousLength; index += 1) {
        removeState(previous[index]!);
      }
      previous.length = nextLength;
      fallbackMount.render(nextLength === 0 && hasFallback ? resolve(fallback) : null);
      return;
    }

    generation += 1;
    const currentGeneration = generation;
    const pool = new Map<T, ItemState<T> | ItemState<T>[]>();
    for (let index = 0; index < previousLength; index += 1) {
      const state = previous[index]!;
      state.previousIndex = index;
      const existing = pool.get(state.item);
      if (existing === undefined) {
        pool.set(state.item, state);
      } else if (Array.isArray(existing)) {
        existing.push(state);
      } else {
        pool.set(state.item, [existing, state]);
      }
    }

    const next = spare;
    next.length = 0;
    const created = createdBuffer;
    created.length = 0;
    let batch: DocumentFragment | null = null;

    runWithOwner(parentOwner, () => {
      for (let position = 0; position < nextLength; position += 1) {
        const item = items[position] as T;
        const entry = pool.get(item);
        let state: ItemState<T> | undefined;
        if (entry === undefined) {
          state = undefined;
        } else if (Array.isArray(entry)) {
          state = entry.length === 0 ? undefined : entry.shift();
          if (entry.length === 0) {
            pool.delete(item);
          }
        } else {
          state = entry;
          pool.delete(item);
        }
        if (state === undefined) {
          if (batch === null) {
            batch = document.createDocumentFragment();
          }
          const fresh = createState(item, position, batch);
          created.push(fresh);
          next.push(fresh);
          continue;
        }
        state.generation = currentGeneration;
        next.push(state);
      }
    });

    for (let index = 0; index < previousLength; index += 1) {
      const state = previous[index]!;
      if (state.generation !== currentGeneration) {
        removeState(state);
      }
    }

    if (batch !== null) {
      parent.insertBefore(batch, endAnchor);
    }

    for (let position = 0; position < nextLength; position += 1) {
      const state = next[position]!;
      if (state.previousIndex !== position) {
        state.setIndex(position);
      }
    }

    let inOrder = true;
    let cursor = 0;
    for (let index = 0; index < previousLength; index += 1) {
      const state = previous[index]!;
      if (state.generation !== currentGeneration) {
        continue;
      }
      if (next[cursor] !== state) {
        inOrder = false;
        break;
      }
      cursor += 1;
    }
    if (inOrder) {
      for (let index = 0; index < created.length; index += 1) {
        if (next[cursor] !== created[index]) {
          inOrder = false;
          break;
        }
        cursor += 1;
      }
    }
    if (inOrder && cursor !== nextLength) {
      inOrder = false;
    }

    if (!inOrder) {
      let reused = 0;
      for (let position = 0; position < nextLength; position += 1) {
        if (next[position]!.previousIndex >= 0) {
          reused += 1;
        }
      }
      const [orderPositions, orderSlots, orderStable, orderTails, orderPrevious] =
        ensureBuffers(reused, nextLength);
      let sequence = 0;
      for (let position = 0; position < nextLength; position += 1) {
        const state = next[position]!;
        if (state.previousIndex >= 0) {
          orderPositions[sequence] = state.previousIndex;
          orderSlots[sequence] = position;
          sequence += 1;
        }
      }
      markStableSlots(orderPositions, orderSlots, reused, orderStable, orderTails, orderPrevious);

      let reference: Node = endAnchor;
      for (let position = nextLength - 1; position >= 0; position -= 1) {
        const state = next[position]!;
        const holder = reference.parentNode;
        if (
          holder !== null &&
          orderStable[position] === 0 &&
          !precedesBlock(materializeNodes(state), state.anchor, reference)
        ) {
          holder.insertBefore(state.anchor, reference);
          const nodes = materializeNodes(state);
          for (let index = 0; index < nodes.length; index += 1) {
            holder.insertBefore(nodes[index]!, reference);
          }
        }
        reference = state.anchor;
      }
    }

    states = next;
    spare = previous;
    previous.length = 0;
    created.length = 0;

    fallbackMount.render(nextLength === 0 && hasFallback ? resolve(fallback) : null);
  });

  onCleanup(removeAll);

  return hydrating
    ? document.createDocumentFragment()
    : (container ??= document.createDocumentFragment());
}

export function Show(props: ShowProps): Node {
  if (SERVER && isServerMode()) {
    const active = truthy(resolve(props.when));
    const value = resolve(active ? props.children : props.fallback);
    const container = document.createDocumentFragment();
    const nodes = extractMetadata(collectNodes(value as Children));
    for (const node of nodes) {
      container.appendChild(node);
    }
    container.appendChild(document.createComment(SHOW));
    return container;
  }
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
    onCleanup(mount.clear);
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
  onCleanup(mount.clear);
  return container;
}
