import { createRenderEffect } from "@ivlev-dev/silent-reactivity";
import { collectNodes, disposeNode, resolveValue, stringOf } from "./dom.js";
import { registerDomHydrationRuntime } from "./dom-hydration-state.js";
import { collectBetween, findInsertWindow, withWindow } from "./hydration.js";
import { extractMetadata } from "./metadata.js";
import type { Children } from "./jsx.js";

export function settleNodes(end: Node | null, value: unknown): void {
  if (end === null || !(value instanceof Node)) {
    return;
  }
  const parent = end.parentNode;
  if (parent === null) {
    return;
  }
  for (const node of collectNodes(value as Children)) {
    if (node.parentNode !== parent) {
      parent.insertBefore(node, end);
    }
  }
}

export function writeRegion(start: Node, end: Node, value: unknown): void {
  const parent = end.parentNode;
  if (parent === null) {
    return;
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint"
  ) {
    const first = start.nextSibling;
    if (first !== null && first !== end && first.nextSibling === end && first instanceof Text) {
      const next = stringOf(value);
      if (first.data !== next) {
        first.data = next;
      }
      return;
    }
  }
  const existing = collectBetween(start, end);
  for (const node of existing) {
    disposeNode(node);
    parent.removeChild(node);
  }
  for (const node of extractMetadata(collectNodes(value as Children))) {
    parent.insertBefore(node, end);
  }
}

export function insertHydrated(
  parent: Node,
  accessor: () => unknown,
  marker: Node | null,
): void {
  const window = findInsertWindow(marker, parent);
  let initialized = false;
  createRenderEffect(() => {
    if (!initialized) {
      initialized = true;
      const value = resolveValue(withWindow(window, () => accessor()));
      settleNodes(window.end, value);
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "bigint"
      ) {
        const first = window.start.nextSibling;
        if (first !== null && first !== window.end && first.nextSibling === window.end && first instanceof Text) {
          const next = stringOf(value);
          if (first.data !== next) {
            first.data = next;
          }
        }
      }
      return;
    }
    writeRegion(window.start, window.end, accessor());
  });
}

export function installDomHydrationRuntime(): void {
  registerDomHydrationRuntime({ settleNodes, writeRegion, insertHydrated });
}

installDomHydrationRuntime();
