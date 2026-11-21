import {
  attr,
  createElement,
  createMountPoint,
  getRuntimeOptions,
  isServerMode,
  normalizeClass,
  on,
  type Children,
  type ClassNameValue,
} from "@ivlev-dev/silent-core";
import { createMemo, createRenderEffect, onCleanup } from "@ivlev-dev/silent-reactivity";
import {
  RouterMissingError,
  isPathActive,
  type RouteLocation,
  type RouteQuery,
  type RouteTarget,
} from "./match.js";
import { Router, type IRouter } from "./router.js";
import { getRouterInternals, type RouterInternals } from "./internals.js";

export interface LinkProps {
  readonly to: RouteTarget | (() => RouteTarget);
  readonly replace?: boolean;
  readonly activeClass?: string;
  readonly exactActiveClass?: string;
  readonly class?: ClassNameValue;
  readonly children?: Children;
  readonly router?: IRouter;
  readonly prefetch?: boolean | "hover" | "visible";
  /** Сравнивать query при определении точного активного маршрута. По умолчанию true. */
  readonly exactQuery?: boolean;
}

function resolveRouter(router: IRouter | undefined): IRouter {
  if (router !== undefined) {
    return router;
  }
  const container = getRuntimeOptions().container;
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
      "Link не нашёл Router в контейнере: передайте router или зарегистрируйте Router",
    );
  }
  const resolved = Router.current();
  if (resolved === null) {
    throw new RouterMissingError("Link требует Router: передайте router или создайте экземпляр");
  }
  return resolved;
}

function resolveTarget(to: RouteTarget | (() => RouteTarget)): RouteTarget {
  return typeof to === "function" ? (to as () => RouteTarget)() : to;
}

type TargetKind = "external" | "internal" | "unsafe";

interface TargetInfo {
  readonly kind: TargetKind;
  readonly externalHref: string | null;
}

const SCHEME_PATTERN = /^([a-z][a-z0-9+.-]*):/i;
const ALLOWED_SCHEMES: ReadonlySet<string> = new Set(["http", "https", "mailto", "tel"]);

/**
 * Классифицирует цель ссылки. Внешними считаются только схемы из allow-list
 * (`http(s)`, `mailto`, `tel`), протокол-относительные (`//`) и hash-ссылки (`#`).
 * Неизвестные и опасные схемы (`javascript:`, `data:`, `vbscript:` и т.п.)
 * помечаются как `unsafe`: href не выставляется, клик не перехватывается.
 */
function inspectTarget(target: RouteTarget): TargetInfo {
  if (typeof target !== "string") {
    return { kind: "internal", externalHref: null };
  }
  // Браузер игнорирует ASCII-пробелы и управляющие символы в URL,
  // поэтому схему проверяем по нормализованной строке.
  const probe = target.replace(/[\u0000-\u0020]+/g, "");
  if (probe.startsWith("#") || probe.startsWith("//")) {
    return { kind: "external", externalHref: target };
  }
  const scheme = SCHEME_PATTERN.exec(probe);
  if (scheme === null) {
    return { kind: "internal", externalHref: null };
  }
  const name = (scheme[1] ?? "").toLowerCase();
  if (ALLOWED_SCHEMES.has(name)) {
    return { kind: "external", externalHref: target };
  }
  return { kind: "unsafe", externalHref: null };
}

function internalsFor(router: IRouter): RouterInternals {
  const internal = getRouterInternals(router);
  if (internal !== undefined) {
    return internal;
  }
  // Сторонние реализации IRouter не обязаны поддерживать внутренний контракт.
  return {
    route: () => router.state().route,
    resolve: (to) => router.resolve(to),
  };
}

interface LinkState {
  readonly href: string | null;
  readonly active: boolean;
  readonly exact: boolean;
}

const INACTIVE_STATE: LinkState = Object.freeze({
  href: null,
  active: false,
  exact: false,
});

function computeInternalState(
  router: IRouter,
  internals: RouterInternals,
  target: RouteTarget,
  current: RouteLocation | null,
  exactQuery: boolean,
): LinkState {
  let location: RouteLocation | null;
  try {
    location = internals.resolve(target);
  } catch {
    location = null;
  }
  const href = location === null
    ? typeof target === "string" ? target : null
    : `${router.base}${location.fullPath}`;
  if (current === null || location === null) {
    return { href, active: false, exact: false };
  }
  let active: boolean;
  if (location.name !== null && current.name === location.name) {
    active = matchesParams(current.params, location.params);
  } else {
    active = isPathActive(current.path, location.path, false);
  }
  return {
    href,
    active,
    exact: active && isExactMatch(current, location, exactQuery),
  };
}

