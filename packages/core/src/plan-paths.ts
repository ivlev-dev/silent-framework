import { INSERT_END, INSERT_START } from "./hydration-state.js";
import { significantChildren, significantChildrenFromEnd } from "./significant.js";
import type { PartPath } from "./dom.js";

function pickSignificantChild(
  parent: Node,
  index: number,
  size: number | undefined,
): Node | null {
  if (size === 1 && index === 0) {
    const first = parent.firstChild;
    if (first !== null) {
      if (first.nodeType !== Node.COMMENT_NODE) {
        return first;
      }
      const data = (first as Comment).data;
      if (data !== INSERT_START && data !== INSERT_END) {
        return first;
      }
    }
  }
  if (size === undefined || size <= 0) {
    return significantChildren(parent, index);
  }
  const last = size - 1;
  if (index >= last - index) {
    return significantChildrenFromEnd(parent, last - index);
  }
  return significantChildren(parent, index);
}

export function resolvePath(
  root: Node,
  entry: PartPath,
  significant: boolean,
): Node | null {
  const path = entry.path;
  const first = path[0];
  if (first === undefined) {
    return null;
  }
  let node: Node | null;
  if (root instanceof DocumentFragment) {
    node = significant
      ? pickSignificantChild(root, first, entry.counts[0])
      : root.childNodes[first] ?? null;
  } else {
    node = first === 0 ? root : null;
  }
  for (let index = 1; node !== null && index < path.length; index += 1) {
    const childIndex = path[index];
    if (childIndex === undefined) {
      return null;
    }
    node = significant
      ? pickSignificantChild(node, childIndex, entry.counts[index])
      : node.childNodes[childIndex] ?? null;
  }
  return node;
}
