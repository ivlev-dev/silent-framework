import {
  adoptHydrationRegion,
  collectNodes,
  component,
  createComponent,
  createMountPoint,
  getRuntimeOptions,
  isServerMode,
  withoutHydration,
  type AnyComponent,
  type Children,
  type ComponentResult,
  type RuntimeOptions,
} from "@ivlev-dev/silent-core";
import type { Container } from "@ivlev-dev/silent-di";
import {
  createMemo,
  createRenderEffect,
  onCleanup,
  runWithOwner,
  untrack,
} from "@ivlev-dev/silent-reactivity";
import {
  RouterMissingError,
  RouterNavigationError,
  type MatchedRoute,
  type RouteLocation,
  type RouteMeta,
  type RouteQuery,
} from "./match.js";
import type { RouteViewProps, TypedRouteLocation } from "./route.js";
import { Router, type IRouter } from "./router.js";

export const ROUTER_VIEW_MARKER = "silent-router-view";

export interface RouterViewProps {
  readonly router?: IRouter;
  readonly depth?: number;
  readonly fallback?: unknown;
  readonly container?: Container;
  readonly error?: unknown | ((error: unknown) => unknown);
  readonly notFound?: unknown | ((error: unknown) => unknown);
}

export type RouterViewComponentProps<
  Path extends string = string,
  Query = RouteQuery,
> = RouteViewProps<Path, Query>;

interface ViewSelection {
  readonly entry: MatchedRoute | undefined;
  readonly route: RouteLocation | null;
  readonly query: RouteQuery;
  readonly hash: string;
  readonly error: unknown;
}

const EMPTY_META: RouteMeta = Object.freeze({});

function resolveRouter(
  router: IRouter | undefined,
  container: Container | undefined,
): IRouter {
  if (router !== undefined) {
    return router;
  }
  if (container !== undefined) {
    const injected = container.peek<IRouter>(Router);
    if (injected !== undefined) {
      return injected;
    }
    if (container.hasExplicit(Router)) {
      throw new RouterMissingError(
        "Router зарегистрирован, но ещё не разрешён; используйте bindValue/provide",
      );
    }
    throw new RouterMissingError(
      "RouterView не нашёл Router в контейнере: передайте router или зарегистрируйте Router",
    );
  }
  const resolved = Router.current();
  if (resolved === null) {
    throw new RouterMissingError("RouterView требует Router: передайте router или создайте экземпляр");
  }
  return resolved;
}

function selectView(router: IRouter, depth: number): ViewSelection {
  const state = router.state();
  return {
    entry: state.matched[depth],
    route: state.route,
    query: state.query,
    hash: state.hash,
    error: state.error,
  };
}

function sameSelection(left: ViewSelection, right: ViewSelection): boolean {
  return left.entry === right.entry
    && left.route === right.route
    && left.query === right.query
    && left.hash === right.hash
    && left.error === right.error;
}

function selectionKey(selection: ViewSelection): string | number | undefined {
  if (selection.entry === undefined || selection.route === null) {
    return undefined;
  }
  return selection.entry.record.key?.(selection.route);
}

function renderSelection(
  router: IRouter,
  props: RouterViewProps,
  selection: ViewSelection,
  viewOptions: RuntimeOptions,
): unknown {
  const entry = selection.entry;
  const routeComponent = entry?.component;
  if (entry === undefined || routeComponent === undefined || selection.route === null) {
    return props.fallback;
  }
  const viewProps: RouteViewProps = {
    route: selection.route,
    params: entry.params,
    query: selection.query,
    hash: selection.hash,
    meta: selection.route.meta,
    router,
  };
  const routerContainer = router instanceof Router ? router.container : undefined;
  const options = routerContainer === undefined
    ? viewOptions
    : { ...viewOptions, container: routerContainer };
  return component(
    routeComponent as AnyComponent,
    viewProps as unknown as Record<string, unknown>,
    options,
  );
}

function createLiveProps(router: IRouter, depth: number): RouteViewProps {
  return {
    get route(): TypedRouteLocation<string, RouteQuery> {
      return router.state().route as TypedRouteLocation<string, RouteQuery>;
    },
    get params(): Record<string, string> {
      return router.state().matched[depth]?.params ?? {};
    },
    get query(): RouteQuery {
      return router.state().query;
    },
    get hash(): string {
      return router.state().hash;
    },
    get meta(): RouteMeta {
      return router.state().route?.meta ?? EMPTY_META;
    },
    router,
  };
}

