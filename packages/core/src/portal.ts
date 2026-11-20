import { createRenderEffect, createRoot, createSignal, onCleanup } from "@ivlev-dev/silent-reactivity";
import type { Children } from "./jsx.js";
import {
  attachDisposer,
  collectNodes,
  disposeNode,
  isServerMode,
  resolveValue,
} from "./dom.js";
import { extractMetadata } from "./metadata.js";
import { currentWindow, isHydrating, mismatch, withoutHydration } from "./hydration-proxy.js";


declare const __SILENT_HYDRATE__: boolean | undefined;

const HYDRATE =
  typeof __SILENT_HYDRATE__ === "undefined" || __SILENT_HYDRATE__;
declare const __SILENT_SERVER__: boolean | undefined;

const SERVER = typeof __SILENT_SERVER__ === "undefined" || __SILENT_SERVER__;

export const PORTAL_MARKER = "silent-portal";

export type PortalTarget = Element | string | (() => Element | null);

export interface PortalProps {
  readonly target: PortalTarget;
  readonly children?: Children;
}

interface PortalHost {
  render(value: unknown): void;
  reparent(parent: Node, marker: Node | null): void;
  clear(): void;
}

function isTextValue(value: unknown): boolean {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint"
  );
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }
  if (typeof left !== typeof right) {
    return false;
  }
  if (isTextValue(left) || typeof left === "boolean") {
    return Object.is(left, right);
  }
  return false;
}

