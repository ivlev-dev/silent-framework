import { isHydrating } from "./hydration-state.js";
import type { TemplatePlan } from "./dom.js";

export interface DomHydrationRuntime {
  settleNodes(end: Node | null, value: unknown): void;
  writeRegion(start: Node, end: Node, value: unknown): void;
  insertHydrated(parent: Node, accessor: () => unknown, marker: Node | null): void;
  adoptPartsPlan(
    root: Node,
    plan: TemplatePlan,
    out: { holes: Comment[]; attrs: Element[] },
  ): void;
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

export function adoptPartsPlan(
  root: Node,
  plan: TemplatePlan,
  out: { holes: Comment[]; attrs: Element[] },
): void {
  requireRuntime().adoptPartsPlan(root, plan, out);
}
