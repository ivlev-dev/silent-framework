import type { AnyComponent, Preloader } from "./types.js";
import {
  component,
  getDefaultPreloader,
  getErrorHandler,
  getRuntimeOptions,
  setReady,
  trackAsyncWork,
  withRuntimeOptions,
} from "./component.js";
import { createMountPoint } from "./dom.js";
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
} from "./hydration.js";
import { getOwner, onCleanup, runWithOwner } from "@silent/reactivity";

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

export function Suspense(props: SuspenseProps): Node {
  if (isHydrating()) {
    return hydrateSuspense(props);
  }
  const container = document.createDocumentFragment();
  const anchor = document.createComment("silent-suspense");
  container.appendChild(anchor);
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
  };

  const boundary: AsyncBoundary = {
    register(promise: Promise<void>): void {
      if (disposed || showingChildren) {
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

  if (pending.size === 0) {
    showChildren();
  }

  onCleanup(() => {
    disposed = true;
    pending.clear();
    mount.clear();
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
  const window = {
    start: outer.start,
    end: anchor,
    cursor: outer.start.nextSibling,
  };

  withRuntimeOptions({ ...options, boundary }, () => {
    withWindow(window, () => resolveValue(props.children));
  });

  onCleanup(() => {
    mount.clear();
  });

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
      })();
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

    if (isHydrating()) {
      const outer = currentWindow();
      if (outer === null) {
        return mismatch("lazy вне окна гидрации");
      }
      const anchor = outer.end.previousSibling;
      if (anchor === null) {
        return mismatch("не найден якорь lazy");
      }
      const window = {
        start: outer.start,
        end: anchor,
        cursor: outer.start.nextSibling,
      };
      onCleanup(() => {
        disposed = true;
      });
      const pending = trackAsyncWork(ensure());
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
                withWindow(window, () => {
                  component(target, propsRecord);
                });
                if (window.cursor !== window.end) {
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
          const handler = options.onError ?? getErrorHandler();
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

    if (boundary === null && preloader !== null) {
      mount.render(withRuntimeOptions(runtimeOptions, () => component(preloader, {})));
    }

    const promise = trackAsyncWork(ensure());
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
        const handler = options.onError ?? getErrorHandler();
        handler(error, Lazy);
        mount.render(errorNode(error));
      },
    );

    return container;
  };
}
