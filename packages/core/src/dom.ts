import type { Child, Children } from "./jsx.js";
import { createRenderEffect, onCleanup } from "@ivlev-dev/silent-reactivity";
import { extractMetadata } from "./metadata.js";
import {
  FRAGMENT,
  INSERT_END,
  INSERT_START,
  claimNext,
  collectBetween,
  currentWindow,
  findInsertWindow,
  isHydrating,
  isMarker,
  mergeTopLevelTitles,
  mismatch,
  shapeMatches,
  withWindow,
} from "./hydration.js";
import { isMetadataTitle } from "./metadata.js";

export const NODE_DISPOSER = Symbol("silent.disposer");

type DisposerHost = Node & { [NODE_DISPOSER]?: () => void };

interface ListenerHolder {
  current: EventListener | null;
  wrapper: EventListener;
}

export interface MountPoint {
  render(value: unknown): void;
  clear(): void;
  nodes(): readonly Node[];
}

const templateCache = new Map<string, HTMLTemplateElement>();
const listenerRegistry = new WeakMap<Element, Map<string, ListenerHolder>>();
const styleSnapshots = new WeakMap<Element, Set<string>>();

let serverMode = false;

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

export const svgTagNames = new Set<string>([
  "svg",
  "path",
  "circle",
  "rect",
  "line",
  "g",
  "defs",
  "linearGradient",
  "stop",
  "use",
  "tspan",
]);

function isRenderableChild(value: unknown): boolean {
  return value !== null && value !== undefined && typeof value !== "boolean";
}

function stringOf(value: unknown): string {
  if (value === null || value === undefined || typeof value === "boolean") {
    return "";
  }
  return String(value);
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

function readDisposer(node: Node): (() => void) | undefined {
  const dispose = (node as DisposerHost)[NODE_DISPOSER];
  return typeof dispose === "function" ? dispose : undefined;
}

export function collectNodes(value: Children): Node[] {
  const nodes: Node[] = [];
  const visit = (input: unknown): void => {
    let current = input;
    while (typeof current === "function") {
      current = (current as () => Child)();
    }
    if (!isRenderableChild(current)) {
      return;
    }
    if (typeof current === "boolean") {
      return;
    }
    if (Array.isArray(current)) {
      for (const item of current) {
        visit(item);
      }
      return;
    }
    if (current instanceof Node) {
      if (current instanceof DocumentFragment) {
        let child = current.firstChild;
        while (child !== null) {
          const next = child.nextSibling;
          visit(child);
          child = next;
        }
        return;
      }
      nodes.push(current);
      return;
    }
    nodes.push(document.createTextNode(stringOf(current)));
  };
  visit(value);
  return nodes;
}

export function disposeNode(node: Node): void {
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

  const holder = (): Node => {
    if (marker === null) {
      return parent;
    }
    const live = marker.parentNode;
    return live ?? parent;
  };

  const place = (node: Node): void => {
    if (marker === null) {
      holder().appendChild(node);
      return;
    }
    holder().insertBefore(node, marker);
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
      initialized = true;
      prev = value;
      if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
        const next = stringOf(value);
        if (textNode === null) {
          clear();
          textNode = document.createTextNode(next);
          nodes = [textNode];
          place(textNode);
          return;
        }
        if (textNode.data !== next) {
          textNode.data = next;
        }
        return;
      }
      clear();
      if (!isRenderableChild(value)) {
        return;
      }
      nodes = collectNodes(value as Child);
      nodes = extractMetadata(nodes);
      for (const node of nodes) {
        place(node);
      }
    },
  };
}

