import { INSERT_END, INSERT_START } from "./hydration-state.js";

export function significantChildren(node: Node, index: number): Node | null {
  const first = node.firstChild;
  if (first !== null && index === 0) {
    if (first.nodeType !== Node.COMMENT_NODE) {
      return first;
    }
    const data = (first as Comment).data;
    if (data !== INSERT_START && data !== INSERT_END) {
      return first;
    }
  }
  let depth = 0;
  let child = first;
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
  const last = node.lastChild;
  if (last !== null && offset === 0) {
    if (last.nodeType !== Node.COMMENT_NODE) {
      return last;
    }
    const data = (last as Comment).data;
    if (data !== INSERT_START && data !== INSERT_END) {
      return last;
    }
  }
  let depth = 0;
  let child = last;
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
