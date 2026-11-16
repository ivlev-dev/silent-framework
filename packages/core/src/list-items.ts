export type ListSource<T> = readonly T[] | Iterable<T> | null | undefined;

const EMPTY: readonly never[] = [];

export function normalizeItems<T>(source: ListSource<T>): readonly T[] {
  if (source === null || source === undefined) {
    return EMPTY;
  }
  if (Array.isArray(source)) {
    return densify(source);
  }
  if (typeof (source as Iterable<T>)[Symbol.iterator] !== "function") {
    return EMPTY;
  }
  const items: T[] = [];
  for (const item of source as Iterable<T>) {
    if (item !== undefined) {
      items.push(item);
    }
  }
  return items;
}

function densify<T>(items: readonly T[]): readonly T[] {
  let sparse = false;
  for (let index = 0; index < items.length; index += 1) {
    if (items[index] === undefined) {
      sparse = true;
      break;
    }
  }
  if (!sparse) {
    return items;
  }
  const dense: T[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item !== undefined) {
      dense.push(item);
    }
  }
  return dense;
}
