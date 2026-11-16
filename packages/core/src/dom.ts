import type { Child, Children } from "./jsx.js";
import { createRenderEffect, onCleanup } from "@ivlev-dev/silent-reactivity";
import { createEffectUnlessStatic } from "./static-effect.js";
import { extractMetadata, isMetadataElement, markMetadataFree } from "./metadata.js";
import type { ServerHole } from "./server-backend.js";
import {
  getServerBackend,
  isServerHole,
  serializeServerValue,
  setServerHoleValue,
} from "./server-proxy.js";
import {
  FRAGMENT,
  INSERT_END,
  INSERT_START,
  claimNext,
  currentWindow,
  isHydrating,
  isMarker,
  countSignificantChildren,
  mergeTopLevelMetadata,
  mismatch,
  shapeMatches,
  significantChildren,
  significantChildrenFromEnd,
  withWindow,
} from "./hydration-proxy.js";
import {
  adoptPartsPlan,
  hydratedEffect,
  insertHydrated,
  settleNodes,
  writeRegion,
} from "./dom-hydration-state.js";
import {
  beginRegion,
  regionMatches,
  settleWindow,
} from "./hydration-cursor.js";

export const NODE_DISPOSER = Symbol("silent.disposer");
const ITEM_DISPOSER = Symbol("silent.itemDisposer");

type DisposerHost = Node & { [NODE_DISPOSER]?: () => void };
type ItemDisposerHost = Node & { [ITEM_DISPOSER]?: () => void };

interface ListenerHolder {
  current: EventListener | null;
  wrapper: EventListener;
  key: string;
}

export interface MountPoint {
  render(value: unknown): void;
  clear(): void;
  nodes(): readonly Node[];
}

export interface PartPath {
  readonly path: readonly number[];
  readonly counts: readonly number[];
  readonly key?: string;
}

export interface StripPlan {
  readonly path: readonly number[];
  readonly counts: readonly number[];
  readonly names: readonly string[];
}

interface PartsPlan {
  readonly holes: readonly PartPath[];
  readonly attrs: readonly PartPath[];
  readonly strips: readonly StripPlan[];
}

export interface TemplatePlan {
  readonly roots: number;
  readonly holes: readonly PartPath[];
  readonly attrs: readonly PartPath[];
  readonly strips: readonly StripPlan[];
}

export type TemplateNamespace = "svg";

interface TemplateParse {
  readonly content: DocumentFragment;
  readonly rootCount: number;
  readonly singleRoot: Node | null;
  readonly metadata: boolean;
  readonly simple: boolean;
  parts: PartsPlan | null;
}

interface ParsedEvent {
  readonly event: string;
  readonly capture: boolean;
  readonly key: string;
}

const parseCache = new Map<string, TemplateParse>();
const METADATA_PATTERN = /<(?:title|meta|link)[\s/>]/i;
const listenerRegistry = new WeakMap<Element, ListenerHolder | Map<string, ListenerHolder>>();
const delegatedInstalled = new Set<string>();
const DELEGATED_EVENTS =
  /^(?:change|click|contextmenu|dblclick|input|keydown|keyup|mousedown|mouseup|pointerdown|pointerup|submit|touchend|touchstart)$/;
const styleStates = new WeakMap<Element, StyleState>();
const hyphenCache = new Map<string, string>();
const eventNameCache = new Map<string, ParsedEvent>();

interface StyleState {
  readonly snapshot: Set<string>;
  readonly applied: Map<string, string>;
}

function createStyleState(): StyleState {
  return { snapshot: new Set<string>(), applied: new Map<string, string>() };
}

export const HOLE_MARKER = "silent-hole-";
export const ATTR_MARKER = "data-silent-a-";
export const TEXT_MARKER = "data-silent-text";
const AUX_CACHE_LIMIT = 1024;

let serverMode = false;

declare const __SILENT_SERVER__: boolean | undefined;

const SERVER = typeof __SILENT_SERVER__ === "undefined" || __SILENT_SERVER__;

export function setServerMode(enabled: boolean): void {
  serverMode = enabled;
}

export function isServerMode(): boolean {
  return serverMode;
}

const propertyNames = new Set<string>(["value", "checked", "selected", "disabled"]);

const booleanNames = new Set<string>([
  "hidden",
  "autofocus",
  "required",
  "readonly",
  "multiple",
  "novalidate",
  "async",
  "defer",
  "open",
  "muted",
  "playsinline",
  "checked",
  "disabled",
  "selected",
  "inert",
  "loop",
  "controls",
  "reversed",
]);

const SVG_TAGS =
  "svg|path|circle|rect|line|poly(?:line|gon)|ellipse|g|defs|use|text|tspan|textPath|linearGradient|radialGradient|stop";
const SVG_TAG = new RegExp(`^(?:${SVG_TAGS})$`, "i");
const SVG_TEMPLATE = new RegExp(`^<(?!svg[\\s/>])(?:${SVG_TAGS})[\\s/>]`, "i");

function isRenderableChild(value: unknown): boolean {
  return value !== null && value !== undefined && typeof value !== "boolean";
}

export function resolveValue(value: unknown): unknown {
  let current = value;
  while (typeof current === "function") {
    current = (current as () => unknown)();
  }
  return current;
}

export function stringOf(value: unknown): string {
  const current = resolveValue(value);
  if (current === null || current === undefined || typeof current === "boolean") {
    return "";
  }
  return String(current);
}

function isTextValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  const type = typeof value;
  return type === "string" || type === "number" || type === "bigint" || type === "boolean";
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  const type = typeof a;
  if (type !== typeof b) {
    return false;
  }
  return type === "string" || type === "number" || type === "bigint" || type === "boolean"
    ? Object.is(a, b)
    : false;
}

export function attachDisposer(node: Node, dispose: () => void): void {
  (node as DisposerHost)[NODE_DISPOSER] = dispose;
}

export function attachItemDisposer(node: Node, dispose: () => void): void {
  (node as ItemDisposerHost)[ITEM_DISPOSER] = dispose;
}

export function clearItemDisposer(node: Node): void {
  delete (node as ItemDisposerHost)[ITEM_DISPOSER];
}

function readDisposer(node: Node): (() => void) | undefined {
  const dispose = (node as DisposerHost)[NODE_DISPOSER];
  return typeof dispose === "function" ? dispose : undefined;
}

