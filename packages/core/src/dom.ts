import type { Child, Children } from "./jsx.js";
import { createRenderEffect, onCleanup, untrack } from "@ivlev-dev/silent-reactivity";
import {
  normalizeClass,
  normalizeStyle,
  styleDeclarations,
  type ClassNameValue,
  type StyleInput,
} from "./class-style.js";
import { createEffectUnlessStatic } from "./static-effect.js";
import {
  isEventAttributeName,
  isSafeAttributeName,
  isSafeUrlAttributeValue,
  isUrlAttributeName,
  isValidAttributeName,
} from "./attribute-name.js";
import { extractMetadata, isMetadataElement, markMetadataFree } from "./metadata.js";
import { getErrorHandler } from "./component-state.js";
import { emitDevtoolsError } from "./devtools-events.js";
import { isValidTagName } from "./safety.js";
import type { AnyComponent } from "./types.js";
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
  mergeTopLevelMetadata,
  mismatch,
  shapeMatches,
  withWindow,
} from "./hydration-proxy.js";
import {
  getDomHydrationRuntime,
  hydratedEffect,
  insertHydrated,
  isStaticHydration,
  settleNodes,
  writeRegion,
  staticAttrMatches,
} from "./dom-hydration-state.js";
import {
  beginRegion,
  regionMatches,
  settleWindow,
} from "./hydration-cursor.js";
import { resolvePath } from "./plan-paths.js";
import { getRuntimeContextStore } from "./runtime-context-provider.js";


declare const __SILENT_HYDRATE__: boolean | undefined;

const HYDRATE =
  typeof __SILENT_HYDRATE__ === "undefined" || __SILENT_HYDRATE__;
export const NODE_DISPOSER = Symbol("silent.disposer");
const ITEM_DISPOSER = Symbol("silent.itemDisposer");
export const ITEM_STATE = Symbol("silent.itemState");

type DisposerHost = Node & { [NODE_DISPOSER]?: () => void };
type ItemDisposerHost = Node & { [ITEM_DISPOSER]?: () => void };

export interface DisposableItemState {
  dispose(): void;
}

export type ItemStateHost = Node & { [ITEM_STATE]?: DisposableItemState };

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

export interface TemplatePlan {
  readonly roots: number;
  readonly holes: readonly PartPath[];
  readonly attrs: readonly PartPath[];
  readonly strips: readonly StripPlan[];
}

export type TemplateNamespace = "svg";

export { resolvePath };

export interface TemplateParse {
  readonly content: DocumentFragment;
  readonly rootCount: number;
  readonly singleRoot: Node | null;
  readonly metadata: boolean;
  readonly simple: boolean;
}

interface ParsedEvent {
  readonly event: string;
  readonly capture: boolean;
  readonly key: string;
}

const parseCache = new WeakMap<Document, Map<string, TemplateParse>>();
const METADATA_PATTERN = /<(?:title|meta|link)[\s/>]/i;
const listenerRegistry = new WeakMap<Element, ListenerHolder | Map<string, ListenerHolder>>();
const delegatedInstalled = new Set<string>();
const DELEGATED_EVENTS =
  /^(?:change|click|contextmenu|dblclick|input|keydown|keyup|mousedown|mouseup|pointerdown|pointerup|submit|touchend|touchstart)$/;
const hyphenCache = new Map<string, string>();
const eventNameCache = new Map<string, ParsedEvent>();

interface ClassState {
  readonly values: Map<object, string>;
  applied: string | null;
}

interface StyleSlot {
  declarations: Map<string, string>;
  value: unknown;
  hasValue: boolean;
}

interface StyleRegistry {
  readonly slots: Map<object, StyleSlot>;
  readonly applied: Map<string, string>;
}

const classStates = new WeakMap<Element, ClassState>();
const styleRegistries = new WeakMap<Element, StyleRegistry>();
const STATIC_CLASS_TOKEN: object = {};
const STATIC_STYLE_TOKEN: object = {};

function classStateFor(el: Element): ClassState {
  let state = classStates.get(el);
  if (state === undefined) {
    state = { values: new Map<object, string>(), applied: null };
    classStates.set(el, state);
  }
  return state;
}

function styleRegistryFor(el: Element): StyleRegistry {
  let registry = styleRegistries.get(el);
  if (registry === undefined) {
    registry = { slots: new Map<object, StyleSlot>(), applied: new Map<string, string>() };
    styleRegistries.set(el, registry);
  }
  return registry;
}

function mergedClass(state: ClassState): string {
  const names = new Set<string>();
  for (const value of state.values.values()) {
    if (value === "") {
      continue;
    }
    for (const name of value.split(/\s+/)) {
      if (name !== "") {
        names.add(name);
      }
    }
  }
  return [...names].join(" ");
}

function writeClass(el: Element, value: string): void {
  if (value === "") {
    el.removeAttribute("class");
    return;
  }
  el.setAttribute("class", value);
}

function recomputeClass(el: Element, state: ClassState): void {
  const next = mergedClass(state);
  if (next === state.applied) {
    return;
  }
  state.applied = next;
  writeClass(el, next);
}

