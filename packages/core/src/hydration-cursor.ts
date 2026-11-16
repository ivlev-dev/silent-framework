import type { HydrationWindow } from "./hydration-state.js";

export function beginRegion(outer: HydrationWindow, end: Node): HydrationWindow {
  return { start: outer.start, end, cursor: outer.start.nextSibling };
}

export function settleWindow(outer: HydrationWindow, anchor: Node): void {
  outer.cursor = anchor.nextSibling;
}

export function advanceCursor(window: HydrationWindow): void {
  window.cursor = window.end.nextSibling;
}

export function isPrimitiveText(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  const type = typeof value;
  return (
    type === "string" || type === "number" || type === "bigint" || type === "boolean"
  );
}

export function claimTextRegion(window: HydrationWindow, end: Node): boolean {
  let cursor = window.cursor;
  if (cursor === null) {
    return false;
  }
  if (cursor === end) {
    return true;
  }
  while (cursor !== null && cursor !== end) {
    if (cursor.nodeType !== Node.TEXT_NODE) {
      return false;
    }
    cursor = cursor.nextSibling;
  }
  if (cursor !== end) {
    return false;
  }
  window.cursor = end;
  return true;
}

export function regionMatches(
  window: HydrationWindow,
  end: Node,
  value: unknown,
): boolean {
  if (isPrimitiveText(value)) {
    return claimTextRegion(window, end);
  }
  return window.cursor === end;
}
