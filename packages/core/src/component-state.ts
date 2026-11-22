import type { Container } from "@ivlev-dev/silent-di";
import { getOwner, onCleanup } from "@ivlev-dev/silent-reactivity";
import { runWithBoundary, type AsyncBoundary } from "./boundary.js";
import { VIEW_END, VIEW_START } from "./hydration-state.js";
import { bindOwnerRuntimeOptions, findOwnerRuntimeOptions } from "./runtime-context.js";
import { getRuntimeContextStore } from "./runtime-context-provider.js";
import type { AnyComponent, Preloader } from "./types.js";

export const VIEW_META = Symbol.for("silent.view");
export const PRELOADER = Symbol.for("silent.preloader");
export const COMPONENT_READY = Symbol.for("silent.ready");
export const COMPONENT_DISPOSE = Symbol.for("silent.dispose");

export interface RuntimeOptions {
  readonly container?: Container | undefined;
  readonly preloader?: Preloader | null | undefined;
  readonly onError?: ((error: unknown, component: AnyComponent) => void) | undefined;
  readonly boundary?: AsyncBoundary | null | undefined;
  readonly hydrate?: boolean | undefined;
}

export interface ComponentResult {
  readonly node: Node;
  readonly ready: Promise<void>;
  readonly settled: Promise<void>;
  readonly update: (props: Record<string, unknown>) => void;
  readonly dispose: () => void;
}

interface ReadyHost {
  [COMPONENT_READY]?: Promise<void>;
}

export const pending = /*#__PURE__*/ new Set<Promise<unknown>>();
export const RESOLVED_READY: Promise<void> = /*#__PURE__*/ Promise.resolve();
export let defaultPreloader: Preloader | null = null;
export let defaultErrorHandler: (error: unknown, component: AnyComponent) => void = (
  error,
) => {
  console.error(error);
};

export type ComponentCreator = (
  component: AnyComponent,
  props: Record<string, unknown>,
  options: RuntimeOptions,
) => ComponentResult;

export class ViewRuntimeUnavailableError extends Error {
  constructor() {
    super("View-рантайм не загружен для компонента с ViewModel");
    this.name = "ViewRuntimeUnavailableError";
  }
}

let componentCreator: ComponentCreator | null = null;
let currentRuntimeOptions: RuntimeOptions = {};

declare const __SILENT_DEV__: boolean | undefined;
const DEV = typeof __SILENT_DEV__ === "undefined" || __SILENT_DEV__;
const warnedAmbient = new WeakSet<object>();

function diagnosticsEnabled(): boolean {
  if (!DEV) {
    return false;
  }
  const host = globalThis as { __SILENT_DEBUG_RUNTIME__?: unknown };
  if (host.__SILENT_DEBUG_RUNTIME__ === true) {
    return true;
  }
  const env = (globalThis as {
    process?: { env?: Readonly<Record<string, string | undefined>> };
  }).process?.env;
  return env?.SILENT_DEBUG_RUNTIME === "1";
}

function isDisposedContainer(container: unknown): boolean {
  return (
    typeof container === "object"
    && container !== null
    && (container as { disposed?: unknown }).disposed === true
  );
}

export function setComponentCreator(creator: ComponentCreator | null): void {
  componentCreator = creator;
}

export function getComponentCreator(): ComponentCreator | null {
  return componentCreator;
}

export function getRuntimeOptions(): RuntimeOptions {
  const scoped = findScopedRuntimeOptions();
  const store = scoped === undefined ? getRuntimeContextStore() : null;
  const result = scoped ?? store?.options ?? currentRuntimeOptions;
  if (isDisposedContainer(result.container)) {
    warnAmbient(result.container as object);
    if (result === currentRuntimeOptions) {
      currentRuntimeOptions = {};
    } else if (store !== null && result === store.options) {
      store.options = {};
    }
    return {};
  }
  return result;
}

/** Сбрасывает амбиентные runtime-опции (SSR-изоляция). @internal */
export function resetRuntimeOptions(): void {
  currentRuntimeOptions = {};
  const store = getRuntimeContextStore();
  if (store !== null) {
    store.options = {};
  }
}

function findScopedRuntimeOptions(): RuntimeOptions | undefined {
  const owner = getOwner();
  if (owner === null) {
    return undefined;
  }
  return findOwnerRuntimeOptions(owner);
}

export function getDefaultPreloader(): Preloader | null {
  return defaultPreloader;
}

