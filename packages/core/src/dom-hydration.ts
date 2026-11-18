import { createRenderEffect, isReactive } from "@ivlev-dev/silent-reactivity";
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
  svgAttributeTarget,
  valuesEqual,
  applyProperty,
  booleanNames,
  propertyNames,
  type SvgAttributeTarget,
  type TemplateClone,
  type TemplateHydrationSource,
  type TemplatePlan,
} from "./dom.js";
import { registerDomHydrationRuntime, isStaticHydration } from "./dom-hydration-state.js";
import { createEffectUnlessStatic } from "./static-effect.js";
import {
  INSERT_END,
  INSERT_START,
  claimNext,
  collectBetween,
  findInsertWindow,
  markClientNodes,
  mergeTopLevelMetadata,
  mismatch,
  registerInsertStart,
  shapeMatches,
  withWindow,
  type HydrationWindow,
} from "./hydration.js";
import { normalizeClass, styleDeclarations, type ClassNameValue, type StyleInput } from "./class-style.js";
import { extractMetadata, isMetadataElement, markMetadataFree } from "./metadata.js";
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

function holeMatches(data: string, key: string | undefined, index: number): boolean {
  return key !== undefined ? data === key : markerIndex(data, HOLE_MARKER) === index;
}

function attrMatches(element: Element, key: string | undefined, index: number): boolean {
  return element.hasAttribute(key ?? (ATTR_MARKER + index));
}

function attrName(key: string | undefined, index: number): string {
  return key ?? (ATTR_MARKER + index);
}

const insertParents = new WeakSet<Node>();

function recordInsertRegion(hole: Comment): void {
  const end = hole.previousSibling;
  if (
    end === null ||
    end.nodeType !== Node.COMMENT_NODE ||
    (end as Comment).data !== INSERT_END
  ) {
    return;
  }
  const parent = hole.parentNode;
  if (parent === null || insertParents.has(parent)) {
    return;
  }
  const before = end.previousSibling;
  if (
    before !== null &&
    before.nodeType === Node.COMMENT_NODE &&
    (before as Comment).data === INSERT_START
  ) {
    return;
  }
  const start = parent.firstChild;
  if (
    start === null ||
    start.nodeType !== Node.COMMENT_NODE ||
    (start as Comment).data !== INSERT_START
  ) {
    return;
  }
  insertParents.add(parent);
  registerInsertStart(end as Comment, start as Comment);
}

