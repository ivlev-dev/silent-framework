export interface ParsedTemplate {
  readonly parts: readonly string[];
  readonly indexes: readonly number[];
  readonly markers: readonly string[];
  readonly tails?: readonly string[] | undefined;
  readonly bare?: readonly boolean[] | undefined;
  readonly holes?: readonly number[] | undefined;
  readonly attrs?: readonly number[] | undefined;
  readonly attrTexts?: readonly number[] | undefined;
  readonly holesOrdered?: boolean | undefined;
}

export const TEMPLATE_CACHE_LIMIT = 768;

interface CacheEntry {
  value: ParsedTemplate | null;
  stamp: number;
}

const cache = new Map<string, CacheEntry>();
let stampCounter = 0;

export function getTemplate(html: string): ParsedTemplate | null | undefined {
  const entry = cache.get(html);
  if (entry === undefined) {
    return undefined;
  }
  stampCounter += 1;
  entry.stamp = stampCounter;
  return entry.value;
}

export function setTemplate(html: string, template: ParsedTemplate | null): void {
  const existing = cache.get(html);
  if (existing !== undefined) {
    existing.value = template;
    stampCounter += 1;
    existing.stamp = stampCounter;
    return;
  }
  if (cache.size >= TEMPLATE_CACHE_LIMIT) {
    let oldestKey: string | null = null;
    let oldestStamp = Number.POSITIVE_INFINITY;
    for (const [key, entry] of cache) {
      if (entry.stamp < oldestStamp) {
        oldestStamp = entry.stamp;
        oldestKey = key;
      }
    }
    if (oldestKey !== null) {
      cache.delete(oldestKey);
    }
  }
  stampCounter += 1;
  cache.set(html, { value: template, stamp: stampCounter });
}

export function hasTemplate(html: string): boolean {
  return cache.has(html);
}

export function templateCacheSize(): number {
  return cache.size;
}

export function clearTemplateCache(): void {
  cache.clear();
  stampCounter = 0;
}