export function withRuntimeOptions<T>(options: RuntimeOptions, fn: () => T): T {
  // Stale-инстансы light-компонентов могут хранить уже освобождённый view-
  // контейнер. Освобождённый контейнер не устанавливается амбиентным:
  // актуальный контейнер передаёт владелец/роутер.
  const effective: RuntimeOptions = isDisposedContainer(options.container)
    ? { ...options, container: undefined }
    : options;
  if (isDisposedContainer(options.container)) {
    warnAmbient(options.container as object);
  }
  bindOwnerRuntimeOptions(getOwner(), effective);
  const store = getRuntimeContextStore();
  if (store !== null) {
    const previous = store.options;
    store.options = effective;
    try {
      return effective.boundary === undefined ? fn() : runWithBoundary(effective.boundary, fn);
    } finally {
      store.options = previous;
    }
  }
  const previous = currentRuntimeOptions;
  currentRuntimeOptions = effective;
  try {
    return effective.boundary === undefined ? fn() : runWithBoundary(effective.boundary, fn);
  } finally {
    currentRuntimeOptions = previous;
  }
}

function warnAmbient(container: object): void {
  if (!diagnosticsEnabled() || warnedAmbient.has(container)) {
    return;
  }
  warnedAmbient.add(container);
  const name = (container as { name?: unknown }).name;
  console.warn(
    `[silent] runtime options: освобождённый контейнер "${typeof name === "string" ? name : "?"}" не используется`,
  );
}

export function hasRuntimeOptions(options: RuntimeOptions): boolean {
  return (
    options.container !== undefined ||
    options.preloader !== undefined ||
    options.onError !== undefined ||
    options.boundary !== undefined ||
    options.hydrate !== undefined
  );
}

export function setDefaultPreloader(preloader: Preloader | null): void {
  defaultPreloader = preloader;
}

export function setErrorHandler(
  handler: ((error: unknown, component: AnyComponent) => void) | null,
): void {
  defaultErrorHandler =
    handler ??
    ((error) => {
      console.error(error);
    });
}

export function getErrorHandler(): (error: unknown, component: AnyComponent) => void {
  return defaultErrorHandler;
}

function pendingTarget(): Set<Promise<unknown>> {
  const store = getRuntimeContextStore();
  return store === null ? pending : store.pending;
}

export function trackPending<T>(
  promise: Promise<T>,
  signal?: AbortSignal | null,
): Promise<T> {
  if (signal !== undefined && signal !== null && signal.aborted) {
    return promise;
  }
  const target = pendingTarget();
  target.add(promise);
  const remove = (): void => {
    target.delete(promise);
    signal?.removeEventListener("abort", remove);
  };
  void promise.then(remove, remove);
  signal?.addEventListener("abort", remove, { once: true });
  return promise;
}

export function trackAsyncWork<T>(
  promise: Promise<T>,
  signal?: AbortSignal | null,
): Promise<T> {
  return trackPending(promise, signal);
}

export async function whenIdle(): Promise<void> {
  // Ждём набор текущей async-цепочки (store) либо общий (legacy).
  const target = pendingTarget();
  while (target.size > 0) {
    await Promise.allSettled([...target]);
  }
}

export function hasPendingWork(): boolean {
  return pendingTarget().size > 0;
}

export function callHook(target: object, name: string, ...args: unknown[]): void {
  const value = (target as Record<string, unknown>)[name];
  if (typeof value === "function") {
    value.apply(target, args);
  }
}

let readyNodes = 0;
let readyTraversals = 0;
let readyEpoch = 0;

const READY_COUNT = Symbol.for("silent.ready.count");
const READY_VERSION = Symbol.for("silent.ready.version");
const READY_CACHE = Symbol.for("silent.ready.cache");
const readyNodeSet = new Set<Node>();

interface ReadyCountHost {
  [READY_COUNT]?: number;
  [READY_VERSION]?: number;
  [READY_CACHE]?: ReadyCacheEntry;
}

interface ReadyCacheEntry {
  readonly version: number;
  readonly epoch: number;
  readonly promise: Promise<void>;
}

/**
 * Обновляет счётчик ready-узлов по цепочке предков и инкрементирует версию:
 * getReady может пропустить поддерево без ready-узлов и переиспользовать
 * ранее собранный промис, пока в поддереве ничего не менялось.
 */
