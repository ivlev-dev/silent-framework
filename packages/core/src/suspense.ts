import type { AnyComponent, Preloader } from "./types.js";
import type { Children } from "./jsx.js";
import {
  component,
  getDefaultPreloader,
  getErrorHandler,
  getReady,
  getRuntimeOptions,
  setReady,
  trackAsyncWork,
  withRuntimeOptions,
} from "./component.js";
import { collectNodes, createMountPoint, disposeNode, isServerMode } from "./dom.js";
import { settleNodes } from "./dom-hydration-state.js";
import { openServerStreamRegion } from "./server-stream.js";
import { beginRegion, regionMatches, settleWindow } from "./hydration-cursor.js";
import { getCurrentBoundary, runWithBoundary, type AsyncBoundary } from "./boundary.js";
import {
  HydrationMismatchError,
  SUSPENSE,
  collectBetween,
  currentWindow,
  isHydrating,
  isMarker,
  mismatch,
  reportMismatch,
  withWindow,
} from "./hydration-proxy.js";
import { getOwner, onCleanup, runWithOwner } from "@ivlev-dev/silent-reactivity";


declare const __SILENT_HYDRATE__: boolean | undefined;

const HYDRATE =
  typeof __SILENT_HYDRATE__ === "undefined" || __SILENT_HYDRATE__;
export interface SuspenseProps {
  readonly fallback?: unknown;
  readonly children: unknown;
}

export interface LazyOptions {
  readonly preloader?: Preloader | null | undefined;
  readonly onError?: ((error: unknown) => void) | undefined;
}

function resolveValue(value: unknown): unknown {
  let current = value;
  while (typeof current === "function") {
    current = (current as () => unknown)();
  }
  return current;
}

function errorNode(error: unknown): Node {
  return document.createTextNode(
    error instanceof Error ? `Error: ${error.message}` : "Error",
  );
}

function nodesOf(value: unknown): Node[] {
  if (value instanceof Node) {
    return value instanceof DocumentFragment
      ? collectNodes(value as unknown as Children)
      : [value];
  }
  if (value === null || value === undefined) {
    return [];
  }
  return collectNodes(value as unknown as Children);
}

function valueReady(value: unknown): Promise<void> {
  const nodes = nodesOf(value);
  if (nodes.length === 0) {
    return Promise.resolve();
  }
  const [only] = nodes;
  if (only !== undefined && nodes.length === 1) {
    return getReady(only);
  }
  return Promise.all(nodes.map((node) => getReady(node))).then(() => undefined);
}

function disposeValue(value: unknown): void {
  for (const node of nodesOf(value)) {
    disposeNode(node);
    node.parentNode?.removeChild(node);
  }
}

export function Suspense(props: SuspenseProps): Node {
  if (HYDRATE && isHydrating()) {
    return hydrateSuspense(props);
  }
  const container = document.createDocumentFragment();
  const anchor = document.createComment("silent-suspense");
  const streamRegion = isServerMode() ? openServerStreamRegion() : null;
  if (streamRegion !== null) {
    container.appendChild(streamRegion.start);
    container.appendChild(anchor);
    container.appendChild(streamRegion.end);
  } else {
    container.appendChild(anchor);
  }
  const mount = createMountPoint(container, anchor);

  const pending = new Set<Promise<unknown>>();
  const options = getRuntimeOptions();
  let disposed = false;
  let showingChildren = false;
  let childrenValue: unknown = null;

  const showFallback = (): void => {
    if (disposed || showingChildren) {
      return;
    }
    mount.render(resolveValue(props.fallback) ?? null);
  };

  const showChildren = (): void => {
    if (disposed || showingChildren) {
      return;
    }
    showingChildren = true;
    mount.render(childrenValue);
    streamRegion?.resolve();
  };

  const controller = new AbortController();
  const boundary: AsyncBoundary = {
    signal: controller.signal,
    get showing(): boolean {
      return showingChildren;
    },
    get fallback(): unknown {
      return props.fallback;
    },
    register(promise: Promise<void>): void {
      if (disposed || showingChildren || controller.signal.aborted) {
        return;
      }
      const tracked: Promise<unknown> = promise;
      pending.add(tracked);
      const done = (): void => {
        pending.delete(tracked);
        if (pending.size === 0) {
          showChildren();
        }
      };
      promise.then(done, done);
    },
  };

  showFallback();

  childrenValue = withRuntimeOptions(
    { ...options, boundary },
    () => runWithBoundary(boundary, () => resolveValue(props.children)),
  );
  setReady(anchor, valueReady(childrenValue));

  if (pending.size === 0) {
    showChildren();
  }

  onCleanup(() => {
    disposed = true;
    controller.abort();
    pending.clear();
    mount.clear();
    if (!showingChildren) {
      disposeValue(childrenValue);
    }
    childrenValue = null;
  });

  return container;
}

