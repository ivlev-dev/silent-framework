import { createRenderEffect, onCleanup } from "@ivlev-dev/silent-reactivity";
import { MATCH_DESCRIPTOR, attachMatch, isMatchNode } from "./match-node.js";
import { createMountPoint } from "./dom.js";
import { settleNodes } from "./dom-hydration-state.js";
import {
  SWITCH,
  collectBetween,
  currentWindow,
  isHydrating,
  isMarker,
  mismatch,
  withWindow,
} from "./hydration-proxy.js";

export interface MatchProps {
  readonly when: unknown | (() => unknown);
  readonly children?: unknown;
}

export interface SwitchProps {
  readonly fallback?: unknown;
  readonly children: unknown | (() => unknown);
}

function truthy(value: unknown): boolean {
  return value !== null && value !== undefined && value !== false && value !== 0 && value !== "";
}

function resolve(value: unknown): unknown {
  let current = value;
  while (typeof current === "function") {
    current = (current as () => unknown)();
  }
  return current;
}

interface Selection {
  found: boolean;
  value: unknown;
}

function collectMatch(value: unknown, selection: Selection): void {
  let current = value;
  while (typeof current === "function") {
    current = (current as () => unknown)();
  }
  if (Array.isArray(current)) {
    for (let index = 0; index < current.length; index += 1) {
      collectMatch(current[index], selection);
    }
    return;
  }
  if (selection.found || !isMatchNode(current)) {
    return;
  }
  const descriptor = current[MATCH_DESCRIPTOR];
  if (truthy(descriptor.when())) {
    selection.found = true;
    selection.value = descriptor.children();
  }
}

function select(props: SwitchProps): unknown {
  const selection: Selection = { found: false, value: undefined };
  collectMatch(props.children, selection);
  return selection.found ? selection.value : resolve(props.fallback);
}

export function Match(props: MatchProps): Node {
  const node = document.createComment("silent-match");
  attachMatch(node, {
    when: () => resolve(props.when),
    children: () => resolve(props.children),
  });
  return node;
}

export function Switch(props: SwitchProps): Node {
  if (isHydrating()) {
    const outer = currentWindow();
    if (outer === null) {
      return mismatch("Switch вне окна гидрации");
    }
    const anchor = outer.end.previousSibling;
    if (!isMarker(anchor, SWITCH)) {
      return mismatch("не найден якорь Switch");
    }
    const parent = anchor.parentNode;
    if (parent === null) {
      return mismatch("якорь Switch отсоединён");
    }
    const mount = createMountPoint(parent, anchor, collectBetween(outer.start, anchor));
    let initialized = false;
    createRenderEffect(() => {
      if (!initialized) {
        initialized = true;
        const window = {
          start: outer.start,
          end: anchor,
          cursor: outer.start.nextSibling,
        };
        const value = withWindow(window, () => select(props));
        settleNodes(anchor, value);
        if (window.cursor !== anchor) {
          mismatch("содержимое Switch не совпало");
        }
        outer.cursor = anchor.nextSibling;
        return;
      }
      mount.render(select(props));
    });
    onCleanup(mount.clear);
    return document.createDocumentFragment();
  }

  const container = document.createDocumentFragment();
  const anchor = document.createComment(SWITCH);
  container.appendChild(anchor);
  const mount = createMountPoint(container, anchor);
  createRenderEffect(() => {
    mount.render(select(props));
  });
  onCleanup(mount.clear);
  return container;
}
