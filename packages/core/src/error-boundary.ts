import {
  createRenderEffect,
  getOwner,
  onCleanup,
} from "@ivlev-dev/silent-reactivity";
import * as reactivity from "@ivlev-dev/silent-reactivity";
import { getRuntimeOptions, withRuntimeOptions } from "./component.js";
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

type EffectErrorHandler = (error: unknown) => void;

const activeBoundaries: BoundaryReporter[] = [];
let dispatcherInstalled = false;
let fallbackEffectHandler: EffectErrorHandler | null = null;

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
  fallbackEffectHandler = candidate((error: unknown) => {
    for (let index = activeBoundaries.length - 1; index >= 0; index -= 1) {
      const reporter = activeBoundaries[index];
      if (reporter !== undefined && reporter.isActive() && reporter.report(error)) {
        return;
      }
    }
    fallbackEffectHandler?.(error);
  });
}

function registerEffectReporter(reporter: BoundaryReporter): void {
  if (getOwner() === null) {
    return;
  }
  activeBoundaries.push(reporter);
  ensureEffectDispatcher();
  onCleanup(() => {
    const index = activeBoundaries.indexOf(reporter);
    if (index !== -1) {
      activeBoundaries.splice(index, 1);
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

  const guardedOptions = { ...options, onError: (error: unknown) => showFallback(error) };

  function showFallback(error: unknown): void {
    if (disposed) {
      return;
    }
    failed = true;
    mount.render(
      withRuntimeOptions(options, () => resolve(props.fallback(error, reset))),
    );
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
      const value = withRuntimeOptions(guardedOptions, () => resolve(props.children));
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
    mount.clear();
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

  const showFallback = (error: unknown): void => {
    if (disposed) {
      return;
    }
    failed = true;
    if (settled) {
      const fallback = withRuntimeOptions(options, () =>
        resolve(props.fallback(error, reset)),
      );
      mount.render(fallback);
      return;
    }
    const fallback = withRuntimeOptions(options, () =>
      withWindow(window, () => resolve(props.fallback(error, reset))),
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
        const value = withRuntimeOptions(guardedOptions, () =>
          withWindow(window, () => resolve(props.children)),
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
      const value = withRuntimeOptions(guardedOptions, () => resolve(props.children));
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
    mount.clear();
  });
  return document.createDocumentFragment();
}
