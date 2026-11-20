import { isMetadataElement } from "./metadata.js";
import {
  HydrationMismatchError,
  INSERT_END,
  INSERT_START,
  ITEM,
  VIEW_END,
  VIEW_START,
  currentWindow,
  mismatch,
  registerHydrationRuntime,
  type HydrationWindow,
} from "./hydration-state.js";

export * from "./hydration-state.js";
export { significantChildren, significantChildrenFromEnd } from "./significant.js";
import { significantChildren, significantChildrenFromEnd } from "./significant.js";

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

export function isMarker(node: Node | null | undefined, data: string): node is Comment {
  return (
    node !== null &&
    node !== undefined &&
    node.nodeType === Node.COMMENT_NODE &&
    (node as Comment).data === data
  );
}

export function isItemMarker(node: Node | null | undefined): node is Comment {
  return (
    node !== null &&
    node !== undefined &&
    node.nodeType === Node.COMMENT_NODE &&
    (node as Comment).data === ITEM
  );
}

const insertStarts = new WeakMap<Comment, Comment>();

export function registerInsertStart(end: Comment, start: Comment): void {
  insertStarts.set(end, start);
}

export function findViewEnd(start: Node, limit?: Node | null): Node {
  let depth = 0;
  let cursor: Node | null = start;
  while (cursor !== null && cursor !== (limit ?? null)) {
    if (cursor.nodeType === Node.COMMENT_NODE) {
      const data = (cursor as Comment).data;
      if (data === VIEW_START) {
        depth += 1;
      } else if (data === VIEW_END) {
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
  const knownStart = insertStarts.get(end);
  if (knownStart !== undefined && knownStart.parentNode === parent) {
    return { start: knownStart, end, cursor: knownStart.nextSibling };
  }
  const first = parent.firstChild;
  if (isMarker(first, INSERT_START) && first.nextSibling === end) {
    return { start: first, end, cursor: first.nextSibling };
  }
  const adjacent = end.previousSibling;
  if (isMarker(adjacent, INSERT_START)) {
    return { start: adjacent, end, cursor: end };
  }
  const stack: Comment[] = [];
  let cursor: Node | null = parent.firstChild;
  while (cursor !== null) {
    if (cursor === end) {
      const start = stack[stack.length - 1];
      if (start !== undefined) {
        return { start, end, cursor: start.nextSibling };
      }
      break;
    }
    if (cursor.nodeType === Node.COMMENT_NODE) {
      const data = (cursor as Comment).data;
      if (data === INSERT_START) {
        stack.push(cursor as Comment);
      } else if (data === INSERT_END && stack.length > 0) {
        stack.pop();
      }
    }
    cursor = cursor.nextSibling;
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

interface ShapeCursor {
  node: Node | null;
  depth: number;
  ignoreTopMetadata: boolean;
  resume: (Node | null)[] | null;
}

const HOLE_PREFIX = "silent-hole-";
const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

function isHoleText(node: Node, next: Node | null): boolean {
  return (
    node.nodeType === Node.TEXT_NODE &&
    next instanceof Comment &&
    next.data.startsWith(HOLE_PREFIX)
  );
}

function isTableBody(node: Node): boolean {
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return false;
  }
  const element = node as Element;
  return (
    element.tagName === "TBODY" &&
    (element.namespaceURI === HTML_NAMESPACE || element.namespaceURI === null)
  );
}

function nextShapeChild(cursor: ShapeCursor): Node | null {
  for (;;) {
    let child = cursor.node;
    let descended = false;
    while (child !== null) {
      const next = child.nextSibling;
      let skip = cursor.depth > 0;
      if (child.nodeType === Node.COMMENT_NODE) {
        const data = (child as Comment).data;
        if (data === INSERT_START) {
          cursor.depth += 1;
          skip = true;
        } else if (data === INSERT_END) {
          if (cursor.depth > 0) {
            cursor.depth -= 1;
          }
          skip = true;
        }
      } else if (skip && isTableBody(child)) {
        (cursor.resume ??= []).push(next);
        cursor.node = child.firstChild;
        descended = true;
        break;
      }
      cursor.node = next;
      if (!skip && !(cursor.ignoreTopMetadata && isMetadataElement(child))) {
        return child;
      }
      child = next;
    }
    if (descended) {
      continue;
    }
    const resume = cursor.resume;
    if (resume === null || resume.length === 0) {
      return null;
    }
    cursor.node = resume.pop() ?? null;
  }
}

function enterShapeChild(cursor: ShapeCursor, section: Node): Node | null {
  (cursor.resume ??= []).push(section.nextSibling);
  cursor.node = section.firstChild;
  return nextShapeChild(cursor);
}

function isHoleMarker(node: Node): boolean {
  return (
    node.nodeType === Node.COMMENT_NODE &&
    (node as Comment).data.startsWith(HOLE_PREFIX)
  );
}

function holeTextMatches(fresh: string, claimed: string): boolean {
  if (fresh === claimed || fresh.length === 0 || claimed.length === 0) {
    return true;
  }
  return fresh.startsWith(claimed) || claimed.startsWith(fresh);
}

function splitHoleText(node: Text, prefix: string): void {
  if (prefix.length === 0) {
    return;
  }
  const parent = node.parentNode;
  if (parent === null) {
    return;
  }
  const remainder = node.data.slice(prefix.length);
  const staticNode = document.createTextNode(prefix);
  parent.insertBefore(staticNode, node);
  node.data = remainder;
}

function attributesMatch(left: Element, right: Element, strict = false): boolean {
  const attributes = left.attributes;
  const length = attributes.length;
  for (let index = 0; index < length; index += 1) {
    const attribute = attributes.item(index);
    if (attribute === null) {
      return false;
    }
    const name = attribute.name;
    if (name.startsWith("data-silent-a-")) {
      if (!right.hasAttribute(name)) {
        return false;
      }
      continue;
    }
    if (attribute.value !== right.getAttribute(name)) {
      return false;
    }
  }
  if (!strict) {
    return true;
  }
  const claimedAttributes = right.attributes;
  const claimedLength = claimedAttributes.length;
  for (let index = 0; index < claimedLength; index += 1) {
    const attribute = claimedAttributes.item(index);
    if (attribute === null) {
      return false;
    }
    const name = attribute.name;
    if (name.startsWith("data-silent-a-")) {
      continue;
    }
    if (attribute.value !== left.getAttribute(name)) {
      return false;
    }
  }
  return true;
}

const ATTR_MARKER_PREFIX = "data-silent-a-";
const TEXT_MARKER_NAME = "data-silent-text";

function stripElementMarkers(element: Element): void {
  const attributes = element.attributes;
  for (let index = attributes.length - 1; index >= 0; index -= 1) {
    const attribute = attributes.item(index);
    if (attribute === null) {
      continue;
    }
    const name = attribute.name;
    if (name === TEXT_MARKER_NAME || name.startsWith(ATTR_MARKER_PREFIX)) {
      element.removeAttribute(name);
    }
  }
}

/**
 * Снимает оставшиеся серверные маркеры (`data-silent-a-*`, `data-silent-text`)
 * с адоптированного поддерева. Серверная разметка от старого деплоя может
 * содержать больше маркеров, чем клиентский план; если их не снять, они
 * навсегда утекут в outerHTML и CSS-селекторы.
 */
export function stripHydrationMarkers(root: Node): void {
  const stack: Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.nodeType === Node.ELEMENT_NODE) {
      stripElementMarkers(node as Element);
    }
    let child = node.firstChild;
    while (child !== null) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        stack.push(child);
      }
      child = child.nextSibling;
    }
  }
}