function collectInto(nodes: Node[], value: unknown): void {
  let current = value;
  while (typeof current === "function") {
    current = (current as () => unknown)();
  }
  if (current === null || current === undefined || typeof current === "boolean") {
    return;
  }
  if (Array.isArray(current)) {
    for (const item of current) {
      collectInto(nodes, item);
    }
    return;
  }
  if (current instanceof Node) {
    if (current instanceof DocumentFragment) {
      let child = current.firstChild;
      while (child !== null) {
        const next = child.nextSibling;
        collectInto(nodes, child);
        child = next;
      }
      return;
    }
    nodes.push(current);
    return;
  }
  if (
    typeof current === "object"
    && current !== null
    && !(current instanceof Node)
    && typeof (current as { [Symbol.iterator]?: unknown })[Symbol.iterator] === "function"
  ) {
    for (const item of current as Iterable<unknown>) {
      collectInto(nodes, item);
    }
    return;
  }
  nodes.push(document.createTextNode(stringOf(current)));
}

export function collectNodes(value: Children | Iterable<Child>): Node[] {
  if (value instanceof Node) {
    if (!(value instanceof DocumentFragment)) {
      return [value];
    }
    const nodes: Node[] = [];
    let child = value.firstChild;
    while (child !== null) {
      const next = child.nextSibling;
      collectInto(nodes, child);
      child = next;
    }
    return nodes;
  }
  const nodes: Node[] = [];
  collectInto(nodes, value);
  return nodes;
}

export function disposeNode(node: Node): void {
  const itemDispose = (node as ItemDisposerHost)[ITEM_DISPOSER];
  if (typeof itemDispose === "function") {
    itemDispose();
    return;
  }
  const dispose = readDisposer(node);
  if (dispose !== undefined) {
    dispose();
    return;
  }
  if (node.nodeType !== 1 && node.nodeType !== 11) {
    return;
  }
  let child = node.firstChild;
  while (child !== null) {
    const next = child.nextSibling;
    disposeNode(child);
    child = next;
  }
}

export function disposeTree(nodes: readonly Node[]): void {
  for (const node of nodes) {
    disposeNode(node);
  }
}

function detach(node: Node): void {
  node.parentNode?.removeChild(node);
}

export function createMountPoint(
  parent: Node,
  marker: Node | null,
  initial?: readonly Node[],
): MountPoint {
  let initialized = false;
  let prev: unknown = null;
  let textNode: Text | null = null;
  let nodes: Node[] = initial === undefined ? [] : [...initial];

  const place = (target: Node, node: Node): void => {
    if (marker === null) {
      target.appendChild(node);
      return;
    }
    target.insertBefore(node, marker);
  };

  const clear = (): void => {
    for (const node of nodes) {
      disposeNode(node);
      detach(node);
    }
    if (textNode !== null) {
      detach(textNode);
      textNode = null;
    }
    nodes = [];
    initialized = false;
    prev = null;
  };

  const sameNodes = (next: readonly Node[]): boolean => {
    if (textNode !== null || next.length !== nodes.length) {
      return false;
    }
    for (let index = 0; index < next.length; index += 1) {
      if (next[index] !== nodes[index]) {
        return false;
      }
    }
    return true;
  };

  return {
    clear,
    nodes(): readonly Node[] {
      return nodes;
    },
    render(value: unknown): void {
      if (initialized && valuesEqual(value, prev)) {
        return;
      }
      if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
        const next = stringOf(value);
        if (textNode === null) {
          clear();
          textNode = document.createTextNode(next);
          nodes = [textNode];
          initialized = true;
          prev = value;
          place(marker === null ? parent : marker.parentNode ?? parent, textNode);
          return;
        }
        initialized = true;
        prev = value;
        if (textNode.data !== next) {
          textNode.data = next;
        }
        return;
      }
      if (!isRenderableChild(value)) {
        clear();
        initialized = true;
        prev = value;
        return;
      }
      const next = extractMetadata(collectNodes(value as Child));
      if (sameNodes(next)) {
        initialized = true;
        prev = value;
        return;
      }
      clear();
      initialized = true;
      prev = value;
      nodes = next;
      const target = marker === null ? parent : marker.parentNode ?? parent;
      for (const node of nodes) {
        place(target, node);
      }
    },
  };
}

function readTemplate(html: string, namespace?: TemplateNamespace): TemplateParse {
  const svg = namespace === "svg" || SVG_TEMPLATE.test(html);
  const key = svg ? "s:" + html : html;
  const cached = parseCache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const element = document.createElement("template");
  element.innerHTML = svg ? "<svg>" + html + "</svg>" : html;
  let content = element.content;
  if (svg) {
    const wrapper = content.firstChild;
    content = document.createDocumentFragment();
    if (wrapper !== null) {
      let child = wrapper.firstChild;
      while (child !== null) {
        const next = child.nextSibling;
        content.appendChild(child);
        child = next;
      }
    }
  }
  const rootCount = content.childNodes.length;
  const metadata = METADATA_PATTERN.test(html);
  const parsed: TemplateParse = {
    content,
    rootCount,
    singleRoot: rootCount === 1 ? content.firstChild : null,
    metadata,
    simple: !metadata && !html.includes("silent-insert"),
    parts: null,
  };
  parseCache.set(key, parsed);
  return parsed;
}

export function template(html: string): () => Node {
  let factory: (() => Node) | null = null;
  return () => {
    factory ??= createTemplateFactory(html);
    return factory();
  };
}

function createTemplateFactory(html: string): () => Node {
  const { content, rootCount, singleRoot, metadata, simple } = readTemplate(html);
  const mark = (node: Node): Node => {
    if (!metadata) {
      if (node instanceof DocumentFragment) {
        for (const child of node.childNodes) {
          markMetadataFree(child);
        }
      }
      markMetadataFree(node);
    }
    return node;
  };
  const create = (): Node => {
    if (singleRoot !== null) {
      return mark(singleRoot.cloneNode(true));
    }
    if (rootCount === 0) {
      return mark(content.cloneNode(false));
    }
    return mark(content.cloneNode(true));
  };
  return () => {
    if (!isHydrating()) {
      return create();
    }
    if (!metadata) {
      if (rootCount !== 1 || singleRoot === null) {
        return mismatch("многослойный шаблон не поддерживается при гидрации");
      }
      const node = claimNext();
      if (node === null || !shapeMatches(singleRoot, node, true, simple)) {
        return mismatch("шаблон не совпал с серверной разметкой");
      }
      return node;
    }
    const fresh = create();
    if (fresh instanceof DocumentFragment) {
      return mismatch("многослойный шаблон не поддерживается при гидрации");
    }
    if (isMetadataElement(fresh)) {
      return fresh;
    }
    const node = claimNext();
    if (node === null || !shapeMatches(fresh, node, true)) {
      return mismatch("шаблон не совпал с серверной разметкой");
    }
    mergeTopLevelMetadata(fresh, node);
    return node;
  };
}

