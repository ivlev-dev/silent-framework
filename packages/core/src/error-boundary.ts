import {
  createRenderEffect,
  createRoot,
  getOwner,
  onCleanup,
  runWithOwner,
  type Owner,
} from "@ivlev-dev/silent-reactivity";
import * as reactivity from "@ivlev-dev/silent-reactivity";
import { getErrorHandler, getRuntimeOptions, withRuntimeOptions } from "./component.js";
import { findOwnerErrorHandler } from "./runtime-context.js";
import type { AnyComponent } from "./types.js";
import type { Children } from "./jsx.js";
import { collectNodes, createMountPoint, isServerMode } from "./dom.js";
import { extractMetadata } from "./metadata.js";
import { settleNodes } from "./dom-hydration-state.js";
import { beginRegion, regionMatches, settleWindow } from "./hydration-cursor.js";
import {
  ERROR_BOUNDARY,
  collectBetween,
  currentWindow,
  isHydrating,
  isMarker,
  mismatch,
  withWindow,
} from "./hydration-proxy.js";
import {
  getRuntimeContextStore,
  type RuntimeContextStore,
} from "./runtime-context-provider.js";


declare const __SILENT_HYDRATE__: boolean | undefined;

const HYDRATE =
  typeof __SILENT_HYDRATE__ === "undefined" || __SILENT_HYDRATE__;
export interface ErrorBoundaryProps {
  readonly fallback: (error: unknown, reset: () => void) => unknown;
  readonly children: unknown | (() => unknown);
}

interface BoundaryReporter {
  isActive(): boolean;
  report(error: unknown): boolean;
}

type EffectErrorHandler = (error: unknown, owner: Owner | null) => void;

const activeBoundaries: BoundaryReporter[] = [];
const scopedBoundaries = new WeakMap<RuntimeContextStore, BoundaryReporter[]>();
let dispatcherInstalled = false;

/**
 * Список активных границ текущего рендера. В SSR-store границы одного
 * запроса не должны перехватывать ошибки другого; на клиенте — общий список.
 */
function boundaryReporters(): BoundaryReporter[] {
  const store = getRuntimeContextStore();
  if (store === null) {
    return activeBoundaries;
  }
  let reporters = scopedBoundaries.get(store);
  if (reporters === undefined) {
    reporters = [];
    scopedBoundaries.set(store, reporters);
  }
  return reporters;
}

// Источник ошибки на уровне эффекта неизвестен, но глобальный обработчик
// ожидает компонент вторым аргументом.
const UNKNOWN_COMPONENT: AnyComponent = () => null;

function ensureEffectDispatcher(): void {
  if (dispatcherInstalled) {
    return;
  }
  const candidate = (
    reactivity as unknown as {
      setEffectErrorHandler?: (
        handler: EffectErrorHandler | null,
      ) => EffectErrorHandler | null;
    }
  ).setEffectErrorHandler;
  if (typeof candidate !== "function") {
    return;
  }
  dispatcherInstalled = true;
  candidate((error: unknown, owner: Owner | null) => {
    const scoped = findOwnerErrorHandler(owner);
    if (scoped !== null) {
      scoped(error);
      return;
    }
    const reporters = boundaryReporters();
    for (let index = reporters.length - 1; index >= 0; index -= 1) {
      const reporter = reporters[index];
      if (reporter !== undefined && reporter.isActive() && reporter.report(error)) {
        return;
      }
    }
    getErrorHandler()(error, UNKNOWN_COMPONENT);
  });
}

function registerEffectReporter(reporter: BoundaryReporter): void {
  if (getOwner() === null) {
    return;
  }
  const reporters = boundaryReporters();
  reporters.push(reporter);
  ensureEffectDispatcher();
  onCleanup(() => {
    const index = reporters.indexOf(reporter);
    if (index !== -1) {
      reporters.splice(index, 1);
    }
  });
}

declare const __SILENT_SERVER__: boolean | undefined;

const SERVER = typeof __SILENT_SERVER__ === "undefined" || __SILENT_SERVER__;

function resolve(value: unknown): unknown {
  let current = value;
  while (typeof current === "function") {
    current = (current as () => unknown)();
  }
  return current;
}

export function ErrorBoundary(props: ErrorBoundaryProps): Node {
  if (HYDRATE && isHydrating()) {
    return hydrateErrorBoundary(props);
  }
  if (SERVER && isServerMode()) {
    return renderErrorBoundaryServer(props);
  }

  const container = document.createDocumentFragment();
  const anchor = document.createComment(ERROR_BOUNDARY);
  container.appendChild(anchor);
  const mount = createMountPoint(container, anchor);
  const options = getRuntimeOptions();
  let disposed = false;
  let failed = false;

  // Отдельный owner для содержимого границы: ошибки эффектов внутри неё
  // должны попадать именно в эту границу, а не в соседнюю, привязанную к
  // тому же родительскому owner.
  let childrenRootDispose: (() => void) | null = null;
  const childrenOwner = createRoot((disposeChildren) => {
    childrenRootDispose = disposeChildren;
    return getOwner();
  });

  const guardedOptions = { ...options, onError: (error: unknown) => showFallback(error) };

  function showFallback(error: unknown): void {
    if (disposed) {
      return;
    }
    failed = true;
    runWithOwner(childrenOwner, () => {
      mount.render(
        withRuntimeOptions(options, () => resolve(props.fallback(error, reset))),
      );
    });
  }

  function reset(): void {
    if (disposed) {
      return;
    }
    failed = false;
    render();
  }

  function render(): void {
    if (disposed || failed) {
      return;
    }
    try {
      const value = runWithOwner(childrenOwner, () =>
        withRuntimeOptions(guardedOptions, () => resolve(props.children)),
      );
      if (failed) {
        return;
      }
      mount.render(value);
    } catch (error) {
      showFallback(error);
    }
  }

  registerEffectReporter({
    isActive: () => !disposed,
    report(error: unknown): boolean {
      if (disposed) {
        return false;
      }
      showFallback(error);
      return true;
    },
  });

  createRenderEffect(render);
  onCleanup(() => {
    disposed = true;
    try {
      mount.clear();
    } finally {
      const disposeChildren = childrenRootDispose;
      childrenRootDispose = null;
      disposeChildren?.();
    }
  });
  return container;
}

