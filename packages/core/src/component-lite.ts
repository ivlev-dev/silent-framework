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
import { isMatchNode } from "./match-node.js";
import { bindOwnerRuntimeOptions } from "./runtime-context.js";
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
): Node {
  const options = getRuntimeOptions();
  if (readMeta(componentFn) === null) {
    return createComponentLight(componentFn, props, options).node;
  }
  const creator = getComponentCreator();
  if (creator === null) {
    throw new ViewRuntimeUnavailableError();
  }
  return creator(componentFn, props, options).node;
}

interface PropsProxy {
  readonly value: Record<string, unknown>;
  update(next: Record<string, unknown>): void;
}

function createPropsProxy(initial: Record<string, unknown>): PropsProxy {
  let current = initial;
  const target: Record<PropertyKey, unknown> = {};
  const value = new Proxy(target, {
    get(_target, key, receiver): unknown {
      return Reflect.get(current, key, receiver);
    },
    has(_target, key): boolean {
      return key in current;
    },
    ownKeys(): ArrayLike<string | symbol> {
      return Reflect.ownKeys(current);
    },
    getOwnPropertyDescriptor(_target, key): PropertyDescriptor | undefined {
      const descriptor = Reflect.getOwnPropertyDescriptor(current, key);
      return descriptor === undefined
        ? undefined
        : { ...descriptor, configurable: true };
    },
    set(_target, key, next): boolean {
      return Reflect.set(current, key, next);
    },
    deleteProperty(_target, key): boolean {
      return Reflect.deleteProperty(current, key);
    },
  }) as Record<string, unknown>;
  return {
    value,
    update(next: Record<string, unknown>): void {
      current = next;
    },
  };
}

interface LightNodeEntry {
  readonly node: Node;
  readonly owned: boolean;
}

interface LightInstance {
  readonly fn: AnyComponent;
  readonly props: PropsProxy;
  readonly whenDisposed: Promise<void>;
  node: Node;
  single: boolean;
  readonly entries: LightNodeEntry[];
  owner: Owner | null;
  disposed: boolean;
  rootDispose: (() => void) | null;
  dispose(): void;
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

function hasDisposer(node: Node): boolean {
  const candidate = (node as unknown as Record<PropertyKey, unknown>)[NODE_DISPOSER];
  return typeof candidate === "function";
}

function disposeDescendants(node: Node): void {
  let child = node.firstChild;
  while (child !== null) {
    const next = child.nextSibling;
    disposeNode(child);
    child = next;
  }
}

function buildLightInstance(
  fn: AnyComponent,
  props: Record<string, unknown>,
  options: RuntimeOptions,
): LightInstance {
  const propsProxy = createPropsProxy(props);
  let output: unknown = null;
  let rootDispose: (() => void) | null = null;
  let owner: Owner | null = null;
  let disposed = false;
  let resolveDisposed: () => void = () => {};
  const whenDisposed = new Promise<void>((resolve) => {
    resolveDisposed = resolve;
  });

  runWithOwner(null, () => {
    createRoot((dispose) => {
      rootDispose = dispose;
      owner = getOwner();
      output = withRuntimeOptions(options, () =>
        (fn as unknown as (values: Record<string, unknown>) => unknown)(
          propsProxy.value,
        ),
      );
      return null;
    });
  });

  const instance: LightInstance = {
    fn,
    props: propsProxy,
    whenDisposed,
    node: document.createComment("silent-empty"),
    single: false,
    entries: [],
    owner,
    disposed: false,
    rootDispose,
    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      instance.disposed = true;
      resolveDisposed();
      const disposeRoot = instance.rootDispose;
      instance.rootDispose = null;
      disposeRoot?.();
      for (const entry of instance.entries) {
        if (entry.owned) {
          disposeDescendants(entry.node);
          entry.node.parentNode?.removeChild(entry.node);
        } else {
          disposeNode(entry.node);
        }
      }
      instance.entries.length = 0;
    },
  };
  instance.owner = owner;

  const matchNode =
    output instanceof Node && output instanceof Comment && isMatchNode(output);
  let nodes: Node[];
  if (matchNode) {
    nodes = [output as Comment];
  } else {
    const normalized = normalizeNodes(output);
    if (isHydrating()) {
      settleNodes(currentWindow()?.end ?? null, output);
    }
    nodes = extractMetadata(normalized);
  }

  const entries: LightNodeEntry[] = [];
  const attachable = nodes.length === 1;
  for (const node of nodes) {
    const owned = attachable && !hasDisposer(node);
    if (owned) {
      attachDisposer(node, instance.dispose);
    }
    entries.push({ node, owned });
  }
  instance.entries.push(...entries);

  if (nodes.length === 1) {
    instance.node = nodes[0]!;
    instance.single = true;
  } else {
    const fragment = document.createDocumentFragment();
    for (const child of nodes) {
      fragment.appendChild(child);
    }
    instance.node = fragment;
    instance.single = false;
  }

  return instance;
}

function lightResult(instance: LightInstance): ComponentResult {
  return {
    node: instance.node,
    ready: instance.single ? getOwnReady(instance.node) : RESOLVED_READY,
    settled: Promise.race([getReady(instance.node), instance.whenDisposed]),
    dispose: instance.dispose,
  };
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
  const owner = getOwner();
  if (owner === null) {
    return lightResult(buildLightInstance(component, props, options));
  }
  return lightFromCache(component, props, options, owner);
}
