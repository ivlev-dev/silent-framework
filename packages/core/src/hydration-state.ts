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
  ): boolean;
  significantChildren(node: Node, index: number): Node | null;
  significantChildrenFromEnd(node: Node, offset: number): Node | null;
  countSignificantChildren(node: Node): number;
}

let active = false;
let windows: HydrationWindow[] = [];
let mismatchListener: ((error: HydrationMismatchError) => void) | null = null;
let runtime: HydrationRuntime | null = null;

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
  return active;
}

export function beginHydration(
  listener?: (error: HydrationMismatchError) => void,
): void {
  active = true;
  windows = [];
  mismatchListener = listener ?? null;
}

export function endHydration(): void {
  active = false;
  windows = [];
  mismatchListener = null;
}

export function currentWindow(): HydrationWindow | null {
  return windows.length === 0 ? null : windows[windows.length - 1] ?? null;
}

export function withWindow<T, A extends unknown[]>(
  window: HydrationWindow,
  fn: (...args: A) => T,
  ...args: A
): T {
  windows.push(window);
  try {
    return fn(...args);
  } finally {
    windows.pop();
  }
}

export function withoutHydration<T>(fn: () => T): T {
  const previousActive = active;
  const previousWindows = windows;
  active = false;
  windows = [];
  try {
    return fn();
  } finally {
    active = previousActive;
    windows = previousWindows;
  }
}

export function mismatch(message: string): never {
  throw new HydrationMismatchError(message);
}

export function reportMismatch(error: HydrationMismatchError): void {
  if (mismatchListener !== null) {
    mismatchListener(error);
  }
}

export function detachNode(node: Node): void {
  node.parentNode?.removeChild(node);
}
