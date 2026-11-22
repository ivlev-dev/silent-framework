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
  canonicalizePath,
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
  if (isServerMode()) {
    throw new RouterMissingError(
      "Link требует Router в серверном рендере: передайте router или зарегистрируйте Router в контейнере; Router.current() на сервере не используется",
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
  /** Нормализованная внутренняя цель (backslash → slash только в pathname); null для объектов. */
  readonly internalTarget: string | null;
}

interface SplitTarget {
  readonly path: string;
  readonly search: string;
  readonly hash: string;
}

/**
 * Делит строковую цель на path/search/hash. Разделение нужно, чтобы
 * нормализовать обратные слэши только в pathname: в query и hash они
 * являются обычными данными и должны дойти до resolve без изменений.
 */
function splitTarget(target: string): SplitTarget {
  let rest = target;
  let hash = "";
  const hashIndex = rest.indexOf("#");
  if (hashIndex !== -1) {
    hash = rest.slice(hashIndex);
    rest = rest.slice(0, hashIndex);
  }
  let search = "";
  const queryIndex = rest.indexOf("?");
  if (queryIndex !== -1) {
    search = rest.slice(queryIndex);
    rest = rest.slice(0, queryIndex);
  }
  return { path: rest, search, hash };
}

const SCHEME_PATTERN = /^([a-z][a-z0-9+.-]*):/i;
const ALLOWED_SCHEMES: ReadonlySet<string> = new Set(["http", "https", "mailto", "tel"]);
// Сентинел для `new URL`: нужен только чтобы отличить same-origin путь
// от protocol-relative/cross-origin цели, реальный origin не используется.
const CLASSIFICATION_ORIGIN = "http://silent-router.invalid";

/**
 * Классифицирует цель ссылки. Внешними считаются только схемы из allow-list
 * (`http(s)`, `mailto`, `tel`), протокол-относительные (`//`) и hash-ссылки (`#`).
 * Неизвестные и опасные схемы (`javascript:`, `data:`, `vbscript:` и т.п.)
 * помечаются как `unsafe`: href не выставляется, клик не перехватывается.
 *
 * Обратные слэши нормализуются в `/` только в pathname, как это делает браузер.
 * В query/hash они остаются исходными данными. Если из-за нормализации
 * pathname становится protocol-relative (`/\evil.com` → `//evil.com`), цель
 * считается unsafe: иначе `<a>` выглядит внутренней, а ведёт на чужой origin.
 */
function inspectTarget(target: RouteTarget): TargetInfo {
  if (typeof target !== "string") {
    return { kind: "internal", externalHref: null, internalTarget: null };
  }
  // Браузер игнорирует ASCII-пробелы и управляющие символы в URL,
  // поэтому схему проверяем по нормализованной строке.
  const probe = target.replace(/[\u0000-\u0020]+/g, "");
  if (probe.startsWith("#")) {
    return { kind: "external", externalHref: target, internalTarget: null };
  }
  const scheme = SCHEME_PATTERN.exec(probe);
  if (scheme !== null) {
    const name = (scheme[1] ?? "").toLowerCase();
    if (ALLOWED_SCHEMES.has(name)) {
      return { kind: "external", externalHref: target, internalTarget: null };
    }
    return { kind: "unsafe", externalHref: null, internalTarget: null };
  }
  const split = splitTarget(target);
  const normalizedPath = split.path.replace(/\\/g, "/");
  const normalized = `${normalizedPath}${split.search}${split.hash}`;
  const normalizedPathProbe = normalizedPath.replace(/[\u0000-\u0020]+/g, "");
  if (normalizedPathProbe.startsWith("//")) {
    const trimmed = target.replace(/^[\u0000-\u0020]+/, "");
    if (!trimmed.startsWith("//")) {
      return { kind: "unsafe", externalHref: null, internalTarget: null };
    }
    return { kind: "external", externalHref: target, internalTarget: null };
  }
  let url: URL;
  try {
    url = new URL(normalized, CLASSIFICATION_ORIGIN);
  } catch {
    return { kind: "unsafe", externalHref: null, internalTarget: null };
  }
  if (url.origin !== CLASSIFICATION_ORIGIN) {
    return { kind: "unsafe", externalHref: null, internalTarget: null };
  }
  return { kind: "internal", externalHref: null, internalTarget: normalized };
}

function fallbackInternalHref(base: string, target: string | null): string | null {
  if (target === null || !target.startsWith("/") || target.startsWith("//")) {
    return null;
  }
  const hashIndex = target.indexOf("#");
  const hash = hashIndex === -1 ? "" : target.slice(hashIndex);
  const withoutHash = hashIndex === -1 ? target : target.slice(0, hashIndex);
  const queryIndex = withoutHash.indexOf("?");
  const search = queryIndex === -1 ? "" : withoutHash.slice(queryIndex);
  const path = queryIndex === -1 ? withoutHash : withoutHash.slice(0, queryIndex);
  return `${base}${canonicalizePath(path)}${search}${hash}`;
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
  fallbackHref: string | null,
): LinkState {
  let location: RouteLocation | null;
  try {
    location = internals.resolve(target);
  } catch {
    location = null;
  }
  const href = location === null
    ? fallbackHref
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
    const internalTarget: RouteTarget = info.internalTarget ?? value;
    return computeInternalState(
      router,
      internals,
      internalTarget,
      internals.route(),
      exactQuery,
      fallbackInternalHref(router.base, info.internalTarget),
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
      const info = inspectTarget(value);
      if (info.kind !== "internal") {
        return;
      }
      void router.prefetch(info.internalTarget ?? value).catch(() => {});
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
    const info = inspectTarget(value);
    if (info.kind !== "internal") {
      return;
    }
    event.preventDefault();
    const navigationTarget = info.internalTarget ?? value;
    const navigation = props.replace === true
      ? router.replace(navigationTarget)
      : router.push(navigationTarget);
    void navigation.catch(() => {});
  });

  return element;
}