export function template(html: string): () => Node {
  let cached = templateCache.get(html);
  if (cached === undefined) {
    const element = document.createElement("template");
    element.innerHTML = html;
    templateCache.set(html, element);
    cached = element;
  }
  const content = cached.content;
  const roots = Array.from(content.childNodes);
  const singleRoot: Node | null = roots.length === 1 ? roots[0] ?? null : null;
  const create = (): Node => {
    if (singleRoot !== null) {
      return singleRoot.cloneNode(true);
    }
    if (roots.length === 0) {
      return content.cloneNode(false);
    }
    const fragment = document.createDocumentFragment();
    for (const root of roots) {
      fragment.appendChild(root.cloneNode(true));
    }
    return fragment;
  };
  return () => {
    if (!isHydrating()) {
      return create();
    }
    const fresh = create();
    if (fresh instanceof DocumentFragment) {
      return mismatch("многослойный шаблон не поддерживается при гидрации");
    }
    if (isMetadataTitle(fresh)) {
      return fresh;
    }
    const node = claimNext();
    if (node === null || !shapeMatches(fresh, node, true)) {
      return mismatch("шаблон не совпал с серверной разметкой");
    }
    mergeTopLevelTitles(fresh, node);
    return node;
  };
}

export interface TemplateClone {
  readonly node: Node;
  readonly holes: readonly Comment[];
  readonly attrs: readonly Element[];
}

function collectPartsMany(nodes: readonly Node[]): { holes: Comment[]; attrs: Element[] } {
  const holesByIndex = new Map<number, Comment>();
  const attrsByIndex = new Map<number, Element>();

  const scanAttributes = (element: Element): void => {
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.name === "data-silent-text") {
        if (!isServerMode()) {
          element.removeAttribute(attribute.name);
        }
        continue;
      }
      const match = /^data-silent-a-(\d+)$/.exec(attribute.name);
      if (match === null) {
        continue;
      }
      const index = Number(match[1]);
      if (Number.isInteger(index)) {
        attrsByIndex.set(index, element);
      }
      if (!isServerMode()) {
        element.removeAttribute(attribute.name);
      }
    }
  };

  const visit = (current: Node): void => {
    if (current.nodeType === Node.COMMENT_NODE) {
      const match = /^silent-hole-(\d+)$/.exec((current as Comment).data);
      if (match !== null) {
        const index = Number(match[1]);
        if (Number.isInteger(index)) {
          holesByIndex.set(index, current as Comment);
        }
      }
    } else if (current.nodeType === Node.ELEMENT_NODE) {
      scanAttributes(current as Element);
    }
    let depth = 0;
    let child = current.firstChild;
    while (child !== null) {
      if (child.nodeType === Node.COMMENT_NODE) {
        const data = (child as Comment).data;
        if (data === INSERT_START) {
          depth += 1;
          child = child.nextSibling;
          continue;
        }
        if (data === INSERT_END) {
          depth = Math.max(0, depth - 1);
          child = child.nextSibling;
          continue;
        }
      }
      if (depth === 0) {
        visit(child);
      }
      child = child.nextSibling;
    }
  };

  for (const node of nodes) {
    visit(node);
  }

  const holes: Comment[] = [];
  for (let index = 0; index < holesByIndex.size; index += 1) {
    const hole = holesByIndex.get(index);
    if (hole === undefined) {
      break;
    }
    holes.push(hole);
  }
  const attrs: Element[] = [];
  for (let index = 0; index < attrsByIndex.size; index += 1) {
    const element = attrsByIndex.get(index);
    if (element === undefined) {
      break;
    }
    attrs.push(element);
  }
  return { holes, attrs };
}

function collectParts(node: Node): { holes: Comment[]; attrs: Element[] } {
  return collectPartsMany([node]);
}