function tryAdoptPartsPlanByPath(
  root: Node,
  plan: TemplatePlan,
  holes: (Comment | undefined)[],
  attrs: (Element | undefined)[],
  stripText: boolean,
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
          recordInsertRegion(next as Comment);
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
      holeMatches((node as Comment).data, entry.key, index)
    ) {
      holes[index] = node as Comment;
      recordInsertRegion(node as Comment);
      continue;
    }
    if (node !== null && node.nodeType === Node.TEXT_NODE) {
      const next = node.nextSibling;
      if (
        next !== null &&
        next.nodeType === Node.COMMENT_NODE &&
        holeMatches((next as Comment).data, entry.key, index)
      ) {
        holes[index] = next as Comment;
        recordInsertRegion(next as Comment);
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
      !attrMatches(node as Element, entry.key, index)
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
    element.removeAttribute(attrName(plan.attrs[index]?.key, index));
    if (stripText && element.hasAttribute(TEXT_MARKER)) {
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
        holeMatches((node as Comment).data, plan.holes[index]?.key, index)
      ) {
        holes[index] = node as Comment;
        return 1;
      }
      if (node.nodeType === Node.TEXT_NODE) {
        const next = node.nextSibling;
        if (
          next !== null &&
          next.nodeType === Node.COMMENT_NODE &&
          holeMatches((next as Comment).data, plan.holes[index]?.key, index)
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
        if (!attrMatches(element, plan.attrs[index]?.key, index)) {
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
  for (const hole of adoptedHoles) {
    recordInsertRegion(hole);
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
    element.removeAttribute(attrName(plan.attrs[index]?.key, index));
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
  stripText: boolean,
): boolean {
  if (tryAdoptPartsPlanByPath(root, plan, holes, attrs, stripText)) {
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

function classTokensMatch(element: Element, expected: string): boolean {
  const current = element.getAttribute("class") ?? "";
  if (current === expected) {
    return true;
  }
  const tokens = new Set<string>();
  for (const token of current.split(/\s+/)) {
    if (token !== "") {
      tokens.add(token);
    }
  }
  for (const token of expected.split(/\s+/)) {
    if (token === "") {
      continue;
    }
    if (!tokens.delete(token)) {
      return false;
    }
  }
  return tokens.size === 0;
}

function svgLocalName(target: SvgAttributeTarget): string {
  const separator = target.name.indexOf(":");
  return separator === -1 ? target.name : target.name.slice(separator + 1);
}

function svgAttributeValue(el: Element, target: SvgAttributeTarget): string | null {
  return target.namespace === null
    ? el.getAttribute(target.name)
    : el.getAttributeNS(target.namespace, svgLocalName(target));
}

function propertyValueMatches(el: Element, name: string, value: unknown): boolean {
  if (name === "value") {
    const target = el as unknown as Record<string, unknown>;
    const expected = value === null || value === undefined ? "" : value;
    return (
      valuesEqual(target["value"], expected)
      || String(target["value"]) === String(expected)
    );
  }
  return el.hasAttribute(name) === Boolean(value);
}

const STYLE_IMPORTANT = /\s*!\s*important\s*$/i;

function splitStylePriority(value: string): readonly [string, string] {
  const match = STYLE_IMPORTANT.exec(value);
  if (match === null) {
    return [value, ""];
  }
  return [value.slice(0, match.index).trimEnd(), "important"];
}

function styleMatches(el: Element, value: unknown): boolean {
  const declarations = styleDeclarations(value as StyleInput);
  if (declarations.size === 0) {
    return !el.hasAttribute("style");
  }
  const style = (el as HTMLElement).style;
  if (style.length === 0) {
    return false;
  }
  const probe = el.ownerDocument.createElement("div").style;
  for (const [property, expected] of declarations) {
    const [text, priority] = splitStylePriority(expected);
    probe.setProperty(property, text, priority);
  }
  if (probe.length !== style.length) {
    return false;
  }
  for (let index = 0; index < style.length; index += 1) {
    const property = style.item(index);
    if (
      probe.getPropertyValue(property) !== style.getPropertyValue(property)
      || probe.getPropertyPriority(property) !== style.getPropertyPriority(property)
    ) {
      return false;
    }
  }
  return true;
}

function attrValueMatches(el: Element, name: string, value: unknown, svg: boolean): boolean {
  if (name === "class" || name === "className") {
    return classTokensMatch(el, normalizeClass(value as ClassNameValue));
  }
  if (name === "style") {
    return styleMatches(el, value);
  }
  if (!svg && propertyNames.has(name) && name !== "value") {
    return propertyValueMatches(el, name, value);
  }
  const target = svg ? svgAttributeTarget(name) : null;
  if (value === null || value === undefined || value === false) {
    return (target === null ? el.getAttribute(name) : svgAttributeValue(el, target)) === null;
  }
  const expected = value === true ? (booleanNames.has(name) ? "" : "true") : stringOf(value);
  const current = target === null ? el.getAttribute(name) : svgAttributeValue(el, target);
  return current === expected;
}

export function staticRowAllowed(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return true;
  }
  if (isReactive(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype !== Object.prototype && prototype !== null) {
    return false;
  }
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor !== undefined &&
      (descriptor.get !== undefined || descriptor.set !== undefined)
    ) {
      return false;
    }
  }
  return true;
}

export function staticAttrMatches(
  el: Element,
  name: string,
  value: unknown,
  svg: boolean,
): boolean {
  if (!svg && (name === "value" || name === "indeterminate")) {
    applyProperty(el, name, value);
    return true;
  }
  return attrValueMatches(el, name, value, svg);
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
  let stripText = false;
  for (let index = 0; index < plan.strips.length; index += 1) {
    const names = plan.strips[index]?.names;
    if (names !== undefined && names.includes(TEXT_MARKER)) {
      stripText = true;
      break;
    }
  }
  if (tryAdoptPartsPlan(root, plan, holes, attrs, stripText)) {
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
  for (const hole of out.holes) {
    recordInsertRegion(hole);
  }
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

function sameShape(left: Node, right: Node): boolean {
  if (left.nodeType !== right.nodeType) {
    return false;
  }
  if (left.nodeType === 1) {
    return (left as Element).tagName === (right as Element).tagName;
  }
  return left.nodeType === 3 || left.nodeType === 8;
}

function dropTrailingShape(marker: Node | null, produced: readonly Node[]): void {
  if (marker === null || produced.length === 0) {
    return;
  }
  const collected: Node[] = [];
  let node = marker.previousSibling;
  while (node !== null && collected.length < produced.length) {
    if (node.nodeType === 8) {
      return;
    }
    collected.push(node);
    node = node.previousSibling;
  }
  if (collected.length !== produced.length) {
    return;
  }
  collected.reverse();
  for (let index = 0; index < produced.length; index += 1) {
    const existing = collected[index];
    const next = produced[index];
    if (existing === undefined || next === undefined || !sameShape(existing, next)) {
      return;
    }
  }
  for (const stale of collected) {
    disposeNode(stale);
    stale.parentNode?.removeChild(stale);
  }
}

function textHydrated(
  parent: Node,
  accessor: () => unknown,
  marker: Node | null,
  initial: Text | null,
): void {
  if (isStaticHydration()) {
    const value = resolveValue(accessor());
    if (isTextValue(value)) {
      const expected = stringOf(value);
      if ((initial === null ? "" : initial.data) !== expected) {
        mismatch("текстовый узел не совпал с серверной разметкой");
      }
      return;
    }
  }
  let textNode = initial;
  let region: HydrationWindow | null = null;
  createEffectUnlessStatic(() => {
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
        markClientNodes();
        textNode = document.createTextNode(next);
        insertText(parent, marker, textNode);
        return;
      }
      if (textNode.data !== next) {
        textNode.data = next;
      }
      return;
    }
    const produced: Node[] = [];
    flattenNodes(resolved, produced);
    dropTrailingShape(marker, produced);
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
    const first = value.firstChild;
    if (first === null) {
      return;
    }
    markClientNodes();
    let child: Node | null = first;
    while (child !== null) {
      clientNodes.add(child);
      child = child.nextSibling;
    }
    parent.insertBefore(value, end);
    return;
  }
  clientNodes.add(value);
  if (value.parentNode !== parent) {
    markClientNodes();
    parent.insertBefore(value, end);
  }
}

function staticRegionText(window: HydrationWindow, expected: string): boolean {
  let text = "";
  let node: Node | null = window.start.nextSibling;
  while (node !== null && node !== window.end) {
    if (node.nodeType !== Node.TEXT_NODE) {
      return false;
    }
    text += (node as Text).data;
    node = node.nextSibling;
  }
  return node === window.end && text === expected;
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
  state.nodes.length = 0;
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
    state.nodes.push(text);
    parent.insertBefore(text, end);
    return;
  }
  writeNodes(state, value);
}

function claimTemplateRoots(plan: TemplatePlan): Node {
  if (plan.roots === 1) {
    const next = claimNext();
    if (next === null) {
      return mismatch("шаблон не совпал с серверной разметкой");
    }
    markMetadataFree(next);
    return next;
  }
  const claimed: Node[] = [];
  for (let index = 0; index < plan.roots; index += 1) {
    const next = claimNext();
    if (next === null) {
      return mismatch("шаблон не совпал с серверной разметкой");
    }
    markMetadataFree(next);
    claimed.push(next);
  }
  const container = document.createDocumentFragment();
  for (const node of claimed) {
    container.appendChild(node);
  }
  markMetadataFree(container);
  return container;
}

export function hydrateTemplate(source: TemplateHydrationSource): TemplateClone {
  const providedPlan = source.providedPlan;
  if (providedPlan !== undefined) {
    const node = claimTemplateRoots(providedPlan);
    const clone: { node: Node; holes: Comment[]; attrs: Element[] } = {
      node,
      holes: NO_HOLES,
      attrs: NO_ATTRIBUTES,
    };
    adoptPartsPlan(node, providedPlan, clone);
    return clone;
  }
  const current = source.parse();
  const metadata = current.metadata;
  const simple = current.simple;
  const rootCount = current.rootCount;
  if (!metadata) {
    if (rootCount === 0) {
      const empty = document.createDocumentFragment();
      markMetadataFree(empty);
      return { node: empty, holes: NO_HOLES, attrs: NO_ATTRIBUTES };
    }
    const expected = collectPartsMany([source.cloneNode()]);
    if (rootCount === 1) {
      const node = claimNext();
      if (node === null) {
        return mismatch("шаблон не совпал с серверной разметкой");
      }
      markMetadataFree(node);
      const collected = collectPartsMany([node]);
      if (
        collected.holes.length !== expected.holes.length ||
        collected.attrs.length !== expected.attrs.length
      ) {
        return mismatch("шаблон не совпал с серверной разметкой");
      }
      return { node, ...collected };
    }
    const claimed: Node[] = [];
    let cursor = current.content.firstChild;
    while (cursor !== null) {
      const next = cursor.nextSibling;
      const node = claimNext();
      if (node === null) {
        return mismatch("шаблон не совпал с серверной разметкой");
      }
      markMetadataFree(node);
      claimed.push(node);
      cursor = next;
    }
    const collected = collectPartsMany(claimed);
    if (
      collected.holes.length !== expected.holes.length ||
      collected.attrs.length !== expected.attrs.length
    ) {
      return mismatch("шаблон не совпал с серверной разметкой");
    }
    const container = document.createDocumentFragment();
    for (const node of claimed) {
      container.appendChild(node);
    }
    markMetadataFree(container);
    return { node: container, ...collected };
  }
  const fresh = source.cloneNode();
  const roots =
    fresh instanceof DocumentFragment ? Array.from(fresh.childNodes) : [fresh];
  if (roots.length === 1 && isMetadataElement(roots[0])) {
    const title = roots[0]!;
    return { node: title, ...collectPartsMany([title]) };
  }
  const claimed: Node[] = [];
  for (const root of roots) {
    if (isMetadataElement(root)) {
      claimed.push(root);
      continue;
    }
    const node = claimNext();
    if (node === null || !shapeMatches(root, node, true, simple)) {
      return mismatch("шаблон не совпал с серверной разметкой");
    }
    mergeTopLevelMetadata(root, node);
    claimed.push(node);
  }
  const collected = collectPartsMany(claimed);
  if (claimed.length === 1 && !(fresh instanceof DocumentFragment)) {
    return { node: claimed[0]!, ...collected };
  }
  const container = document.createDocumentFragment();
  for (const node of claimed) {
    container.appendChild(node);
  }
  return { node: container, ...collected };
}

const clientNodes = new WeakSet<Node>();

function flattenNodes(value: unknown, out: Node[]): void {
  if (value instanceof Node) {
    if (value.nodeType === 11) {
      let child = value.firstChild;
      while (child !== null) {
        out.push(child);
        child = child.nextSibling;
      }
      return;
    }
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      flattenNodes(item, out);
    }
  }
}

function keepRegion(start: Node, end: Node, keep: ReadonlySet<Node>): void {
  let node = start.nextSibling;
  while (node !== null && node !== end) {
    const next = node.nextSibling;
    if (!keep.has(node)) {
      disposeNode(node);
      node.parentNode?.removeChild(node);
    }
    node = next;
  }
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
  const start = previous.previousSibling;
  const window: HydrationWindow =
    start !== null &&
    start.nodeType === Node.COMMENT_NODE &&
    (start as Comment).data === INSERT_START
      ? { start, end: previous, cursor: previous }
      : findInsertWindow(marker, parent);
  if (isStaticHydration()) {
    const value = resolveValue(accessor());
    if (isTextValue(value)) {
      if (!staticRegionText(window, stringOf(value))) {
        mismatch("содержимое региона вставки не совпало");
      }
      return;
    }
  }
  let initialized = false;
  createRenderEffect(() => {
    if (!initialized) {
      initialized = true;
      const value = resolveValue(withWindow(window, accessor));
      const produced: Node[] = [];
      flattenNodes(value, produced);
      if (produced.some((node) => clientNodes.has(node))) {
        keepRegion(window.start, window.end, new Set(produced));
      }
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
  registerDomHydrationRuntime({
    hydrateTemplate,
    settleNodes,
    writeRegion,
    insertHydrated,
    hydratedEffect: createEffectUnlessStatic,
    staticAttrMatches,
    staticRowAllowed,
    adoptPartsPlan,
  });
}

installDomHydrationRuntime();
