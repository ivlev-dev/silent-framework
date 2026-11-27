import { Router } from "@ivlev-dev/silent-router";
import { ROUTE_PATHS, routes } from "./routes.js";

export function createAppRouter(): Router {
  return new Router({
    routes,
    scrollBehavior: (_to, _from, savedPosition) => savedPosition ?? { left: 0, top: 0 },
  });
}

export function normalizeLegacyHash(): void {
  if (typeof window === "undefined") return;
  const { hash, search } = window.location;
  if (!hash.startsWith("#/")) return;
  const target = hash.slice(1);
  const next = target.includes("?") || search === "" ? target : `${target}${search}`;
  window.history.replaceState(window.history.state, "", next);
}

export function prefetchRoutes(router: Router): void {
  const paths: readonly string[] = [
    ROUTE_PATHS.projects,
    ROUTE_PATHS.team,
    ROUTE_PATHS.settings,
  ];
  for (const path of paths) {
    void router.prefetch(path).catch(() => undefined);
  }
}

export { ROUTE_PATHS, isSectionKey, sectionFromPath } from "./routes.js";
export type { SectionKey } from "./routes.js";
