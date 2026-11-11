import {
  getHydrationRuntime,
  type HydrationRuntime,
  type HydrationWindow,
} from "./hydration-state.js";

export {
  ERROR_BOUNDARY,
  FRAGMENT,
  HYDRATE_END,
  HYDRATE_START,
  HydrationMismatchError,
  INSERT_END,
  INSERT_START,
  ITEM,
  LIST_END,
  MATCH,
  SHOW,
  SUSPENSE,
  SWITCH,
  beginHydration,
  currentWindow,
  detachNode,
  endHydration,
  isHydrating,
  mismatch,
  reportMismatch,
  withWindow,
  withoutHydration,
} from "./hydration-state.js";

let impl: HydrationRuntime | null = null;

function runtime(): HydrationRuntime {
  return (impl ??= getHydrationRuntime());
}

export function claimNext(): Node | null {
  return runtime().claimNext();
}

export function isMarker(node: Node | null | undefined, data: string): node is Comment {
  return runtime().isMarker(node, data);
}

export function isItemMarker(node: Node | null | undefined): node is Comment {
  return runtime().isItemMarker(node);
}

export function findViewEnd(start: Node, limit?: Node | null): Node {
  return runtime().findViewEnd(start, limit);
}

export function findInsertWindow(marker: Node | null, parent: Node): HydrationWindow {
  return runtime().findInsertWindow(marker, parent);
}

export function collectBetween(start: Node, end: Node): Node[] {
  return runtime().collectBetween(start, end);
}

export function mergeTopLevelMetadata(fresh: Node, claimed: Node): void {
  runtime().mergeTopLevelMetadata(fresh, claimed);
}

export function shapeMatches(
  fresh: Node,
  claimed: Node,
  ignoreTopMetadata?: boolean,
  simpleFresh?: boolean,
): boolean {
  return runtime().shapeMatches(fresh, claimed, ignoreTopMetadata, simpleFresh);
}

export function significantChildren(node: Node, index: number): Node | null {
  return runtime().significantChildren(node, index);
}

export function significantChildrenFromEnd(node: Node, offset: number): Node | null {
  return runtime().significantChildrenFromEnd(node, offset);
}

export function countSignificantChildren(node: Node): number {
  return runtime().countSignificantChildren(node);
}
