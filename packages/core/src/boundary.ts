import { getOwner } from "@ivlev-dev/silent-reactivity";
import { findOwnerRuntimeOptions } from "./runtime-context.js";

export interface AsyncBoundary {
  register(promise: Promise<void>): void;
  readonly signal?: AbortSignal;
  readonly showing?: boolean;
  readonly fallback?: unknown;
}

let currentBoundary: AsyncBoundary | null = null;

export function getCurrentBoundary(): AsyncBoundary | null {
  const owner = getOwner();
  const options = findOwnerRuntimeOptions(owner);
  if (options !== undefined && options.boundary !== undefined) {
    return options.boundary;
  }
  return currentBoundary;
}

export function runWithBoundary<T>(
  boundary: AsyncBoundary | null,
  fn: () => T,
): T {
  const previous = currentBoundary;
  currentBoundary = boundary;
  try {
    return fn();
  } finally {
    currentBoundary = previous;
  }
}