function hydrateSuspense(props: SuspenseProps): Node {
  const outer = currentWindow();
  if (outer === null) {
    return mismatch("Suspense вне окна гидрации");
  }
  const anchor = outer.end.previousSibling;
  if (!isMarker(anchor, SUSPENSE)) {
    return mismatch("не найден якорь Suspense");
  }
  const parent = anchor.parentNode;
  if (parent === null) {
    return mismatch("якорь Suspense отсоединён");
  }
  const mount = createMountPoint(parent, anchor, collectBetween(outer.start, anchor));
  const options = getRuntimeOptions();
  const boundary: AsyncBoundary = {
    register(): void {},
  };
  const window = beginRegion(outer, anchor);

  let children: unknown = null;
  withRuntimeOptions({ ...options, boundary }, () => {
    children = withWindow(window, () => resolveValue(props.children));
  });
  settleNodes(anchor, children);
  if (!regionMatches(window, anchor, children)) {
    return mismatch("содержимое Suspense не совпало");
  }
  settleWindow(outer, anchor);

  onCleanup(mount.clear);

  return document.createDocumentFragment();
}

export function lazy<P extends Record<string, unknown>>(
  loader: () => Promise<AnyComponent | { default: AnyComponent }>,
  options: LazyOptions = {},
): (props: P) => Node {
  let loaded: AnyComponent | null = null;
  let loading: Promise<void> | null = null;

  const ensure = (): Promise<void> => {
    if (loading === null) {
      loading = (async () => {
        const module = await loader();
        loaded = typeof module === "function" ? module : module.default;
      })().catch((error: unknown) => {
        loading = null;
        loaded = null;
        throw error;
      });
    }
    return loading;
  };

  return function Lazy(props: P): Node {
    const owner = getOwner();
    const boundary = getCurrentBoundary();
    const runtimeOptions = getRuntimeOptions();
    const preloader =
      options.preloader === undefined ? getDefaultPreloader() : options.preloader;
    const propsRecord: Record<string, unknown> = props;
    let disposed = false;

    if (HYDRATE && isHydrating()) {
      const outer = currentWindow();
      if (outer === null) {
        return mismatch("lazy вне окна гидрации");
      }
      const anchor = outer.end.previousSibling;
      if (anchor === null) {
        return mismatch("не найден якорь lazy");
      }
      const window = beginRegion(outer, anchor);
      settleWindow(outer, anchor);
      onCleanup(() => {
        disposed = true;
      });
      const pending = trackAsyncWork(ensure(), boundary?.signal ?? null);
      boundary?.register(pending);
      void pending.then(
        () => {
          if (disposed || loaded === null) {
            return;
          }
          const target = loaded;
          runWithOwner(owner, () => {
            try {
              withRuntimeOptions(runtimeOptions, () => {
                const value = withWindow(window, () =>
                  component(target, propsRecord),
                );
                settleNodes(window.end, value);
                if (!regionMatches(window, window.end, value)) {
                  mismatch("содержимое lazy не совпало");
                }
              });
            } catch (error) {
              if (error instanceof HydrationMismatchError) {
                reportMismatch(error);
                return;
              }
              throw error;
            }
          });
        },
        (error: unknown) => {
          if (disposed) {
            return;
          }
          const handler =
            options.onError ?? runtimeOptions.onError ?? getErrorHandler();
          handler(error, Lazy);
        },
      );
      return document.createDocumentFragment();
    }

    const container = document.createDocumentFragment();
    const anchor = document.createComment("silent-lazy");
    container.appendChild(anchor);
    const mount = createMountPoint(container, anchor);

    onCleanup(() => {
      disposed = true;
      mount.clear();
    });

    if (loaded !== null) {
      mount.render(component(loaded, propsRecord));
      return container;
    }

    const showInitialFallback = (): void => {
      if (preloader !== null) {
        mount.render(withRuntimeOptions(runtimeOptions, () => component(preloader, {})));
        return;
      }
      if (boundary === null || boundary.showing !== true) {
        return;
      }
      const fallback = boundary.fallback;
      if (typeof fallback !== "function") {
        return;
      }
      mount.render((fallback as () => unknown)());
    };
    if (boundary === null) {
      showInitialFallback();
    } else if (boundary.showing === true) {
      showInitialFallback();
    }

    const promise = trackAsyncWork(ensure(), boundary?.signal ?? null);
    setReady(
      anchor,
      promise.then(
        () => undefined,
        () => undefined,
      ),
    );
    boundary?.register(promise);

    const renderLoaded = (target: AnyComponent): void => {
      if (disposed) {
        return;
      }
      runWithOwner(owner, () => {
        withRuntimeOptions(runtimeOptions, () => {
          mount.render(component(target, propsRecord));
        });
      });
    };

    void promise.then(
      () => {
        if (loaded !== null) {
          renderLoaded(loaded);
        }
      },
      (error: unknown) => {
        if (disposed) {
          return;
        }
        const handler =
          options.onError ?? runtimeOptions.onError ?? getErrorHandler();
        handler(error, Lazy);
        if (disposed) {
          return;
        }
        mount.render(errorNode(error));
      },
    );

    return container;
  };
}
