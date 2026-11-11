import { createRenderEffect } from "@ivlev-dev/silent-reactivity";
import { collectNodes, disposeNode, resolveValue, stringOf } from "./dom.js";
import { registerDomHydrationRuntime } from "./dom-hydration-state.js";
import {
  INSERT_END,
  INSERT_START,
  collectBetween,
  findInsertWindow,
  isMarker,
  withWindow,
  type HydrationWindow,
} from "./hydration.js";
import { extractMetadata } from "./metadata.js";
import type { Children } from "./jsx.js";

function isTextValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  const type = typeof value;
  return type === "string" || type === "number" || type === "bigint" || type === "boolean";
}

function insertText(parent: Node, marker: Node | null, node: Text): void {
  if (marker === null) {
    parent.appendChild(node);
    return;
  }
  const container = marker.parentNode;
  if (container === null) {
    parent.appendChild(node);
    return;
  }
  container.insertBefore(node, marker);
}

function ensureRegion(
  parent: Node,
  marker: Node | null,
  text: Text | null,
): HydrationWindow {
  const start = document.createComment(INSERT_START);
  const end = document.createComment(INSERT_END);
  if (text !== null && text.parentNode !== null) {
    const container = text.parentNode;
    container.insertBefore(start, text);
    container.insertBefore(end, text.nextSibling ?? marker);
  } else if (marker !== null && marker.parentNode !== null) {
    const container = marker.parentNode;
    container.insertBefore(start, marker);
    container.insertBefore(end, marker);
  } else {
    parent.appendChild(start);
    parent.appendChild(end);
  }
  return { start, end, cursor: start.nextSibling };
}

function textHydrated(
  parent: Node,
  accessor: () => unknown,
  marker: Node | null,
  initial: Text | null,
): void {
  let textNode = initial;
  let region: HydrationWindow | null = null;
  createRenderEffect(() => {
    const value = accessor();
    if (region !== null) {
      writeRegion(region.start, region.end, value);
      return;
    }
    const resolved = resolveValue(value);
    if (isTextValue(resolved)) {
      const next = stringOf(resolved);
      if (textNode === null) {
        if (next === "") {
          return;
        }
        textNode = document.createTextNode(next);
        insertText(parent, marker, textNode);
        return;
      }
      if (textNode.data !== next) {
        textNode.data = next;
      }
      return;
    }
    region = ensureRegion(parent, marker, textNode);
    textNode = null;
    writeRegion(region.start, region.end, value);
  });
}

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
  const previous = marker === null ? parent.lastChild : marker.previousSibling;
  if (!isMarker(previous, INSERT_END)) {
    textHydrated(parent, accessor, marker, previous instanceof Text ? previous : null);
    return;
  }
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
