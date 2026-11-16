import {
  attr,
  createElement,
  createMountPoint,
  normalizeClass,
  on,
  type Children,
  type ClassNameValue,
} from "@ivlev-dev/silent-core";
import { createRenderEffect, onCleanup } from "@ivlev-dev/silent-reactivity";
import { RouterMissingError, isPathActive, type RouteTarget } from "./match.js";
import { Router } from "./router.js";

export interface LinkProps {
  readonly to: RouteTarget | (() => RouteTarget);
  readonly replace?: boolean;
  readonly activeClass?: string;
  readonly exactActiveClass?: string;
  readonly class?: ClassNameValue;
  readonly children?: Children;
  readonly router?: Router;
}

function resolveRouter(router: Router | undefined): Router {
  const resolved = router ?? Router.current();
  if (resolved === null) {
    throw new RouterMissingError("Link требует Router: передайте router или создайте экземпляр");
  }
  return resolved;
}

function resolveTarget(to: RouteTarget | (() => RouteTarget)): RouteTarget {
  return typeof to === "function" ? (to as () => RouteTarget)() : to;
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

export function Link(props: LinkProps): Node {
  const router = resolveRouter(props.router);
  const element = createElement("a");
  const target = (): RouteTarget => resolveTarget(props.to);

  attr(element, "href", () => router.href(target()));

  if (
    props.class !== undefined
    || props.activeClass !== undefined
    || props.exactActiveClass !== undefined
  ) {
    attr(element, "class", () => {
      const current = router.state().route;
      const location = router.resolve(target());
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
      const custom = normalizeClass(props.class);
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
    event.preventDefault();
    const navigation = props.replace === true
      ? router.replace(target())
      : router.push(target());
    void navigation.catch(() => {});
  });

  return element;
}
