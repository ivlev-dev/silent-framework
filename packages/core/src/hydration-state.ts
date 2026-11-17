import { getOwner } from "@ivlev-dev/silent-reactivity";
import { emitDevtoolsError } from "./devtools-events.js";
import { findOwnerRuntimeOptions } from "./runtime-context.js";

export class HydrationMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HydrationMismatchError";
  }
}

export interface HydrationWindow {
  readonly start: Node;
  readonly end: Node;
  cursor: Node | null;
}

export interface HydrationContext {
  readonly windows: HydrationWindow[];
  readonly listener: ((error: HydrationMismatchError) => void) | null;
}

export const INSERT_START = "silent-insert";
export const INSERT_END = "silent-insert-end";
export const VIEW_START = "silent-view";
export const VIEW_END = "silent-view-end";
export const ITEM = "silent-item";
export const LIST_END = "silent-end";
export const SHOW = "silent-show";
export const SWITCH = "silent-switch";
export const ERROR_BOUNDARY = "silent-error";
export const MATCH = "silent-match";
export const FRAGMENT = "silent-fragment";
export const SUSPENSE = "silent-suspense";
export const HYDRATE_START = "silent-hydrate";
export const HYDRATE_END = "silent-hydrate-end";

export interface HydrationStats {
  readonly active: boolean;
  readonly depth: number;
  readonly windows: number;
  readonly sessions: number;
  readonly mismatches: number;
}

export interface HydrationRuntime {
  claimNext(): Node | null;
  isMarker(node: Node | null | undefined, data: string): node is Comment;
  isItemMarker(node: Node | null | undefined): node is Comment;
  findViewEnd(start: Node, limit?: Node | null): Node;
  findInsertWindow(marker: Node | null, parent: Node): HydrationWindow;
  collectBetween(start: Node, end: Node): Node[];
  mergeTopLevelMetadata(fresh: Node, claimed: Node): void;
  shapeMatches(
    fresh: Node,
    claimed: Node,
    ignoreTopMetadata?: boolean,
    simpleFresh?: boolean,
    strict?: boolean,
  ): boolean;
  significantChildren(node: Node, index: number): Node | null;
  significantChildrenFromEnd(node: Node, offset: number): Node | null;
  countSignificantChildren(node: Node): number;
}

const contexts: HydrationContext[] = [];
let current: HydrationContext | null = null;
let runtime: HydrationRuntime | null = null;
let sessions = 0;
let mismatches = 0;

export function getHydrationStats(): HydrationStats {
  return {
    active: current !== null,
    depth: contexts.length,
    windows: current?.windows.length ?? 0,
    sessions,
    mismatches,
  };
}

function refreshContext(): void {
  current = contexts.length === 0 ? null : contexts[contexts.length - 1] ?? null;
}

export function registerHydrationRuntime(next: HydrationRuntime): void {
  runtime = next;
}

export function getHydrationRuntime(): HydrationRuntime {
  if (runtime === null) {
    throw new Error("Hydration runtime не загружен");
  }
  return runtime;
}

export function isHydrating(): boolean {
  if (current === null) {
    return false;
  }
  const options = findOwnerRuntimeOptions(getOwner());
  return options?.hydrate !== false;
}

export function beginHydration(
  listener?: (error: HydrationMismatchError) => void,
): HydrationContext {
  const context: HydrationContext = {
    windows: [],
    listener: listener ?? null,
  };
  contexts.push(context);
  current = context;
  sessions += 1;
  return context;
}

export function endHydration(context?: HydrationContext): void {
  if (context === undefined) {
    contexts.pop();
    refreshContext();
    return;
  }
  const index = contexts.lastIndexOf(context);
  if (index === -1) {
    return;
  }
  contexts.splice(index, 1);
  refreshContext();
}

export function currentWindow(): HydrationWindow | null {
  if (current === null) {
    return null;
  }
  const windows = current.windows;
  return windows.length === 0 ? null : windows[windows.length - 1] ?? null;
}

export function withWindow<T, A extends unknown[]>(
  window: HydrationWindow,
  fn: (...args: A) => T,
  ...args: A
): T {
  const context = current;
  if (context === null) {
    return fn(...args);
  }
  context.windows.push(window);
  try {
    return fn(...args);
  } finally {
    context.windows.pop();
  }
}

export function withoutHydration<T>(fn: () => T): T {
  const previous = current;
  current = null;
  try {
    return fn();
  } finally {
    current = previous;
  }
}

export function mismatch(message: string): never {
  throw new HydrationMismatchError(message);
}

export function reportMismatch(error: HydrationMismatchError): void {
  mismatches += 1;
  emitDevtoolsError({
    name: null,
    moduleId: null,
    phase: "hydration",
    message: error.message,
  });
  const listener = current?.listener ?? null;
  if (listener !== null) {
    listener(error);
  }
}

export function detachNode(node: Node): void {
  node.parentNode?.removeChild(node);
}