export function applyClass(
  el: Element,
  value: unknown,
  token: object = STATIC_CLASS_TOKEN,
): void {
  const state = classStateFor(el);
  const next = normalizeClass(value as ClassNameValue);
  if (state.values.has(token) && state.values.get(token) === next) {
    return;
  }
  state.values.set(token, next);
  recomputeClass(el, state);
}

export function releaseClass(el: Element, token: object): void {
  const state = classStates.get(el);
  if (state === undefined || !state.values.delete(token)) {
    return;
  }
  recomputeClass(el, state);
}

function mergedStyle(registry: StyleRegistry): Map<string, string> {
  const merged = new Map<string, string>();
  for (const slot of registry.slots.values()) {
    for (const [property, value] of slot.declarations) {
      merged.set(property, value);
    }
  }
  return merged;
}

function recomputeStyle(el: Element, registry: StyleRegistry): void {
  const style = (el as HTMLElement).style;
  const merged = mergedStyle(registry);
  const applied = registry.applied;
  for (const [property, value] of merged) {
    if (applied.get(property) !== value) {
      style.setProperty(property, value);
    }
  }
  for (const property of applied.keys()) {
    if (!merged.has(property)) {
      style.removeProperty(property);
    }
  }
  applied.clear();
  for (const [property, value] of merged) {
    applied.set(property, value);
  }
}

export function applyStyle(
  el: Element,
  value: unknown,
  token: object = STATIC_STYLE_TOKEN,
): void {
  const registry = styleRegistryFor(el);
  let slot = registry.slots.get(token);
  if (slot === undefined) {
    slot = { declarations: new Map<string, string>(), value: undefined, hasValue: false };
    registry.slots.set(token, slot);
  } else if (slot.hasValue && Object.is(slot.value, value)) {
    // Тот же объект стилей: декларации не изменились, пересборка Map не нужна.
    return;
  }
  slot.value = value;
  slot.hasValue = true;
  slot.declarations = styleDeclarations(value as StyleInput);
  recomputeStyle(el, registry);
}

export function releaseStyle(el: Element, token: object): void {
  const registry = styleRegistries.get(el);
  if (registry === undefined || !registry.slots.delete(token)) {
    return;
  }
  recomputeStyle(el, registry);
}

function styleTarget(value: unknown): value is Element {
  return (
    typeof value === "object"
    && value !== null
    && typeof (value as { setAttribute?: unknown }).setAttribute === "function"
  );
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
  // serverMode выставляется на весь сериализованный рендер (begin/cleanup),
  // поэтому в SSR это первая и единственная проверка: без похода в async-контекст.
  if (serverMode) {
    return true;
  }
  const store = getRuntimeContextStore();
  return store !== null && store.server;
}

export const propertyNames = new Set<string>(["value", "checked", "selected", "disabled", "indeterminate"]);

/** `aria-*` и `data-*` сериализуют `false` как строку `"false"`. */
function isStringBooleanAttribute(name: string): boolean {
  const normalized = name.toLowerCase();
  return normalized.startsWith("aria-") || normalized.startsWith("data-");
}