function mountNodesConnected(nodes: readonly Node[]): boolean {
  for (const node of nodes) {
    if (node.isConnected === true) {
      return true;
    }
    if (node.nodeType === 11) {
      let child = node.firstChild;
      while (child !== null) {
        if (child.isConnected === true) {
          return true;
        }
        child = child.nextSibling;
      }
    }
  }
  return false;
}

function isNotFound(error: unknown): boolean {
  return error instanceof RouterNavigationError && error.code === "no-match";
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return String(error);
}

function defaultErrorText(error: unknown, notFound: boolean): string {
  return `Error: ${notFound ? "Маршрут не найден" : errorMessage(error)}`;
}

function resolveSlot(slot: unknown, error: unknown): unknown {
  return typeof slot === "function"
    ? (slot as (value: unknown) => unknown)(error)
    : slot;
}

function renderError(props: RouterViewProps, error: unknown): unknown {
  const notFound = isNotFound(error);
  const slot = notFound && props.notFound !== undefined ? props.notFound : props.error;
  return slot === undefined ? defaultErrorText(error, notFound) : resolveSlot(slot, error);
}

function keysDiffer(
  nextKey: string | number | undefined,
  currentKey: string | number | undefined,
): boolean {
  return nextKey !== undefined && nextKey !== currentKey;
}

export function RouterView(props: RouterViewProps): Node {
  const runtimeOptions = getRuntimeOptions();
  const container = props.container ?? runtimeOptions.container;
  const router = resolveRouter(props.router, container);
  const viewOptions: RuntimeOptions = container === undefined
    ? runtimeOptions
    : { ...runtimeOptions, container };
  const depth = props.depth ?? 0;
  const fragment = document.createDocumentFragment();
  const marker = document.createComment(ROUTER_VIEW_MARKER);
  fragment.appendChild(marker);

  if (isServerMode()) {
    const selection = selectView(router, depth);
    const output = selection.error === null
      ? renderSelection(router, props, selection, viewOptions)
      : renderError(props, selection.error);
    const nodes = collectNodes(output as Children);
    for (const node of nodes) {
      fragment.insertBefore(node, marker);
    }
    return fragment;
  }

  const adoptedMarker = adoptHydrationRegion(ROUTER_VIEW_MARKER);
  const mountMarker = adoptedMarker ?? marker;
  fragment.appendChild(mountMarker);
  const mount = createMountPoint(fragment, mountMarker);
  const selection = createMemo(
    () => selectView(router, depth),
    { equals: sameSelection },
  );
  const liveProps = createLiveProps(router, depth);
  let currentResult: ComponentResult | null = null;
  let currentComponent: AnyComponent | null = null;
  let currentKey: string | number | undefined;
  let fallbackShown = false;

  const teardown = (): void => {
    mount.clear();
    currentResult?.dispose();
    currentResult = null;
    currentComponent = null;
    currentKey = undefined;
    fallbackShown = false;
  };

  createRenderEffect(() => {
    const current = selection();

    if (current.error !== null) {
      mount.clear();
      currentResult?.dispose();
      currentResult = null;
      currentComponent = null;
      currentKey = undefined;
      fallbackShown = false;
      mount.render(renderError(props, current.error));
      return;
    }

    const next = current.entry?.component ?? null;
    const nextKey = selectionKey(current);

    if (next === null) {
      if (fallbackShown && currentComponent === null) {
        return;
      }
      mount.clear();
      currentResult?.dispose();
      currentResult = null;
      currentComponent = null;
      currentKey = undefined;
      mount.render(props.fallback);
      fallbackShown = true;
      return;
    }

    if (
      next === currentComponent
      && !keysDiffer(nextKey, currentKey)
      && currentResult !== null
      && mountNodesConnected(mount.nodes())
    ) {
      currentResult.update(liveProps as unknown as Record<string, unknown>);
      return;
    }

    mount.clear();
    fallbackShown = false;
    currentResult?.dispose();
    currentComponent = next;
    const create = (): ComponentResult => runWithOwner(null, () =>
      untrack(() =>
        createComponent(
          next,
          liveProps as unknown as Record<string, unknown>,
          adoptedMarker === null
            ? viewOptions
            : { ...viewOptions, hydrate: false },
        ),
      ),
    );
    if (adoptedMarker === null) {
      currentResult = create();
    } else {
      currentResult = withoutHydration(create);
    }
    currentKey = nextKey;
    mount.render(currentResult.node);
  });

  onCleanup(() => {
    teardown();
  });

  return fragment;
}