export interface TemplateClone {
  readonly node: Node;
  readonly holes: readonly (Comment | ServerHole)[];
  readonly attrs: readonly Element[];
}

export function markerIndex(value: string, prefix: string): number | null {
  if (!value.startsWith(prefix)) {
    return null;
  }
  const digits = value.slice(prefix.length);
  if (digits.length === 0) {
    return null;
  }
  let index = 0;
  for (let position = 0; position < digits.length; position += 1) {
    const digit = digits.charCodeAt(position) - 48;
    if (digit < 0 || digit > 9) {
      return null;
    }
    index = index * 10 + digit;
  }
  return index;
}

function forEachPartChild(node: Node, visit: (child: Node, index: number) => void): void {
  let depth = 0;
  let child = node.firstChild;
  let index = 0;
  while (child !== null) {
    const next = child.nextSibling;
    let marker = false;
    if (child.nodeType === Node.COMMENT_NODE) {
      const data = (child as Comment).data;
      if (data === INSERT_START) {
        depth += 1;
        marker = true;
      } else if (data === INSERT_END) {
        depth = depth > 0 ? depth - 1 : 0;
        marker = true;
      }
    }
    if (!marker && depth === 0) {
      visit(child, index);
      index += 1;
    }
    child = next;
  }
}

function denseParts<T>(sparse: readonly (T | undefined)[]): T[] {
  const result: T[] = [];
  for (const item of sparse) {
    if (item === undefined) {
      break;
    }
    result.push(item);
  }
  return result;
}

export function collectPartsMany(nodes: readonly Node[]): { holes: Comment[]; attrs: Element[] } {
  const holesByIndex: (Comment | undefined)[] = [];
  const attrsByIndex: (Element | undefined)[] = [];
  const strip = !isServerMode();

  const visit = (current: Node): void => {
    const nodeType = current.nodeType;
    if (nodeType === Node.COMMENT_NODE) {
      const index = markerIndex((current as Comment).data, HOLE_MARKER);
      if (index !== null) {
        holesByIndex[index] = current as Comment;
      }
    } else if (nodeType === Node.ELEMENT_NODE) {
      const element = current as Element;
      const attributes = element.attributes;
      for (let position = attributes.length - 1; position >= 0; position -= 1) {
        const attribute = attributes.item(position);
        if (attribute === null) {
          continue;
        }
        const name = attribute.name;
        if (name === TEXT_MARKER) {
          if (strip) {
            element.removeAttribute(name);
          }
          continue;
        }
        const index = markerIndex(name, ATTR_MARKER);
        if (index === null) {
          continue;
        }
        attrsByIndex[index] = element;
        if (strip) {
          element.removeAttribute(name);
        }
      }
    }
    forEachPartChild(current, visit);
  };

  for (const node of nodes) {
    visit(node);
  }

  return { holes: denseParts(holesByIndex), attrs: denseParts(attrsByIndex) };
}

function collectPartsPlan(content: DocumentFragment): PartsPlan {
  const holesByIndex: (number[] | undefined)[] = [];
  const attrsByIndex: (number[] | undefined)[] = [];
  const strips: { readonly path: readonly number[]; readonly names: readonly string[] }[] = [];
  const path: number[] = [];

  const visit = (node: Node): void => {
    const nodeType = node.nodeType;
    if (nodeType === Node.COMMENT_NODE) {
      const index = markerIndex((node as Comment).data, HOLE_MARKER);
      if (index !== null) {
        holesByIndex[index] = path.slice();
      }
    } else if (nodeType === Node.ELEMENT_NODE) {
      const element = node as Element;
      const names: string[] = [];
      const attributes = element.attributes;
      for (let position = attributes.length - 1; position >= 0; position -= 1) {
        const attribute = attributes.item(position);
        if (attribute === null) {
          continue;
        }
        const name = attribute.name;
        if (name === TEXT_MARKER) {
          names.push(name);
          continue;
        }
        const index = markerIndex(name, ATTR_MARKER);
        if (index !== null) {
          attrsByIndex[index] = path.slice();
          names.push(name);
        }
      }
      if (names.length > 0) {
        strips.push({ path: path.slice(), names });
      }
    }
    forEachPartChild(node, visitChild);
  };

  const visitChild = (child: Node, index: number): void => {
    path.push(index);
    visit(child);
    path.pop();
  };

  if (content.childNodes.length === 1) {
    const root = content.firstChild;
    if (root !== null) {
      visitChild(root, 0);
    }
  } else if (content.childNodes.length > 1) {
    forEachPartChild(content, visitChild);
  }

  return {
    holes: denseParts(holesByIndex).map((entry) => measurePath(content, entry)),
    attrs: denseParts(attrsByIndex).map((entry) => measurePath(content, entry)),
    strips: strips.map((entry) => ({
      ...measurePath(content, entry.path),
      names: entry.names,
    })),
  };
}

function measurePath(root: Node, path: readonly number[]): PartPath {
  const counts: number[] = [];
  let node: Node | null;
  if (root instanceof DocumentFragment) {
    counts.push(countSignificantChildren(root));
    const first = path[0];
    node = first === undefined ? null : significantChildren(root, first);
  } else {
    counts.push(0);
    node = path[0] === 0 ? root : null;
  }
  for (let index = 1; index < path.length; index += 1) {
    if (node === null) {
      counts.push(0);
      continue;
    }
    counts.push(countSignificantChildren(node));
    const childIndex = path[index];
    node = childIndex === undefined ? null : significantChildren(node, childIndex);
  }
  return { path, counts };
}

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

function applyPartsPlan(
  root: Node,
  plan: PartsPlan,
  strip: boolean,
  significant: boolean,
): { holes: Comment[]; attrs: Element[] } {
  const holes: Comment[] = [];
  for (const entry of plan.holes) {
    const node = resolvePath(root, entry, significant);
    if (node !== null) {
      holes.push(node as Comment);
    }
  }
  if (strip) {
    for (const entry of plan.strips) {
      const node = resolvePath(root, entry, significant);
      if (node === null) {
        continue;
      }
      const element = node as Element;
      for (const name of entry.names) {
        element.removeAttribute(name);
      }
    }
  }
  const attrs: Element[] = [];
  for (const entry of plan.attrs) {
    const node = resolvePath(root, entry, significant);
    if (node !== null) {
      attrs.push(node as Element);
    }
  }
  return { holes, attrs };
}

