import { createRenderEffect } from "@ivlev-dev/silent-reactivity";
import {
  ATTR_MARKER,
  HOLE_MARKER,
  TEXT_MARKER,
  collectNodes,
  collectPartsMany,
  disposeNode,
  markerIndex,
  resolvePath,
  resolveValue,
  stringOf,
  type TemplatePlan,
} from "./dom.js";
import { registerDomHydrationRuntime } from "./dom-hydration-state.js";
import { renderEffectUnlessStatic } from "./static-effect.js";
import {
  INSERT_END,
  INSERT_START,
  collectBetween,
  findInsertWindow,
  mismatch,
  withWindow,
  type HydrationWindow,
} from "./hydration.js";
import { extractMetadata } from "./metadata.js";
import type { Children } from "./jsx.js";


interface TrieNode {
  children: Map<number, TrieNode> | null;
  hole: number;
  attrs: number[] | null;
  maxIndex: number;
}

const trieCache = new WeakMap<TemplatePlan, TrieNode>();

function createTrieNode(): TrieNode {
  return { children: null, hole: -1, attrs: null, maxIndex: -1 };
}

function trieChild(parent: TrieNode, index: number): TrieNode {
  let children = parent.children;
  if (children === null) {
    children = new Map<number, TrieNode>();
    parent.children = children;
  }
  let child = children.get(index);
  if (child === undefined) {
    child = createTrieNode();
    children.set(index, child);
  }
  if (index > parent.maxIndex) {
    parent.maxIndex = index;
  }
  return child;
}

function insertTriePath(root: TrieNode, path: readonly number[]): TrieNode {
  let node = root;
  for (const index of path) {
    node = trieChild(node, index);
  }
  return node;
}

function buildTrie(plan: TemplatePlan): TrieNode {
  const root = createTrieNode();
  for (let index = 0; index < plan.holes.length; index += 1) {
    const entry = plan.holes[index];
    if (entry === undefined) {
      continue;
    }
    insertTriePath(root, entry.path).hole = index;
  }
  for (let index = 0; index < plan.attrs.length; index += 1) {
    const entry = plan.attrs[index];
    if (entry === undefined) {
      continue;
    }
    const node = insertTriePath(root, entry.path);
    const attrs = node.attrs;
    if (attrs === null) {
      node.attrs = [index];
    } else {
      attrs.push(index);
    }
  }
  return root;
}

function trieFor(plan: TemplatePlan): TrieNode {
  const cached = trieCache.get(plan);
  if (cached !== undefined) {
    return cached;
  }
  const trie = buildTrie(plan);
  trieCache.set(plan, trie);
  return trie;
}

const HOLE_ZERO = HOLE_MARKER + "0";

function tryAdoptPartsPlanByPath(
  root: Node,
  plan: TemplatePlan,
  holes: (Comment | undefined)[],
  attrs: (Element | undefined)[],
): boolean {
  if (plan.roots === 1 && plan.holes.length === 1 && plan.attrs.length === 0) {
    const entry = plan.holes[0];
    if (
      entry !== undefined &&
      entry.path.length === 2 &&
      entry.path[0] === 0 &&
      entry.path[1] === 0
    ) {
      const first = root.firstChild;
      if (first !== null && first.nodeType === Node.TEXT_NODE) {
        const next = first.nextSibling;
        if (
          next !== null &&
          next.nodeType === Node.COMMENT_NODE &&
          (next as Comment).data === HOLE_ZERO
        ) {
          holes[0] = next as Comment;
          return true;
        }
      }
    }
  }
  for (let index = 0; index < plan.holes.length; index += 1) {
    const entry = plan.holes[index];
    if (entry === undefined) {
      return false;
    }
    const node = resolvePath(root, entry, true);
    if (
      node !== null &&
      node.nodeType === Node.COMMENT_NODE &&
      markerIndex((node as Comment).data, HOLE_MARKER) === index
    ) {
      holes[index] = node as Comment;
      continue;
    }
    if (node !== null && node.nodeType === Node.TEXT_NODE) {
      const next = node.nextSibling;
      if (
        next !== null &&
        next.nodeType === Node.COMMENT_NODE &&
        markerIndex((next as Comment).data, HOLE_MARKER) === index
      ) {
        holes[index] = next as Comment;
        continue;
      }
    }
    return false;
  }
  for (let index = 0; index < plan.attrs.length; index += 1) {
    const entry = plan.attrs[index];
    if (entry === undefined) {
      return false;
    }
    const node = resolvePath(root, entry, true);
    if (
      node === null ||
      node.nodeType !== Node.ELEMENT_NODE ||
      !(node as Element).hasAttribute(ATTR_MARKER + index)
    ) {
      return false;
    }
    attrs[index] = node as Element;
  }
  for (let index = 0; index < plan.attrs.length; index += 1) {
    const element = attrs[index];
    if (element === undefined) {
      return false;
    }
    element.removeAttribute(ATTR_MARKER + index);
    if (element.hasAttribute(TEXT_MARKER)) {
      element.removeAttribute(TEXT_MARKER);
    }
  }
  return true;
}

