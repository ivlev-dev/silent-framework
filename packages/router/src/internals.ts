import type { Accessor } from "@ivlev-dev/silent-reactivity";
import type { RouteLocation, RouteTarget } from "./match.js";
import type { IRouter } from "./router.js";

/**
 * Внутренний контракт роутера для пакетных компонентов (`Link`).
 * Позволяет читать только маршрут, не подписываясь на изменения
 * `pending`/`error` в общем `state()`.
 *
 * Модуль не экспортируется из `index.ts` и не является публичным API пакета.
 */
export interface RouterInternals {
  readonly route: Accessor<RouteLocation | null>;
  resolve(to: RouteTarget): RouteLocation;
}

const registry = new WeakMap<IRouter, RouterInternals>();

export function registerRouterInternals(
  router: IRouter,
  internals: RouterInternals,
): void {
  registry.set(router, internals);
}

export function getRouterInternals(router: IRouter): RouterInternals | undefined {
  return registry.get(router);
}
