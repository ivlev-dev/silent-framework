export interface AsyncBoundary {
  register(promise: Promise<void>): void;
}

let currentBoundary: AsyncBoundary | null = null;

export function getCurrentBoundary(): AsyncBoundary | null {
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
