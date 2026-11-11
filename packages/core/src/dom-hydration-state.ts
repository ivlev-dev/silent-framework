import { isHydrating } from "./hydration-state.js";

export interface DomHydrationRuntime {
  settleNodes(end: Node | null, value: unknown): void;
  writeRegion(start: Node, end: Node, value: unknown): void;
  insertHydrated(parent: Node, accessor: () => unknown, marker: Node | null): void;
}

let runtime: DomHydrationRuntime | null = null;

export function registerDomHydrationRuntime(next: DomHydrationRuntime): void {
  runtime = next;
}

function requireRuntime(): DomHydrationRuntime {
  if (runtime === null) {
    throw new Error("Hydration DOM runtime не загружен");
  }
  return runtime;
}

export function settleNodes(end: Node | null, value: unknown): void {
  if (!isHydrating()) {
    return;
  }
  requireRuntime().settleNodes(end, value);
}

export function writeRegion(start: Node, end: Node, value: unknown): void {
  requireRuntime().writeRegion(start, end, value);
}

export function insertHydrated(
  parent: Node,
  accessor: () => unknown,
  marker: Node | null,
): void {
  requireRuntime().insertHydrated(parent, accessor, marker);
}