function matchesParams(
  current: Readonly<Record<string, string>>,
  target: Readonly<Record<string, string>>,
): boolean {
  for (const key of Object.keys(target)) {
    if (current[key] !== target[key]) {
      return false;
    }
  }
  return true;
}

function matchesQuery(current: RouteQuery, target: RouteQuery): boolean {
  const currentKeys = Object.keys(current);
  if (currentKeys.length !== Object.keys(target).length) {
    return false;
  }
  for (const key of currentKeys) {
    const currentValue = current[key];
    const targetValue = target[key];
    if (currentValue === undefined || targetValue === undefined) {
      if (currentValue !== targetValue) {
        return false;
      }
      continue;
    }
    if (Array.isArray(currentValue) || Array.isArray(targetValue)) {
      if (!Array.isArray(currentValue) || !Array.isArray(targetValue)) {
        return false;
      }
      if (currentValue.length !== targetValue.length) {
        return false;
      }
      for (let index = 0; index < currentValue.length; index += 1) {
        if (String(currentValue[index]) !== String(targetValue[index])) {
          return false;
        }
      }
      continue;
    }
    if (String(currentValue) !== String(targetValue)) {
      return false;
    }
  }
  return true;
}

function isExactMatch(
  current: RouteLocation,
  location: RouteLocation,
  exactQuery: boolean,
): boolean {
  if (current.hash !== location.hash) {
    return false;
  }
  if (exactQuery && !matchesQuery(current.query, location.query)) {
    return false;
  }
  if (location.name !== null && current.name === location.name) {
    return matchesParams(current.params, location.params);
  }
  return current.path === location.path;
}

export function Link(props: LinkProps): Node {
  const router = resolveRouter(props.router);
  const internals = internalsFor(router);
  const exactQuery = props.exactQuery !== false;
  const element = createElement("a");
  const target = (): RouteTarget => resolveTarget(props.to);
  // Один мемоизированный результат на ссылку: href, aria-current и class
  // переиспользуют его, а смена pending/error не запускает resolve заново.
  const state = createMemo<LinkState>(() => {
    const value = target();
    const info = inspectTarget(value);
    if (info.kind !== "internal") {
      return info.kind === "external"
        ? { href: info.externalHref, active: false, exact: false }
        : INACTIVE_STATE;
    }
    return computeInternalState(
      router,
      internals,
      value,
      internals.route(),
      exactQuery,
    );
  });

  attr(element, "href", () => state().href);
  attr(element, "aria-current", () => (state().exact ? "page" : null));

  if (
    props.class !== undefined
    || props.activeClass !== undefined
    || props.exactActiveClass !== undefined
  ) {
    attr(element, "class", () => {
      const computed = state();
      const custom = normalizeClass(props.class);
      const classes: string[] = [];
      if (custom !== "") {
        classes.push(custom);
      }
      if (computed.active && props.activeClass !== undefined) {
        classes.push(props.activeClass);
      }
      if (computed.exact && props.exactActiveClass !== undefined) {
        classes.push(props.exactActiveClass);
      }
      return classes.join(" ");
    });
  }

  const mount = createMountPoint(element, null);
  createRenderEffect(() => {
    mount.render(props.children);
  });
  onCleanup(mount.clear);

  const prefetchMode = props.prefetch;
  if (prefetchMode === true || prefetchMode === "hover" || prefetchMode === "visible") {
    let started = false;
    const prefetch = (): void => {
      if (started) {
        return;
      }
      started = true;
      const value = target();
      if (inspectTarget(value).kind !== "internal") {
        return;
      }
      void router.prefetch(value).catch(() => {});
    };
    if (prefetchMode === "visible") {
      if (typeof IntersectionObserver === "function") {
        const observer = new IntersectionObserver((entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              prefetch();
              observer.disconnect();
              return;
            }
          }
        });
        observer.observe(element);
        onCleanup(() => {
          observer.disconnect();
        });
      } else if (!isServerMode()) {
        prefetch();
      }
    } else {
      on(element, "pointerenter", () => prefetch);
      on(element, "pointerdown", () => prefetch);
      on(element, "focus", () => prefetch);
    }
  }

  on(element, "click", () => (event: MouseEvent): void => {
    if (event.defaultPrevented || event.button !== 0) {
      return;
    }
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    if (element.hasAttribute("download")) {
      return;
    }
    const value = target();
    if (inspectTarget(value).kind !== "internal") {
      return;
    }
    event.preventDefault();
    const navigation = props.replace === true
      ? router.replace(value)
      : router.push(value);
    void navigation.catch(() => {});
  });

  return element;
}
