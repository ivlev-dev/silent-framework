import { container as rootContainer } from "@ivlev-dev/silent-di";
import type { AnyComponent, Preloader, ViewMeta } from "./types.js";
import { ComponentContext } from "./component-context.js";
import { attachDisposer, disposeNode, isServerMode } from "./dom.js";
import { openServerStreamRegion } from "./server-stream.js";
import {
  copyReactiveState,
  createRoot,
  getOwner,
  onCleanup,
  runWithOwner,
  type Owner,
} from "@ivlev-dev/silent-reactivity";
import { registerView } from "./registry.js";
import {
  emitDevtoolsError,
  emitDevtoolsMount,
  emitDevtoolsUnmount,
  isDevtoolsActive,
} from "./devtools-events.js";
import { extractMetadata } from "./metadata.js";
import {
  getCurrentBoundary,
  type AsyncBoundary,
} from "./boundary.js";
import {
  HydrationMismatchError,
  VIEW_END,
  VIEW_START,
  claimNext,
  currentWindow,
  findViewEnd,
  isHydrating,
  isMarker,
  mismatch,
  reportMismatch,
  withWindow,
  withoutHydration,
  type HydrationWindow,
} from "./hydration.js";
import { settleWindow } from "./hydration-cursor.js";
import {
  createComponentLight,
  getComponentName,
  normalizeNodes,
  readMeta,
  toNode,
} from "./component-lite.js";
import { createPropsProxy } from "./props-proxy.js";
import { registerPropsUpdater } from "./props-update.js";
import {
  COMPONENT_DISPOSE,
  PRELOADER,
  callHook,
  getDefaultPreloader,
  getErrorHandler,
  getOwnReady,
  setComponentCreator,
  setReady,
  trackPending,
  whenSettled,
  withRuntimeOptions,
  type ComponentResult,
  type RuntimeOptions,
} from "./component-state.js";


declare const __SILENT_HYDRATE__: boolean | undefined;

const HYDRATE =
  typeof __SILENT_HYDRATE__ === "undefined" || __SILENT_HYDRATE__;
interface DisposeHost {
  [COMPONENT_DISPOSE]?: () => void;
}

setComponentCreator(createComponentView);

let viewSequence = 0;

function readAttachedPreloader(component: AnyComponent): Preloader | null {
  const record = component as unknown as Record<PropertyKey, unknown>;
  const candidate = record[PRELOADER] ?? record["fallback"];
  return typeof candidate === "function" ? (candidate as Preloader) : null;
}

function readVmPreloader(vm: unknown): Preloader | null {
  if (typeof vm === "function" || (typeof vm === "object" && vm !== null)) {
    const record = vm as Record<PropertyKey, unknown>;
    const candidate = record["preloader"] ?? record["fallback"];
    return typeof candidate === "function" ? (candidate as Preloader) : null;
  }
  return null;
}

function resolvePreloader(
  component: AnyComponent,
  meta: ViewMeta | null,
): Preloader | null {
  const fromMeta = meta?.preloader;
  if (fromMeta !== undefined) {
    return fromMeta;
  }
  const attached = readAttachedPreloader(component);
  if (attached !== null) {
    return attached;
  }
  const fromVm = readVmPreloader(meta?.vm);
  if (fromVm !== null) {
    return fromVm;
  }
  return getDefaultPreloader();
}

function assertSyncPreloader(preloader: Preloader, owner: AnyComponent): void {
  if (readMeta(preloader) !== null) {
    throw new Error(
      `Прелоадер компонента ${getComponentName(owner)} должен быть синхронным компонентом без ViewModel`,
    );
  }
}