function tryAdoptPartsPlanByTrie(
  root: Node,
  plan: TemplatePlan,
): { holes: Comment[]; attrs: Element[] } | null {
  const trie = trieFor(plan);
  const holes: (Comment | undefined)[] = [];
  const attrs: (Element | undefined)[] = [];

  function adoptNode(node: Node, nodeTrie: TrieNode): number {
    if (nodeTrie.hole >= 0) {
      const index = nodeTrie.hole;
      if (
        node.nodeType === Node.COMMENT_NODE &&
        markerIndex((node as Comment).data, HOLE_MARKER) === index
      ) {
        holes[index] = node as Comment;
        return 1;
      }
      if (node.nodeType === Node.TEXT_NODE) {
        const next = node.nextSibling;
        if (
          next !== null &&
          next.nodeType === Node.COMMENT_NODE &&
          markerIndex((next as Comment).data, HOLE_MARKER) === index
        ) {
          holes[index] = next as Comment;
          return 2;
        }
      }
      return -1;
    }
    if (nodeTrie.attrs !== null) {
      if (node.nodeType !== Node.ELEMENT_NODE) {
        return -1;
      }
      const element = node as Element;
      for (const index of nodeTrie.attrs) {
        if (!element.hasAttribute(ATTR_MARKER + index)) {
          return -1;
        }
      }
      for (const index of nodeTrie.attrs) {
        attrs[index] = element;
      }
    }
    if (nodeTrie.children !== null && !walk(node, nodeTrie)) {
      return -1;
    }
    return 1;
  }

  function walk(parent: Node, nodeTrie: TrieNode): boolean {
    const children = nodeTrie.children;
    if (children === null) {
      return true;
    }
    let child = parent.firstChild;
    let depth = 0;
    let templateIndex = 0;
    let skipNext = false;
    while (child !== null) {
      const next = child.nextSibling;
      let skip = depth > 0;
      if (child.nodeType === Node.COMMENT_NODE) {
        const data = (child as Comment).data;
        if (data === INSERT_START) {
          depth += 1;
          skip = true;
        } else if (data === INSERT_END) {
          depth = depth > 0 ? depth - 1 : 0;
          skip = true;
        }
      }
      if (!skip) {
        if (skipNext) {
          skipNext = false;
        } else {
          const childTrie = children.get(templateIndex);
          if (childTrie !== undefined) {
            const consumed = adoptNode(child, childTrie);
            if (consumed < 0) {
              return false;
            }
            if (consumed === 2) {
              skipNext = true;
            }
          }
          templateIndex += 1;
        }
      }
      child = next;
    }
    return templateIndex > nodeTrie.maxIndex;
  }

  if (plan.roots === 0) {
    return plan.holes.length === 0 && plan.attrs.length === 0
      ? { holes: [], attrs: [] }
      : null;
  }
  if (plan.roots === 1) {
    const first = trie.children?.get(0);
    if (first === undefined) {
      if (plan.holes.length === 0 && plan.attrs.length === 0) {
        return { holes: [], attrs: [] };
      }
      return null;
    }
    if (adoptNode(root, first) < 0) {
      return null;
    }
  } else if (!walk(root, trie)) {
    return null;
  }

  const adoptedHoles: Comment[] = [];
  for (let index = 0; index < plan.holes.length; index += 1) {
    const hole = holes[index];
    if (hole === undefined) {
      return null;
    }
    adoptedHoles.push(hole);
  }
  const adoptedAttrs: Element[] = [];
  for (let index = 0; index < plan.attrs.length; index += 1) {
    const element = attrs[index];
    if (element === undefined) {
      return null;
    }
    adoptedAttrs.push(element);
  }
  for (let index = 0; index < adoptedAttrs.length; index += 1) {
    const element = adoptedAttrs[index]!;
    element.removeAttribute(ATTR_MARKER + index);
    if (element.hasAttribute(TEXT_MARKER)) {
      element.removeAttribute(TEXT_MARKER);
    }
  }
  return { holes: adoptedHoles, attrs: adoptedAttrs };
}