export function templateHoles(
  html: string,
  plan?: TemplatePlan,
  namespace?: TemplateNamespace,
): () => TemplateClone {
  let clientFactory: (() => TemplateClone) | null = null;
  return () => {
    if (SERVER && isServerMode()) {
      const backend = getServerBackend();
      if (backend !== null) {
        const template = backend.createTemplate(html);
        if (template !== null) {
          markMetadataFree(template.node as Node);
          return template as unknown as TemplateClone;
        }
      }
    }
    clientFactory ??= createClientTemplateHoles(html, plan, namespace);
    return clientFactory();
  };
}

const NO_HOLES: Comment[] = [];
const NO_ATTRIBUTES: Element[] = [];

function createClientTemplateHoles(
  html: string,
  providedPlan?: TemplatePlan,
  namespace?: TemplateNamespace,
): () => TemplateClone {
  let parsed: TemplateParse | null = null;
  const parse = (): TemplateParse => {
    parsed ??= readTemplate(html, namespace);
    return parsed;
  };
  const mark = (node: Node): Node => {
    if (!parse().metadata) {
      if (node instanceof DocumentFragment) {
        for (const child of node.childNodes) {
          markMetadataFree(child);
        }
      }
      markMetadataFree(node);
    }
    return node;
  };
  const cloneNode = (): Node => {
    const clone = parse().content.cloneNode(true) as DocumentFragment;
    return clone.childNodes.length === 1 ? clone.firstChild ?? clone : clone;
  };
  const parts = (): PartsPlan => {
    const current = parse();
    if (current.parts === null) {
      current.parts = collectPartsPlan(current.content);
    }
    return current.parts;
  };
  const create = (): TemplateClone => {
    const node = mark(cloneNode());
    return {
      node,
      ...applyPartsPlan(node, providedPlan ?? parts(), !isServerMode(), true),
    };
  };
  const claimRoots = (plan: TemplatePlan): Node => {
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
  };
  return () => {
    if (!isHydrating()) {
      return create();
    }
    if (providedPlan !== undefined) {
      const node = claimRoots(providedPlan);
      const clone = { node, holes: NO_HOLES, attrs: NO_ATTRIBUTES };
      adoptPartsPlan(node, providedPlan, clone);
      return clone;
    }
    const current = parse();
    const content = current.content;
    const metadata = current.metadata;
    const simple = current.simple;
    const rootCount = current.rootCount;
    if (!metadata) {
      if (rootCount === 0) {
        const empty = document.createDocumentFragment();
        markMetadataFree(empty);
        return { node: empty, holes: NO_HOLES, attrs: NO_ATTRIBUTES };
      }
      const expected = parts();
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
      let cursor = content.firstChild;
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
    const fresh = cloneNode();
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
  };
}


function insertServer(
  parent: Node,
  accessor: () => unknown,
  marker: Node | null,
): void {
  const previous = marker === null ? parent.lastChild : marker.previousSibling;
  let textNode: Text | null = null;
  let mount: MountPoint | null = null;
  let initialized = false;
  const writeText = (value: unknown): void => {
    const text = stringOf(value);
    if (textNode === null) {
      if (text === "") {
        return;
      }
      textNode = document.createTextNode(text);
      if (marker === null) {
        parent.appendChild(textNode);
      } else {
        parent.insertBefore(textNode, marker);
      }
      return;
    }
    if (textNode.data !== text) {
      textNode.data = text;
    }
  };
  const openRegion = (): MountPoint => {
    const start = document.createComment(INSERT_START);
    const end = document.createComment(INSERT_END);
    if (marker === null) {
      parent.appendChild(start);
      parent.appendChild(end);
    } else {
      parent.insertBefore(start, marker);
      parent.insertBefore(end, marker);
    }
    mount = createMountPoint(parent, end);
    return mount;
  };
  createEffectUnlessStatic(() => {
    const value = accessor();
    if (!initialized) {
      initialized = true;
      if (isTextValue(value) && !(previous instanceof Text)) {
        writeText(value);
        return;
      }
      openRegion().render(value);
      return;
    }
    if (mount !== null) {
      mount.render(value);
      return;
    }
    if (isTextValue(value)) {
      writeText(value);
      return;
    }
    const stale = textNode;
    const created = openRegion();
    if (stale !== null && stale.parentNode !== null) {
      stale.parentNode.removeChild(stale);
    }
    textNode = null;
    created.render(value);
  });
}


export function ssrValue(value: unknown, bare: boolean): string {
  if (bare && isTextValue(value)) {
    return serializeServerValue(value);
  }
  return `<!--${INSERT_START}-->${serializeServerValue(value)}<!--${INSERT_END}-->`;
}

export function ssrRaw(text: string): Node {
  const backend = getServerBackend();
  if (backend === null) {
    throw new Error("ssrRaw() доступен только при серверном рендеринге");
  }
  const created = backend.createRaw?.(text);
  const node = created ?? backend.createTemplate(text)?.node;
  if (node === null || node === undefined) {
    throw new Error("Серверный backend не поддерживает строковые узлы");
  }
  markMetadataFree(node as Node);
  return node as Node;
}

export function insert(
  parent: Node,
  accessor: () => unknown,
  marker?: Node | ServerHole,
): void {
  if (isServerHole(marker)) {
    if (SERVER) {
      const value = accessor();
      if (!setServerHoleValue(marker, value)) {
        marker.set(
          `<!--${INSERT_START}-->${serializeServerValue(value)}<!--${INSERT_END}-->`,
        );
      }
    }
    return;
  }
  if (SERVER && isServerMode()) {
    insertServer(parent, accessor, marker ?? null);
    return;
  }
  if (isHydrating()) {
    insertHydrated(parent, accessor, marker ?? null);
    return;
  }
  const mount = createMountPoint(parent, marker ?? null);
  createRenderEffect(() => {
    mount.render(accessor());
  });
}

export function text(node: Text, accessor: () => unknown): void {
  const apply = (): void => {
    const value = accessor();
    const next = stringOf(value);
    if (node.data !== next) {
      node.data = next;
    }
  };
  if (isHydrating()) {
    hydratedEffect(apply);
    return;
  }
  createRenderEffect(apply);
}

function isSvgElement(el: Element): boolean {
  return el instanceof SVGElement;
}

function setClass(el: Element, value: unknown): void {
  if (value === null || value === undefined || value === false || value === "") {
    el.removeAttribute("class");
    return;
  }
  el.setAttribute("class", stringOf(value));
}

interface ServerAttribute {
  setAttribute(name: string, value: unknown): void;
}

function serverAttribute(el: Element): ServerAttribute | null {
  return el instanceof Element ? null : (el as unknown as ServerAttribute);
}

export function attr(el: Element, name: string, accessor: () => unknown): void {
  const server = serverAttribute(el);
  if (server !== null) {
    createEffectUnlessStatic(() => {
      server.setAttribute(name, accessor());
    });
    return;
  }
  const svg = isSvgElement(el);
  let prev: unknown;
  let initialized = false;
  const apply = (): void => {
    const value = accessor();
    if (initialized && valuesEqual(value, prev)) {
      return;
    }
    initialized = true;
    prev = value;
    applyAttr(el, name, value, svg);
  };
  if (isHydrating()) {
    hydratedEffect(apply);
    return;
  }
  createRenderEffect(apply);
}

export function applyAttr(el: Element, name: string, value: unknown, svg: boolean): void {
  if (name === "class" || name === "className") {
    setClass(el, value);
    return;
  }
  if (name === "style") {
    if (typeof value === "object" && value !== null) {
      applyStyle(el, value, elementStyleState(el));
      return;
    }
    if (value === null || value === undefined) {
      applyStyle(el, value, elementStyleState(el));
      return;
    }
    el.setAttribute("style", stringOf(value));
    return;
  }
  if (!svg && propertyNames.has(name)) {
    applyProperty(el, name, value);
    return;
  }
  const target = svg ? svgAttributeTarget(name) : null;
  if (value === null || value === undefined || value === false) {
    if (target === null) {
      el.removeAttribute(name);
    } else {
      removeSvgAttribute(el, target);
    }
    return;
  }
  if (value === true) {
    const text = booleanNames.has(name) ? "" : "true";
    if (target === null) {
      el.setAttribute(name, text);
    } else {
      setSvgAttribute(el, target, text);
    }
    return;
  }
  const text = stringOf(value);
  if (target === null) {
    el.setAttribute(name, text);
  } else {
    setSvgAttribute(el, target, text);
  }
}

interface SvgAttributeTarget {
  readonly name: string;
  readonly namespace: string | null;
}

const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";
const SVG_ATTRIBUTE_NAMES: ReadonlyMap<string, string> = new Map([
  ["strokeWidth", "stroke-width"],
  ["strokeLinecap", "stroke-linecap"],
  ["strokeLinejoin", "stroke-linejoin"],
  ["strokeDasharray", "stroke-dasharray"],
  ["strokeDashoffset", "stroke-dashoffset"],
  ["strokeMiterlimit", "stroke-miterlimit"],
  ["strokeOpacity", "stroke-opacity"],
  ["fillOpacity", "fill-opacity"],
  ["fillRule", "fill-rule"],
  ["clipPath", "clip-path"],
  ["clipRule", "clip-rule"],
  ["stopColor", "stop-color"],
  ["stopOpacity", "stop-opacity"],
  ["gradientUnits", "gradient-units"],
  ["gradientTransform", "gradient-transform"],
  ["patternUnits", "pattern-units"],
  ["patternContentUnits", "pattern-content-units"],
  ["fontFamily", "font-family"],
  ["fontSize", "font-size"],
  ["fontWeight", "font-weight"],
  ["textAnchor", "text-anchor"],
  ["dominantBaseline", "dominant-baseline"],
  ["shapeRendering", "shape-rendering"],
  ["colorInterpolation", "color-interpolation"],
  ["markerUnits", "marker-units"],
  ["markerWidth", "marker-width"],
  ["markerHeight", "marker-height"],
  ["markerStart", "marker-start"],
  ["markerMid", "marker-mid"],
  ["markerEnd", "marker-end"],
]);

function svgAttributeTarget(name: string): SvgAttributeTarget {
  if (name.startsWith("xlink:")) {
    return { name, namespace: XLINK_NAMESPACE };
  }
  return { name: SVG_ATTRIBUTE_NAMES.get(name) ?? name, namespace: null };
}

function setSvgAttribute(el: Element, target: SvgAttributeTarget, value: string): void {
  if (target.namespace === null) {
    el.setAttribute(target.name, value);
    return;
  }
  el.setAttributeNS(target.namespace, target.name, value);
}

function removeSvgAttribute(el: Element, target: SvgAttributeTarget): void {
  if (target.namespace === null) {
    el.removeAttribute(target.name);
    return;
  }
  const separator = target.name.indexOf(":");
  const local = separator === -1 ? target.name : target.name.slice(separator + 1);
  el.removeAttributeNS(target.namespace, local);
}

function applyProperty(el: Element, name: string, value: unknown): void {
  const target = el as unknown as Record<string, unknown>;
  if (name === "value") {
    if (el.localName === "select" && isServerMode()) {
      return;
    }
    const empty = value === null || value === undefined;
    const next = empty ? "" : value;
    if (valuesEqual(target["value"], next) || String(target["value"]) === String(next)) {
      if (empty && el.hasAttribute(name)) {
        el.removeAttribute(name);
      }
      return;
    }
    target["value"] = next;
    if (empty) {
      el.removeAttribute(name);
      return;
    }
    if (el.localName === "select" && (el as unknown as HTMLSelectElement).options.length === 0) {
      queueMicrotask(() => {
        if (!valuesEqual(target["value"], next)) {
          target["value"] = next;
        }
      });
    }
    return;
  }
  const enabled = Boolean(value);
  if (target[name] !== enabled) {
    target[name] = enabled;
  }
  if (enabled !== el.hasAttribute(name)) {
    if (enabled) {
      el.setAttribute(name, "");
    } else {
      el.removeAttribute(name);
    }
  }
}

export function spread(el: Element, accessor: () => unknown): void {
  const server = serverAttribute(el);
  if (server !== null) {
    createEffectUnlessStatic(() => {
      const value = accessor();
      if (typeof value !== "object" || value === null) {
        return;
      }
      for (const [key, item] of Object.entries(value)) {
        if (
          key === "ref"
          || key === "children"
          || key === "key"
          || key === "innerHTML"
          || key === "dangerouslySetInnerHTML"
          || isEventName(key)
        ) {
          continue;
        }
        server.setAttribute(key, item);
      }
    });
    return;
  }
  const svg = isSvgElement(el);
  let prev: Record<string, unknown> | null = null;
  let prevKeys: readonly string[] | null = null;
  let currentRef: ((node: Element | null) => void) | null = null;

  const releaseRef = (): void => {
    const previous = currentRef;
    currentRef = null;
    if (previous !== null) {
      previous(null);
    }
  };

  const removeKey = (key: string): void => {
    if (key === "ref") {
      releaseRef();
      return;
    }
    if (key === "children" || key === "key") {
      return;
    }
    if (key === "style") {
      applyStyle(el, null, elementStyleState(el));
      return;
    }
    if (key === "innerHTML" || key === "dangerouslySetInnerHTML") {
      applyInnerHtml(el, null);
      return;
    }
    if (isEventName(key)) {
      removeListener(el, key);
      return;
    }
    applyAttr(el, key, undefined, svg);
  };

  createRenderEffect(() => {
    const value = accessor();
    if (typeof value !== "object" || value === null) {
      if (prevKeys !== null) {
        for (const key of prevKeys) {
          removeKey(key);
        }
      }
      prev = null;
      prevKeys = null;
      return;
    }
    const props = value as Record<string, unknown>;
    const keys = Object.keys(props);
    if (prev !== null && prevKeys !== null) {
      for (const key of prevKeys) {
        if (key in props) {
          continue;
        }
        removeKey(key);
      }
    }
    for (const key of keys) {
      const next = props[key];
      if (prev !== null && valuesEqual(prev[key], next)) {
        continue;
      }
      if (key === "ref") {
        const nextRef =
          typeof next === "function" ? (next as (node: Element | null) => void) : null;
        if (nextRef !== currentRef) {
          releaseRef();
          currentRef = nextRef;
          if (nextRef !== null) {
            nextRef(el);
          }
        }
        continue;
      }
      if (key === "children" || key === "key") {
        continue;
      }
      if (key === "innerHTML" || key === "dangerouslySetInnerHTML") {
        applyInnerHtml(el, next);
        continue;
      }
      if (isEventName(key)) {
        addListener(el, key, typeof next === "function" ? (next as EventListener) : null);
        continue;
      }
      if (key === "class" || key === "className") {
        setClass(el, next);
        continue;
      }
      if (key === "style") {
        applyStyle(el, next, elementStyleState(el));
        continue;
      }
      applyAttr(el, key, next, svg);
    }
    prev = props;
    prevKeys = keys;
  });

  onCleanup(releaseRef);
}

function applyInnerHtml(el: Element, value: unknown): void {
  let html = "";
  const resolved = resolveValue(value);
  if (resolved !== null && typeof resolved === "object") {
    const raw = resolveValue((resolved as { __html?: unknown }).__html);
    html = raw === null || raw === undefined ? "" : String(raw);
  } else if (resolved !== null && resolved !== undefined) {
    html = String(resolved);
  }
  for (const child of Array.from(el.childNodes)) {
    disposeNode(child);
  }
  (el as unknown as { innerHTML: string }).innerHTML = html;
}

export function innerHtml(el: Element, accessor: () => unknown): void {
  const server = serverAttribute(el);
  if (server !== null) {
    createEffectUnlessStatic(() => {
      server.setAttribute("innerHTML", accessor());
    });
    return;
  }
  let prev: unknown;
  let initialized = false;
  createRenderEffect(() => {
    const value = accessor();
    if (initialized && valuesEqual(value, prev)) {
      return;
    }
    initialized = true;
    prev = value;
    applyInnerHtml(el, value);
  });
}

export function prop(el: Element, name: string, accessor: () => unknown): void {
  const server = serverAttribute(el);
  if (server !== null) {
    createEffectUnlessStatic(() => {
      server.setAttribute(name, accessor());
    });
    return;
  }
  let prev: unknown;
  let initialized = false;
  createRenderEffect(() => {
    const value = accessor();
    if (initialized && valuesEqual(value, prev)) {
      return;
    }
    initialized = true;
    prev = value;
    (el as unknown as Record<string, unknown>)[name] = value;
  });
}

export function style(el: Element, accessor: () => unknown): void {
  const server = serverAttribute(el);
  if (server !== null) {
    createEffectUnlessStatic(() => {
      server.setAttribute("style", accessor());
    });
    return;
  }
  const state = createStyleState();
  createRenderEffect(() => {
    applyStyle(el, accessor(), state);
  });
}

function elementStyleState(el: Element): StyleState {
  let state = styleStates.get(el);
  if (state === undefined) {
    state = createStyleState();
    styleStates.set(el, state);
  }
  return state;
}

function applyStyle(el: Element, value: unknown, state: StyleState): void {
  const style = (el as HTMLElement).style;
  const applied = state.applied;
  const snapshot = state.snapshot;
  if (value === null || value === undefined) {
    for (const key of snapshot) {
      style.removeProperty(key);
    }
    snapshot.clear();
    applied.clear();
    return;
  }
  if (typeof value === "string") {
    const keys = new Set<string>();
    for (const [key, target] of parseStyleString(value)) {
      keys.add(key);
      if (target === "") {
        if (applied.get(key) !== "") {
          style.removeProperty(key);
          applied.delete(key);
        }
        snapshot.delete(key);
        continue;
      }
      if (applied.get(key) !== target) {
        style.setProperty(key, target);
        applied.set(key, target);
      }
      snapshot.add(key);
    }
    for (const key of snapshot) {
      if (!keys.has(key)) {
        style.removeProperty(key);
        snapshot.delete(key);
        applied.delete(key);
      }
    }
    return;
  }
  if (typeof value !== "object") {
    return;
  }
  const props = value as Record<string, string | number | null | undefined>;
  const keys = new Set<string>();
  for (const raw of Object.keys(props)) {
    const next = props[raw];
    const key = hyphen(raw);
    const target = next === null || next === undefined ? "" : String(next);
    keys.add(key);
    if (target === "") {
      if (applied.get(key) !== "") {
        style.removeProperty(key);
        applied.delete(key);
      }
      snapshot.delete(key);
      continue;
    }
    if (applied.get(key) !== target) {
      style.setProperty(key, target);
      applied.set(key, target);
    }
    snapshot.add(key);
  }
  for (const key of snapshot) {
    if (!keys.has(key)) {
      style.removeProperty(key);
      snapshot.delete(key);
      applied.delete(key);
    }
  }
}

function parseStyleString(value: string): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  let cursor = 0;
  while (cursor <= value.length) {
    const limit = value.indexOf(";", cursor);
    const entryEnd = limit === -1 ? value.length : limit;
    const separator = value.indexOf(":", cursor);
    const keyEnd = separator !== -1 && separator < entryEnd ? separator : entryEnd;
    const key = value.slice(cursor, keyEnd).trim();
    if (key !== "") {
      const target =
        separator !== -1 && separator < entryEnd
          ? value.slice(separator + 1, entryEnd).trim()
          : "";
      entries.push([key, target]);
    }
    if (limit === -1) {
      break;
    }
    cursor = limit + 1;
  }
  return entries;
}