function removeBetween(start: Comment, end: Comment): void {
  const parent = end.parentNode;
  if (parent === null) {
    return;
  }
  let current: Node | null = start.nextSibling;
  if (current === null || current === end) {
    return;
  }
  const range =
    typeof document !== "undefined" && typeof document.createRange === "function"
      ? document.createRange()
      : null;
  if (range !== null) {
    range.setStartAfter(start);
    range.setEndBefore(end);
  }
  while (current !== null && current !== end) {
    const next: Node | null = current.nextSibling;
    disposeNode(current);
    if (range === null) {
      parent.removeChild(current);
    }
    current = next;
  }
  range?.deleteContents();
}

function insertBetween(end: Node, nodes: readonly Node[]): void {
  const parent = end.parentNode;
  if (parent === null) {
    return;
  }
  for (const node of nodes) {
    parent.insertBefore(node, end);
  }
}

function disposeVm(vm: object): void {
  const dispose = (vm as Record<string, unknown>)["dispose"];
  if (typeof dispose === "function") {
    dispose.call(vm);
  }
}

function assignVm(vm: object, props: Record<string, unknown>, view: Node | null): void {
  const target = vm as Record<string, unknown>;
  target["props"] = props;
  target["view"] = view;
}

function renderError(start: Comment, end: Comment, error: unknown): void {
  removeBetween(start, end);
  const text = document.createTextNode(
    error instanceof Error ? `Error: ${error.message}` : "Error",
  );
  insertBetween(end, [text]);
}

function reportError(
  error: unknown,
  component: AnyComponent,
  options: RuntimeOptions,
  phase: string,
): void {
  emitDevtoolsError({
    name: getComponentName(component),
    moduleId: readMeta(component)?.moduleId ?? null,
    phase,
    message: error instanceof Error ? error.message : String(error),
  });
  const handler = options.onError ?? getErrorHandler();
  handler(error, component);
}

function renderSync(
  component: AnyComponent,
  props: Record<string, unknown>,
  options: RuntimeOptions,
): Node {
  const result = withRuntimeOptions(options, () =>
    (component as unknown as (props: Record<string, unknown>) => unknown)(props),
  );
  return toNode(result);
}

function propsAssign(vm: object, props: Record<string, unknown>): void {
  (vm as Record<string, unknown>)["props"] = props;
}