export const booleanNames = new Set<string>([
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

export function valuesEqual(a: unknown, b: unknown): boolean {
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

export function attachItemState(node: Node, state: DisposableItemState): void {
  (node as ItemStateHost)[ITEM_STATE] = state;
}

export function clearItemDisposer(node: Node): void {
  delete (node as ItemDisposerHost)[ITEM_DISPOSER];
  delete (node as ItemStateHost)[ITEM_STATE];
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

let disposeDepth = 0;
let disposeFlushers: Array<() => void> = [];

/**
 * Выполняет отложенную работу сразу вне каскада disposeNode, иначе — один
 * раз после завершения внешнего вызова. Нужен для батч-переиндексации
 * списков при массовом удалении строк.
 */
export function deferDisposeFlush(flush: () => void): void {
  if (disposeDepth === 0) {
    flush();
    return;
  }
  disposeFlushers.push(flush);
}

export function isDisposing(): boolean {
  return disposeDepth > 0;
}

function runDisposeFlushers(): void {
  if (disposeFlushers.length === 0) {
    return;
  }
  const pending = disposeFlushers;
  disposeFlushers = [];
  for (const flush of pending) {
    flush();
  }
}

export function withDisposeBatch<T>(fn: () => T): T {
  disposeDepth += 1;
  try {
    return fn();
  } finally {
    disposeDepth -= 1;
    if (disposeDepth === 0) {
      runDisposeFlushers();
    }
  }
}

function disposeNodeInner(node: Node): void {
  const state = (node as ItemStateHost)[ITEM_STATE];
  if (state !== undefined) {
    state.dispose();
    return;
  }
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

export function disposeNode(node: Node): void {
  disposeDepth += 1;
  try {
    disposeNodeInner(node);
  } finally {
    disposeDepth -= 1;
    if (disposeDepth === 0) {
      runDisposeFlushers();
    }
  }
}

export function disposeTree(nodes: readonly Node[]): void {
  withDisposeBatch(() => {
    for (const node of nodes) {
      disposeNode(node);
    }
  });
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
    if (marker.parentNode !== target) {
      target.appendChild(marker);
    }
    target.insertBefore(node, marker);
  };

  const clear = (): void => {
    withDisposeBatch(() => {
      for (const node of nodes) {
        disposeNode(node);
        detach(node);
      }
    });
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
  let cache = parseCache.get(document);
  if (cache === undefined) {
    cache = new Map<string, TemplateParse>();
    parseCache.set(document, cache);
  }
  const cached = cache.get(key);
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
  };
  cache.set(key, parsed);
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
    if (!HYDRATE || !isHydrating()) {
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

const EMPTY_HOLES: readonly (Comment | ServerHole)[] = [];
const EMPTY_ATTRS: readonly Element[] = [];

export interface TemplateHydrationSource {
  readonly providedPlan: TemplatePlan | undefined;
  readonly parse: () => TemplateParse;
  readonly cloneNode: () => Node;
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

function adoptMountParts(
  root: Node,
  plan: TemplatePlan,
): { holes: Comment[]; attrs: Element[] } | null {
  if (isServerMode()) {
    return null;
  }
  const holes = new Array<Comment>(plan.holes.length);
  const attrs = new Array<Element>(plan.attrs.length);
  for (let index = 0; index < plan.holes.length; index += 1) {
    const entry = plan.holes[index];
    if (entry === undefined) {
      return null;
    }
    const node = resolvePath(root, entry, true);
    if (node === null || node.nodeType !== Node.COMMENT_NODE) {
      return null;
    }
    const data = (node as Comment).data;
    if (
      entry.key !== undefined
        ? data !== entry.key
        : markerIndex(data, HOLE_MARKER) !== index
    ) {
      return null;
    }
    holes[index] = node as Comment;
  }
  for (let index = 0; index < plan.attrs.length; index += 1) {
    const entry = plan.attrs[index];
    if (entry === undefined) {
      return null;
    }
    const node = resolvePath(root, entry, true);
    if (node === null || node.nodeType !== Node.ELEMENT_NODE) {
      return null;
    }
    const element = node as Element;
    if (!element.hasAttribute(entry.key ?? (ATTR_MARKER + index))) {
      return null;
    }
    attrs[index] = element;
  }
  const strips = plan.strips ?? [];
  for (let index = 0; index < strips.length; index += 1) {
    const entry = strips[index];
    if (entry === undefined) {
      return null;
    }
    const node = resolvePath(root, entry, true);
    if (node === null || node.nodeType !== Node.ELEMENT_NODE) {
      return null;
    }
  }
  for (let index = 0; index < attrs.length; index += 1) {
    attrs[index]?.removeAttribute(plan.attrs[index]?.key ?? (ATTR_MARKER + index));
  }
  for (const entry of strips) {
    const element = resolvePath(root, entry, true) as Element;
    for (const name of entry.names) {
      element.removeAttribute(name);
    }
  }
  return { holes, attrs };
}

export function templateHoles(
  html: string,
  plan?: TemplatePlan | false,
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

function createClientTemplateHoles(
  html: string,
  providedPlan?: TemplatePlan | false,
  namespace?: TemplateNamespace,
): () => TemplateClone {
  let parsed: TemplateParse | null = null;
  const staticParts =
    providedPlan === false
    || (providedPlan !== undefined
      && providedPlan.holes.length === 0
      && providedPlan.attrs.length === 0
      && providedPlan.strips.length === 0);
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
    const single = clone.firstChild;
    if (clone.childNodes.length !== 1 || single === null) {
      return clone;
    }
    return single.nodeType === Node.COMMENT_NODE
      && markerIndex((single as Comment).data, HOLE_MARKER) !== null
      ? clone
      : single;
  };
  const create = (): TemplateClone => {
    const node = mark(cloneNode());
    if (staticParts) {
      return { node, holes: EMPTY_HOLES, attrs: EMPTY_ATTRS };
    }
    if (providedPlan !== undefined) {
      const adopted = adoptMountParts(node, providedPlan);
      if (adopted !== null) {
        return { node, ...adopted };
      }
    }
    return { node, ...collectPartsMany([node]) };
  };
  const source: TemplateHydrationSource = {
    providedPlan: providedPlan === false ? undefined : providedPlan,
    parse,
    cloneNode,
  };
  return () => {
    if (HYDRATE && isHydrating()) {
      return getDomHydrationRuntime().hydrateTemplate(source);
    }
    return create();
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
  if (SERVER && isServerHole(marker)) {
    const value = accessor();
    if (!setServerHoleValue(marker, value)) {
      marker.set(
        `<!--${INSERT_START}-->${serializeServerValue(value)}<!--${INSERT_END}-->`,
      );
    }
    return;
  }
  const nodeMarker: Node | null = (marker as Node | null | undefined) ?? null;
  if (SERVER && isServerMode()) {
    insertServer(parent, accessor, nodeMarker);
    return;
  }
  if (HYDRATE && isHydrating()) {
    insertHydrated(parent, accessor, nodeMarker);
    return;
  }
  const mount = createMountPoint(parent, nodeMarker);
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
  if (HYDRATE && isHydrating()) {
    if (isStaticHydration()) {
      if (node.data !== stringOf(accessor())) {
        mismatch("текстовый узел не совпал с серверной разметкой");
      }
      return;
    }
    hydratedEffect(apply);
    return;
  }
  createRenderEffect(apply);
}

function isSvgElement(el: Element): boolean {
  return el instanceof SVGElement;
}

interface ServerAttribute {
  setAttribute(name: string, value: unknown): void;
  removeAttribute?(name: string): void;
}

function serverAttribute(el: Element): ServerAttribute | null {
  return el instanceof Element ? null : (el as unknown as ServerAttribute);
}

function removeServerAttribute(server: ServerAttribute, name: string): void {
  if (typeof server.removeAttribute === "function") {
    server.removeAttribute(name);
    return;
  }
  server.setAttribute(name, "");
}

function applyServerClass(server: ServerAttribute, value: unknown): void {
  const next = normalizeClass(value as ClassNameValue);
  if (next === "") {
    removeServerAttribute(server, "class");
    return;
  }
  server.setAttribute("class", next);
}

function applyServerStyle(server: ServerAttribute, value: unknown): void {
  if (value === null || value === undefined || value === false) {
    removeServerAttribute(server, "style");
    return;
  }
  if (typeof value === "string") {
    if (value === "") {
      removeServerAttribute(server, "style");
      return;
    }
    server.setAttribute("style", value);
    return;
  }
  if (typeof value !== "object") {
    server.setAttribute("style", String(value));
    return;
  }
  const declarations = styleDeclarations(value as StyleInput);
  if (declarations.size === 0) {
    removeServerAttribute(server, "style");
    return;
  }
  const record: Record<string, string> = {};
  for (const [property, target] of declarations) {
    record[property] = target;
  }
  server.setAttribute("style", record);
}

export function attr(el: Element, name: string, accessor: () => unknown): void {
  if (!isSafeAttributeName(name)) {
    return;
  }
  const server = serverAttribute(el);
  if (server !== null) {
    createEffectUnlessStatic(() => {
      const value = accessor();
      if (name === "class" || name === "className") {
        applyServerClass(server, value);
        return;
      }
      if (name === "style") {
        applyServerStyle(server, value);
        return;
      }
      if (isUrlAttributeName(name) && !isSafeUrlAttributeValue(name, stringOf(value))) {
        removeServerAttribute(server, name);
        return;
      }
      if (value === false) {
        if (isStringBooleanAttribute(name)) {
          server.setAttribute(name, "false");
          return;
        }
        if (propertyNames.has(name)) {
          server.setAttribute(name, value);
          return;
        }
        removeServerAttribute(server, name);
        return;
      }
      if (value === true) {
        if (booleanNames.has(name)) {
          server.setAttribute(name, "");
          return;
        }
        if (propertyNames.has(name)) {
          server.setAttribute(name, value);
          return;
        }
        server.setAttribute(name, "true");
        return;
      }
      server.setAttribute(name, value);
    });
    return;
  }
  const svg = isSvgElement(el);
  const classToken: object = {};
  const styleToken: object = {};
  let prev: unknown;
  let initialized = false;
  const apply = (): void => {
    const value = accessor();
    if (initialized && valuesEqual(value, prev)) {
      return;
    }
    initialized = true;
    prev = value;
    if (name === "class" || name === "className") {
      applyClass(el, value, classToken);
      return;
    }
    if (name === "style") {
      applyStyle(el, value, styleToken);
      return;
    }
    applyAttr(el, name, value, svg);
  };
  if (HYDRATE && isHydrating()) {
    if (isStaticHydration()) {
      if (!staticAttrMatches(el, name, accessor(), svg)) {
        mismatch("значение атрибута не совпало с серверной разметкой");
      }
      return;
    }
    hydratedEffect(apply);
  } else {
    createRenderEffect(apply);
  }
  onCleanup(() => {
    if (name === "class" || name === "className") {
      releaseClass(el, classToken);
      return;
    }
    if (name === "style") {
      releaseStyle(el, styleToken);
    }
  });
}

export function applyAttr(el: Element, name: string, value: unknown, svg: boolean): void {
  if (!isSafeAttributeName(name)) {
    return;
  }
  const server = serverAttribute(el);
  if (name === "class" || name === "className") {
    if (server !== null) {
      applyServerClass(server, value);
      return;
    }
    applyClass(el, value);
    return;
  }
  if (name === "style") {
    if (server !== null) {
      applyServerStyle(server, value);
      return;
    }
    applyStyle(el, value);
    return;
  }
  if (!svg && propertyNames.has(name)) {
    applyProperty(el, name, value);
    return;
  }
  const target = svg ? svgAttributeTarget(name) : null;
  if (isUrlAttributeName(name) && !isSafeUrlAttributeValue(name, stringOf(value))) {
    if (target === null) {
      el.removeAttribute(name);
    } else {
      removeSvgAttribute(el, target);
    }
    return;
  }
  if (value === null || value === undefined || value === false) {
    if (value === false && isStringBooleanAttribute(name)) {
      const text = "false";
      if (target === null) {
        el.setAttribute(name, text);
      } else {
        setSvgAttribute(el, target, text);
      }
      return;
    }
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

export interface SvgAttributeTarget {
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
  ["fontFamily", "font-family"],
  ["fontSize", "font-size"],
  ["fontWeight", "font-weight"],
  ["textAnchor", "text-anchor"],
  ["dominantBaseline", "dominant-baseline"],
  ["shapeRendering", "shape-rendering"],
  ["colorInterpolation", "color-interpolation"],
  ["markerStart", "marker-start"],
  ["markerMid", "marker-mid"],
  ["markerEnd", "marker-end"],
]);

export function svgAttributeTarget(name: string): SvgAttributeTarget {
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

export function applyProperty(el: Element, name: string, value: unknown): void {
  const target = el as unknown as Record<string, unknown>;
  if (name === "indeterminate") {
    const enabled = value === "mixed" || Boolean(value);
    if (target["indeterminate"] !== enabled) {
      target["indeterminate"] = enabled;
    }
    return;
  }
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
          || key === "bindValue"
          || key === "bindChecked"
          || key === "innerHTML"
          || key === "dangerouslySetInnerHTML"
          || isEventAttributeName(key)
          || !isValidAttributeName(key)
        ) {
          continue;
        }
        if (key === "class" || key === "className") {
          applyServerClass(server, item);
          continue;
        }
        if (key === "style") {
          applyServerStyle(server, item);
          continue;
        }
        server.setAttribute(key, item);
      }
    });
    return;
  }
  const svg = isSvgElement(el);
  const classToken: object = {};
  const styleToken: object = {};
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
    if (key === "children" || key === "key" || key === "bindValue" || key === "bindChecked") {
      return;
    }
    if (key === "class" || key === "className") {
      applyClass(el, null, classToken);
      return;
    }
    if (key === "style") {
      applyStyle(el, null, styleToken);
      return;
    }
    if (key === "innerHTML" || key === "dangerouslySetInnerHTML") {
      applyInnerHtml(el, null);
      return;
    }
    if (isEventAttributeName(key)) {
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
      if (key === "children" || key === "key" || key === "bindValue" || key === "bindChecked") {
        continue;
      }
      if (key === "innerHTML" || key === "dangerouslySetInnerHTML") {
        applyInnerHtml(el, next);
        continue;
      }
      if (isEventAttributeName(key)) {
        if (tryResolveEventName(key) === null) {
          continue;
        }
        addListener(el, key, typeof next === "function" ? (next as EventListener) : null);
        continue;
      }
      if (!isValidAttributeName(key)) {
        continue;
      }
      if (key === "class" || key === "className") {
        applyClass(el, next, classToken);
        continue;
      }
      if (key === "style") {
        applyStyle(el, next, styleToken);
        continue;
      }
      applyAttr(el, key, next, svg);
    }
    prev = props;
    prevKeys = keys;
  });

  onCleanup(releaseRef);
  onCleanup(() => {
    releaseClass(el, classToken);
    releaseStyle(el, styleToken);
  });
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

export type BindAccessor<T = unknown> = () => T;

export type BindSetter<T = unknown> = (value: T) => void;

const MISSING = Symbol("silent.missing");

type ValueControl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

type NormalizedValue = string | readonly string[];

interface ValueBinding {
  read: BindAccessor<unknown> | null;
  setter: BindSetter<unknown> | null;
  applied: NormalizedValue | typeof MISSING;
  initialized: boolean;
  writing: boolean;
  composing: boolean;
  deferred: unknown;
  hasDeferred: boolean;
  pending: NormalizedValue | null;
  observer: MutationObserver | null;
  detached: boolean;
}

interface CheckBinding {
  read: BindAccessor<unknown> | null;
  setter: BindSetter<unknown> | null;
  checked: boolean | typeof MISSING;
  mixed: boolean;
  initialized: boolean;
  writing: boolean;
  detached: boolean;
}

const valueBindings = new WeakMap<Element, ValueBinding>();
const checkBindings = new WeakMap<Element, CheckBinding>();

function isTextControl(el: ValueControl): boolean {
  if (el.localName === "textarea") {
    return true;
  }
  if (el.localName !== "input") {
    return false;
  }
  const type = (el as HTMLInputElement).type;
  return type !== "checkbox" && type !== "radio" && type !== "file" && type !== "hidden";
}

function supportsSelection(el: ValueControl): boolean {
  try {
    return (
      el.localName === "textarea"
      || (el.localName === "input" && (el as HTMLInputElement).selectionStart !== null)
    );
  } catch {
    return false;
  }
}

function normalizeText(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (Array.isArray(value)) {
    return value.length === 0 ? "" : String(value[0]);
  }
  return String(value);
}

function normalizeList(value: unknown): readonly string[] {
  if (value === null || value === undefined) {
    return [];
  }
  if (Array.isArray(value)) {
    const out: string[] = [];
    for (const item of value) {
      if (item !== null && item !== undefined) {
        out.push(String(item));
      }
    }
    return out;
  }
  if (typeof (value as Iterable<unknown>)[Symbol.iterator] === "function") {
    const out: string[] = [];
    for (const item of value as Iterable<unknown>) {
      if (item !== null && item !== undefined) {
        out.push(String(item));
      }
    }
    return out;
  }
  return [String(value)];
}

function sameNormalized(a: NormalizedValue, b: NormalizedValue): boolean {
  if (typeof a === "string" || typeof b === "string") {
    return a === b;
  }
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return false;
    }
  }
  return true;
}

function writeValue(control: ValueControl, value: NormalizedValue): void {
  if (control.localName === "select") {
    const select = control as HTMLSelectElement;
    if (select.multiple && typeof value !== "string") {
      const wanted = new Set(value);
      const options = Array.from(select.options);
      for (const option of options) {
        option.selected = wanted.has(option.value);
      }
      return;
    }
    select.value = typeof value === "string" ? value : value[0] ?? "";
    return;
  }
  (control as HTMLInputElement).value = typeof value === "string" ? value : value[0] ?? "";
}

function readValue(control: ValueControl): NormalizedValue {
  if (control.localName === "select") {
    const select = control as HTMLSelectElement;
    if (select.multiple) {
      const values: string[] = [];
      for (const option of Array.from(select.options)) {
        if (option.selected) {
          values.push(option.value);
        }
      }
      return values;
    }
    return select.value;
  }
  return control.value;
}

function flushSelect(control: HTMLSelectElement, state: ValueBinding): void {
  const pending = state.pending;
  if (pending === null || state.detached) {
    return;
  }
  if (control.options.length === 0) {
    return;
  }
  state.pending = null;
  const observer = state.observer;
  state.observer = null;
  observer?.disconnect();
  state.applied = pending;
  state.initialized = true;
  state.writing = true;
  try {
    writeValue(control, pending);
  } finally {
    state.writing = false;
  }
}

function scheduleSelect(control: HTMLSelectElement, state: ValueBinding, value: NormalizedValue): void {
  state.pending = value;
  if (state.observer === null && typeof MutationObserver !== "undefined") {
    const observer = new MutationObserver(() => flushSelect(control, state));
    observer.observe(control, { childList: true, subtree: true });
    state.observer = observer;
  }
  queueMicrotask(() => flushSelect(control, state));
}

function ensureDefaultValue(control: ValueControl, text: string): void {
  if (!isTextControl(control) || text === "") {
    return;
  }
  const field = control as HTMLInputElement;
  if (field.defaultValue === "") {
    field.defaultValue = text;
  }
}

function captureSelection(
  control: ValueControl,
): readonly [number | null, number | null, "forward" | "backward" | "none"] | null {
  if (!supportsSelection(control)) {
    return null;
  }
  const field = control as HTMLInputElement;
  if (field.ownerDocument.activeElement !== control) {
    return null;
  }
  return [field.selectionStart, field.selectionEnd, field.selectionDirection ?? "none"];
}

function restoreSelection(
  control: ValueControl,
  selection: readonly [number | null, number | null, "forward" | "backward" | "none"] | null,
): void {
  if (selection === null || !supportsSelection(control)) {
    return;
  }
  const field = control as HTMLInputElement;
  const start = selection[0];
  const end = selection[1];
  if (start === null || end === null) {
    return;
  }
  try {
    const length = field.value.length;
    field.setSelectionRange(Math.min(start, length), Math.min(end, length), selection[2]);
  } catch {
    return;
  }
}

function syncFromControl(control: ValueControl, state: ValueBinding): void {
  if (state.writing || state.composing) {
    return;
  }
  if (!isTextControl(control) && control.localName === "input") {
    return;
  }
  const value = readValue(control);
  state.applied = value;
  state.initialized = true;
  const setter = state.setter;
  if (setter !== null) {
    untrack(() => setter(value));
  }
}

function attachValueListeners(control: ValueControl, state: ValueBinding): void {
  const onInput = (): void => {
    syncFromControl(control, state);
  };
  const onCompositionStart = (): void => {
    state.composing = true;
  };
  const onCompositionEnd = (): void => {
    state.composing = false;
    if (state.hasDeferred) {
      const deferred = state.deferred;
      state.hasDeferred = false;
      state.deferred = undefined;
      applyValue(control, state, deferred);
      return;
    }
    syncFromControl(control, state);
  };
  const onReset = (): void => {
    const read = state.read;
    if (read === null) {
      return;
    }
    queueMicrotask(() => {
      if (state.detached || read === null) {
        return;
      }
      state.initialized = false;
      state.applied = MISSING;
      applyValue(control, state, untrack(read));
    });
  };
  control.addEventListener("input", onInput);
  control.addEventListener("compositionstart", onCompositionStart);
  control.addEventListener("compositionend", onCompositionEnd);
  const form = control.form;
  form?.addEventListener("reset", onReset);
  onCleanup(() => {
    state.detached = true;
    state.observer?.disconnect();
    state.observer = null;
    control.removeEventListener("input", onInput);
    control.removeEventListener("compositionstart", onCompositionStart);
    control.removeEventListener("compositionend", onCompositionEnd);
    form?.removeEventListener("reset", onReset);
  });
}

function applyValue(control: ValueControl, state: ValueBinding, raw: unknown): void {
  const multiple = control.localName === "select" && (control as HTMLSelectElement).multiple;
  const value: NormalizedValue = multiple ? normalizeList(raw) : normalizeText(raw);
  if (state.initialized && state.applied !== MISSING && sameNormalized(state.applied, value)) {
    return;
  }
  if (state.composing) {
    state.deferred = raw;
    state.hasDeferred = true;
    return;
  }
  if (!multiple) {
    ensureDefaultValue(control, value as string);
  }
  if (
    control.localName === "select"
    && (control as HTMLSelectElement).options.length === 0
    && (typeof value === "string" ? value !== "" : value.length > 0)
  ) {
    scheduleSelect(control as HTMLSelectElement, state, value);
    return;
  }
  state.initialized = true;
  state.applied = value;
  if (control.localName !== "select" && control.value === (typeof value === "string" ? value : value[0] ?? "")) {
    return;
  }
  const selection = captureSelection(control);
  state.writing = true;
  try {
    writeValue(control, value);
  } finally {
    state.writing = false;
  }
  restoreSelection(control, selection);
  if (control.localName === "select" && !multiple) {
    const select = control as HTMLSelectElement;
    const desired = value as string;
    if (desired !== "" && select.value !== desired) {
      scheduleSelect(select, state, desired);
    }
  }
}

export function bindValue(
  el: Element,
  accessor: BindAccessor<unknown>,
  setter?: BindSetter<unknown>,
): void {
  const server = serverAttribute(el);
  if (server !== null) {
    createEffectUnlessStatic(() => {
      server.setAttribute("value", accessor());
    });
    return;
  }
  if (isServerMode()) {
    createEffectUnlessStatic(() => {
      applyAttr(el, "value", accessor(), false);
    });
    return;
  }
  if (el.localName !== "input" && el.localName !== "textarea" && el.localName !== "select") {
    attr(el, "value", accessor);
    return;
  }
  const control = el as ValueControl;
  let state = valueBindings.get(control);
  if (state === undefined) {
    state = {
      read: null,
      setter: setter ?? null,
      applied: MISSING,
      initialized: false,
      writing: false,
      composing: false,
      deferred: undefined,
      hasDeferred: false,
      pending: null,
      observer: null,
      detached: false,
    };
    valueBindings.set(control, state);
    attachValueListeners(control, state);
  } else if (setter !== undefined) {
    state.setter = setter;
  }
  state.read = accessor;
  const apply = (): void => {
    applyValue(control, state as ValueBinding, accessor());
  };
  if (HYDRATE && isHydrating()) {
    hydratedEffect(apply);
    return;
  }
  createRenderEffect(apply);
}

function applyChecked(control: HTMLInputElement, state: CheckBinding, raw: unknown): void {
  const mixed = raw === "mixed";
  const checked = mixed ? false : Boolean(raw);
  if (state.initialized && state.checked === checked && state.mixed === mixed) {
    return;
  }
  if (!state.initialized) {
    control.defaultChecked = checked;
  }
  state.initialized = true;
  state.checked = checked;
  state.mixed = mixed;
  state.writing = true;
  try {
    control.indeterminate = mixed;
    control.checked = checked;
  } finally {
    state.writing = false;
  }
}

function attachCheckListeners(control: HTMLInputElement, state: CheckBinding): void {
  const onChange = (): void => {
    if (state.writing) {
      return;
    }
    if (control.type === "radio") {
      if (!control.checked) {
        return;
      }
      control.indeterminate = false;
      state.checked = true;
      state.mixed = false;
      state.initialized = true;
      const setter = state.setter;
      if (setter !== null) {
        untrack(() => setter(true));
      }
      return;
    }
    control.indeterminate = false;
    state.checked = control.checked;
    state.mixed = false;
    state.initialized = true;
    const setter = state.setter;
    if (setter !== null) {
      untrack(() => setter(control.checked));
    }
  };
  const onReset = (): void => {
    const read = state.read;
    if (read === null) {
      return;
    }
    queueMicrotask(() => {
      if (state.detached || read === null) {
        return;
      }
      state.initialized = false;
      state.checked = MISSING;
      applyChecked(control, state, untrack(read));
    });
  };
  control.addEventListener("change", onChange);
  const form = control.form;
  form?.addEventListener("reset", onReset);
  onCleanup(() => {
    state.detached = true;
    control.removeEventListener("change", onChange);
    form?.removeEventListener("reset", onReset);
  });
}

export function bindChecked(
  el: Element,
  accessor: BindAccessor<unknown>,
  setter?: BindSetter<unknown>,
): void {
  const server = serverAttribute(el);
  if (server !== null) {
    createEffectUnlessStatic(() => {
      const value = accessor();
      server.setAttribute("checked", value === "mixed" ? false : Boolean(value));
    });
    return;
  }
  if (isServerMode()) {
    createEffectUnlessStatic(() => {
      const value = accessor();
      applyAttr(el, "checked", value === "mixed" ? undefined : Boolean(value), false);
    });
    return;
  }
  if (el.localName !== "input") {
    attr(el, "checked", accessor);
    return;
  }
  const control = el as HTMLInputElement;
  if (control.type !== "checkbox" && control.type !== "radio") {
    attr(el, "checked", accessor);
    return;
  }
  let state = checkBindings.get(control);
  if (state === undefined) {
    state = {
      read: null,
      setter: setter ?? null,
      checked: MISSING,
      mixed: false,
      initialized: false,
      writing: false,
      detached: false,
    };
    checkBindings.set(control, state);
    attachCheckListeners(control, state);
  } else if (setter !== undefined) {
    state.setter = setter;
  }
  state.read = accessor;
  const apply = (): void => {
    applyChecked(control, state as CheckBinding, accessor());
  };
  if (HYDRATE && isHydrating()) {
    hydratedEffect(apply);
    return;
  }
  createRenderEffect(apply);
}

export function bindSource(
  value: unknown,
): readonly [BindAccessor<unknown>, BindSetter<unknown> | undefined] {
  if (Array.isArray(value) && value.length === 2 && typeof value[0] === "function") {
    return [value[0] as BindAccessor<unknown>, value[1] as BindSetter<unknown>];
  }
  if (typeof value === "function") {
    return [value as BindAccessor<unknown>, undefined];
  }
  if (typeof value === "object" && value !== null && typeof (value as { get?: unknown }).get === "function") {
    const binding = value as { get: BindAccessor<unknown>; set?: BindSetter<unknown> };
    return [binding.get, typeof binding.set === "function" ? binding.set : undefined];
  }
  return [() => value, undefined];
}

export function style(el: Element, accessor: () => unknown): void;
export function style(...values: readonly StyleInput[]): string;
export function style(...args: unknown[]): void | string {
  const first = args[0];
  if (args.length >= 2 && styleTarget(first)) {
    const el = first;
    const accessor = args[1] as () => unknown;
    const server = serverAttribute(el);
    if (server !== null) {
      createEffectUnlessStatic(() => {
        applyServerStyle(server, accessor());
      });
      return;
    }
    const token: object = {};
    createRenderEffect(() => {
      applyStyle(el, accessor(), token);
    });
    onCleanup(() => releaseStyle(el, token));
    return;
  }
  return normalizeStyle(...(args as StyleInput[]));
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

/**
 * Как `resolveEventName`, но неизвестное/некорректное имя даёт `null`.
 * Нужен для динамических props (`spread`, `applyProps`): один случайный
 * `onFooBar` не должен ронять рендер, в отличие от явного `on()`.
 */
function tryResolveEventName(name: string): ParsedEvent | null {
  try {
    return resolveEventName(name);
  } catch {
    return null;
  }
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

const UNKNOWN_EVENT_COMPONENT: AnyComponent = () => null;

function reportDelegatedError(error: unknown): void {
  const name = error instanceof Error ? error.name : "Error";
  const message = error instanceof Error ? error.message : String(error);
  try {
    emitDevtoolsError({
      name: null,
      moduleId: null,
      phase: "event",
      message: `${name}: ${message}`,
    });
  } catch {
    // Devtools не должны ломать доставку события.
  }
  try {
    getErrorHandler()(error, UNKNOWN_EVENT_COMPONENT);
  } catch {
    // Ошибка глобального обработчика не должна прерывать всплытие.
  }
}

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
            } catch (error) {
              reportDelegatedError(error);
            }
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
  let parsed: ParsedEvent;
  try {
    parsed = resolveEventName(name);
  } catch {
    // Неизвестное событие не могло быть навешено — удалять нечего.
    return;
  }
  const { event, capture, key } = parsed;
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
  if (HYDRATE && isHydrating()) {
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
  if (!isValidTagName(tag)) {
    throw new Error(`Недопустимое имя тега: "${tag}"`);
  }
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
    if (key === "bindValue") {
      const [accessor, setter] = bindSource(value);
      bindValue(el, accessor, setter);
      continue;
    }
    if (key === "bindChecked") {
      const [accessor, setter] = bindSource(value);
      bindChecked(el, accessor, setter);
      continue;
    }
    if (key === "ref") {
      applyElementRef(el, value);
      continue;
    }
    if (isEventAttributeName(key)) {
      if (typeof value === "function" && tryResolveEventName(key) !== null) {
        on(el, key, () => value);
      }
      continue;
    }
    if (!isValidAttributeName(key)) {
      continue;
    }
    if (key === "innerHTML" || key === "dangerouslySetInnerHTML") {
      applyInnerHtml(el, value);
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