export function staleAttributes(fresh: Element, claimed: Element): string[] {
  const stale: string[] = [];
  const attributes = claimed.attributes;
  const length = attributes.length;
  for (let index = 0; index < length; index += 1) {
    const attribute = attributes.item(index);
    if (attribute === null) {
      continue;
    }
    const name = attribute.name;
    if (name.startsWith("data-silent-a-")) {
      continue;
    }
    if (attribute.value !== fresh.getAttribute(name)) {
      stale.push(name);
    }
  }
  return stale;
}

function childrenMatch(
  left: Element,
  right: Element,
  ignoreTopMetadata: boolean,
  simpleFresh: boolean,
  strict: boolean,
): boolean {
  const leftCursor: ShapeCursor = {
    node: left.firstChild,
    depth: 0,
    ignoreTopMetadata,
    resume: null,
  };
  const rightCursor: ShapeCursor = {
    node: right.firstChild,
    depth: 0,
    ignoreTopMetadata: false,
    resume: null,
  };
  let x = nextShapeChild(leftCursor);
  let y = nextShapeChild(rightCursor);
  while (x !== null && y !== null) {
    if (isTableBody(y) && !isTableBody(x)) {
      if (isHoleMarker(x)) {
        y = nextShapeChild(rightCursor);
        continue;
      }
      y = enterShapeChild(rightCursor, y);
      continue;
    }
    if (isTableBody(x) && !isTableBody(y)) {
      if (isHoleMarker(y)) {
        x = nextShapeChild(leftCursor);
        continue;
      }
      x = enterShapeChild(leftCursor, x);
      continue;
    }
    if (isHoleText(y, y.nextSibling)) {
      if (x.nodeType !== Node.TEXT_NODE) {
        y = nextShapeChild(rightCursor);
        continue;
      }
      const staticText = (x as Text).data;
      const claimedText = y as Text;
      if (x !== y && claimedText.data.startsWith(staticText)) {
        splitHoleText(claimedText, staticText);
      } else if (!holeTextMatches(staticText, claimedText.data)) {
        return false;
      }
      x = nextShapeChild(leftCursor);
      y = nextShapeChild(rightCursor);
      continue;
    }
    if (!shapeMatches(x, y, false, simpleFresh, strict)) {
      return false;
    }
    x = nextShapeChild(leftCursor);
    y = nextShapeChild(rightCursor);
  }
  while (y !== null) {
    if (isTableBody(y) && x === null) {
      y = enterShapeChild(rightCursor, y);
      continue;
    }
    if (!isHoleText(y, y.nextSibling)) {
      return false;
    }
    y = nextShapeChild(rightCursor);
  }
  return x === null;
}

