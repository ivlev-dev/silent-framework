import {
  collectNodes,
  component,
  createMountPoint,
  getRuntimeOptions,
  isServerMode,
  type AnyComponent,
  type Children,
} from "@ivlev-dev/silent-core";
import { createMemo, createRenderEffect, createRoot, onCleanup } from "@ivlev-dev/silent-reactivity";
import {
  RouterMissingError,
  type MatchedRoute,
  type RouteLocation,
  type RouteQuery,
} from "./match.js";
import type { RouteViewProps } from "./route.js";
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

  const mount = createMountPoint(container, marker);
  const selection = createMemo(
    () => selectView(router, depth),
    { equals: sameSelection },
  );
  let viewRootDispose: (() => void) | null = null;
  createRenderEffect(() => {
    const current = selection();
    mount.clear();
    viewRootDispose?.();
    viewRootDispose = null;
    const output = createRoot((dispose) => {
      viewRootDispose = dispose;
      return renderSelection(router, props, current);
    });
    mount.render(output);
  });
  onCleanup(() => {
    mount.clear();
    viewRootDispose?.();
    viewRootDispose = null;
  });
  return container;
}