function tryAdoptPartsPlan(
  root: Node,
  plan: TemplatePlan,
  holes: (Comment | undefined)[],
  attrs: (Element | undefined)[],
): boolean {
  if (tryAdoptPartsPlanByPath(root, plan, holes, attrs)) {
    return true;
  }
  const adopted = tryAdoptPartsPlanByTrie(root, plan);
  if (adopted === null) {
    return false;
  }
  for (let index = 0; index < adopted.holes.length; index += 1) {
    holes[index] = adopted.holes[index];
  }
  for (let index = 0; index < adopted.attrs.length; index += 1) {
    attrs[index] = adopted.attrs[index];
  }
  return true;
}

const NO_HOLES: Comment[] = [];
const NO_ATTRIBUTES: Element[] = [];

export function adoptPartsPlan(
  root: Node,
  plan: TemplatePlan,
  out: { holes: Comment[]; attrs: Element[] },
): void {
  const holes: Comment[] =
    plan.holes.length === 0 ? NO_HOLES : new Array<Comment>(plan.holes.length);
  const attrs: Element[] =
    plan.attrs.length === 0 ? NO_ATTRIBUTES : new Array<Element>(plan.attrs.length);
  if (tryAdoptPartsPlan(root, plan, holes, attrs)) {
    out.holes = holes;
    out.attrs = attrs;
    return;
  }
  const collected = collectPartsMany([root]);
  if (
    collected.holes.length !== plan.holes.length ||
    collected.attrs.length !== plan.attrs.length
  ) {
    return mismatch("шаблон не совпал с серверной разметкой");
  }
  out.holes = collected.holes;
  out.attrs = collected.attrs;
}

function isTextValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  const type = typeof value;
  return type === "string" || type === "number" || type === "bigint" || type === "boolean";
}

function insertText(parent: Node, marker: Node | null, node: Text): void {
  if (marker === null) {
    parent.appendChild(node);
    return;
  }
  const container = marker.parentNode;
  if (container === null) {
    parent.appendChild(node);
    return;
  }
  container.insertBefore(node, marker);
}

function ensureRegion(
  parent: Node,
  marker: Node | null,
  text: Text | null,
): HydrationWindow {
  const start = document.createComment(INSERT_START);
  const end = document.createComment(INSERT_END);
  if (text !== null && text.parentNode !== null) {
    const container = text.parentNode;
    container.insertBefore(start, text);
    container.insertBefore(end, text.nextSibling ?? marker);
  } else if (marker !== null && marker.parentNode !== null) {
    const container = marker.parentNode;
    container.insertBefore(start, marker);
    container.insertBefore(end, marker);
  } else {
    parent.appendChild(start);
    parent.appendChild(end);
  }
  return { start, end, cursor: start.nextSibling };
}

function textHydrated(
  parent: Node,
  accessor: () => unknown,
  marker: Node | null,
  initial: Text | null,
): void {
  let textNode = initial;
  let region: HydrationWindow | null = null;
  renderEffectUnlessStatic(() => {
    const value = accessor();
    if (region !== null) {
      writeRegion(region.start, region.end, value);
      return;
    }
    const resolved = resolveValue(value);
    if (isTextValue(resolved)) {
      const next = stringOf(resolved);
      if (textNode === null) {
        if (next === "") {
          return;
        }
        textNode = document.createTextNode(next);
        insertText(parent, marker, textNode);
        return;
      }
      if (textNode.data !== next) {
        textNode.data = next;
      }
      return;
    }
    region = ensureRegion(parent, marker, textNode);
    textNode = null;
    writeRegion(region.start, region.end, value);
  });
}

