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
} from "@ivlev-dev/silent-core";
import {
  createMemo,
  createRenderEffect,
  onCleanup,
  runWithOwner,
  untrack,
} from "@ivlev-dev/silent-reactivity";
import {
  RouterMissingError,
  type MatchedRoute,
  type RouteLocation,
  type RouteQuery,
} from "./match.js";
import type { RouteViewProps, TypedRouteLocation } from "./route.js";
import { Router, type IRouter } from "./router.js";

export const ROUTER_VIEW_MARKER = "silent-router-view";

export interface RouterViewProps {
  readonly router?: IRouter;
  readonly depth?: number;
  readonly fallback?: unknown;
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
}

function resolveRouter(router: IRouter | undefined): IRouter {
  if (router !== undefined) {
    return router;
  }
  const injected = getRuntimeOptions().container?.peek<IRouter>(Router);
  if (injected !== undefined) {
    return injected;
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
  };
}

function sameSelection(left: ViewSelection, right: ViewSelection): boolean {
  return left.entry === right.entry
    && left.route === right.route
    && left.query === right.query
    && left.hash === right.hash;
}

function renderSelection(
  router: IRouter,
  props: RouterViewProps,
  selection: ViewSelection,
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
    router,
  };
  return component(
    routeComponent as AnyComponent,
    viewProps as unknown as Record<string, unknown>,
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

export function RouterView(props: RouterViewProps): Node {
  const router = resolveRouter(props.router);
  const depth = props.depth ?? 0;
  const container = document.createDocumentFragment();
  const marker = document.createComment(ROUTER_VIEW_MARKER);
  container.appendChild(marker);

  if (isServerMode()) {
    const nodes = collectNodes(renderSelection(router, props, selectView(router, depth)) as Children);
    for (const node of nodes) {
      container.insertBefore(node, marker);
    }
    return container;
  }

  const runtimeOptions = getRuntimeOptions();
  const adoptedMarker = adoptHydrationRegion(ROUTER_VIEW_MARKER);
  const mountMarker = adoptedMarker ?? marker;
  container.appendChild(mountMarker);
  const mount = createMountPoint(container, mountMarker);
  const selection = createMemo(
    () => selectView(router, depth),
    { equals: sameSelection },
  );
  const liveProps = createLiveProps(router, depth);
  let currentResult: ComponentResult | null = null;
  let currentComponent: AnyComponent | null = null;
  let fallbackShown = false;

  const teardown = (): void => {
    mount.clear();
    currentResult?.dispose();
    currentResult = null;
    currentComponent = null;
    fallbackShown = false;
  };

  createRenderEffect(() => {
    const current = selection();
    const next = current.entry?.component ?? null;

    if (next === null) {
      if (fallbackShown && currentComponent === null) {
        return;
      }
      mount.clear();
      currentResult?.dispose();
      currentResult = null;
      currentComponent = null;
      mount.render(props.fallback);
      fallbackShown = true;
      return;
    }

    if (
      next === currentComponent
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
            ? runtimeOptions
            : { ...runtimeOptions, hydrate: false },
        ),
      ),
    );
    if (adoptedMarker === null) {
      currentResult = create();
    } else {
      currentResult = withoutHydration(create);
    }
    mount.render(currentResult.node);
  });

  onCleanup(() => {
    teardown();
  });

  return container;
}
