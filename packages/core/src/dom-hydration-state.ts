import { isHydrating } from "./hydration-state.js";
import type {
  TemplateClone,
  TemplateHydrationSource,
  TemplatePlan,
} from "./dom.js";


declare const __SILENT_HYDRATE__: boolean | undefined;

const HYDRATE =
  typeof __SILENT_HYDRATE__ === "undefined" || __SILENT_HYDRATE__;
export interface DomHydrationRuntime {
  hydrateTemplate(source: TemplateHydrationSource): TemplateClone;
  settleNodes(end: Node | null, value: unknown): void;
  writeRegion(start: Node, end: Node, value: unknown): void;
  insertHydrated(parent: Node, accessor: () => unknown, marker: Node | null): void;
  hydratedEffect(fn: () => void): (() => void) | null;
  adoptPartsPlan(
    root: Node,
    plan: TemplatePlan,
    out: { holes: Comment[]; attrs: Element[] },
  ): void;
}

let runtime: DomHydrationRuntime | null = null;
let staticDepth = 0;

export function registerDomHydrationRuntime(next: DomHydrationRuntime): void {
  runtime = next;
}

export function withStaticHydration<T>(fn: () => T): T {
  staticDepth += 1;
  try {
    return fn();
  } finally {
    staticDepth -= 1;
  }
}

export function isStaticHydration(): boolean {
  return staticDepth > 0;
}

export function getDomHydrationRuntime(): DomHydrationRuntime {
  if (runtime === null) {
    throw new Error("Hydration DOM runtime не загружен");
  }
  return runtime;
}

function requireRuntime(): DomHydrationRuntime {
  if (runtime === null) {
    throw new Error("Hydration DOM runtime не загружен");
  }
  return runtime;
}

export function settleNodes(end: Node | null, value: unknown): void {
  if (!HYDRATE || !isHydrating()) {
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

export function hydratedEffect(fn: () => void): (() => void) | null {
  return requireRuntime().hydratedEffect(fn);
}

export function adoptPartsPlan(
  root: Node,
  plan: TemplatePlan,
  out: { holes: Comment[]; attrs: Element[] },
): void {
  requireRuntime().adoptPartsPlan(root, plan, out);
}