export function hyphen(raw: string): string {
  const cached = hyphenCache.get(raw);
  if (cached !== undefined) {
    return cached;
  }
  let result: string;
  if (raw.includes("-")) {
    result = raw.toLowerCase();
  } else {
    result = "";
    for (const char of raw) {
      if (char >= "A" && char <= "Z") {
        result += "-" + char.toLowerCase();
        continue;
      }
      result += char;
    }
  }
  if (hyphenCache.size < AUX_CACHE_LIMIT) {
    hyphenCache.set(raw, result);
  }
  return result;
}

function createHolder(key: string, handler: EventListener | null): ListenerHolder {
  const holder: ListenerHolder = {
    current: typeof handler === "function" ? handler : null,
    wrapper: () => {},
    key,
  };
  const wrapper: EventListener = (event: Event) => {
    const current = holder.current;
    if (typeof current === "function") {
      current(event);
    }
  };
  holder.wrapper = wrapper;
  return holder;
}

function isEventName(name: string): boolean {
  if (name.startsWith("on:")) {
    return true;
  }
  if (name.length <= 2 || !name.startsWith("on")) {
    return false;
  }
  const code = name.charCodeAt(2);
  if (code >= 65 && code <= 90) {
    return true;
  }
  const rest = name.slice(2).toLowerCase();
  return DOM_EVENT_NAMES.has(DOM_EVENT_ALIASES.get(rest) ?? rest);
}

