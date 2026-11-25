import { defaultKey } from "./keys.js";
import {
  normalizeCount,
  normalizeOffset,
  normalizeOverscan,
  normalizeSize,
  normalizeSpacing,
} from "./measurements.js";
import { computeRangeFromSource, emptyRange } from "./range.js";
import type { RangeSource } from "./range.js";
import type {
  ServerSlice,
  ServerSliceOptions,
  VirtualItem,
} from "./types.js";

/**
 * Детерминированный SSR-срез списка без DOM и без измерений.
 *
 * Функция полностью чистая: одинаковые аргументы всегда дают одинаковый
 * результат (включая порядок элементов), что позволяет использовать её на
 * сервере и проверять гидрацию побайтовым сравнением.
 *
 * Раскладка строится по `estimateSize`; `gap` и `paddingStart` учитываются в
 * координатах и полном размере. Смещение клампится в границы контента.
 *
 * @param options Количество, оценка размера, вьюпорт и необязательные отступы.
 * @returns Видимый срез (`items`), полный размер и диапазон индексов.
 */
export function computeServerSlice(options: ServerSliceOptions): ServerSlice {
  const count = normalizeCount(options.count);
  if (count === 0) {
    return { items: [], totalSize: 0, range: emptyRange(0) };
  }

  const gap = normalizeSpacing(options.gap);
  const paddingStart = normalizeSpacing(options.paddingStart);
  const overscan = normalizeOverscan(options.overscan, 0);
  const scrollOffset = normalizeOffset(options.scrollOffset);
  const viewportSize = Number.isFinite(options.viewportSize)
    ? Math.max(0, options.viewportSize)
    : 0;

  const sizes = new Float64Array(count);
  const starts = new Float64Array(count);
  const endBounds = new Float64Array(count);

  let cursor = 0;
  let bound = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < count; index++) {
    const size = normalizeSize(options.estimateSize(index));
    sizes[index] = size;
    starts[index] = paddingStart + cursor;

    const end = paddingStart + cursor + size;
    bound = Math.max(bound, end);
    endBounds[index] = bound;

    cursor += size + gap;
  }

  const content = Math.max(0, cursor - gap);
  const totalSize = paddingStart + content;

  const source: RangeSource = {
    count,
    startAt: (index) => starts[index] ?? 0,
    maxEndAt: (index) => endBounds[index] ?? 0,
  };

  const range = computeRangeFromSource(
    source,
    scrollOffset,
    viewportSize,
    overscan,
    undefined,
  );

  const items: VirtualItem[] = [];
  for (
    let index = range.overscanStartIndex;
    index <= range.overscanEndIndex;
    index++
  ) {
    const start = starts[index] ?? 0;
    const size = sizes[index] ?? 0;
    items.push({
      index,
      key: defaultKey(index),
      start,
      end: start + size,
      size,
      lane: 0,
    });
  }

  return { items, totalSize, range };
}