export function settleNodes(end: Node | null, value: unknown): void {
  if (end === null || !(value instanceof Node)) {
    return;
  }
  const parent = end.parentNode;
  if (parent === null) {
    return;
  }
  if (value instanceof DocumentFragment) {
    if (value.firstChild !== null) {
      parent.insertBefore(value, end);
    }
    return;
  }
  if (value.parentNode !== parent) {
    parent.insertBefore(value, end);
  }
}

interface RegionState {
  readonly end: Node;
  text: Text | null;
  nodes: Node[];
}

const regionStates = new WeakMap<Node, RegionState>();

function readRegion(start: Node, end: Node): RegionState {
  const existing = regionStates.get(start);
  if (existing !== undefined && existing.end === end) {
    return existing;
  }
  const nodes = collectBetween(start, end);
  const state: RegionState = {
    end,
    text: nodes.length === 1 && nodes[0] instanceof Text ? nodes[0] : null,
    nodes,
  };
  regionStates.set(start, state);
  return state;
}

function detach(node: Node): void {
  node.parentNode?.removeChild(node);
}

function disposeRegion(state: RegionState): void {
  for (const node of state.nodes) {
    disposeNode(node);
    detach(node);
  }
  state.nodes = [];
  state.text = null;
}

function sameNodes(left: readonly Node[], right: readonly Node[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function writeNodes(state: RegionState, value: unknown): void {
  const next = extractMetadata(collectNodes(value as Children));
  if (sameNodes(state.nodes, next)) {
    state.text = next.length === 1 && next[0] instanceof Text ? next[0] : null;
    return;
  }
  const parent = state.end.parentNode;
  if (parent === null) {
    return;
  }
  const nextSet = new Set(next);
  for (const node of state.nodes) {
    if (nextSet.has(node)) {
      continue;
    }
    disposeNode(node);
    detach(node);
  }
  state.nodes = [];
  for (const node of next) {
    parent.insertBefore(node, state.end);
  }
  state.nodes = next;
  state.text = next.length === 1 && next[0] instanceof Text ? next[0] : null;
}

export function writeRegion(start: Node, end: Node, value: unknown): void {
  const parent = end.parentNode;
  if (parent === null) {
    return;
  }
  const state = readRegion(start, end);
  const type = typeof value;
  if (type === "string" || type === "number" || type === "bigint") {
    const next = stringOf(value);
    if (state.text !== null) {
      if (state.text.data !== next) {
        state.text.data = next;
      }
      return;
    }
    disposeRegion(state);
    const text = document.createTextNode(next);
    state.text = text;
    state.nodes = [text];
    parent.insertBefore(text, end);
    return;
  }
  writeNodes(state, value);
}

export function insertHydrated(
  parent: Node,
  accessor: () => unknown,
  marker: Node | null,
): void {
  const previous = marker === null ? parent.lastChild : marker.previousSibling;
  if (
    previous === null ||
    previous.nodeType !== Node.COMMENT_NODE ||
    (previous as Comment).data !== INSERT_END
  ) {
    textHydrated(parent, accessor, marker, previous instanceof Text ? previous : null);
    return;
  }
  const window = findInsertWindow(marker, parent);
  let initialized = false;
  createRenderEffect(() => {
    if (!initialized) {
      initialized = true;
      const value = resolveValue(withWindow(window, () => accessor()));
      settleNodes(window.end, value);
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "bigint"
      ) {
        const first = window.start.nextSibling;
        if (first !== null && first !== window.end && first.nextSibling === window.end && first instanceof Text) {
          const next = stringOf(value);
          if (first.data !== next) {
            first.data = next;
          }
        }
      }
      return;
    }
    writeRegion(window.start, window.end, accessor());
  });
}

export function installDomHydrationRuntime(): void {
  registerDomHydrationRuntime({ settleNodes, writeRegion, insertHydrated, adoptPartsPlan });
}

installDomHydrationRuntime();
