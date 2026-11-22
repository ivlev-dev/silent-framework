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
import { createEffectUnlessStatic } from "./static-effect.js";
import { markDirectComponent } from "./match-node.js";
import { settleNodes } from "./dom-hydration-state.js";
import type { Children } from "./jsx.js";
import {
  attachItemState,
  clearItemDisposer,
  collectNodes,
  createMountPoint,
  disposeNode,
  isServerMode,
  type MountPoint,
} from "./dom.js";
import { getListHydration } from "./list-hydration-state.js";
import { beginRegion, regionMatches, settleWindow } from "./hydration-cursor.js";
import { normalizeItems, type ListSource } from "./list-items.js";
import { getServerBackend, serializeServerValue } from "./server-proxy.js";
import { extractMetadata, extractMetadataNode, isMetadataFree } from "./metadata.js";
import {
  ITEM,
  LIST_END,
  SHOW,
  collectBetween,
  currentWindow,
  findInsertWindow,
  isHydrating,
  isMarker,
  mismatch,
  withWindow,
} from "./hydration-proxy.js";


declare const __SILENT_HYDRATE__: boolean | undefined;

const HYDRATE =
  typeof __SILENT_HYDRATE__ === "undefined" || __SILENT_HYDRATE__;
declare const __SILENT_SERVER__: boolean | undefined;

const SERVER = typeof __SILENT_SERVER__ === "undefined" || __SILENT_SERVER__;

const noopCleanup = (): void => {};

interface ItemState<T> {
  item: T;
  key: unknown;
  index: Accessor<number>;
  setIndex: Setter<number>;
  anchor: Comment | null;
  nodes: Node[];
  nodesEnd: Node | null;
  cleanup: () => void;
  disposed: boolean;
  previousIndex: number;
  generation: number;
  disposeRerender: (() => void) | null;
  dispose(): void;
}

const NO_NODES: Node[] = [];

interface MutableWindow {
  start: Node;
  end: Node;
  cursor: Node | null;
}

const NO_INDEX: Accessor<number> = () => 0;

class KeyedState<T> implements ItemState<T> {
  item: T;
  key: unknown;
  anchor: Comment | null;
  nodes: Node[];
  nodesEnd: Node | null;
  cleanup: () => void = noopCleanup;
  disposed = false;
  previousIndex = -1;
  generation = -1;
  disposeRerender: (() => void) | null = null;
  index: Accessor<number>;
  private handle: [Accessor<number>, Setter<number>] | null = null;
  private position: number;
  private remove: (state: ItemState<T>) => void;

  constructor(
    item: T,
    key: unknown,
    anchor: Comment | null,
    itemEnd: Node | null,
    position: number,
    usesIndex: boolean,
    remove: (state: ItemState<T>) => void,
  ) {
    this.item = item;
    this.key = key;
    this.anchor = anchor;
    this.nodes = itemEnd === null ? [] : NO_NODES;
    this.nodesEnd = itemEnd;
    this.position = position;
    this.remove = remove;
    this.index = usesIndex
      ? () => {
          let handle = this.handle;
          if (handle === null) {
            handle = createSignal(this.position);
            this.handle = handle;
          }
          return handle[0]();
        }
      : NO_INDEX;
  }

  dispose(): void {
    this.remove(this);
  }

  setIndex(value: number | ((previous: number) => number)): number {
    const next: number = typeof value === "function" ? value(this.position) : value;
    this.position = next;
    const handle = this.handle;
    if (handle !== null) {
      handle[1](next);
    }
    return next;
  }
}

export interface ForProps<T> {
  each: ListSource<T> | (() => ListSource<T>);
  children: (item: T, index: () => number) => Node;
  keyOf?: (item: T, index: number) => unknown;
  fallback?: unknown;
  parent?: Node;
  marker?: Node | null;
  index?: boolean;
  readonly staticRows?: boolean;
}

