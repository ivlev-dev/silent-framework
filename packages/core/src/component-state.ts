import type { Container } from "@ivlev-dev/silent-di";
import { getOwner } from "@ivlev-dev/silent-reactivity";
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
}

export interface ComponentResult {
  readonly node: Node;
  readonly ready: Promise<void>;
  readonly settled: Promise<void>;
  readonly dispose: () => void;
}

interface ReadyHost {
  [COMPONENT_READY]?: Promise<void>;
}

export const pending = new Set<Promise<unknown>>();
export const RESOLVED_READY: Promise<void> = Promise.resolve();
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

export function setComponentCreator(creator: ComponentCreator | null): void {
  componentCreator = creator;
}

export function getComponentCreator(): ComponentCreator | null {
  return componentCreator;
}

export function getRuntimeOptions(): RuntimeOptions {
  const scoped = findScopedRuntimeOptions();
  return scoped ?? currentRuntimeOptions;
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
  currentRuntimeOptions = options;
  bindOwnerRuntimeOptions(getOwner(), options);
  try {
    return options.boundary === undefined ? fn() : runWithBoundary(options.boundary, fn);
  } finally {
    currentRuntimeOptions = previous;
  }
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

export function setReady(node: Node, ready: Promise<void>): void {
  (node as ReadyHost)[COMPONENT_READY] = ready;
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