export function templateHoles(html: string): () => TemplateClone {
  let cached = templateCache.get(html);
  if (cached === undefined) {
    const element = document.createElement("template");
    element.innerHTML = html;
    templateCache.set(html, element);
    cached = element;
  }
  const template = cached;
  const cloneNode = (): Node => {
    const content = template.content.cloneNode(true) as DocumentFragment;
    const rootNodes = Array.from(content.childNodes);
    return rootNodes.length === 1 && rootNodes[0] !== undefined
      ? rootNodes[0]
      : content;
  };
  const create = (): TemplateClone => {
    const node = cloneNode();
    return { node, ...collectParts(node) };
  };
  return () => {
    if (!isHydrating()) {
      return create();
    }
    const fresh = cloneNode();
    const roots =
      fresh instanceof DocumentFragment ? Array.from(fresh.childNodes) : [fresh];
    if (roots.length === 1 && isMetadataTitle(roots[0])) {
      const title = roots[0]!;
      return { node: title, ...collectPartsMany([title]) };
    }
    const claimed: Node[] = [];
    for (const root of roots) {
      if (isMetadataTitle(root)) {
        claimed.push(root);
        continue;
      }
      const node = claimNext();
      if (node === null || !shapeMatches(root, node, true)) {
        return mismatch("шаблон не совпал с серверной разметкой");
      }
      mergeTopLevelTitles(root, node);
      claimed.push(node);
    }
    const parts = collectPartsMany(claimed);
    if (claimed.length === 1 && !(fresh instanceof DocumentFragment)) {
      return { node: claimed[0]!, ...parts };
    }
    const container = document.createDocumentFragment();
    for (const node of claimed) {
      container.appendChild(node);
    }
    return { node: container, ...parts };
  };
}

export function settleNodes(end: Node | null, value: unknown): void {
  if (end === null || !(value instanceof Node)) {
    return;
  }
  const parent = end.parentNode;
  if (parent === null) {
    return;
  }
  for (const node of collectNodes(value as Children)) {
    if (node.parentNode !== parent) {
      parent.insertBefore(node, end);
    }
  }
}

export function writeRegion(start: Node, end: Node, value: unknown): void {
  const parent = end.parentNode;
  if (parent === null) {
    return;
  }
  const existing = collectBetween(start, end);
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint"
  ) {
    const next = stringOf(value);
    if (existing.length === 1 && existing[0] instanceof Text) {
      const text = existing[0];
      if (text.data !== next) {
        text.data = next;
      }
      return;
    }
  }
  for (const node of existing) {
    disposeNode(node);
    parent.removeChild(node);
  }
  for (const node of extractMetadata(collectNodes(value as Children))) {
    parent.insertBefore(node, end);
  }
}

function insertServer(
  parent: Node,
  accessor: () => unknown,
  marker: Node | null,
): void {
  const start = document.createComment(INSERT_START);
  const end = document.createComment(INSERT_END);
  if (marker === null) {
    parent.appendChild(start);
    parent.appendChild(end);
  } else {
    parent.insertBefore(start, marker);
    parent.insertBefore(end, marker);
  }
  const mount = createMountPoint(parent, end);
  createRenderEffect(() => {
    mount.render(accessor());
  });
}

function insertHydrated(
  parent: Node,
  accessor: () => unknown,
  marker: Node | null,
): void {
  const window = findInsertWindow(marker, parent);
  let initialized = false;
  createRenderEffect(() => {
    if (!initialized) {
      initialized = true;
      const value = withWindow(window, () => accessor());
      settleNodes(window.end, value);
      const nodes = collectBetween(window.start, window.end);
      if (
        (typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "bigint") &&
        nodes.length === 1 &&
        nodes[0] instanceof Text
      ) {
        const text = nodes[0];
        const next = stringOf(value);
        if (text.data !== next) {
          text.data = next;
        }
      }
      return;
    }
    writeRegion(window.start, window.end, accessor());
  });
}