function sameNodes(left: readonly Node[], right: readonly Node[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function detach(node: Node): void {
  node.parentNode?.removeChild(node);
}

function createPortalHost(parent: Node, marker: Node | null): PortalHost {
  let hostParent = parent;
  let hostMarker = marker;
  let nodes: Node[] = [];
  let textNode: Text | null = null;
  let initialized = false;
  let previous: unknown = null;

  const place = (node: Node): void => {
    if (hostMarker === null) {
      hostParent.appendChild(node);
      return;
    }
    hostParent.insertBefore(node, hostMarker);
  };

  const clear = (): void => {
    for (const node of nodes) {
      disposeNode(node);
      detach(node);
    }
    nodes = [];
    textNode = null;
    initialized = false;
    previous = null;
  };

  const render = (value: unknown): void => {
    if (initialized && valuesEqual(value, previous)) {
      return;
    }
    const current = resolveValue(value);
    if (isTextValue(current)) {
      const next = String(current);
      if (textNode !== null) {
        if (textNode.data !== next) {
          textNode.data = next;
        }
        initialized = true;
        previous = value;
        return;
      }
      clear();
      textNode = document.createTextNode(next);
      nodes = [textNode];
      place(textNode);
      initialized = true;
      previous = value;
      return;
    }
    if (current === null || current === undefined || typeof current === "boolean") {
      clear();
      initialized = true;
      previous = value;
      return;
    }
    const nextNodes = extractMetadata(collectNodes(current as Children));
    if (sameNodes(nodes, nextNodes)) {
      initialized = true;
      previous = value;
      return;
    }
    clear();
    nodes = nextNodes;
    for (const node of nodes) {
      place(node);
    }
    initialized = true;
    previous = value;
  };

  const reparent = (nextParent: Node, nextMarker: Node | null): void => {
    if (nextParent === hostParent && nextMarker === hostMarker) {
      return;
    }
    hostParent = nextParent;
    hostMarker = nextMarker;
    for (const node of nodes) {
      place(node);
    }
  };

  return {
    render,
    reparent,
    clear,
  };
}

function resolvePortalTarget(target: PortalTarget): Element | null {
  const candidate = typeof target === "function" ? target() : target;
  if (typeof candidate === "string") {
    if (candidate.length === 0) {
      return null;
    }
    try {
      const found = document.querySelector(candidate);
      return found instanceof Element ? found : null;
    } catch {
      return null;
    }
  }
  return candidate instanceof Element ? candidate : null;
}

function isComment(node: Node | null, data: string): node is Comment {
  return (
    node !== null &&
    node.nodeType === Node.COMMENT_NODE &&
    (node as Comment).data === data
  );
}

export function Portal(props: PortalProps): Node {
  let marker: Comment = document.createComment(PORTAL_MARKER);
  if (SERVER && isServerMode()) {
    return marker;
  }

  if (HYDRATE && isHydrating()) {
    const window = currentWindow();
    if (window === null) {
      return mismatch("Portal вне окна гидрации");
    }
    const cursor = window.cursor;
    if (!isComment(cursor, PORTAL_MARKER)) {
      return mismatch("не найден маркер Portal");
    }
    marker = cursor;
    window.cursor = cursor.nextSibling;
  }

  let disposed = false;
  let host: PortalHost | null = null;
  let rootDispose: (() => void) | null = null;
  const [hostEpoch, setHostEpoch] = createSignal(0);
  let observer: MutationObserver | null = null;
  let retryFrame: number | null = null;
  let retryCount = 0;
  let lastTarget: Element | null = null;
  let lastConnected = false;
  const MAX_RETRY_FRAMES = 240;

  const stopWaiting = (): void => {
    if (observer !== null) {
      observer.disconnect();
      observer = null;
    }
    if (retryFrame !== null) {
      if (typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(retryFrame);
      }
      retryFrame = null;
    }
    retryCount = 0;
  };

  const dispose = (): void => {
    if (disposed) {
      return;
    }
    disposed = true;
    stopWaiting();
    const disposeRoot = rootDispose;
    rootDispose = null;
    disposeRoot?.();
    host?.clear();
    host = null;
  };

  /**
   * Ожидание target без прокрутки microtask-очереди: MutationObserver
   * реагирует на появление узла, rAF-ветка ограничена по числу кадров
   * и отменяется вместе с порталом.
   */
  const scheduleRetry = (): void => {
    if (disposed || observer !== null || retryFrame !== null) {
      return;
    }
    const root = typeof document === "undefined" ? null : document.documentElement;
    if (typeof MutationObserver === "function" && root !== null) {
      const active = new MutationObserver(() => {
        if (disposed) {
          stopWaiting();
          return;
        }
        const next = resolvePortalTarget(props.target);
        const connected = marker.parentNode !== null;
        const changed = next !== lastTarget || connected !== lastConnected;
        stopWaiting();
        if (changed) {
          setHostEpoch((value) => value + 1);
          return;
        }
        // Мутации от собственного рендера не должны запускать новый цикл:
        // продолжаем ждать без перерасчёта эффекта.
        scheduleRetry();
      });
      observer = active;
      active.observe(root, { childList: true, subtree: true });
      return;
    }
    if (typeof requestAnimationFrame !== "function") {
      return;
    }
    retryCount += 1;
    if (retryCount > MAX_RETRY_FRAMES) {
      return;
    }
    retryFrame = requestAnimationFrame(() => {
      retryFrame = null;
      if (!disposed) {
        setHostEpoch((value) => value + 1);
      }
    });
  };

  createRoot((disposeRoot) => {
    rootDispose = disposeRoot;

    createRenderEffect(() => {
      hostEpoch();
      if (disposed) {
        return;
      }
      const target = resolvePortalTarget(props.target);
      lastTarget = target;
      lastConnected = marker.parentNode !== null;
      if (target === null) {
        scheduleRetry();
      } else {
        stopWaiting();
      }
      const parent = target ?? marker.parentNode;
      if (parent === null) {
        return;
      }
      const anchor = target === null ? marker : null;
      if (host === null) {
        host = createPortalHost(parent, anchor);
        setHostEpoch((value) => value + 1);
        return;
      }
      host.reparent(parent, anchor);
    });

    createRenderEffect(() => {
      hostEpoch();
      if (disposed || host === null) {
        return;
      }
      host.render(withoutHydration(() => resolveValue(props.children)));
    });

    return null;
  });

  attachDisposer(marker, dispose);
  onCleanup(dispose);
  return marker;
}

export const Teleport: typeof Portal = Portal;
