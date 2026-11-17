import type { Children } from "./jsx.js";
import type { AnyComponent, Preloader, ViewMeta } from "./types.js";
import {
  createRoot,
  getOwner,
  onCleanup,
  runWithOwner,
  type Owner,
} from "@ivlev-dev/silent-reactivity";
import { NODE_DISPOSER, attachDisposer, collectNodes, disposeNode } from "./dom.js";
import { settleNodes } from "./dom-hydration-state.js";
import { extractMetadata } from "./metadata.js";
import { currentWindow, isHydrating } from "./hydration-state.js";
import { isMarkerComponent, isMatchNode } from "./match-node.js";
import { bindOwnerRuntimeOptions } from "./runtime-context.js";
import { createPropsProxy, type PropsProxy } from "./props-proxy.js";
import { registerPropsUpdater } from "./props-update.js";
import { adoptContextValues, captureContextValues, type ContextValues } from "./context-link.js";
import {
  COMPONENT_DISPOSE,
  PRELOADER,
  RESOLVED_READY,
  VIEW_META,
  ViewRuntimeUnavailableError,
  getComponentCreator,
  getOwnReady,
  getReady,
  getRuntimeOptions,
  hasRuntimeOptions,
  withRuntimeOptions,
  type ComponentResult,
  type RuntimeOptions,
} from "./component-state.js";

interface DisposeHost {
  [COMPONENT_DISPOSE]?: () => void;
}

export function readMeta(component: AnyComponent): ViewMeta | null {
  const candidate = (component as unknown as Record<PropertyKey, unknown>)[
    VIEW_META
  ];
  if (candidate === null || typeof candidate !== "object") {
    return null;
  }
  const meta = candidate as Record<PropertyKey, unknown>;
  const vm = meta["vm"];
  if (vm === undefined) {
    return null;
  }
  const result: {
    vm: unknown;
    preloader?: Preloader;
    preloaderName?: string;
    name?: string;
    moduleId?: string;
  } = { vm };
  const preloader = meta["preloader"];
  if (typeof preloader === "function") {
    result.preloader = preloader as Preloader;
  }
  const preloaderName = meta["preloaderName"];
  if (typeof preloaderName === "string") {
    result.preloaderName = preloaderName;
  }
  const name = meta["name"];
  if (typeof name === "string") {
    result.name = name;
  }
  const moduleId = meta["moduleId"];
  if (typeof moduleId === "string") {
    result.moduleId = moduleId;
  }
  return result;
}

export function getViewMeta(component: AnyComponent): ViewMeta | null {
  return readMeta(component);
}

export function setPreloader<C extends AnyComponent>(
  component: C,
  preloader: Preloader,
): C {
  (component as unknown as Record<PropertyKey, unknown>)[PRELOADER] = preloader;
  return component;
}

export const setFallback = setPreloader;

export function getComponentName(component: AnyComponent): string {
  const meta = readMeta(component);
  if (meta?.name !== undefined) {
    return meta.name;
  }
  return component.name || "Anonymous";
}

export function isViewComponent(componentFn: AnyComponent): boolean {
  return readMeta(componentFn) !== null;
}

export function getComponentDispose(node: Node): (() => void) | null {
  const dispose = (node as DisposeHost)[COMPONENT_DISPOSE];
  return typeof dispose === "function" ? dispose : null;
}

export function normalizeNodes(value: unknown): Node[] {
  return collectNodes(value as Children);
}

export function toNode(value: unknown): Node {
  const nodes = normalizeNodes(value);
  if (nodes.length === 1) {
    const node = nodes[0];
    if (node !== undefined) {
      return node;
    }
  }
  const fragment = document.createDocumentFragment();
  for (const node of nodes) {
    fragment.appendChild(node);
  }
  return fragment;
}

export function component(
  componentFn: AnyComponent,
  props: Record<string, unknown>,
  runtimeOptions?: RuntimeOptions,
): Node {
  if (isMarkerComponent(componentFn)) {
    return (componentFn as unknown as (values: Record<string, unknown>) => Node)(props);
  }
  const options =
    runtimeOptions === undefined
      ? getRuntimeOptions()
      : { ...getRuntimeOptions(), ...runtimeOptions };
  if (readMeta(componentFn) === null) {
    return createComponentLight(componentFn, props, options).node;
  }
  const creator = getComponentCreator();
  if (creator === null) {
    throw new ViewRuntimeUnavailableError();
  }
  return creator(componentFn, props, options).node;
}

