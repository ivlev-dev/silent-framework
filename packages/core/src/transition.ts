import { createRenderEffect, createSignal, onCleanup } from "@ivlev-dev/silent-reactivity";
import type { Children } from "./jsx.js";
import {
  collectNodes,
  createMountPoint,
  isServerMode,
  resolveValue,
} from "./dom.js";
import { extractMetadata } from "./metadata.js";
import { settleWindow } from "./hydration-cursor.js";
import { collectBetween, currentWindow, isHydrating, mismatch } from "./hydration-proxy.js";

declare const __SILENT_SERVER__: boolean | undefined;

const SERVER = typeof __SILENT_SERVER__ === "undefined" || __SILENT_SERVER__;

export const TRANSITION_MARKER = "silent-transition";

export interface TransitionProps {
  readonly show?: unknown | (() => unknown);
  readonly when?: unknown | (() => unknown);
  readonly children?: unknown;
  readonly enterClass?: string;
  readonly leaveClass?: string;
  readonly duration?: number;
  readonly fallback?: unknown;
  readonly unmount?: boolean;
}

function truthy(value: unknown): boolean {
  return value !== null && value !== undefined && value !== false && value !== 0 && value !== "";
}

function showSource(props: TransitionProps): unknown | (() => unknown) {
  return props.show !== undefined ? props.show : props.when;
}

function resolveShow(props: TransitionProps): boolean {
  return truthy(resolveValue(showSource(props)));
}

function durationOf(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function isMarkerNode(node: Node | null, data: string): node is Comment {
  return (
    node !== null &&
    node.nodeType === Node.COMMENT_NODE &&
    (node as Comment).data === data
  );
}

function renderServer(props: TransitionProps): Node {
  const container = document.createDocumentFragment();
  const content = resolveShow(props) ? props.children : props.fallback;
  if (content !== undefined) {
    const nodes = extractMetadata(collectNodes(resolveValue(content) as Children));
    for (const node of nodes) {
      container.appendChild(node);
    }
  }
  container.appendChild(document.createComment(TRANSITION_MARKER));
  return container;
}

export function Transition(props: TransitionProps): Node {
  if (SERVER && isServerMode()) {
    return renderServer(props);
  }

  const hydrating = isHydrating();
  let container: DocumentFragment;
  let anchor: Comment;
  let mount: ReturnType<typeof createMountPoint>;
  let adopted = false;

  if (hydrating) {
    const outer = currentWindow();
    if (outer === null) {
      return mismatch("Transition вне окна гидрации");
    }
    const claimed = outer.end.previousSibling;
    if (!isMarkerNode(claimed, TRANSITION_MARKER)) {
      return mismatch("не найден якорь Transition");
    }
    const parent = claimed.parentNode;
    if (parent === null) {
      return mismatch("якорь Transition отсоединён");
    }
    anchor = claimed;
    mount = createMountPoint(parent, anchor, collectBetween(outer.start, anchor));
    settleWindow(outer, anchor);
    container = document.createDocumentFragment();
    adopted = true;
  } else {
    container = document.createDocumentFragment();
    anchor = document.createComment(TRANSITION_MARKER);
    container.appendChild(anchor);
    mount = createMountPoint(container, anchor);
  }

  const initialShown = hydrating ? resolveShow(props) : false;
  const [mounted, setMounted] = createSignal(initialShown);
  const [visible, setVisible] = createSignal(false);

  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let activeClass: string | null = null;
  let activeElements: Element[] = [];
  let firstTransition = true;
  let contentAdopted = adopted;

  const rootElements = (): Element[] => {
    const elements: Element[] = [];
    for (const node of mount.nodes()) {
      if (node instanceof Element) {
        elements.push(node);
      }
    }
    return elements;
  };

  const syncClass = (): void => {
    if (activeClass === null) {
      activeElements = [];
      return;
    }
    const current = rootElements();
    const currentSet = new Set(current);
    for (const element of activeElements) {
      if (!currentSet.has(element)) {
        element.classList.remove(activeClass);
      }
    }
    for (const element of current) {
      element.classList.add(activeClass);
    }
    activeElements = current;
  };

  const clearClass = (): void => {
    const previous = activeClass;
    activeClass = null;
    if (previous !== null) {
      for (const element of activeElements) {
        element.classList.remove(previous);
      }
    }
    activeElements = [];
  };

  const clearTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const applyClass = (name: string | undefined, async: boolean): void => {
    clearClass();
    if (!async || name === undefined || name === "") {
      return;
    }
    activeClass = name;
    syncClass();
  };

  const finishLeave = (): void => {
    clearTimer();
    clearClass();
    if (props.unmount === false) {
      return;
    }
    setMounted(false);
  };

  const enter = (): void => {
    clearTimer();
    clearClass();
    setMounted(true);
    const duration = durationOf(props.duration);
    applyClass(props.enterClass, duration > 0);
    if (activeClass !== null) {
      timer = setTimeout(() => {
        timer = null;
        if (disposed) {
          return;
        }
        clearClass();
      }, duration);
    }
  };

  const leave = (): void => {
    if (!mounted()) {
      clearTimer();
      clearClass();
      return;
    }
    clearTimer();
    clearClass();
    const duration = durationOf(props.duration);
    applyClass(props.leaveClass, duration > 0);
    if (activeClass !== null) {
      timer = setTimeout(() => {
        timer = null;
        if (disposed) {
          return;
        }
        finishLeave();
      }, duration);
      return;
    }
    finishLeave();
  };

  const content = (): void => {
    if (contentAdopted) {
      contentAdopted = false;
      return;
    }
    if (mounted()) {
      mount.render(resolveValue(props.children));
    } else if (props.fallback !== undefined) {
      mount.render(resolveValue(props.fallback));
    } else {
      mount.render(null);
    }
    syncClass();
  };

  createRenderEffect(() => {
    setVisible(resolveShow(props));
  });

  createRenderEffect(() => {
    mounted();
    content();
  });

  createRenderEffect(() => {
    const next = visible();
    if (firstTransition) {
      firstTransition = false;
      if (hydrating) {
        return;
      }
    }
    if (next) {
      enter();
    } else {
      leave();
    }
  });

  onCleanup(() => {
    if (disposed) {
      return;
    }
    disposed = true;
    clearTimer();
    clearClass();
    mount.clear();
  });

  return container;
}

export const Presence: typeof Transition = Transition;
