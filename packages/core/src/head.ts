import { createRenderEffect, onCleanup } from "@ivlev-dev/silent-reactivity";
import type { Children } from "./jsx.js";
import { collectNodes } from "./dom.js";
import { getMetadataCollector, hoistNode } from "./metadata.js";

export type HeadValue<T> = T | (() => T | null | undefined) | null | undefined;

export interface HeadMetaProps {
  readonly name?: HeadValue<string>;
  readonly property?: HeadValue<string>;
  readonly httpEquiv?: HeadValue<string>;
  readonly charset?: HeadValue<string>;
  readonly content?: HeadValue<string>;
  readonly [attribute: string]: HeadValue<string> | undefined;
}

export interface HeadLinkProps {
  readonly rel: string;
  readonly href?: HeadValue<string>;
  readonly [attribute: string]: HeadValue<string> | undefined;
}

export interface HeadStyleProps {
  readonly id?: HeadValue<string>;
  readonly css: HeadValue<string>;
  readonly [attribute: string]: HeadValue<string> | undefined;
}

export interface HeadProps {
  readonly title?: HeadValue<string>;
  readonly meta?: HeadMetaProps | readonly HeadMetaProps[] | undefined;
  readonly link?: HeadLinkProps | readonly HeadLinkProps[] | undefined;
  readonly style?: HeadStyleProps | readonly HeadStyleProps[] | undefined;
  readonly children?: Children;
}

type HeadTag = "title" | "meta" | "link" | "style";

interface HeadSpec {
  readonly active: boolean;
  readonly text: string | null;
  readonly attrs: Readonly<Record<string, string>>;
}

const EMPTY_SPEC: HeadSpec = { active: false, text: null, attrs: {} };

interface HeadEntry {
  spec: HeadSpec;
}

type HeadMatcher = (element: Element) => boolean;

interface HeadSlot {
  readonly element: Element;
  readonly matches: HeadMatcher | null;
  readonly stack: HeadEntry[];
  readonly collected: boolean;
  pushed: boolean;
  attached: boolean;
  dispose: (() => void) | null;
}

interface HeadRegistry {
  readonly slots: Map<string, HeadSlot>;
  readonly children: Map<string, Element>;
}

const ATTRIBUTE_ALIASES: Readonly<Record<string, string>> = {
  acceptCharset: "accept-charset",
  charSet: "charset",
  crossOrigin: "crossorigin",
  fetchPriority: "fetchpriority",
  hrefLang: "hreflang",
  httpEquiv: "http-equiv",
  imageSizes: "imagesizes",
  imageSrcSet: "imagesrcset",
  referrerPolicy: "referrerpolicy",
};

const ATTRS = Symbol("silent.head.attrs");

interface AttrHost {
  [ATTRS]?: Set<string>;
}

const clientRegistry: HeadRegistry = { slots: new Map(), children: new Map() };
const ssrRegistries = new WeakMap<object, HeadRegistry>();

let uniqueSeq = 0;

function createRegistry(): HeadRegistry {
  return { slots: new Map(), children: new Map() };
}

function acquireRegistry(): HeadRegistry {
  const collector = getMetadataCollector();
  if (collector === null) {
    return clientRegistry;
  }
  let registry = ssrRegistries.get(collector);
  if (registry === undefined) {
    registry = createRegistry();
    ssrRegistries.set(collector, registry);
  }
  return registry;
}

function asArray<Item>(
  value: Item | readonly Item[] | undefined,
): readonly Item[] {
  if (value === undefined) {
    return [];
  }
  if (Array.isArray(value)) {
    return value as readonly Item[];
  }
  return [value as Item];
}

function resolveValue(value: HeadValue<string> | undefined): string | null {
  const resolved = typeof value === "function" ? value() : value;
  if (resolved === null || resolved === undefined) {
    return null;
  }
  return String(resolved);
}

function staticValue(value: HeadValue<string> | undefined): string | null {
  if (value === null || value === undefined || typeof value === "function") {
    return null;
  }
  return String(value);
}

function attributeName(key: string): string {
  const alias = ATTRIBUTE_ALIASES[key];
  if (alias !== undefined) {
    return alias;
  }
  if (!/[A-Z]/.test(key)) {
    return key;
  }
  return key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}

function readAttributes(source: Readonly<Record<string, unknown>>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(source)) {
    if (key === "css") {
      continue;
    }
    const value = typeof raw === "function" ? (raw as () => unknown)() : raw;
    if (value === null || value === undefined) {
      continue;
    }
    result[attributeName(key)] = String(value);
  }
  return result;
}

function titleSpec(value: HeadValue<string>): HeadSpec {
  const text = resolveValue(value);
  return { active: text !== null, text, attrs: {} };
}

function metaSpec(props: HeadMetaProps): HeadSpec {
  return { active: true, text: null, attrs: readAttributes(props) };
}