interface LightNodeEntry {
  readonly node: Node;
  readonly owned: boolean;
}

interface LightInstance {
  readonly fn: AnyComponent;
  readonly props: PropsProxy;
  readonly whenDisposed: Promise<void>;
  readonly options: RuntimeOptions;
  readonly contextValues: ContextValues | null;
  node: Node;
  single: boolean;
  readonly entries: LightNodeEntry[];
  owner: Owner | null;
  disposed: boolean;
  rootDispose: (() => void) | null;
  renderRootDispose: (() => void) | null;
  readonly disposeMarker: () => void;
  updateProps(props: Record<string, unknown>): void;
  dispose(): void;
}

interface LightBuilt {
  readonly nodes: Node[];
  readonly entries: LightNodeEntry[];
  readonly node: Node;
  readonly single: boolean;
}

interface FocusSnapshot {
  readonly id: string | null;
  readonly name: string | null;
  readonly tag: string;
  readonly index: number;
  readonly selectionStart: number | null;
  readonly selectionEnd: number | null;
  readonly selectionDirection: string | null;
}

function collectElements(node: Node, out: Element[]): void {
  if (node.nodeType === 1) {
    out.push(node as Element);
  }
  let child = node.firstChild;
  while (child !== null) {
    collectElements(child, out);
    child = child.nextSibling;
  }
}

function selectionOf(element: Element): {
  start: number | null;
  end: number | null;
  direction: string | null;
} {
  const candidate = element as unknown as {
    selectionStart?: unknown;
    selectionEnd?: unknown;
    selectionDirection?: unknown;
  };
  return {
    start: typeof candidate.selectionStart === "number" ? candidate.selectionStart : null,
    end: typeof candidate.selectionEnd === "number" ? candidate.selectionEnd : null,
    direction:
      typeof candidate.selectionDirection === "string"
        ? candidate.selectionDirection
        : null,
  };
}

function captureFocus(entries: readonly LightNodeEntry[]): FocusSnapshot | null {
  if (typeof document === "undefined") {
    return null;
  }
  const active = document.activeElement;
  if (active === null || active === document.body) {
    return null;
  }
  const elements: Element[] = [];
  for (const entry of entries) {
    collectElements(entry.node, elements);
  }
  const index = elements.indexOf(active as Element);
  if (index === -1) {
    return null;
  }
  const selection = selectionOf(active as Element);
  return {
    id: active.getAttribute("id"),
    name: active.getAttribute("name"),
    tag: active.tagName,
    index,
    selectionStart: selection.start,
    selectionEnd: selection.end,
    selectionDirection: selection.direction,
  };
}

function restoreFocus(
  snapshot: FocusSnapshot | null,
  nodes: readonly Node[],
): void {
  if (snapshot === null || typeof document === "undefined") {
    return;
  }
  const elements: Element[] = [];
  for (const node of nodes) {
    collectElements(node, elements);
  }
  let candidate: Element | null = null;
  if (snapshot.id !== null) {
    candidate = elements.find((element) => element.getAttribute("id") === snapshot.id) ?? null;
  }
  if (candidate === null && snapshot.name !== null) {
    candidate =
      elements.find((element) => element.getAttribute("name") === snapshot.name) ?? null;
  }
  if (candidate === null) {
    const sameTag = elements.filter((element) => element.tagName === snapshot.tag);
    candidate =
      sameTag.find((_element, index) => index === snapshot.index)
      ?? sameTag[0]
      ?? null;
  }
  if (candidate === null) {
    return;
  }
  const focus = (candidate as unknown as { focus?: () => void }).focus;
  if (typeof focus === "function") {
    focus.call(candidate);
  }
  if (snapshot.selectionStart === null || snapshot.selectionEnd === null) {
    return;
  }
  const target = candidate as unknown as {
    setSelectionRange?: (start: number, end: number, direction?: string) => void;
  };
  if (typeof target.setSelectionRange === "function") {
    const start = snapshot.selectionStart;
    const end = snapshot.selectionEnd;
    target.setSelectionRange(start, end, snapshot.selectionDirection ?? undefined);
  }
}