export function insert(parent: Node, accessor: () => unknown, marker?: Node): void {
  if (isServerMode()) {
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
  createRenderEffect(() => {
    const value = accessor();
    const next = stringOf(value);
    if (node.data !== next) {
      node.data = next;
    }
  });
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

export function attr(el: Element, name: string, accessor: () => unknown): void {
  const svg = isSvgElement(el);
  let prev: unknown = accessor();
  applyAttr(el, name, prev, svg);
  createRenderEffect(() => {
    const value = accessor();
    if (valuesEqual(value, prev)) {
      return;
    }
    prev = value;
    applyAttr(el, name, value, svg);
  });
}

export function applyAttr(el: Element, name: string, value: unknown, svg: boolean): void {
  if (name === "class" || name === "className") {
    setClass(el, value);
    return;
  }
  if (name === "style") {
    if (typeof value === "object" && value !== null) {
      applyStyle(el, value, ensureSnapshot(el));
      return;
    }
    if (value === null || value === undefined) {
      applyStyle(el, value, ensureSnapshot(el));
      return;
    }
    el.setAttribute("style", stringOf(value));
    return;
  }
  if (!svg && propertyNames.has(name)) {
    applyProperty(el, name, value);
    return;
  }
  if (value === null || value === undefined || value === false) {
    el.removeAttribute(name);
    return;
  }
  if (value === true) {
    el.setAttribute(name, booleanNames.has(name) ? "" : "true");
    return;
  }
  el.setAttribute(name, stringOf(value));
}

function applyProperty(el: Element, name: string, value: unknown): void {
  const target = el as unknown as Record<string, unknown>;
  if (name === "value") {
    const empty = value === null || value === undefined;
    target["value"] = empty ? "" : value;
    if (empty) {
      el.removeAttribute(name);
    }
    return;
  }
  const enabled = Boolean(value);
  target[name] = enabled;
  if (enabled) {
    el.setAttribute(name, "");
    return;
  }
  el.removeAttribute(name);
}

export function spread(el: Element, accessor: () => unknown): void {
  const svg = isSvgElement(el);
  let prev: Record<string, unknown> | null = null;
  let currentRef: ((node: Element | null) => void) | null = null;

  const releaseRef = (): void => {
    const previous = currentRef;
    currentRef = null;
    if (previous !== null) {
      previous(null);
    }
  };

  createRenderEffect(() => {
    const value = accessor();
    if (typeof value !== "object" || value === null) {
      return;
    }
    const props = value as Record<string, unknown>;
    if (prev !== null) {
      for (const key of Object.keys(prev)) {
        if (key in props) {
          continue;
        }
        if (key === "ref") {
          releaseRef();
          continue;
        }
        if (key === "style") {
          applyStyle(el, null, ensureSnapshot(el));
          continue;
        }
        if (isEventName(key)) {
          removeListener(el, key);
          continue;
        }
        applyAttr(el, key, undefined, svg);
      }
    }
    for (const [key, next] of Object.entries(props)) {
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
      if (isEventName(key)) {
        addListener(el, key, typeof next === "function" ? (next as EventListener) : null);
        continue;
      }
      if (key === "class" || key === "className") {
        setClass(el, next);
        continue;
      }
      if (key === "style") {
        applyStyle(el, next, ensureSnapshot(el));
        continue;
      }
      applyAttr(el, key, next, svg);
    }
    prev = props;
  });

  onCleanup(releaseRef);
}

export function prop(el: Element, name: string, accessor: () => unknown): void {
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
  const snapshot = ensureSnapshot(el);
  createRenderEffect(() => {
    applyStyle(el, accessor(), snapshot);
  });
}

function ensureSnapshot(el: Element): Set<string> {
  let snapshot = styleSnapshots.get(el);
  if (snapshot === undefined) {
    snapshot = new Set<string>();
    styleSnapshots.set(el, snapshot);
  }
  return snapshot;
}

function applyStyle(el: Element, value: unknown, snapshot: Set<string>): void {
  const style = (el as HTMLElement).style;
  if (value === null || value === undefined) {
    for (const key of snapshot) {
      style.removeProperty(key);
    }
    snapshot.clear();
    return;
  }
  if (typeof value === "string") {
    if (style.cssText !== value) {
      style.cssText = value;
    }
    const keep = new Set<string>();
    for (const entry of value.split(";")) {
      const separator = entry.indexOf(":");
      const key = separator === -1 ? entry.trim() : entry.slice(0, separator).trim();
      if (key !== "") {
        keep.add(key);
      }
    }
    for (const key of Array.from(snapshot)) {
      if (!keep.has(key)) {
        style.removeProperty(key);
        snapshot.delete(key);
      }
    }
    for (const key of keep) {
      snapshot.add(key);
    }
    return;
  }
  if (typeof value !== "object") {
    return;
  }
  const props = value as Record<string, string | number | null | undefined>;
  const keys = new Set<string>();
  for (const [raw, next] of Object.entries(props)) {
    const key = hyphen(raw);
    const target = next === null || next === undefined ? "" : String(next);
    keys.add(key);
    if (target === "") {
      if (style.getPropertyValue(key) !== "") {
        style.removeProperty(key);
      }
      snapshot.delete(key);
      continue;
    }
    if (style.getPropertyValue(key) !== target) {
      style.setProperty(key, target);
    }
    snapshot.add(key);
  }
  for (const key of Array.from(snapshot)) {
    if (!keys.has(key)) {
      style.removeProperty(key);
      snapshot.delete(key);
    }
  }
}

export function hyphen(raw: string): string {
  if (raw.includes("-")) {
    return raw.toLowerCase();
  }
  let result = "";
  for (const char of raw) {
    if (char >= "A" && char <= "Z") {
      result += "-" + char.toLowerCase();
      continue;
    }
    result += char;
  }
  return result;
}

function getHolders(el: Element): Map<string, ListenerHolder> {
  let holders = listenerRegistry.get(el);
  if (holders === undefined) {
    holders = new Map<string, ListenerHolder>();
    listenerRegistry.set(el, holders);
  }
  return holders;
}

function isEventName(name: string): boolean {
  return name.startsWith("on:") || (name.startsWith("on") && name.length > 2);
}

export function parseEventName(name: string): { event: string; capture: boolean } {
  if (name.startsWith("on:")) {
    return { event: name.slice(3), capture: false };
  }
  let event = name.slice(2);
  if (event.endsWith("Capture")) {
    event = event.slice(0, -7);
    const first = event.charAt(0);
    event = first === "" ? event : first.toLowerCase() + event.slice(1);
    return { event, capture: true };
  }
  const first = event.charAt(0);
  event = first === "" ? event : first.toLowerCase() + event.slice(1);
  return { event, capture: false };
}

export function addListener(el: Element, name: string, handler: EventListener | null): void {
  const { event, capture } = parseEventName(name);
  const holders = getHolders(el);
  const key = (capture ? "c:" : "e:") + event;
  const registered = holders.get(key);
  if (registered !== undefined) {
    registered.current = typeof handler === "function" ? handler : null;
    return;
  }
  const holder: ListenerHolder = {
    current: typeof handler === "function" ? handler : null,
    wrapper: () => {},
  };
  const wrapper: EventListener = (event: Event) => {
    const current = holder.current;
    if (typeof current === "function") {
      current(event);
    }
  };
  holder.wrapper = wrapper;
  holders.set(key, holder);
  el.addEventListener(event, wrapper, capture);
}

export function removeListener(el: Element, name: string): void {
  const { event, capture } = parseEventName(name);
  const holders = listenerRegistry.get(el);
  if (holders === undefined) {
    return;
  }
  const key = (capture ? "c:" : "e:") + event;
  const registered = holders.get(key);
  if (registered === undefined) {
    return;
  }
  holders.delete(key);
  registered.current = null;
  el.removeEventListener(event, registered.wrapper, capture);
}

export function on(el: Element, name: string, accessor: () => unknown): void {
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
    const window = {
      start: outer.start,
      end: anchor,
      cursor: outer.start.nextSibling,
    };
    let initialized = false;
    createRenderEffect(() => {
      if (!initialized) {
        initialized = true;
        const value = withWindow(window, () => accessor());
        settleNodes(anchor, value);
        if (window.cursor !== anchor) {
          mismatch("содержимое fragment не совпало");
        }
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
  if (svgTagNames.has(tag)) {
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
  for (const [key, value] of Object.entries(props)) {
    if (key === "children" || key === "key") {
      continue;
    }
    if (key === "ref") {
      applyElementRef(el, value);
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