function renderErrorBoundaryServer(props: ErrorBoundaryProps): Node {
  const container = document.createDocumentFragment();
  const anchor = document.createComment(ERROR_BOUNDARY);
  container.appendChild(anchor);
  const options = getRuntimeOptions();
  let rendered: Node[] = [];
  let failed = false;

  const clear = (): void => {
    for (const node of rendered) {
      container.removeChild(node);
    }
    rendered = [];
  };

  const append = (value: unknown): void => {
    const nodes = extractMetadata(collectNodes(value as Children));
    for (const node of nodes) {
      container.insertBefore(node, anchor);
      rendered.push(node);
    }
  };

  const showFallback = (error: unknown): void => {
    if (failed) {
      return;
    }
    failed = true;
    clear();
    append(
      withRuntimeOptions(options, () => resolve(props.fallback(error, () => {}))),
    );
  };

  const guardedOptions = { ...options, onError: showFallback };

  try {
    const value = withRuntimeOptions(guardedOptions, () => resolve(props.children));
    if (!failed) {
      append(value);
    }
  } catch (error) {
    showFallback(error);
  }

  return container;
}

function hydrateErrorBoundary(props: ErrorBoundaryProps): Node {
  const outer = currentWindow();
  if (outer === null) {
    return mismatch("ErrorBoundary вне окна гидрации");
  }
  const anchor = outer.end.previousSibling;
  if (!isMarker(anchor, ERROR_BOUNDARY)) {
    return mismatch("не найден якорь ErrorBoundary");
  }
  const parent = anchor.parentNode;
  if (parent === null) {
    return mismatch("якорь ErrorBoundary отсоединён");
  }

  const mount = createMountPoint(parent, anchor, collectBetween(outer.start, anchor));
  const options = getRuntimeOptions();
  const window = beginRegion(outer, anchor);
  let settled = false;
  let failed = false;
  let disposed = false;

  let childrenRootDispose: (() => void) | null = null;
  const childrenOwner = createRoot((disposeChildren) => {
    childrenRootDispose = disposeChildren;
    return getOwner();
  });

  const showFallback = (error: unknown): void => {
    if (disposed) {
      return;
    }
    failed = true;
    if (settled) {
      const fallback = runWithOwner(childrenOwner, () =>
        withRuntimeOptions(options, () => resolve(props.fallback(error, reset))),
      );
      mount.render(fallback);
      return;
    }
    const fallback = runWithOwner(childrenOwner, () =>
      withRuntimeOptions(options, () =>
        withWindow(window, () => resolve(props.fallback(error, reset))),
      ),
    );
    if (!regionMatches(window, anchor, fallback)) {
      return mismatch("содержимое ErrorBoundary не совпало");
    }
    settleWindow(outer, anchor);
    settleNodes(anchor, fallback);
    settled = true;
  };

  const guardedOptions = { ...options, onError: showFallback };

  const render = (): void => {
    if (failed) {
      return;
    }
    try {
      if (!settled) {
        const value = runWithOwner(childrenOwner, () =>
          withRuntimeOptions(guardedOptions, () =>
            withWindow(window, () => resolve(props.children)),
          ),
        );
        if (failed) {
          return;
        }
        if (!regionMatches(window, anchor, value)) {
          mismatch("содержимое ErrorBoundary не совпало");
        }
        settleWindow(outer, anchor);
        settleNodes(anchor, value);
        settled = true;
        return;
      }
      const value = runWithOwner(childrenOwner, () =>
        withRuntimeOptions(guardedOptions, () => resolve(props.children)),
      );
      if (failed) {
        return;
      }
      mount.render(value);
    } catch (error) {
      showFallback(error);
    }
  };

  const reset = (): void => {
    if (disposed) {
      return;
    }
    failed = false;
    render();
  };

  registerEffectReporter({
    isActive: () => !disposed,
    report(error: unknown): boolean {
      if (disposed) {
        return false;
      }
      showFallback(error);
      return true;
    },
  });

  createRenderEffect(render);
  onCleanup(() => {
    disposed = true;
    try {
      mount.clear();
    } finally {
      const disposeChildren = childrenRootDispose;
      childrenRootDispose = null;
      disposeChildren?.();
    }
  });
  return document.createDocumentFragment();
}