function linkSpec(props: HeadLinkProps): HeadSpec {
  return { active: true, text: null, attrs: readAttributes(props) };
}

function styleSpec(props: HeadStyleProps): HeadSpec {
  const text = resolveValue(props.css);
  return { active: text !== null, text, attrs: readAttributes(props) };
}

function uniqueKey(prefix: string): string {
  uniqueSeq += 1;
  return `${prefix}#${uniqueSeq}`;
}

function metaKey(props: HeadMetaProps): string | null {
  const charset = staticValue(props.charset);
  if (charset !== null) {
    return "meta:charset";
  }
  const name = staticValue(props.name);
  if (name !== null) {
    return `meta:name:${name}`;
  }
  const property = staticValue(props.property);
  if (property !== null) {
    return `meta:property:${property}`;
  }
  const httpEquiv = staticValue(props.httpEquiv);
  if (httpEquiv !== null) {
    return `meta:http-equiv:${httpEquiv.toLowerCase()}`;
  }
  return null;
}

function metaMatcher(props: HeadMetaProps): HeadMatcher | null {
  const charset = staticValue(props.charset);
  if (charset !== null) {
    return (element) => element.tagName === "META" && element.hasAttribute("charset");
  }
  const name = staticValue(props.name);
  if (name !== null) {
    return (element) =>
      element.tagName === "META" && element.getAttribute("name") === name;
  }
  const property = staticValue(props.property);
  if (property !== null) {
    return (element) =>
      element.tagName === "META" && element.getAttribute("property") === property;
  }
  const httpEquiv = staticValue(props.httpEquiv);
  if (httpEquiv !== null) {
    const expected = httpEquiv.toLowerCase();
    return (element) =>
      element.tagName === "META"
      && (element.getAttribute("http-equiv") ?? "").toLowerCase() === expected;
  }
  return null;
}

function linkMatcher(props: HeadLinkProps): HeadMatcher | null {
  const href = staticValue(props.href);
  if (href === null) {
    return null;
  }
  const rel = props.rel;
  return (element) =>
    element.tagName === "LINK"
    && element.getAttribute("rel") === rel
    && element.getAttribute("href") === href;
}

function styleMatcher(props: HeadStyleProps): HeadMatcher | null {
  const id = staticValue(props.id);
  if (id !== null) {
    return (element) =>
      element.tagName === "STYLE" && element.getAttribute("id") === id;
  }
  const css = staticValue(props.css);
  if (css !== null) {
    return (element) =>
      element.tagName === "STYLE" && (element.textContent ?? "") === css;
  }
  return null;
}

function linkKey(props: HeadLinkProps): string | null {
  const href = staticValue(props.href);
  if (href === null) {
    return null;
  }
  return `link:${props.rel}:${href}`;
}

function styleKey(props: HeadStyleProps): string | null {
  const id = staticValue(props.id);
  if (id !== null) {
    return `style:id:${id}`;
  }
  const css = staticValue(props.css);
  if (css !== null) {
    return `style:css:${css}`;
  }
  return null;
}

function applySpec(element: Element, spec: HeadSpec): void {
  const host = element as AttrHost & Element;
  const applied = host[ATTRS];
  const attrs = spec.attrs;
  if (applied !== undefined) {
    for (const name of applied) {
      if (!(name in attrs)) {
        element.removeAttribute(name);
      }
    }
  }
  const next = new Set<string>();
  for (const [name, value] of Object.entries(attrs)) {
    next.add(name);
    if (element.getAttribute(name) !== value) {
      element.setAttribute(name, value);
    }
  }
  host[ATTRS] = next;
  if (spec.text !== null && element.textContent !== spec.text) {
    element.textContent = spec.text;
  }
}

function detachSlot(slot: HeadSlot): void {
  if (!slot.attached) {
    return;
  }
  slot.attached = false;
  if (slot.collected) {
    return;
  }
  const dispose = slot.dispose;
  slot.dispose = null;
  dispose?.();
}

function removeForeign(
  registry: HeadRegistry,
  matches: HeadMatcher,
  keep: Element,
): void {
  if (typeof document === "undefined" || document.head === null) {
    return;
  }
  const head = document.head;
  const registered = new Set<Element>(registry.children.values());
  for (const child of Array.from(head.children)) {
    if (child === keep || registered.has(child)) {
      continue;
    }
    if (matches(child)) {
      head.removeChild(child);
    }
  }
}

function activeSpecOf(slot: HeadSlot): HeadSpec | null {
  for (let index = slot.stack.length - 1; index >= 0; index -= 1) {
    const candidate = slot.stack[index];
    if (candidate !== undefined && candidate.spec.active) {
      return candidate.spec;
    }
  }
  return null;
}