function disposeLightEntry(entry: LightNodeEntry): void {
  if (entry.owned) {
    disposeDescendants(entry.node);
    entry.node.parentNode?.removeChild(entry.node);
    return;
  }
  disposeNode(entry.node);
}

function buildLightOutput(
  instance: LightInstance,
  output: unknown,
  initial: boolean,
): LightBuilt {
  const matchNode =
    output instanceof Node && output instanceof Comment && isMatchNode(output);
  let nodes: Node[];
  if (matchNode) {
    nodes = [output as Comment];
  } else {
    if (initial && isHydrating()) {
      settleNodes(currentWindow()?.end ?? null, output);
    }
    const normalized = normalizeNodes(output);
    nodes = extractMetadata(normalized);
  }

  const entries: LightNodeEntry[] = [];
  const attachable = nodes.length === 1;
  for (const node of nodes) {
    const disposer = (node as unknown as Record<PropertyKey, unknown>)[NODE_DISPOSER];
    const owned =
      attachable
      && (typeof disposer !== "function" || disposer === instance.disposeMarker);
    if (owned) {
      attachDisposer(node, instance.disposeMarker);
    }
    entries.push({ node, owned });
  }

  if (nodes.length === 1) {
    return { nodes, entries, node: nodes[0]!, single: true };
  }
  const fragment = document.createDocumentFragment();
  for (const child of nodes) {
    fragment.appendChild(child);
  }
  return { nodes, entries, node: fragment, single: false };
}

function registerLightUpdaters(instance: LightInstance): void {
  registerPropsUpdater(instance.node, instance.updateProps);
  for (const entry of instance.entries) {
    registerPropsUpdater(entry.node, instance.updateProps);
  }
}

function refreshLightInstance(instance: LightInstance, initial: boolean): void {
  if (instance.disposed) {
    return;
  }
  const previousEntries = instance.entries.slice();
  const previousNode = instance.node;
  const connected = previousEntries
    .map((entry) => entry.node)
    .find((node) => node.parentNode !== null) ?? null;
  const anchor =
    connected ?? (previousNode.parentNode !== null ? previousNode : null);
  const focus = captureFocus(previousEntries);

  let output: unknown = null;
  const previousRoot = instance.renderRootDispose;
  instance.renderRootDispose = null;
  previousRoot?.();

  let owner: Owner | null = null;
  runWithOwner(null, () => {
    createRoot((dispose) => {
      instance.renderRootDispose = dispose;
      owner = getOwner();
      adoptContextValues(owner, instance.contextValues);
      const render = (): unknown =>
        (instance.fn as unknown as (values: Record<string, unknown>) => unknown)(
          instance.props.value,
        );
      output = hasRuntimeOptions(instance.options)
        ? withRuntimeOptions(instance.options, render)
        : render();
      return null;
    });
  });
  instance.owner = owner;

  const built = buildLightOutput(instance, output, initial);
  const parent = anchor === null ? null : anchor.parentNode;
  if (parent !== null) {
    for (const node of built.nodes) {
      if (node.parentNode !== parent) {
        parent.insertBefore(node, anchor);
      }
    }
  }

  const nextNodes = new Set(built.nodes);
  for (const entry of previousEntries) {
    if (!nextNodes.has(entry.node)) {
      disposeLightEntry(entry);
    }
  }

  instance.entries.length = 0;
  instance.entries.push(...built.entries);
  instance.node = built.node;
  instance.single = built.single;
  registerLightUpdaters(instance);
  restoreFocus(focus, built.nodes);
}

