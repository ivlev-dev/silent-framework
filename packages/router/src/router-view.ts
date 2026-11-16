import {
  collectNodes,
  createMountPoint,
  isServerMode,
  type Children,
} from "@ivlev-dev/silent-core";
import { createMemo, createRenderEffect, onCleanup } from "@ivlev-dev/silent-reactivity";
import {
  RouterMissingError,
  type MatchedRoute,
  type RouteLocation,
  type RouteParams,
  type RouteQuery,
} from "./match.js";
import { Router } from "./router.js";

export const ROUTER_VIEW_MARKER = "silent-router-view";

export interface RouterViewProps {
  readonly router?: Router;
  readonly depth?: number;
  readonly fallback?: unknown;
}

export interface RouterViewComponentProps {
  readonly route: RouteLocation | null;
  readonly params: RouteParams;
  readonly query: RouteQuery;
  readonly hash: string;
  readonly router: Router;
}

interface ViewSelection {
  readonly entry: MatchedRoute | undefined;
  readonly route: RouteLocation | null;
  readonly query: RouteQuery;
  readonly hash: string;
}

function resolveRouter(router: Router | undefined): Router {
  const resolved = router ?? Router.current();
  if (resolved === null) {
    throw new RouterMissingError("RouterView требует Router: передайте router или создайте экземпляр");
  }
  return resolved;
}

function selectView(router: Router, depth: number): ViewSelection {
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
  router: Router,
  props: RouterViewProps,
  selection: ViewSelection,
): unknown {
  const entry = selection.entry;
  const component = entry?.component;
  if (entry === undefined || component === undefined) {
    return props.fallback;
  }
  const viewProps: RouterViewComponentProps = {
    route: selection.route,
    params: entry.params,
    query: selection.query,
    hash: selection.hash,
    router,
  };
  return (component as (props: RouterViewComponentProps) => unknown)(viewProps);
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
  createRenderEffect(() => {
    mount.render(renderSelection(router, props, selection()));
  });
  onCleanup(mount.clear);
  return container;
}