export function parseEventName(name: string): { event: string; capture: boolean } {
  const parsed = resolveEventName(name);
  return { event: parsed.event, capture: parsed.capture };
}

function resolveEventName(name: string): ParsedEvent {
  const cached = eventNameCache.get(name);
  if (cached !== undefined) {
    return cached;
  }
  const parsed = buildEventName(name);
  if (eventNameCache.size < AUX_CACHE_LIMIT) {
    eventNameCache.set(name, parsed);
  }
  return parsed;
}

const DOM_EVENT_NAMES: ReadonlySet<string> = new Set([
  "animationcancel",
  "animationend",
  "animationiteration",
  "animationstart",
  "auxclick",
  "beforeinput",
  "blur",
  "change",
  "click",
  "compositionend",
  "compositionstart",
  "compositionupdate",
  "contextmenu",
  "copy",
  "cut",
  "dblclick",
  "drag",
  "dragend",
  "dragenter",
  "dragleave",
  "dragover",
  "dragstart",
  "drop",
  "focus",
  "focusin",
  "focusout",
  "gotpointercapture",
  "input",
  "invalid",
  "keydown",
  "keypress",
  "keyup",
  "lostpointercapture",
  "mousedown",
  "mouseenter",
  "mouseleave",
  "mousemove",
  "mouseout",
  "mouseover",
  "mouseup",
  "paste",
  "pointercancel",
  "pointerdown",
  "pointerenter",
  "pointerleave",
  "pointermove",
  "pointerout",
  "pointerover",
  "pointerup",
  "reset",
  "resize",
  "scroll",
  "select",
  "submit",
  "touchend",
  "touchmove",
  "touchstart",
  "touchcancel",
  "transitioncancel",
  "transitionend",
  "transitionrun",
  "transitionstart",
  "wheel",
]);