function buildLightInstance(
  fn: AnyComponent,
  props: Record<string, unknown>,
  options: RuntimeOptions,
): LightInstance {
  const inheritedContext = captureContextValues();
  const propsProxy = createPropsProxy(props);
  let instanceRootDispose: (() => void) | null = null;

  let resolveDisposed: () => void = () => {};
  const whenDisposed = new Promise<void>((resolve) => {
    resolveDisposed = resolve;
  });

  const instance: LightInstance = {
    fn,
    props: propsProxy,
    whenDisposed,
    options,
    contextValues: inheritedContext,
    node: document.createComment("silent-empty"),
    single: false,
    entries: [],
    owner: null,
    disposed: false,
    rootDispose: instanceRootDispose,
    renderRootDispose: null,
    disposeMarker: () => instance.dispose(),
    updateProps(next: Record<string, unknown>): void {
      if (instance.disposed) {
        return;
      }
      const observed = instance.props.update(next);
      if (!observed) {
        refreshLightInstance(instance, false);
      }
    },
    dispose(): void {
      if (instance.disposed) {
        return;
      }
      instance.disposed = true;
      resolveDisposed();
      const disposeRender = instance.renderRootDispose;
      instance.renderRootDispose = null;
      disposeRender?.();
      const disposeRoot = instance.rootDispose;
      instance.rootDispose = null;
      disposeRoot?.();
      for (const entry of instance.entries) {
        disposeLightEntry(entry);
      }
      instance.entries.length = 0;
    },
  };

  refreshLightInstance(instance, true);
  return instance;
}

function lightResult(instance: LightInstance): ComponentResult {
  registerLightUpdaters(instance);
  return {
    get node(): Node {
      return instance.node;
    },
    ready: instance.single ? getOwnReady(instance.node) : RESOLVED_READY,
    settled: Promise.race([getReady(instance.node), instance.whenDisposed]),
    update: instance.updateProps,
    dispose: instance.dispose,
  };
}

interface LightSlot {
  fn: AnyComponent | null;
  instance: LightInstance | null;
}

interface LightOwnerCache {
  readonly slots: LightSlot[];
  readonly instances: Set<LightInstance>;
  cursor: number;
}

const lightCaches = new WeakMap<Owner, LightOwnerCache>();
const lightCacheCleanup = new WeakSet<Owner>();

function cacheFor(owner: Owner): LightOwnerCache {
  let cache = lightCaches.get(owner);
  if (cache === undefined) {
    cache = { slots: [], instances: new Set<LightInstance>(), cursor: 0 };
    lightCaches.set(owner, cache);
  }
  if (!lightCacheCleanup.has(owner)) {
    lightCacheCleanup.add(owner);
    onCleanup(() => {
      lightCacheCleanup.delete(owner);
      if (owner.disposed) {
        for (const instance of cache.instances) {
          instance.dispose();
        }
        cache.instances.clear();
        cache.slots.length = 0;
        lightCaches.delete(owner);
        return;
      }
      cache.cursor = 0;
    });
  }
  return cache;
}

function disposeDescendants(node: Node): void {
  let child = node.firstChild;
  while (child !== null) {
    const next = child.nextSibling;
    disposeNode(child);
    child = next;
  }
}

function lightFromCache(
  fn: AnyComponent,
  props: Record<string, unknown>,
  options: RuntimeOptions,
  owner: Owner,
): ComponentResult {
  const cache = cacheFor(owner);
  const index = cache.cursor;
  cache.cursor += 1;
  let slot = cache.slots[index];
  if (slot === undefined) {
    slot = { fn: null, instance: null };
    cache.slots[index] = slot;
  }
  if (slot.fn !== fn) {
    slot.instance?.dispose();
    slot.instance = null;
    slot.fn = fn;
  }
  const existing = slot.instance;
  if (existing !== null && !existing.disposed && existing.single) {
    existing.props.update(props);
    bindOwnerRuntimeOptions(existing.owner, options);
    adoptContextValues(existing.owner, captureContextValues());
    return lightResult(existing);
  }
  const instance = buildLightInstance(fn, props, options);
  cache.instances.add(instance);
  slot.instance = instance.single ? instance : null;
  return lightResult(instance);
}

export function createComponentLight(
  component: AnyComponent,
  props: Record<string, unknown>,
  options: RuntimeOptions,
): ComponentResult {
  if (isMarkerComponent(component)) {
    const node = (component as unknown as (values: Record<string, unknown>) => Node)(props);
    return {
      node,
      ready: RESOLVED_READY,
      settled: RESOLVED_READY,
      update: () => {},
      dispose: () => {},
    };
  }
  const owner = getOwner();
  if (owner === null) {
    return lightResult(buildLightInstance(component, props, options));
  }
  return lightFromCache(component, props, options, owner);
}
