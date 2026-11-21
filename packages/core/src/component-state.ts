import type { Container } from "@ivlev-dev/silent-di";
import { getOwner, onCleanup } from "@ivlev-dev/silent-reactivity";
import { runWithBoundary, type AsyncBoundary } from "./boundary.js";
import { VIEW_END, VIEW_START } from "./hydration-state.js";
import { bindOwnerRuntimeOptions, findOwnerRuntimeOptions } from "./runtime-context.js";
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
  const result = scoped ?? currentRuntimeOptions;
  if (isDisposedContainer(result.container)) {
    warnAmbient(result.container as object);
    if (result === currentRuntimeOptions) {
      currentRuntimeOptions = {};
    }
    return {};
  }
  return result;
}

/** Сбрасывает амбиентные runtime-опции (SSR-изоляция). @internal */
export function resetRuntimeOptions(): void {
  currentRuntimeOptions = {};
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
  const previous = currentRuntimeOptions;
  // Stale-инстансы light-компонентов могут хранить уже освобождённый view-
  // контейнер. Освобождённый контейнер не устанавливается амбиентным:
  // актуальный контейнер передаёт владелец/роутер.
  const effective: RuntimeOptions = isDisposedContainer(options.container)
    ? { ...options, container: undefined }
    : options;
  if (isDisposedContainer(options.container)) {
    warnAmbient(options.container as object);
  }
  currentRuntimeOptions = effective;
  bindOwnerRuntimeOptions(getOwner(), effective);
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

export function trackPending<T>(
  promise: Promise<T>,
  signal?: AbortSignal | null,
): Promise<T> {
  if (signal !== undefined && signal !== null && signal.aborted) {
    return promise;
  }
  pending.add(promise);
  const remove = (): void => {
    pending.delete(promise);
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
  while (pending.size > 0) {
    await Promise.allSettled([...pending]);
  }
}

export function hasPendingWork(): boolean {
  return pending.size > 0;
}

export function callHook(target: object, name: string, ...args: unknown[]): void {
  const value = (target as Record<string, unknown>)[name];
  if (typeof value === "function") {
    value.apply(target, args);
  }
}

let readyNodes = 0;
let readyTraversals = 0;

export function setReady(node: Node, ready: Promise<void>): void {
  const host = node as ReadyHost;
  if (host[COMPONENT_READY] === undefined) {
    readyNodes += 1;
    const owner = getOwner();
    if (owner !== null) {
      onCleanup(() => clearReady(node));
    }
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
  if (readyNodes > 0) {
    readyNodes -= 1;
  }
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
  readyTraversals += 1;
  const promises: Promise<void>[] = [];
  collectReady(node, promises, new Set<Node>());
  if (promises.length === 0) {
    return RESOLVED_READY;
  }
  if (promises.length === 1) {
    return promises[0] ?? RESOLVED_READY;
  }
  return Promise.all(promises).then(() => undefined);
}

export async function whenSettled(node: Node): Promise<void> {
  await getReady(node);
  await whenIdle();
}