const DOM_EVENT_ALIASES: ReadonlyMap<string, string> = new Map([
  ["doubleclick", "dblclick"],
]);

function buildEventName(name: string): ParsedEvent {
  if (name.startsWith("on:")) {
    const raw = name.slice(3);
    const capture = raw.endsWith(":capture");
    const event = capture ? raw.slice(0, -8) : raw;
    if (event.length === 0) {
      throw new Error(`Некорректное имя события: "${name}"`);
    }
    return { event, capture, key: (capture ? "c:" : "e:") + event };
  }
  if (name.length > 2 && name.startsWith("on") && isUpperCode(name.charCodeAt(2))) {
    let event = name.slice(2);
    let capture = false;
    if (event.length > 7 && event.endsWith("Capture")) {
      event = event.slice(0, -7);
      capture = true;
    }
    if (event.length === 0) {
      throw new Error(`Некорректное имя события: "${name}"`);
    }
    const lower = event.toLowerCase();
    const canonical = DOM_EVENT_ALIASES.get(lower) ?? lower;
    if (!DOM_EVENT_NAMES.has(canonical)) {
      throw new Error(
        `Неизвестное событие "${name}". Для пользовательского события используйте "on:${lower}"`,
      );
    }
    return { event: canonical, capture, key: (capture ? "c:" : "e:") + canonical };
  }
  if (name.length > 2 && name.startsWith("on")) {
    const rest = name.slice(2).toLowerCase();
    const aliased = DOM_EVENT_ALIASES.get(rest) ?? rest;
    if (DOM_EVENT_NAMES.has(aliased) || rest.includes("-")) {
      return { event: aliased, capture: false, key: "e:" + aliased };
    }
  }
  let event = name;
  let capture = false;
  if (event.length > 7 && event.endsWith("Capture")) {
    event = event.slice(0, -7);
    capture = true;
  }
  const lower = event.toLowerCase();
  const canonical = DOM_EVENT_ALIASES.get(lower) ?? lower;
  if (!EVENT_NAME.test(canonical)) {
    throw new Error(`Некорректное имя события: "${name}"`);
  }
  return { event: canonical, capture, key: (capture ? "c:" : "e:") + canonical };
}

function isUpperCode(code: number): boolean {
  return code >= 65 && code <= 90;
}

const EVENT_NAME = /^[a-z][a-z0-9-]*$/;

function ensureDelegated(event: string, key: string): void {
  if (delegatedInstalled.has(key)) {
    return;
  }
  delegatedInstalled.add(key);
  document.addEventListener(event, (nativeEvent: Event) => dispatchDelegated(nativeEvent, key));
}

