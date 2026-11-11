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

interface ShapeCursor {
  node: Node | null;
  depth: number;
  ignoreTopMetadata: boolean;
}

function nextShapeChild(cursor: ShapeCursor): Node | null {
  let child = cursor.node;
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
    }
    cursor.node = next;
    if (!skip && !(cursor.ignoreTopMetadata && isMetadataElement(child))) {
      return child;
    }
    child = next;
  }
  return null;
}

function attributesMatch(left: Element, right: Element): boolean {
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
  return true;
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
    if (!attributesMatch(left, right)) {
      return false;
    }
    if (simpleFresh) {
      let freshChild = left.firstChild;
      let claimedChild = right.firstChild;
      let depth = 0;
      while (freshChild !== null) {
        let matched: Node | null = null;
        while (claimedChild !== null) {
          const candidate = claimedChild;
          const next = candidate.nextSibling;
          let skip = depth > 0;
          if (candidate.nodeType === Node.COMMENT_NODE) {
            const data = (candidate as Comment).data;
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
          claimedChild = next;
          if (!skip) {
            matched = candidate;
            break;
          }
        }
        if (matched === null || !shapeMatches(freshChild, matched, false, true)) {
          return false;
        }
        freshChild = freshChild.nextSibling;
      }
      while (claimedChild !== null) {
        const candidate = claimedChild;
        const next = candidate.nextSibling;
        let skip = depth > 0;
        if (candidate.nodeType === Node.COMMENT_NODE) {
          const data = (candidate as Comment).data;
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
        claimedChild = next;
        if (!skip) {
          return false;
        }
      }
      return true;
    }
    const rightCursor: ShapeCursor = {
      node: right.firstChild,
      depth: 0,
      ignoreTopMetadata: false,
    };
    const leftCursor: ShapeCursor = {
      node: left.firstChild,
      depth: 0,
      ignoreTopMetadata,
    };
    let x = nextShapeChild(leftCursor);
    let y = nextShapeChild(rightCursor);
    while (x !== null && y !== null) {
      if (!shapeMatches(x, y)) {
        return false;
      }
      x = nextShapeChild(leftCursor);
      y = nextShapeChild(rightCursor);
    }
    return x === null && y === null;
  }
  if (nodeType === Node.TEXT_NODE) {
    return (fresh as Text).data === (claimed as Text).data;
  }
  if (nodeType === Node.COMMENT_NODE) {
    return (fresh as Comment).data === (claimed as Comment).data;
  }
  return true;
}

export function significantChildren(node: Node, index: number): Node | null {
  let depth = 0;
  let child = node.firstChild;
  let position = 0;
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
      if (position === index) {
        return child;
      }
      position += 1;
    }
    child = next;
  }
  return null;
}

export function significantChildrenFromEnd(node: Node, offset: number): Node | null {
  let depth = 0;
  let child = node.lastChild;
  let position = 0;
  while (child !== null) {
    const previous = child.previousSibling;
    let skip = depth > 0;
    if (child.nodeType === Node.COMMENT_NODE) {
      const data = (child as Comment).data;
      if (data === INSERT_END) {
        depth += 1;
        skip = true;
      } else if (data === INSERT_START) {
        if (depth > 0) {
          depth -= 1;
        }
        skip = true;
      }
    }
    if (!skip) {
      if (position === offset) {
        return child;
      }
      position += 1;
    }
    child = previous;
  }
  return null;
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