function sameItem(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }
  const tag = Object.prototype.toString.call(a);
  if (tag !== Object.prototype.toString.call(b)) {
    return false;
  }
  if (tag === "[object Date]") {
    return (a as Date).getTime() === (b as Date).getTime();
  }
  if (tag === "[object RegExp]") {
    return String(a) === String(b);
  }
  if (tag !== "[object Object]" && tag !== "[object Array]") {
    return false;
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) {
    return false;
  }
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(right, key)) {
      return false;
    }
    if (!Object.is(left[key], right[key])) {
      return false;
    }
  }
  return true;
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

/**
 * Готовит значение элемента списка к серверной сериализации: `<title>`,
 * `<meta>` и `<link>` должны уходить в head, а не в тело списка.
 */
function serverListItem(value: unknown): unknown {
  const type = typeof value;
  if (
    value === null
    || value === undefined
    || type === "string"
    || type === "number"
    || type === "bigint"
    || type === "boolean"
  ) {
    return value;
  }
  if (
    value instanceof Node
    && !(value instanceof DocumentFragment)
    && isMetadataFree(value)
  ) {
    return value;
  }
  const nodes = extractMetadata(collectNodes(value as Children));
  if (nodes.length === 0) {
    return "";
  }
  return nodes.length === 1 ? nodes[0] : nodes;
}