export function createViewResult(
  component: AnyComponent,
  meta: ViewMeta,
  props: Record<string, unknown>,
  options: RuntimeOptions,
): ComponentResult {
  const viewId = (viewSequence += 1);
  let mountedAt: number | null = null;
  let fragment: DocumentFragment | null = null;
  const hydrated = HYDRATE && isHydrating();
  const propsProxy = createPropsProxy(props);
  const viewProps = propsProxy.value;
  let adoptPending = hydrated;
  let start: Comment;
  let end: Comment;
  if (hydrated) {
    const outer = currentWindow();
    if (outer === null) {
      return mismatch("view вне окна гидрации");
    }
    const claimed = claimNext();
    if (!isMarker(claimed, VIEW_START)) {
      return mismatch("не найден стартовый маркер view");
    }
    start = claimed;
    const claimedEnd = findViewEnd(start, outer.end);
    if (!isMarker(claimedEnd, VIEW_END)) {
      return mismatch("не найден закрывающий маркер view");
    }
    end = claimedEnd;
    settleWindow(outer, end);
  } else {
    start = document.createComment(VIEW_START);
    end = document.createComment(VIEW_END);
    fragment = document.createDocumentFragment();
    fragment.appendChild(start);
    fragment.appendChild(end);
  }

  const streamRegion =
    isServerMode() && !hydrated ? openServerStreamRegion() : null;
  if (streamRegion !== null && fragment !== null) {
    fragment.insertBefore(streamRegion.start, start);
    fragment.appendChild(streamRegion.end);
  }

  let controller: AbortController | null = null;
  const getSignal = (): AbortSignal => {
    controller ??= new AbortController();
    return controller.signal;
  };
  const boundary: AsyncBoundary | null =
    options.boundary === undefined ? getCurrentBoundary() : options.boundary;
  const scope = (options.container ?? rootContainer).createScope(
    `view:${getComponentName(component)}`,
  );
  const context = new ComponentContext(viewProps, scope, getSignal);
  scope.bind(ComponentContext, () => context);
  const runtimeOptions: RuntimeOptions = {
    ...options,
    container: scope,
    boundary,
  };

  let disposed = false;
  let generation = 0;
  let resolveDisposed: (() => void) | null = null;
  const disposedGate = new Promise<void>((resolve) => {
    resolveDisposed = resolve;
  });
  let vmInstance: object | null = null;
  let fallbackRootDispose: (() => void) | null = null;
  let viewRootDispose: (() => void) | null = null;
  let currentNodes: Node[] = [];
  let unregister: (() => void) | null = null;
  let createdCalled = false;
  let componentRef = component;
  let metaRef = meta;
  let componentOwner: Owner | null = null;
  let componentRootDispose: (() => void) | null = null;

  let preloaderRef =
    boundary === null && !hydrated ? resolvePreloader(component, meta) : null;

  const clearView = (): void => {
    viewRootDispose?.();
    viewRootDispose = null;
    fallbackRootDispose?.();
    fallbackRootDispose = null;
    for (const node of currentNodes) {
      if (node.parentNode === null) {
        disposeNode(node);
      }
    }
    currentNodes = [];
    removeBetween(start, end);
  };

  const renderFallback = (): void => {
    fallbackRootDispose?.();
    fallbackRootDispose = null;
    if (hydrated || disposed || preloaderRef === null) {
      return;
    }
    removeBetween(start, end);
    try {
      assertSyncPreloader(preloaderRef, componentRef);
      runWithOwner(componentOwner, () => {
        const root = createRoot((disposeFallback) => {
          fallbackRootDispose = disposeFallback;
          const fallbackNode = renderSync(preloaderRef as Preloader, {}, runtimeOptions);
          insertBetween(end, normalizeNodes(fallbackNode));
          return null;
        });
        void root;
      });
    } catch (error) {
      reportError(error, componentRef, options, "preloader");
    }
  };

  const disposeInstance = (): void => {
    if (disposed) {
      return;
    }
    disposed = true;
    generation += 1;
    resolveDisposed?.();
    resolveDisposed = null;
    controller?.abort();
    if (vmInstance !== null) {
      callHook(vmInstance, "beforeUnmount");
    }
    clearView();
    fallbackRootDispose?.();
    fallbackRootDispose = null;
    unregister?.();
    unregister = null;
    if (vmInstance !== null) {
      callHook(vmInstance, "unmounted");
      disposeVm(vmInstance);
      vmInstance = null;
    }
    componentRootDispose?.();
    componentRootDispose = null;
    scope.dispose();
    start.remove();
    end.remove();
    emitDevtoolsUnmount({
      viewId,
      name: getComponentName(componentRef),
      moduleId: metaRef.moduleId ?? null,
      lifetimeMs: mountedAt === null ? 0 : Math.max(0, Date.now() - mountedAt),
    });
  };

  attachDisposer(start, disposeInstance);
  (start as unknown as DisposeHost)[COMPONENT_DISPOSE] = disposeInstance;

  const updateProps = (next: Record<string, unknown>): void => {
    if (disposed) {
      return;
    }
    propsProxy.update(next);
    if (vmInstance === null) {
      return;
    }
    propsAssign(vmInstance, viewProps);
    if (createdCalled) {
      callHook(vmInstance, "updated");
    }
  };
  registerPropsUpdater(start, updateProps);

  const finishRender = (nextVm: object, initial: boolean): void => {
    const rootNode = currentNodes[0] ?? start;
    assignVm(nextVm, viewProps, rootNode);
    context.view = rootNode;
    registerPropsUpdater(rootNode, updateProps);
    registerPropsUpdater(start, updateProps);
    for (const node of currentNodes) {
      registerPropsUpdater(node, updateProps);
    }
    if (initial) {
      callHook(nextVm, "mounted");
      mountedAt = Date.now();
      emitDevtoolsMount({
        viewId,
        name: getComponentName(componentRef),
        moduleId: metaRef.moduleId ?? null,
        hydrated,
        props: isDevtoolsActive() ? Object.keys(props) : [],
      });
    } else {
      callHook(nextVm, "updated");
    }
  };

  const renderAdopted = (nextVm: object, owner: Owner): boolean => {
    const holder: { dispose: (() => void) | null } = { dispose: null };
    try {
      const window: HydrationWindow = {
        start,
        end,
        cursor: start.nextSibling,
      };
      runWithOwner(owner, () => {
        createRoot((disposeView) => {
          holder.dispose = disposeView;
          const viewContext = {
            vm: nextVm,
            preloader: preloaderRef as Preloader,
          };
          const output = withWindow(window, () =>
            withRuntimeOptions(runtimeOptions, () =>
              (
                componentRef as unknown as (
                  this: unknown,
                  props: Record<string, unknown>,
                ) => unknown
              ).call(viewContext, viewProps),
            ),
          );
          const nodes = normalizeNodes(output);
          if (output instanceof Node) {
            const parent = end.parentNode;
            if (parent !== null) {
              for (let index = 0; index < nodes.length; index += 1) {
                const node = nodes[index]!;
                if (node.parentNode !== parent) {
                  parent.insertBefore(node, end);
                }
              }
            }
          }
          if (window.cursor !== end) {
            mismatch("view не совпал с серверной разметкой");
          }
          currentNodes = extractMetadata(nodes);
          return null;
        });
      });
      viewRootDispose = holder.dispose;
      return true;
    } catch (error) {
      holder.dispose?.();
      viewRootDispose = null;
      if (!(error instanceof HydrationMismatchError)) {
        throw error;
      }
      reportMismatch(error);
      return false;
    }
  };

  const renderFresh = (nextVm: object, owner: Owner): void => {
    runWithOwner(owner, () => {
      const viewRoot = createRoot((disposeView) => {
        viewRootDispose = disposeView;
        const viewContext = {
          vm: nextVm,
          preloader: preloaderRef as Preloader,
        };
        const output = withRuntimeOptions(runtimeOptions, () =>
          (
            componentRef as unknown as (
              this: unknown,
              props: Record<string, unknown>,
            ) => unknown
          ).call(viewContext, viewProps),
        );
        if (disposed) {
          return null;
        }
        currentNodes = extractMetadata(normalizeNodes(output));
        insertBetween(end, currentNodes);
        return null;
      });
      void viewRoot;
    });
  };

  const renderView = (nextVm: object, initial: boolean): void => {
    if (disposed) {
      return;
    }
    const adopt = adoptPending && initial;
    if (!adopt) {
      clearView();
    }
    propsAssign(nextVm, viewProps);
    if (initial) {
      callHook(nextVm, "created");
      createdCalled = true;
      callHook(nextVm, "beforeMount");
    }
    const owner = componentOwner;
    if (owner === null) {
      return;
    }
    if (adopt) {
      adoptPending = false;
      if (renderAdopted(nextVm, owner)) {
        finishRender(nextVm, initial);
        streamRegion?.resolve();
        return;
      }
      clearView();
      withoutHydration(() => {
        renderFresh(nextVm, owner);
      });
      finishRender(nextVm, initial);
      streamRegion?.resolve();
      return;
    }
    renderFresh(nextVm, owner);
    finishRender(nextVm, initial);
    streamRegion?.resolve();
  };

  const root = createRoot((disposeRoot) => {
    componentRootDispose = disposeRoot;
    componentOwner = getOwner();
    onCleanup(() => {
      controller?.abort();
    });

    renderFallback();

    if (metaRef.moduleId !== undefined) {
      unregister = registerView({
        id: viewId,
        moduleId: metaRef.moduleId,
        name: getComponentName(componentRef),
        hydrated,
        component: componentRef,
        meta: metaRef,
        props: viewProps,
        rerender: (nextComponent, nextMeta) => {
          componentRef = nextComponent;
          metaRef = nextMeta;
          if (nextMeta.preloader !== undefined) {
            preloaderRef = nextMeta.preloader;
          }
          if (vmInstance !== null && createdCalled) {
            renderView(vmInstance, false);
          } else {
            renderFallback();
          }
        },
        replaceVm: (nextVm: object) => {
          if (disposed) {
            return;
          }
          generation += 1;
          const previous = vmInstance;
          if (previous !== null) {
            if (createdCalled) {
              callHook(previous, "beforeUnmount");
            }
            clearView();
            if (createdCalled) {
              callHook(previous, "unmounted");
            }
            disposeVm(previous);
          } else {
            clearView();
          }
          createdCalled = false;
          vmInstance = nextVm;
          scope.clearCache();
          runWithOwner(componentOwner, () => renderView(nextVm, true));
        },
        recreateVm: async (nextVm?: unknown) => {
          if (disposed) {
            return;
          }
          const ticket = ++generation;
          if (nextVm !== undefined) {
            metaRef = { ...metaRef, vm: nextVm };
          }
          const previous = vmInstance;
          const hadView = createdCalled;
          if (previous !== null) {
            if (hadView) {
              callHook(previous, "beforeUnmount");
            }
            clearView();
            if (hadView) {
              callHook(previous, "unmounted");
            }
          } else {
            clearView();
          }
          vmInstance = null;
          createdCalled = false;
          scope.clearCache();
          const next = await scope.resolve<object>(metaRef.vm);
          if (disposed || ticket !== generation) {
            disposeVm(next);
            if (previous !== null) {
              disposeVm(previous);
            }
            return;
          }
          if (previous !== null) {
            copyReactiveState(previous, next);
            disposeVm(previous);
          }
          vmInstance = next;
          runWithOwner(componentOwner, () => renderView(next, true));
        },
        updatePreloader: (nextPreloader: Preloader) => {
          if (nextPreloader === preloaderRef) {
            return;
          }
          preloaderRef = nextPreloader;
          if (vmInstance === null) {
            renderFallback();
          } else if (createdCalled) {
            renderView(vmInstance, false);
          }
        },
        dispose: disposeInstance,
      });
    }

    const readyGeneration = generation;
    const ready = (async () => {
      try {
        const resolved = await Promise.resolve().then(() =>
          scope.resolve<object>(metaRef.vm),
        );
        if (
          disposed ||
          readyGeneration !== generation ||
          (controller !== null && controller.signal.aborted)
        ) {
          disposeVm(resolved);
          return;
        }
        vmInstance = resolved;
        runWithOwner(componentOwner, () => renderView(resolved, true));
      } catch (error) {
        if (disposed || readyGeneration !== generation) {
          return;
        }
        reportError(error, component, options, "resolve");
        renderError(start, end, error);
        streamRegion?.resolve();
      }
    })();

    setReady(start, trackPending(Promise.race([ready, disposedGate])));
    boundary?.register(getOwnReady(start));
    return null;
  });

  void root;

  const ownReady = getOwnReady(start);
  const result: ComponentResult = {
    node: hydrated ? start : fragment!,
    ready: ownReady,
    settled: Promise.race([
      ownReady.then(async () => {
        if (disposed) {
          return;
        }
        await whenSettled(start);
      }),
      disposedGate,
    ]),
    update: updateProps,
    dispose: disposeInstance,
  };
  registerPropsUpdater(result.node, updateProps);
  return result;
}

export function createComponentView(
  component: AnyComponent,
  props: Record<string, unknown>,
  options: RuntimeOptions,
): ComponentResult {
  const meta = readMeta(component);
  if (meta === null) {
    return createComponentLight(component, props, options);
  }
  return createViewResult(component, meta, props, options);
}
