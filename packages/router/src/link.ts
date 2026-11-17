import {
  attr,
  createElement,
  createMountPoint,
  getRuntimeOptions,
  normalizeClass,
  on,
  type Children,
  type ClassNameValue,
} from "@ivlev-dev/silent-core";
import { createRenderEffect, onCleanup } from "@ivlev-dev/silent-reactivity";
import { RouterMissingError, isPathActive, type RouteTarget } from "./match.js";
import { Router, type IRouter } from "./router.js";

export interface LinkProps {
  readonly to: RouteTarget | (() => RouteTarget);
  readonly replace?: boolean;
  readonly activeClass?: string;
  readonly exactActiveClass?: string;
  readonly class?: ClassNameValue;
  readonly children?: Children;
  readonly router?: IRouter;
  readonly prefetch?: boolean;
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
    throw new RouterMissingError("Link требует Router: передайте router или создайте экземпляр");
  }
  return resolved;
}

function resolveTarget(to: RouteTarget | (() => RouteTarget)): RouteTarget {
  return typeof to === "function" ? (to as () => RouteTarget)() : to;
}

function externalHref(target: RouteTarget): string | null {
  if (typeof target !== "string") {
    return null;
  }
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(target) ? target : null;
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

function isExactActive(router: IRouter, target: RouteTarget): boolean {
  const current = router.state().route;
  if (current === null) {
    return false;
  }
  const location = router.resolve(target);
  if (location.name !== null && current.name === location.name) {
    return matchesParams(current.params, location.params);
  }
  return current.path === location.path;
}

export function Link(props: LinkProps): Node {
  const router = resolveRouter(props.router);
  const element = createElement("a");
  const target = (): RouteTarget => resolveTarget(props.to);

  attr(element, "href", () => {
    const value = target();
    return externalHref(value) ?? router.href(value);
  });
  attr(element, "aria-current", () => {
    const value = target();
    return externalHref(value) === null && isExactActive(router, value) ? "page" : null;
  });

  if (
    props.class !== undefined
    || props.activeClass !== undefined
    || props.exactActiveClass !== undefined
  ) {
    attr(element, "class", () => {
      const value = target();
      const custom = normalizeClass(props.class);
      if (externalHref(value) !== null) {
        return custom;
      }
      const current = router.state().route;
      const location = router.resolve(value);
      let active = false;
      let exact = false;
      if (current !== null) {
        if (location.name !== null && current.name === location.name) {
          exact = matchesParams(current.params, location.params);
          active = exact;
        } else {
          exact = current.path === location.path;
          active = isPathActive(current.path, location.path, false);
        }
      }
      const classes: string[] = [];
      if (custom !== "") {
        classes.push(custom);
      }
      if (active && props.activeClass !== undefined) {
        classes.push(props.activeClass);
      }
      if (exact && props.exactActiveClass !== undefined) {
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

  if (props.prefetch === true) {
    let started = false;
    const prefetch = (): void => {
      if (started) {
        return;
      }
      started = true;
      const value = target();
      if (externalHref(value) !== null) {
        return;
      }
      void router.prefetch(value).catch(() => {});
    };
    on(element, "pointerenter", () => prefetch);
    on(element, "focus", () => prefetch);
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
    if (externalHref(value) !== null) {
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