function applyContribution(
  registry: HeadRegistry,
  slot: HeadSlot,
  spec: HeadSpec,
): void {
  if (!spec.active) {
    const fallback = activeSpecOf(slot);
    if (fallback === null) {
      detachSlot(slot);
      return;
    }
    applyContribution(registry, slot, fallback);
    return;
  }
  applySpec(slot.element, spec);
  if (!slot.attached) {
    if (slot.collected) {
      if (!slot.pushed) {
        slot.pushed = true;
        hoistNode(slot.element);
      }
    } else {
      if (slot.matches !== null) {
        removeForeign(registry, slot.matches, slot.element);
      }
      slot.dispose = hoistNode(slot.element);
    }
    slot.attached = true;
  }
}

function ensureSlot(
  registry: HeadRegistry,
  key: string,
  tag: HeadTag,
  matches: HeadMatcher | null,
): HeadSlot {
  const existing = registry.slots.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const slot: HeadSlot = {
    element: document.createElement(tag),
    matches,
    stack: [],
    collected: getMetadataCollector() !== null,
    pushed: false,
    attached: false,
    dispose: null,
  };
  registry.slots.set(key, slot);
  return slot;
}

function elementKey(element: Element): string | null {
  switch (element.tagName) {
    case "TITLE":
      return "title";
    case "META": {
      const charset = element.getAttribute("charset");
      if (charset !== null) {
        return "meta:charset";
      }
      for (const name of ["name", "property", "http-equiv"]) {
        const value = element.getAttribute(name);
        if (value !== null) {
          return `meta:${name}:${name === "http-equiv" ? value.toLowerCase() : value}`;
        }
      }
      return null;
    }
    case "LINK": {
      const rel = element.getAttribute("rel");
      const href = element.getAttribute("href");
      if (rel === null || href === null) {
        return null;
      }
      return `link:${rel}:${href}`;
    }
    case "STYLE": {
      const id = element.getAttribute("id");
      if (id !== null) {
        return `style:id:${id}`;
      }
      return null;
    }
    default:
      return null;
  }
}

export function Head(props: HeadProps): Node {
  const registry = acquireRegistry();
  const contributions: Array<{
    readonly key: string;
    readonly slot: HeadSlot;
    readonly entry: HeadEntry;
  }> = [];
  const childDisposers: Array<{ readonly key: string | null; readonly dispose: () => void }> = [];

  const add = (
    key: string,
    tag: HeadTag,
    matches: HeadMatcher | null,
    resolve: () => HeadSpec,
  ): void => {
    const slot = ensureSlot(registry, key, tag, matches);
    const entry: HeadEntry = { spec: EMPTY_SPEC };
    slot.stack.push(entry);
    contributions.push({ key, slot, entry });
    createRenderEffect(() => {
      entry.spec = resolve();
      const last = slot.stack[slot.stack.length - 1];
      if (last === entry) {
        applyContribution(registry, slot, entry.spec);
        return;
      }
      if (
        last !== undefined
        && !last.spec.active
        && activeSpecOf(slot) === entry.spec
      ) {
        applyContribution(registry, slot, entry.spec);
      }
    });
  };

  if (props.title !== undefined) {
    add("title", "title", null, () => titleSpec(props.title));
  }

  for (const meta of asArray(props.meta)) {
    add(metaKey(meta) ?? uniqueKey("meta"), "meta", metaMatcher(meta), () =>
      metaSpec(meta),
    );
  }

  for (const link of asArray(props.link)) {
    add(linkKey(link) ?? uniqueKey("link"), "link", linkMatcher(link), () =>
      linkSpec(link),
    );
  }

  for (const style of asArray(props.style)) {
    add(styleKey(style) ?? uniqueKey("style"), "style", styleMatcher(style), () =>
      styleSpec(style),
    );
  }

  if (props.children !== undefined) {
    for (const node of collectNodes(props.children)) {
      if (!(node instanceof Element)) {
        continue;
      }
      const key = elementKey(node);
      if (key !== null) {
        if (registry.children.has(key)) {
          if (node.parentNode !== null) {
            node.parentNode.removeChild(node);
          }
          continue;
        }
        registry.children.set(key, node);
      }
      childDisposers.push({ key, dispose: hoistNode(node) });
    }
  }

  onCleanup(() => {
    for (const { key, slot, entry } of contributions) {
      const index = slot.stack.indexOf(entry);
      if (index === -1) {
        continue;
      }
      slot.stack.splice(index, 1);
      if (slot.stack.length === 0) {
        detachSlot(slot);
        if (registry.slots.get(key) === slot) {
          registry.slots.delete(key);
        }
        continue;
      }
      const top = slot.stack[slot.stack.length - 1];
      if (top !== undefined) {
        applyContribution(registry, slot, top.spec);
      }
    }
    for (const { key, dispose } of childDisposers) {
      dispose();
      if (key !== null && registry.children.get(key) !== undefined) {
        registry.children.delete(key);
      }
    }
  });

  return document.createDocumentFragment();
}