export function mergeTopLevelMetadata(fresh: Node, claimed: Node): void {
  let freshChild: Node | null = fresh.firstChild;
  if (freshChild === null) {
    return;
  }
  let hasMetadata = false;
  for (let probe: Node | null = freshChild; probe !== null; probe = probe.nextSibling) {
    if (isMetadataElement(probe)) {
      hasMetadata = true;
      break;
    }
  }
  if (!hasMetadata) {
    return;
  }
  let claimedChild: Node | null = claimed.firstChild;
  while (freshChild !== null) {
    const next: Node | null = freshChild.nextSibling;
    if (isMetadataElement(freshChild)) {
      freshChild.parentNode?.removeChild(freshChild);
      claimed.insertBefore(freshChild, claimedChild);
    } else if (claimedChild !== null) {
      claimedChild = claimedChild.nextSibling;
    }
    freshChild = next;
  }
}

export function shapeMatches(
  fresh: Node,
  claimed: Node,
  ignoreTopMetadata = false,
  simpleFresh = false,
  strict = false,
): boolean {
  const nodeType = fresh.nodeType;
  if (nodeType !== claimed.nodeType) {
    return false;
  }
  if (nodeType === Node.ELEMENT_NODE) {
    const left = fresh as Element;
    const right = claimed as Element;
    if (left.tagName !== right.tagName || left.namespaceURI !== right.namespaceURI) {
      return false;
    }
    if (!attributesMatch(left, right, strict)) {
      return false;
    }
    return childrenMatch(left, right, ignoreTopMetadata, simpleFresh, strict);
  }
  if (nodeType === Node.TEXT_NODE) {
    return (fresh as Text).data === (claimed as Text).data;
  }
  if (nodeType === Node.COMMENT_NODE) {
    return (fresh as Comment).data === (claimed as Comment).data;
  }
  return true;
}

export function countSignificantChildren(node: Node): number {
  let depth = 0;
  let child = node.firstChild;
  let count = 0;
  while (child !== null) {
    const next = child.nextSibling;
    let skip = depth > 0;
    if (child.nodeType === Node.COMMENT_NODE) {
      const data = (child as Comment).data;
      if (data === INSERT_START) {
        depth += 1;
        skip = true;
      } else if (data === INSERT_END) {
        if (depth > 0) {
          depth -= 1;
        }
        skip = true;
      }
    }
    if (!skip) {
      count += 1;
    }
    child = next;
  }
  return count;
}

export function installHydrationRuntime(): void {
  registerHydrationRuntime({
    claimNext,
    isMarker,
    isItemMarker,
    findViewEnd,
    findInsertWindow,
    collectBetween,
    mergeTopLevelMetadata,
    shapeMatches,
    significantChildren,
    significantChildrenFromEnd,
    countSignificantChildren,
  });
}

installHydrationRuntime();
