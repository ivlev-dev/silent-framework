import { getOwner } from "@ivlev-dev/silent-reactivity";
import { findOwnerRuntimeOptions } from "./runtime-context.js";
import {
  getRuntimeContextStore,
  type RuntimeContextStore,
} from "./runtime-context-provider.js";

export interface AsyncBoundary {
  register(promise: Promise<void>): void;
  readonly signal?: AbortSignal;
  readonly showing?: boolean;
  readonly fallback?: unknown;
}

interface BoundaryScope {
  current: AsyncBoundary | null;
}

let currentBoundary: AsyncBoundary | null = null;

/**
 * На сервере текущая boundary живёт в per-render store: параллельные запросы
 * не должны видеть границу соседнего рендера. На клиенте (провайдера нет)
 * остаётся прежняя модульная переменная.
 */
const scopedBoundaries = new WeakMap<RuntimeContextStore, BoundaryScope>();

function scopedBoundary(): BoundaryScope | null {
  const store = getRuntimeContextStore();
  if (store === null) {
    return null;
  }
  let scope = scopedBoundaries.get(store);
  if (scope === undefined) {
    scope = { current: null };
    scopedBoundaries.set(store, scope);
  }
  return scope;
}

export function getCurrentBoundary(): AsyncBoundary | null {
  const owner = getOwner();
  const options = findOwnerRuntimeOptions(owner);
  if (options !== undefined && options.boundary !== undefined) {
    return options.boundary;
  }
  const scope = scopedBoundary();
  return scope === null ? currentBoundary : scope.current;
}

export function runWithBoundary<T>(
  boundary: AsyncBoundary | null,
  fn: () => T,
): T {
  const scope = scopedBoundary();
  if (scope !== null) {
    const previous = scope.current;
    scope.current = boundary;
    try {
      return fn();
    } finally {
      scope.current = previous;
    }
  }
  const previous = currentBoundary;
  currentBoundary = boundary;
  try {
    return fn();
  } finally {
    currentBoundary = previous;
  }
}