function renderForServer<T>(props: ForProps<T>): Node {
  const hasFallback = "fallback" in props;
  const fallback = (): unknown => props.fallback;
  const items: readonly T[] = normalizeItems<T>(
    typeof props.each === "function" ? props.each() : props.each,
  );
  const backend = getServerBackend();
  if (backend?.createRaw !== undefined) {
    if (items.length === 0) {
      const out = hasFallback
        ? serializeServerValue(serverListItem(resolve(fallback()))) + LIST_END_MARKER
        : LIST_END_MARKER;
      return backend.createRaw(out) as Node;
    }
    let out = "";
    let currentIndex = 0;
    const indexOf = (): number => currentIndex;
    for (let position = 0; position < items.length; position += 1) {
      currentIndex = position;
      out += ITEM_MARKER;
      out += serializeServerValue(
        serverListItem(props.children(items[position] as T, indexOf)),
      );
    }
    out += LIST_END_MARKER;
    return backend.createRaw(out) as Node;
  }
  if (backend?.createFragment !== undefined) {
    const total = items.length;
    const values: unknown[] = new Array(total);
    let currentIndex = 0;
    const indexOf = (): number => currentIndex;
    for (let position = 0; position < total; position += 1) {
      currentIndex = position;
      values[position] = serverListItem(props.children(items[position] as T, indexOf));
    }
    let parts: string[];
    if (total === 0) {
      if (hasFallback) {
        values.push(serverListItem(resolve(fallback())));
        parts = ["", LIST_END_MARKER];
      } else {
        parts = [LIST_END_MARKER];
      }
    } else {
      parts = new Array<string>(total + 1);
      parts[0] = ITEM_MARKER;
      if (total > 1) {
        parts.fill(ITEM_MARKER, 1, total);
      }
      parts[total] = LIST_END_MARKER;
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
    const item = items[position] as T;
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
    const nodes = extractMetadata(collectNodes(resolve(fallback()) as Children));
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
  const hydrating = HYDRATE && isHydrating();
  const hydration = hydrating ? getListHydration() : null;
  const target = props.parent ?? null;
  let outer = hydrating ? currentWindow() : null;
  if (hydrating && target !== null && props.marker !== undefined && props.marker !== null) {
    try {
      outer = findInsertWindow(props.marker, target);
    } catch {
      // fall back to the enclosing template window
    }
  }
  let container: Node | null = null;
  const parentOwner = getOwner();
  const hasFallback = "fallback" in props;
  const fallback = (): unknown => props.fallback;
  const keyOf = props.keyOf;
  const usesIndex = props.index !== false;
  const staticRows = props.staticRows === true;
  const keyAt = (item: T, index: number): unknown => {
    if (keyOf === undefined) {
      return item;
    }
    const key = untrack(() => keyOf(item, index));
    return key === undefined || key === null ? item : key;
  };
  let states: ItemState<T>[] = [];
  let spare: ItemState<T>[] = [];
  const createdBuffer: ItemState<T>[] = [];
  let updating = false;
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
    let cursor: Node | null = state.anchor === null ? null : state.anchor.nextSibling;
    while (cursor !== null && cursor !== state.nodesEnd) {
      collected.push(cursor);
      cursor = cursor.nextSibling;
    }
    state.nodes = collected;
    return collected;
  };

  const materializeBoundary = (
    kept: readonly ItemState<T>[],
    removed: readonly ItemState<T>[],
  ): void => {
    const anchors = new Set<Node>();
    for (const state of removed) {
      if (state.anchor !== null) {
        anchors.add(state.anchor);
      }
    }
    for (const state of kept) {
      if (
        state.nodes === NO_NODES &&
        state.nodesEnd !== null &&
        (state.nodesEnd === endAnchor || anchors.has(state.nodesEnd))
      ) {
        materializeNodes(state);
      }
    }
  };

  const renderItem = (
    state: ItemState<T>,
    value: unknown,
    mountParent: Node | null = null,
    mountTail: Node | null = null,
  ): void => {
    const nodes = materializeNodes(state);
    let tail: Node | null = mountTail;
    let parent: Node | null = mountParent;
    if (nodes.length > 0) {
      tail = nodes[nodes.length - 1]!.nextSibling;
      parent ??= nodes[0]!.parentNode;
      clearItemDisposer(nodes[0]!);
      for (let index = 0; index < nodes.length; index += 1) {
        const node = nodes[index]!;
        disposeNode(node);
        detachNode(node);
      }
    } else if (state.anchor !== null) {
      tail = state.anchor.nextSibling;
      parent ??= state.anchor.parentNode;
    }
    state.nodes = [];
    state.nodesEnd = null;
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
    if (placed.length === 0) {
      if (state.anchor === null) {
        const anchor = document.createComment(ITEM);
        if (tail === null) {
          parent.appendChild(anchor);
        } else {
          parent.insertBefore(anchor, tail);
        }
        state.anchor = anchor;
        attachItemState(anchor, state);
      }
      return;
    }
    for (let index = 0; index < placed.length; index += 1) {
      parent.insertBefore(placed[index]!, tail);
    }
    state.nodes = placed;
    attachItemState(placed[0]!, state);
  };

  const unlinkState = (state: ItemState<T>): void => {
    const position = states.indexOf(state);
    if (position < 0) {
      return;
    }
    states.splice(position, 1);
    for (let index = position; index < states.length; index += 1) {
      states[index]!.setIndex(index);
    }
  };

  const rerenderItem = (state: ItemState<T>, item: T): void => {
    const pendingRerender = state.disposeRerender;
    runWithOwner(parentOwner, () => {
      state.disposeRerender = createRoot((dispose) => {
        renderItem(state, untrack(() => props.children)(item, state.index));
        return dispose;
      });
    });
    if (pendingRerender !== null) {
      pendingRerender();
    }
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
    if (state.anchor !== null) {
      detachNode(state.anchor);
    }
    state.cleanup();
    const pendingRerender = state.disposeRerender;
    if (pendingRerender !== null) {
      state.disposeRerender = null;
      pendingRerender();
    }
    if (!updating) {
      unlinkState(state);
    }
  };

  const removeAll = (): void => {
    const snapshot = states;
    states = [];
    spare = [];
    createdBuffer.length = 0;
    stopFallbackEffect();
    const errors: unknown[] = [];
    for (const state of snapshot) {
      try {
        removeState(state);
      } catch (error) {
        errors.push(error);
      }
    }
    try {
      fallbackMount.clear();
    } catch (error) {
      errors.push(error);
    }
    if (errors.length === 1) {
      throw errors[0];
    }
    if (errors.length > 1) {
      throw new AggregateError(errors, "Ошибки при удалении элементов For");
    }
  };

  const ensureAnchors = (list: readonly ItemState<T>[]): void => {
    for (const state of list) {
      if (state.anchor !== null) {
        continue;
      }
      const first = state.nodes[0];
      if (first === undefined) {
        continue;
      }
      const parent = first.parentNode;
      if (parent === null) {
        continue;
      }
      const anchor = document.createComment(ITEM);
      parent.insertBefore(anchor, first);
      state.anchor = anchor;
      attachItemState(anchor, state);
    }
  };

  let runWindow: MutableWindow | null = null;

  const makeState = (
    item: T,
    anchor: Comment | null,
    itemEnd: Node | null,
    position: number,
    mountParent: Node | null = null,
    tail: Node | null = null,
    providedChildren: ForProps<T>["children"] | undefined = undefined,
  ): ItemState<T> => {
    const children = providedChildren ?? untrack(() => props.children);
    const state = new KeyedState<T>(
      item,
      keyAt(item, position),
      anchor,
      itemEnd,
      position,
      usesIndex,
      removeState,
    );
    let initialMount: Node | null = mountParent;
    let seeded = itemEnd !== null;
    let mountTail: Node | null = tail;
    const run = (): void => {
      if (seeded && hydration !== null) {
        seeded = false;
        runWindow = hydration.seedItem(
          runWindow,
          anchor as Comment,
          itemEnd as Node,
          children,
          item,
          state.index,
        );
        return;
      }
      renderItem(state, children(state.item, state.index), initialMount, mountTail);
      initialMount = null;
      mountTail = null;
      const pendingRerender = state.disposeRerender;
      if (pendingRerender !== null) {
        state.disposeRerender = null;
        pendingRerender();
      }
    };
    if (hydration !== null) {
      state.cleanup = hydration.effect(run, staticRows, anchor, itemEnd, item);
    } else {
      state.cleanup = createEffectUnlessStatic(run) ?? noopCleanup;
    }

    if (anchor !== null) {
      attachItemState(anchor, state);
    }
    if (itemEnd !== null) {
      const first = state.nodes[0] ?? anchor?.nextSibling ?? null;
      if (first !== null && first !== itemEnd) {
        attachItemState(first, state);
      }
    }
    return state;
  };

  const updateStateItem = (state: ItemState<T>, item: T): void => {
    if (state.disposed || state.item === item) {
      return;
    }
    const previous = state.item;
    state.item = item;
    if (keyOf === undefined) {
      return;
    }
    if (untrack(() => sameItem(previous, item))) {
      return;
    }
    rerenderItem(state, item);
  };

  const createState = (
    item: T,
    position: number,
    sink: Node,
    tail: Node | null = null,
    children: ForProps<T>["children"] | undefined = undefined,
  ): ItemState<T> => makeState(item, null, null, position, sink, tail, children);

  let fallbackMount: MountPoint;
  let fallbackShown = false;
  let fallbackEffectDispose: (() => void) | null = null;
  let skipFirst = hydrating;

  if (hydration !== null) {
    const seeded = hydration.preseed(
      props,
      fallback,
      hasFallback,
      outer,
      parentOwner,
      (item, anchor, itemEnd, position, children) =>
        makeState(item, anchor, itemEnd, position, null, null, children),
    );
    states = seeded.states;
    endAnchor = seeded.endAnchor;
    fallbackMount = createMountPoint(
      seeded.fallbackParent,
      endAnchor,
      seeded.fallbackSeed,
    );
    fallbackShown = seeded.fallbackSeed.length > 0;
  } else {
    endAnchor = document.createComment(LIST_END);
    if (target !== null) {
      const marker = props.marker ?? null;
      if (marker !== null) {
        target.insertBefore(endAnchor, marker);
      } else {
        target.appendChild(endAnchor);
      }
      container = target;
    } else {
      const sink = container ?? (container = document.createDocumentFragment());
      sink.appendChild(endAnchor);
    }
    fallbackMount = createMountPoint(
      target ?? (container ??= document.createDocumentFragment()),
      endAnchor,
    );
  }

  const startFallbackEffect = (): void => {
    if (fallbackEffectDispose !== null) {
      return;
    }
    runWithOwner(parentOwner, () => {
      const root = createRoot((dispose) => {
        fallbackEffectDispose = dispose;
        createRenderEffect(() => fallbackMount.render(resolve(fallback())));
        return null;
      });
      void root;
    });
  };

  const stopFallbackEffect = (): void => {
    const disposeEffect = fallbackEffectDispose;
    fallbackEffectDispose = null;
    disposeEffect?.();
  };

  const syncFallback = (empty: boolean): void => {
    const shouldShow = empty && hasFallback;
    if (shouldShow === fallbackShown) {
      return;
    }
    fallbackShown = shouldShow;
    if (shouldShow) {
      startFallbackEffect();
      return;
    }
    stopFallbackEffect();
    fallbackMount.render(null);
  };


  const renderList = (): void => {
    const parent = endAnchor.parentNode;
    if (parent === null) {
      removeAll();
      return;
    }

    const each = props.each;
    const items: readonly T[] = normalizeItems<T>(typeof each === "function" ? each() : each);
    if (skipFirst) {
      skipFirst = false;
      return;
    }

    const previous = states;
    const previousLength = previous.length;
    const nextLength = items.length;
    const desired = keyOf === undefined ? null : new Array<unknown>(nextLength);
    if (desired !== null) {
      for (let position = 0; position < nextLength; position += 1) {
        desired[position] = keyAt(items[position] as T, position);
      }
    }
    const desiredKey = (position: number): unknown =>
      desired === null ? items[position] : desired[position];
    const shared = previousLength < nextLength ? previousLength : nextLength;
    let prefix = 0;
    while (prefix < shared && previous[prefix]!.key === desiredKey(prefix)) {
      prefix += 1;
    }

    if (prefix === shared) {
      for (let position = 0; position < shared; position += 1) {
        updateStateItem(previous[position]!, items[position] as T);
      }
      if (nextLength >= previousLength) {
        if (nextLength > previousLength) {
          const children = untrack(() => props.children);
          if (previousLength === 0 && target !== null) {
            runWithOwner(parentOwner, () => {
              for (let position = 0; position < nextLength; position += 1) {
                previous.push(createState(items[position] as T, position, target, endAnchor, children));
              }
            });
          } else {
            const batch = document.createDocumentFragment();
            materializeBoundary(previous, []);
            runWithOwner(parentOwner, () => {
              for (let position = previousLength; position < nextLength; position += 1) {
                previous.push(createState(items[position] as T, position, batch, null, children));
              }
            });
            parent.insertBefore(batch, endAnchor);
          }
        }
        syncFallback(nextLength === 0);
        return;
      }
      const removedTrailing = previous.slice(nextLength, previousLength);
      materializeBoundary(previous.slice(0, nextLength), removedTrailing);
      for (const state of removedTrailing) {
        removeState(state);
      }
      previous.length = nextLength;
      syncFallback(nextLength === 0);
      return;
    }

    generation += 1;
    const currentGeneration = generation;
    const pool = new Map<unknown, ItemState<T> | ItemState<T>[]>();
    for (let index = 0; index < previousLength; index += 1) {
      const state = previous[index]!;
      state.previousIndex = index;
      const existing = pool.get(state.key);
      if (existing === undefined) {
        pool.set(state.key, state);
      } else if (Array.isArray(existing)) {
        existing.push(state);
      } else {
        pool.set(state.key, [existing, state]);
      }
    }

    const next = spare;
    next.length = 0;
    const created = createdBuffer;
    created.length = 0;
    let batch: DocumentFragment | null = null;

    const children = untrack(() => props.children);
    runWithOwner(parentOwner, () => {
      for (let position = 0; position < nextLength; position += 1) {
        const item = items[position] as T;
        const key = desiredKey(position);
        const entry = pool.get(key);
        let state: ItemState<T> | undefined;
        if (entry === undefined) {
          state = undefined;
        } else if (Array.isArray(entry)) {
          state = entry.length === 0 ? undefined : entry.shift();
          if (entry.length === 0) {
            pool.delete(key);
          }
        } else {
          state = entry;
          pool.delete(key);
        }
        if (state === undefined) {
          if (batch === null) {
            batch = document.createDocumentFragment();
          }
          const fresh = createState(item, position, batch, null, children);
          created.push(fresh);
          next.push(fresh);
          continue;
        }
        updateStateItem(state, item);
        state.generation = currentGeneration;
        next.push(state);
      }
    });

    for (const state of next) {
      if (state.nodes === NO_NODES && state.nodesEnd !== null) {
        materializeNodes(state);
      }
    }
    const removedStates: ItemState<T>[] = [];
    for (let index = 0; index < previousLength; index += 1) {
      const state = previous[index]!;
      if (state.generation !== currentGeneration) {
        removedStates.push(state);
      }
    }
    materializeBoundary(next, removedStates);
    for (const state of removedStates) {
      removeState(state);
    }

    if (batch !== null) {
      materializeBoundary(next, []);
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
      ensureAnchors(next);
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
        const anchor = state.anchor;
        if (anchor === null) {
          continue;
        }
        const holder = reference.parentNode;
        if (
          holder !== null &&
          orderStable[position] === 0 &&
          !precedesBlock(materializeNodes(state), anchor, reference)
        ) {
          holder.insertBefore(anchor, reference);
          const nodes = materializeNodes(state);
          for (let index = 0; index < nodes.length; index += 1) {
            holder.insertBefore(nodes[index]!, reference);
          }
        }
        reference = anchor;
      }
    }

    states = next;
    spare = previous;
    previous.length = 0;
    created.length = 0;

    syncFallback(nextLength === 0);
  };

  createRenderEffect(() => {
    updating = true;
    try {
      renderList();
    } finally {
      updating = false;
    }
  });

  onCleanup(removeAll);

  return target !== null || hydrating
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
  if (HYDRATE && isHydrating()) {
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
    const [active, setActive] = createSignal(false);
    createRenderEffect(() => {
      setActive(truthy(resolve(props.when)));
    });
    let initialized = false;
    createRenderEffect(() => {
      const current = active();
      if (!initialized) {
        initialized = true;
        const window = beginRegion(outer, anchor);
        const value = withWindow(
          window,
          () => resolve(current ? props.children : props.fallback),
        );
        settleNodes(anchor, value);
        if (!regionMatches(window, anchor, value)) {
          mismatch("содержимое Show не совпало");
        }
        settleWindow(outer, anchor);
        return;
      }
      mount.render(resolve(current ? props.children : props.fallback));
    });
    onCleanup(mount.clear);
    return document.createDocumentFragment();
  }

  const container = document.createDocumentFragment();
  const anchor = document.createComment(SHOW);
  container.appendChild(anchor);
  const mount = createMountPoint(container, anchor);
  const [active, setActive] = createSignal(false);
  createRenderEffect(() => {
    setActive(truthy(resolve(props.when)));
  });
  createRenderEffect(() => {
    mount.render(resolve(active() ? props.children : props.fallback));
  });
  onCleanup(mount.clear);
  return container;
}

markDirectComponent(For);
