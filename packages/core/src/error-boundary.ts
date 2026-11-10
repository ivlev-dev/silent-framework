import { createRenderEffect, onCleanup } from "@ivlev-dev/silent-reactivity";
import { getRuntimeOptions, withRuntimeOptions } from "./component.js";
import { createMountPoint, settleNodes } from "./dom.js";
import {
  ERROR_BOUNDARY,
  collectBetween,
  currentWindow,
  isHydrating,
  isMarker,
  mismatch,
  withWindow,
} from "./hydration.js";

export interface ErrorBoundaryProps {
  readonly fallback: (error: unknown, reset: () => void) => unknown;
  readonly children: unknown | (() => unknown);
}

function resolve(value: unknown): unknown {
  let current = value;
  while (typeof current === "function") {
    current = (current as () => unknown)();
  }
  return current;
}

export function ErrorBoundary(props: ErrorBoundaryProps): Node {
  if (isHydrating()) {
    return hydrateErrorBoundary(props);
  }

  const container = document.createDocumentFragment();
  const anchor = document.createComment(ERROR_BOUNDARY);
  container.appendChild(anchor);
  const mount = createMountPoint(container, anchor);
  const options = getRuntimeOptions();
  let disposed = false;
  let failed = false;

  const render: () => void = () => {
    if (disposed || failed) {
      return;
    }
    try {
      const value = withRuntimeOptions(
        { ...options, onError: (error) => showFallback(error) },
        () => resolve(props.children),
      );
      if (failed) {
        return;
      }
      mount.render(value);
    } catch (error) {
      showFallback(error);
    }
  };

  const showFallback = (error: unknown): void => {
    if (disposed) {
      return;
    }
    failed = true;
    mount.render(
      withRuntimeOptions(options, () => resolve(props.fallback(error, reset))),
    );
  };

  const reset = (): void => {
    if (disposed) {
      return;
    }
    failed = false;
    render();
  };

  createRenderEffect(render);
  onCleanup(() => {
    disposed = true;
    mount.clear();
  });
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
  const window = {
    start: outer.start,
    end: anchor,
    cursor: outer.start.nextSibling,
  };
  let initialized = false;
  let failed = false;

  const showFallback = (error: unknown): void => {
    failed = true;
    const fallback = withRuntimeOptions(options, () =>
      initialized
        ? resolve(props.fallback(error, reset))
        : withWindow(window, () => resolve(props.fallback(error, reset))),
    );
    if (initialized) {
      mount.render(fallback);
      return;
    }
    if (window.cursor !== anchor) {
      return mismatch("содержимое ErrorBoundary не совпало");
    }
    outer.cursor = anchor.nextSibling;
    settleNodes(anchor, fallback);
    initialized = true;
  };

  const render = (): void => {
    if (failed) {
      return;
    }
    try {
      if (!initialized) {
        initialized = true;
        const value = withRuntimeOptions({ ...options, onError: showFallback }, () =>
          withWindow(window, () => resolve(props.children)),
        );
        if (failed) {
          return;
        }
        if (window.cursor !== anchor) {
          mismatch("содержимое ErrorBoundary не совпало");
        }
        outer.cursor = anchor.nextSibling;
        settleNodes(anchor, value);
        return;
      }
      const value = withRuntimeOptions({ ...options, onError: showFallback }, () =>
        resolve(props.children),
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
    failed = false;
    render();
  };

  createRenderEffect(render);
  onCleanup(() => mount.clear());
  return document.createDocumentFragment();
}
