import { container as rootContainer } from "@silent/di";
import type { Children } from "./jsx.js";
import type { AnyComponent, Preloader, ViewMeta } from "./types.js";
import { ComponentContext } from "./component-context.js";
import { attachDisposer, collectNodes, disposeNode } from "./dom.js";
import {
  copyReactiveState,
  createRoot,
  getOwner,
  onCleanup,
  runWithOwner,
  type Owner,
} from "@silent/reactivity";
import { registerView } from "./registry.js";
import { extractMetadata } from "./metadata.js";
import {
  getCurrentBoundary,
  runWithBoundary,
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

export const VIEW_META = Symbol.for("silent.view");
export const PRELOADER = Symbol.for("silent.preloader");
export const COMPONENT_READY = Symbol.for("silent.ready");
export const COMPONENT_DISPOSE = Symbol.for("silent.dispose");

export interface RuntimeOptions {
  readonly container?: import("@silent/di").Container | undefined;
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

interface DisposeHost {
  [COMPONENT_DISPOSE]?: () => void;
}

const pending = new Set<Promise<unknown>>();
let defaultPreloader: Preloader | null = null;
let defaultErrorHandler: (error: unknown, component: AnyComponent) => void = (
  error,
) => {
  console.error(error);
};

let currentRuntimeOptions: RuntimeOptions = {};

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

function trackPending<T>(promise: Promise<T>): Promise<T> {
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

function callHook(target: object, name: string, ...args: unknown[]): void {
  const value = (target as Record<string, unknown>)[name];
  if (typeof value === "function") {
    value.apply(target, args);
  }
}

function normalizeNodes(value: unknown): Node[] {
  return collectNodes(value as Children);
}

function toNode(value: unknown): Node {
  const nodes = normalizeNodes(value);
  if (nodes.length === 1) {
    const node = nodes[0];
    if (node !== undefined) {
      return node;
    }
  }
  const fragment = document.createDocumentFragment();
  for (const node of nodes) {
    fragment.appendChild(node);
  }
  return fragment;
}

function readMeta(component: AnyComponent): ViewMeta | null {
  const candidate = (component as unknown as Record<PropertyKey, unknown>)[
    VIEW_META
  ];
  if (candidate === null || typeof candidate !== "object") {
    return null;
  }
  const meta = candidate as Record<PropertyKey, unknown>;
  const vm = meta["vm"];
  if (vm === undefined) {
    return null;
  }
  const preloader = meta["preloader"];
  const preloaderName = meta["preloaderName"];
  const name = meta["name"];
  const moduleId = meta["moduleId"];
  return {
    vm,
    ...(typeof preloader === "function" ? { preloader: preloader as Preloader } : {}),
    ...(typeof preloaderName === "string" ? { preloaderName } : {}),
    ...(typeof name === "string" ? { name } : {}),
    ...(typeof moduleId === "string" ? { moduleId } : {}),
  };
}

export function getViewMeta(component: AnyComponent): ViewMeta | null {
  return readMeta(component);
}

export function setPreloader<C extends AnyComponent>(
  component: C,
  preloader: Preloader,
): C {
  (component as unknown as Record<PropertyKey, unknown>)[PRELOADER] = preloader;
  return component;
}

export const setFallback = setPreloader;

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
  return defaultPreloader;
}

function assertSyncPreloader(preloader: Preloader, owner: AnyComponent): void {
  if (readMeta(preloader) !== null) {
    throw new Error(
      `Прелоадер компонента ${getComponentName(owner)} должен быть синхронным компонентом без ViewModel`,
    );
  }
}

export function getComponentName(component: AnyComponent): string {
  const meta = readMeta(component);
  if (meta?.name !== undefined) {
    return meta.name;
  }
  return component.name || "Anonymous";
}

function removeBetween(start: Comment, end: Comment): void {
  let current = start.nextSibling;
  while (current !== null && current !== end) {
    const next = current.nextSibling;
    disposeNode(current);
    current.remove();
    current = next;
  }
}

function insertBetween(start: Comment, end: Comment, nodes: readonly Node[]): void {
  const parent = end.parentNode;
  if (parent === null) {
    return;
  }
  for (const node of nodes) {
    parent.insertBefore(node, end);
  }
  void start;
}

function clearBetween(start: Comment, end: Comment): void {
  removeBetween(start, end);
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
  insertBetween(start, end, [text]);
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
    for (const child of Array.from(node.childNodes)) {
      const childReady = (child as ReadyHost)[COMPONENT_READY];
      if (childReady !== undefined) {
        return childReady;
      }
    }
  }
  return Promise.resolve();
}

function reportError(
  error: unknown,
  component: AnyComponent,
  options: RuntimeOptions,
): void {
  const handler = options.onError ?? defaultErrorHandler;
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

function createViewResult(
  component: AnyComponent,
  meta: ViewMeta,
  props: Record<string, unknown>,
  options: RuntimeOptions,
): ComponentResult {
  const fragment = document.createDocumentFragment();
  const hydrated = isHydrating();
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
    outer.cursor = outer.end;
  } else {
    start = document.createComment(VIEW_START);
    end = document.createComment(VIEW_END);
    fragment.appendChild(start);
    fragment.appendChild(end);
  }

  const controller = new AbortController();
  const boundary =
    options.boundary === undefined ? getCurrentBoundary() : options.boundary;
  const scope = (options.container ?? rootContainer).createScope(
    `view:${getComponentName(component)}`,
  );
  const context = new ComponentContext(props, scope, controller.signal);
  scope.bind(ComponentContext, () => context);
  const runtimeOptions: RuntimeOptions = {
    ...options,
    container: scope,
    boundary,
  };

  let disposed = false;
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
    clearBetween(start, end);
    for (const node of currentNodes) {
      disposeNode(node);
    }
    currentNodes = [];
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
          insertBetween(start, end, normalizeNodes(fallbackNode));
          return null;
        });
        void root;
      });
    } catch (error) {
      reportError(error, componentRef, options);
    }
  };

  const disposeInstance = (): void => {
    if (disposed) {
      return;
    }
    disposed = true;
    controller.abort();
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
  };

  attachDisposer(start, disposeInstance);
  (start as unknown as DisposeHost)[COMPONENT_DISPOSE] = disposeInstance;

  const finishRender = (nextVm: object, initial: boolean): void => {
    const rootNode = currentNodes[0] ?? start;
    assignVm(nextVm, props, rootNode);
    context.view = rootNode;
    if (initial) {
      callHook(nextVm, "mounted");
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
              ).call(viewContext, props),
            ),
          );
          if (window.cursor !== end) {
            mismatch("view не совпал с серверной разметкой");
          }
          currentNodes = extractMetadata(normalizeNodes(output));
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
          ).call(viewContext, props),
        );
        if (disposed) {
          return null;
        }
        currentNodes = extractMetadata(normalizeNodes(output));
        insertBetween(start, end, currentNodes);
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
    propsAssign(nextVm, props);
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
        return;
      }
      clearView();
      withoutHydration(() => {
        renderFresh(nextVm, owner);
      });
      finishRender(nextVm, initial);
      return;
    }
    renderFresh(nextVm, owner);
    finishRender(nextVm, initial);
  };

  const root = createRoot((disposeRoot) => {
    componentRootDispose = disposeRoot;
    componentOwner = getOwner();
    onCleanup(() => {
      controller.abort();
    });

    renderFallback();

    if (metaRef.moduleId !== undefined) {
      unregister = registerView({
        moduleId: metaRef.moduleId,
        name: getComponentName(componentRef),
        component: componentRef,
        meta: metaRef,
        props,
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
          if (vmInstance !== null) {
            disposeVm(vmInstance);
          }
          vmInstance = nextVm;
          renderView(nextVm, true);
        },
        recreateVm: async (nextVm?: unknown) => {
          if (disposed) {
            return;
          }
          if (nextVm !== undefined) {
            metaRef = { ...metaRef, vm: nextVm };
          }
          const previous = vmInstance;
          scope.clearCache(metaRef.vm);
          const next = await scope.resolve<object>(metaRef.vm);
          if (disposed) {
            disposeVm(next);
            return;
          }
          if (previous !== null) {
            copyReactiveState(previous, next);
          }
          if (previous !== null) {
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

    const ready = (async () => {
      try {
        const resolved = await Promise.resolve().then(() =>
          scope.resolve<object>(metaRef.vm),
        );
        if (disposed || controller.signal.aborted) {
          disposeVm(resolved);
          return;
        }
        vmInstance = resolved;
        runWithOwner(componentOwner, () => renderView(resolved, true));
      } catch (error) {
        if (!disposed) {
          reportError(error, component, options);
          renderError(start, end, error);
        }
      }
    })();

    setReady(start, trackPending(ready));
    boundary?.register(getReady(start));
    return null;
  });

  void root;

  return {
    node: hydrated ? start : fragment,
    ready: getReady(start),
    dispose: disposeInstance,
  };
}

function propsAssign(vm: object, props: Record<string, unknown>): void {
  (vm as Record<string, unknown>)["props"] = props;
}

export function createComponent(
  component: AnyComponent,
  props: Record<string, unknown> = {},
  options: RuntimeOptions = {},
): ComponentResult {
  const meta = readMeta(component);
  if (meta === null) {
    const result = withRuntimeOptions(options, () =>
      (component as unknown as (props: Record<string, unknown>) => unknown)(props),
    );
    const nodes = extractMetadata(normalizeNodes(result));
    let node: Node;
    if (nodes.length === 1) {
      const single = nodes[0];
      node = single ?? document.createComment("silent-empty");
    } else {
      const fragment = document.createDocumentFragment();
      for (const child of nodes) {
        fragment.appendChild(child);
      }
      node = fragment;
    }
    return {
      node,
      ready: getReady(node),
      dispose: () => {
        for (const child of nodes) {
          disposeNode(child);
          child.parentNode?.removeChild(child);
        }
      },
    };
  }
  return createViewResult(component, meta, props, options);
}

export function component(
  componentFn: AnyComponent,
  props: Record<string, unknown>,
): Node {
  return createComponent(componentFn, props, getRuntimeOptions()).node;
}

export function isViewComponent(componentFn: AnyComponent): boolean {
  return readMeta(componentFn) !== null;
}

export function getComponentDispose(node: Node): (() => void) | null {
  const dispose = (node as DisposeHost)[COMPONENT_DISPOSE];
  return typeof dispose === "function" ? dispose : null;
}
