import { isMetadataElement } from "./metadata.js";

export class HydrationMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HydrationMismatchError";
  }
}

export interface HydrationWindow {
  readonly start: Node;
  readonly end: Node;
  cursor: Node | null;
}

export const INSERT_START = "silent-insert";
export const INSERT_END = "silent-insert-end";
export const VIEW_START = "silent-view";
export const VIEW_END = "silent-view-end";
export const ITEM = "silent-item";
export const LIST_END = "silent-end";
export const SHOW = "silent-show";
export const SWITCH = "silent-switch";
export const ERROR_BOUNDARY = "silent-error";
export const MATCH = "silent-match";
export const FRAGMENT = "silent-fragment";
export const SUSPENSE = "silent-suspense";
export const HYDRATE_START = "silent-hydrate";
export const HYDRATE_END = "silent-hydrate-end";

let active = false;
let windows: HydrationWindow[] = [];
let mismatchListener: ((error: HydrationMismatchError) => void) | null = null;

export function isHydrating(): boolean {
  return active;
}

export function beginHydration(
  listener?: (error: HydrationMismatchError) => void,
): void {
  active = true;
  windows = [];
  mismatchListener = listener ?? null;
}

export function endHydration(): void {
  active = false;
  windows = [];
  mismatchListener = null;
}

export function currentWindow(): HydrationWindow | null {
  return windows.length === 0 ? null : windows[windows.length - 1] ?? null;
}

export function withWindow<T>(window: HydrationWindow, fn: () => T): T {
  windows.push(window);
  try {
    return fn();
  } finally {
    windows.pop();
  }
}

export function withoutHydration<T>(fn: () => T): T {
  const previousActive = active;
  const previousWindows = windows;
  active = false;
  windows = [];
  try {
    return fn();
  } finally {
    active = previousActive;
    windows = previousWindows;
  }
}

export function claimNext(): Node | null {
  const window = currentWindow();
  if (window === null) {
    return null;
  }
  const node = window.cursor;
  if (node === null || node === window.end) {
    return null;
  }
  window.cursor = node.nextSibling;
  return node;
}

export function mismatch(message: string): never {
  throw new HydrationMismatchError(message);
}

export function reportMismatch(error: HydrationMismatchError): void {
  if (mismatchListener !== null) {
    mismatchListener(error);
  }
}

export function isMarker(node: Node | null | undefined, data: string): node is Comment {
  return node instanceof Comment && node.data === data;
}

export function isItemMarker(node: Node | null | undefined): node is Comment {
  return node instanceof Comment && node.data === ITEM;
}

export function findViewEnd(start: Node, limit?: Node | null): Node {
  let depth = 0;
  let cursor: Node | null = start;
  while (cursor !== null && cursor !== (limit ?? null)) {
    if (cursor instanceof Comment) {
      if (cursor.data === VIEW_START) {
        depth += 1;
      } else if (cursor.data === VIEW_END) {
        depth -= 1;
        if (depth === 0) {
          return cursor;
        }
      }
    }
    cursor = cursor.nextSibling;
  }
  return mismatch("не найден закрывающий маркер view");
}

export function findInsertWindow(marker: Node | null, parent: Node): HydrationWindow {
  const end = marker === null ? parent.lastChild : marker.previousSibling;
  if (!isMarker(end, INSERT_END)) {
    return mismatch("не найден конец региона вставки");
  }
  let depth = 0;
  let cursor: Node | null = end;
  while (cursor !== null) {
    if (cursor instanceof Comment) {
      if (cursor.data === INSERT_END) {
        depth += 1;
      } else if (cursor.data === INSERT_START) {
        depth -= 1;
        if (depth === 0) {
          return { start: cursor, end, cursor: cursor.nextSibling };
        }
      }
    }
    cursor = cursor.previousSibling;
  }
  return mismatch("не найдено начало региона вставки");
}

export function collectBetween(start: Node, end: Node): Node[] {
  const nodes: Node[] = [];
  let cursor = start.nextSibling;
  while (cursor !== null && cursor !== end) {
    nodes.push(cursor);
    cursor = cursor.nextSibling;
  }
  return nodes;
}

export function detachNode(node: Node): void {
  node.parentNode?.removeChild(node);
}

function shapeChildren(node: Node, ignoreTopMetadata: boolean): Node[] {
  const result: Node[] = [];
  let depth = 0;
  for (const child of node.childNodes) {
    if (child instanceof Comment) {
      if (child.data === INSERT_START) {
        depth += 1;
        continue;
      }
      if (child.data === INSERT_END) {
        depth = Math.max(0, depth - 1);
        continue;
      }
    }
    if (depth > 0) {
      continue;
    }
    if (ignoreTopMetadata && isMetadataElement(child)) {
      continue;
    }
    result.push(child);
  }
  return result;
}

export function mergeTopLevelMetadata(fresh: Node, claimed: Node): void {
  let claimedChild = claimed.firstChild;
  for (const freshChild of Array.from(fresh.childNodes)) {
    if (isMetadataElement(freshChild)) {
      freshChild.parentNode?.removeChild(freshChild);
      claimed.insertBefore(freshChild, claimedChild);
      continue;
    }
    if (claimedChild !== null) {
      claimedChild = claimedChild.nextSibling;
    }
  }
}

export function shapeMatches(
  fresh: Node,
  claimed: Node,
  ignoreTopMetadata = false,
): boolean {
  if (fresh.nodeType !== claimed.nodeType) {
    return false;
  }
  if (fresh.nodeType === Node.ELEMENT_NODE) {
    const left = fresh as Element;
    const right = claimed as Element;
    if (left.tagName !== right.tagName || left.namespaceURI !== right.namespaceURI) {
      return false;
    }
    for (let index = 0; index < left.attributes.length; index += 1) {
      const attribute = left.attributes[index];
      if (attribute === undefined) {
        return false;
      }
      if (attribute.name.startsWith("data-silent-a-")) {
        if (!right.hasAttribute(attribute.name)) {
          return false;
        }
        continue;
      }
      if (right.getAttribute(attribute.name) !== attribute.value) {
        return false;
      }
    }
    const freshChildren = shapeChildren(left, ignoreTopMetadata);
    const claimedChildren = shapeChildren(right, false);
    if (freshChildren.length !== claimedChildren.length) {
      return false;
    }
    for (let index = 0; index < freshChildren.length; index += 1) {
      const x = freshChildren[index];
      const y = claimedChildren[index];
      if (x === undefined || y === undefined || !shapeMatches(x, y)) {
        return false;
      }
    }
    return true;
  }
  if (fresh.nodeType === Node.TEXT_NODE) {
    return (fresh as Text).data === (claimed as Text).data;
  }
  if (fresh.nodeType === Node.COMMENT_NODE) {
    return (fresh as Comment).data === (claimed as Comment).data;
  }
  return true;
}
