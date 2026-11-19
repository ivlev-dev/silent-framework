import { runWithOwner, untrack } from "@ivlev-dev/silent-reactivity";
import type { Accessor, Owner } from "@ivlev-dev/silent-reactivity";
import {
  hydratedEffect,
  isStaticHydration,
  settleNodes,
  staticRowAllowed,
  withStaticHydration,
} from "./dom-hydration-state.js";
import { beginRegion, regionMatches, settleWindow } from "./hydration-cursor.js";
import { ITEM, LIST_END, mismatch, withWindow } from "./hydration-state.js";
import { collectBetween, isMarker } from "./hydration.js";
import { normalizeItems } from "./list-items.js";
import type {
  ListHydrationRuntime,
  ListItemHandle,
  ListPreseed,
  ListWindow,
} from "./list-hydration-state.js";
import type { ForProps } from "./control-flow.js";

const noopCleanup = (): void => {};

function resolveFallback(value: unknown): unknown {
  let current = value;
  while (typeof current === "function") {
    current = (current as () => unknown)();
  }
  return current;
}

function preseed<T, S extends ListItemHandle>(
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
): ListPreseed<S> {
  if (outer === null) {
    return mismatch("For вне окна гидрации");
  }
  const candidate = outer.end.previousSibling;
  if (!isMarker(candidate, LIST_END)) {
    return mismatch("не найден конец списка");
  }
  const endAnchor = candidate;
  const items: readonly T[] = untrack(() =>
    normalizeItems<T>(typeof props.each === "function" ? props.each() : props.each),
  );
  let fallbackSeed: Node[] = [];
  if (items.length === 0 && hasFallback) {
    const window = beginRegion(outer, endAnchor);
    const value = withWindow(window, () => untrack(() => resolveFallback(fallback())));
    if (!regionMatches(window, endAnchor, value)) {
      return mismatch("содержимое fallback списка не совпало");
    }
    fallbackSeed = collectBetween(outer.start, endAnchor);
  }
  let cursor: Node | null = items.length === 0 ? endAnchor : outer.start.nextSibling;
  let position = 0;
  const children = untrack(() => props.children);
  const states: S[] = [];
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
      states.push(makeState(item, anchor, node ?? endAnchor, position, children));
      position += 1;
      cursor = node;
    }
  });
  if (position !== items.length) {
    return mismatch("число элементов списка не совпало");
  }
  settleWindow(outer, endAnchor);
  const fallbackParent = endAnchor.parentNode;
  if (fallbackParent === null) {
    return mismatch("список отсоединён от документа");
  }
  return { states, endAnchor, fallbackParent, fallbackSeed };
}

function seedItem<T>(
  window: ListWindow | null,
  anchor: Comment,
  end: Node,
  children: ForProps<T>["children"],
  item: T,
  index: Accessor<number>,
): ListWindow {
  const target = window ?? { start: anchor, end, cursor: anchor.nextSibling };
  target.start = anchor;
  target.end = end;
  target.cursor = anchor.nextSibling;
  const value = withWindow(target, children, item, index);
  if (!isStaticHydration() || value instanceof DocumentFragment) {
    settleNodes(end, value);
  }
  if (!regionMatches(target, end, value)) {
    return mismatch("содержимое элемента списка не совпало");
  }
  return target;
}

function effect<T>(
  run: () => void,
  staticRows: boolean,
  anchor: Comment | null,
  itemEnd: Node | null,
  item: T,
): () => void {
  if (staticRows && anchor !== null && itemEnd !== null && staticRowAllowed(item)) {
    untrack(() => withStaticHydration(run));
    return noopCleanup;
  }
  return hydratedEffect(run) ?? noopCleanup;
}

export const listHydration: ListHydrationRuntime = { preseed, seedItem, effect };