function touchReadyPath(node: Node, delta: number): void {
  readyEpoch += 1;
  let current: Node | null = node;
  while (current !== null) {
    const host = current as ReadyCountHost;
    host[READY_VERSION] = (host[READY_VERSION] ?? 0) + 1;
    const count = (host[READY_COUNT] ?? 0) + delta;
    if (count > 0) {
      host[READY_COUNT] = count;
    } else {
      delete host[READY_COUNT];
    }
    current = current.parentNode;
  }
}

/**
 * Узлы можно переносить между фрагментами после setReady (например,
 * flattening списка компонентов), поэтому счётчик предков может быть
 * неактуален. Проверяем вхождение по самим ready-узлам — их обычно немного.
 */
function subtreeHasReady(node: Node): boolean {
  if (readyNodeSet.size === 0) {
    return false;
  }
  for (const candidate of readyNodeSet) {
    let current: Node | null = candidate;
    while (current !== null) {
      if (current === node) {
        return true;
      }
      current = current.parentNode;
    }
  }
  return false;
}

export function setReady(node: Node, ready: Promise<void>): void {
  const host = node as ReadyHost;
  if (host[COMPONENT_READY] === undefined) {
    readyNodes += 1;
    readyNodeSet.add(node);
    touchReadyPath(node, 1);
    const owner = getOwner();
    if (owner !== null) {
      onCleanup(() => clearReady(node));
    }
  } else {
    // Промис заменён — собранный ранее aggregate недействителен.
    touchReadyPath(node, 0);
  }
  host[COMPONENT_READY] = ready;
}

/**
 * Снимает признак ready с узла: счётчик готовых узлов должен убывать, иначе
 * fast-path в getReady отключается навсегда после первого ready-компонента.
 */
export function clearReady(node: Node): void {
  const host = node as ReadyHost;
  if (host[COMPONENT_READY] === undefined) {
    return;
  }
  delete host[COMPONENT_READY];
  readyNodeSet.delete(node);
  if (readyNodes > 0) {
    readyNodes -= 1;
  }
  touchReadyPath(node, -1);
}

/** Внутренняя диагностика для тестов: размер учёта ready и число обходов. */
export function getReadyStats(): { readonly nodes: number; readonly traversals: number } {
  return { nodes: readyNodes, traversals: readyTraversals };
}

export function getOwnReady(node: Node): Promise<void> {
  const ready = (node as ReadyHost)[COMPONENT_READY];
  return ready ?? RESOLVED_READY;
}

function collectReady(
  node: Node,
  promises: Promise<void>[],
  seen: Set<Node>,
): void {
  if (seen.has(node)) {
    return;
  }
  seen.add(node);
  const own = (node as ReadyHost)[COMPONENT_READY];
  if (own !== undefined) {
    promises.push(own);
  }
  if (node.nodeType === 8 && (node as Comment).data === VIEW_START) {
    let sibling = node.nextSibling;
    while (sibling !== null) {
      collectReady(sibling, promises, seen);
      if (sibling.nodeType === 8 && (sibling as Comment).data === VIEW_END) {
        return;
      }
      sibling = sibling.nextSibling;
    }
    return;
  }
  let child = node.firstChild;
  while (child !== null) {
    collectReady(child, promises, seen);
    child = child.nextSibling;
  }
}

export function getReady(node: Node): Promise<void> {
  if (readyNodes === 0) {
    return RESOLVED_READY;
  }
  const host = node as ReadyCountHost;
  if ((host[READY_COUNT] ?? 0) === 0 && !subtreeHasReady(node)) {
    return RESOLVED_READY;
  }
  const version = host[READY_VERSION] ?? 0;
  const cache = host[READY_CACHE];
  if (
    cache !== undefined &&
    cache.version === version &&
    cache.epoch === readyEpoch
  ) {
    return cache.promise;
  }
  readyTraversals += 1;
  const promises: Promise<void>[] = [];
  collectReady(node, promises, new Set<Node>());
  let promise: Promise<void>;
  if (promises.length === 0) {
    promise = RESOLVED_READY;
  } else if (promises.length === 1) {
    promise = promises[0] ?? RESOLVED_READY;
  } else {
    promise = Promise.all(promises).then(() => undefined);
  }
  host[READY_CACHE] = { version, epoch: readyEpoch, promise };
  return promise;
}

export async function whenSettled(node: Node): Promise<void> {
  await getReady(node);
  await whenIdle();
}