function dispatchDelegated(event: Event, key: string): void {
  let node = event.target as Node | null;
  try {
    while (node !== null) {
      if (node instanceof Element) {
        const entry = listenerRegistry.get(node);
        const holder =
          entry instanceof Map
            ? entry.get(key)
            : entry !== undefined && entry.key === key
              ? entry
              : undefined;
        if (holder !== undefined) {
          const handler = holder.current;
          if (typeof handler === "function") {
            Reflect.defineProperty(event, "currentTarget", {
              configurable: true,
              value: node,
            });
            try {
              handler.call(node, event);
            } catch {}
            if (event.cancelBubble) {
              return;
            }
          }
        }
      }
      node = node.parentNode;
    }
  } finally {
    Reflect.deleteProperty(event, "currentTarget");
  }
}

export function addListener(el: Element, name: string, handler: EventListener | null): void {
  const { event, capture, key } = resolveEventName(name);
  const delegated =
    !capture
    && typeof document !== "undefined"
    && !isServerMode()
    && DELEGATED_EVENTS.test(event)
    && (el.ownerDocument === document || el.ownerDocument.defaultView === null);
  const existing = listenerRegistry.get(el);
  if (existing === undefined) {
    const holder = createHolder(key, handler);
    listenerRegistry.set(el, holder);
    if (delegated) {
      ensureDelegated(event, key);
    } else {
      el.addEventListener(event, holder.wrapper, capture);
    }
    return;
  }
  if (existing instanceof Map) {
    const registered = existing.get(key);
    if (registered !== undefined) {
      registered.current = typeof handler === "function" ? handler : null;
      return;
    }
    const holder = createHolder(key, handler);
    existing.set(key, holder);
    if (delegated) {
      ensureDelegated(event, key);
    } else {
      el.addEventListener(event, holder.wrapper, capture);
    }
    return;
  }
  if (existing.key === key) {
    existing.current = typeof handler === "function" ? handler : null;
    return;
  }
  const holder = createHolder(key, handler);
  const holders = new Map<string, ListenerHolder>();
  holders.set(existing.key, existing);
  holders.set(key, holder);
  listenerRegistry.set(el, holders);
  if (delegated) {
    ensureDelegated(event, key);
  } else {
    el.addEventListener(event, holder.wrapper, capture);
  }
}

export function removeListener(el: Element, name: string): void {
  const { event, capture, key } = resolveEventName(name);
  const holders = listenerRegistry.get(el);
  if (holders === undefined) {
    return;
  }
  if (holders instanceof Map) {
    const registered = holders.get(key);
    if (registered === undefined) {
      return;
    }
    holders.delete(key);
    registered.current = null;
    el.removeEventListener(event, registered.wrapper, capture);
    return;
  }
  if (holders.key !== key) {
    return;
  }
  listenerRegistry.delete(el);
  holders.current = null;
  el.removeEventListener(event, holders.wrapper, capture);
}

export function on(el: Element, name: string, accessor: () => unknown): void {
  if (!(el instanceof Element)) {
    return;
  }
  createRenderEffect(() => {
    const value = accessor();
    addListener(el, name, typeof value === "function" ? (value as EventListener) : null);
  });
}

export function ref(el: Element, accessor: () => unknown): void {
  let current: ((node: Element | null) => void) | null = null;

  const release = (): void => {
    const previous = current;
    current = null;
    if (previous !== null) {
      previous(null);
    }
  };

  createRenderEffect(() => {
    const value = accessor();
    const next = typeof value === "function" ? (value as (node: Element | null) => void) : null;
    if (next === current) {
      return;
    }
    release();
    current = next;
    if (next !== null) {
      next(el);
    }
  });

  onCleanup(release);
}

export function effect(fn: () => void): void {
  createRenderEffect(fn);
}

export function fragment(accessor: () => unknown): Node {
  if (isHydrating()) {
    const outer = currentWindow();
    if (outer === null) {
      return mismatch("fragment вне окна гидрации");
    }
    const anchor = outer.end.previousSibling;
    if (!isMarker(anchor, FRAGMENT)) {
      return mismatch("не найден якорь fragment");
    }
    const window = beginRegion(outer, anchor);
    let initialized = false;
    createRenderEffect(() => {
      if (!initialized) {
        initialized = true;
        const value = withWindow(window, accessor);
        settleNodes(anchor, value);
        if (!regionMatches(window, anchor, value)) {
          mismatch("содержимое fragment не совпало");
        }
        settleWindow(outer, anchor);
        return;
      }
      writeRegion(window.start, window.end, accessor());
    });
    return document.createDocumentFragment();
  }
  const container = document.createDocumentFragment();
  const anchor = document.createComment("silent-fragment");
  container.appendChild(anchor);
  const mount = createMountPoint(container, anchor);
  createRenderEffect(() => mount.render(accessor()));
  return container;
}

export function dynamic(tag: () => string, props: Record<string, unknown>): Node {
  const element = createElement(tag());
  applyProps(element, props);
  return element;
}

export function createElement(tag: string): Element {
  if (SVG_TAG.test(tag)) {
    return document.createElementNS("http://www.w3.org/2000/svg", tag);
  }
  return document.createElement(tag);
}

export function applyProps(el: Element, props: Record<string, unknown> | undefined): void {
  if (props === undefined) {
    return;
  }
  const svg = isSvgElement(el);
  const children = props["children"];
  for (const key of Object.keys(props)) {
    const value = props[key];
    if (key === "children" || key === "key") {
      continue;
    }
    if (key === "ref") {
      applyElementRef(el, value);
      continue;
    }
    if (key === "innerHTML" || key === "dangerouslySetInnerHTML") {
      applyInnerHtml(el, value);
      continue;
    }
    if (isEventName(key)) {
      on(el, key, () => value);
      continue;
    }
    if (typeof value === "function") {
      if (key === "style") {
        style(el, value as () => unknown);
        continue;
      }
      if (key === "class" || key === "className") {
        attr(el, key, value as () => unknown);
        continue;
      }
      attr(el, key, value as () => unknown);
      continue;
    }
    if (key === "style") {
      style(el, () => value);
      continue;
    }
    applyAttr(el, key, value, svg);
  }
  if (children !== undefined) {
    if (typeof children === "function") {
      insert(el, children as () => unknown);
      return;
    }
    for (const node of collectNodes(children as Child)) {
      el.appendChild(node);
    }
  }
}

function applyElementRef(el: Element, value: unknown): void {
  if (typeof value !== "function") {
    return;
  }
  const callback = value as (node: Element | null) => void;
  callback(el);
  onCleanup(() => callback(null));
}
