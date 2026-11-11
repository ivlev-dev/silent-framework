import type { Container } from "@ivlev-dev/silent-di";
import { runWithBoundary, type AsyncBoundary } from "./boundary.js";
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
  return currentRuntimeOptions;
}

export function getDefaultPreloader(): Preloader | null {
  return defaultPreloader;
}

export function withRuntimeOptions<T>(options: RuntimeOptions, fn: () => T): T {
  const previous = currentRuntimeOptions;
  currentRuntimeOptions = options;
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

export function trackPending<T>(promise: Promise<T>): Promise<T> {
  pending.add(promise);
  void promise.then(
    () => pending.delete(promise),
    () => pending.delete(promise),
  );
  return promise;
}

export function trackAsyncWork<T>(promise: Promise<T>): Promise<T> {
  return trackPending(promise);
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

export function getReady(node: Node): Promise<void> {
  const host = node as ReadyHost;
  const ready = host[COMPONENT_READY];
  if (ready !== undefined) {
    return ready;
  }
  if (node instanceof DocumentFragment) {
    let child = node.firstChild;
    while (child !== null) {
      const childReady = (child as ReadyHost)[COMPONENT_READY];
      if (childReady !== undefined) {
        return childReady;
      }
      child = child.nextSibling;
    }
  }
  return RESOLVED_READY;
}
