import { normalizeOffset, normalizeOverscan } from "./measurements.js";
import type { ComputeRangeOptions, Range, RangeExtractor } from "./types.js";

/**
 * Абстрактный доступ к измерениям, который позволяет считать диапазон как по
 * массиву `VirtualItem`, так и напрямую по типизированным массивам движка —
 * без материализации объектов.
 *
 * @internal
 */
export interface RangeSource {
  /** Общее количество элементов. */
  readonly count: number;
  /** Начало элемента по индексу. Значения должны быть неубывающими. */
  startAt(index: number): number;
  /**
   * Префиксный максимум `end` на отрезке `[0, index]` (неубывающая функция).
   * Нужен для поиска первого элемента, пересекающего вьюпорт, когда элементы
   * разных дорожек перекрываются и `end` не монотонен.
   */
  maxEndAt(index: number): number;
}

/** Канонический пустой диапазон. */
export function emptyRange(count: number): Range {
  return {
    startIndex: 0,
    endIndex: -1,
    overscanStartIndex: 0,
    overscanEndIndex: -1,
    count,
  };
}

/**
 * Отбрасывает некорректные индексы, усекает дробные, удаляет дубликаты и
 * сортирует результат по возрастанию.
 */
function sanitizeIndices(values: readonly number[], count: number): number[] {
  const unique = new Set<number>();
  for (const value of values) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      continue;
    }
    const index = Math.trunc(value);
    if (index < 0 || index >= count) {
      continue;
    }
    unique.add(index);
  }
  return [...unique].sort((left, right) => left - right);
}

/** Первый индекс, у которого префиксный максимум `end` больше `offset`. */
function firstIndexEndingAfter(
  source: RangeSource,
  offset: number,
): number {
  let low = 0;
  let high = source.count - 1;
  let result = source.count;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (source.maxEndAt(middle) > offset) {
      result = middle;
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }
  return result;
}

/** Последний индекс, у которого `start` меньше `limit`; `-1`, если такого нет. */
function lastIndexStartingBefore(
  source: RangeSource,
  limit: number,
): number {
  let low = 0;
  let high = source.count - 1;
  let result = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (source.startAt(middle) < limit) {
      result = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return result;
}

/**
 * Ядро вычисления диапазона: бинарный поиск по `start` и префиксному максимуму
 * `end`, клампинг смещения в границы контента, применение `overscan` и
 * пользовательского `rangeExtractor`.
 *
 * Смещение клампится к `[0, maxEnd - viewportSize]`, поэтому прокрутка «за
 * пределы» списка возвращает корректный последний экран, а отрицательная —
 * первый.
 *
 * @internal
 */
export function computeRangeFromSource(
  source: RangeSource,
  scrollOffset: number,
  viewportSize: number,
  overscan: number,
  rangeExtractor: RangeExtractor | undefined,
): Range {
  const count = source.count;
  if (count <= 0) {
    return emptyRange(0);
  }

  const viewport = Number.isFinite(viewportSize) ? Math.max(0, viewportSize) : 0;
  if (viewport <= 0) {
    return emptyRange(count);
  }

  const maxEnd = source.maxEndAt(count - 1);
  const maxOffset = Math.max(0, maxEnd - viewport);
  const offset = Math.min(Math.max(normalizeOffset(scrollOffset), 0), maxOffset);
  const viewEnd = offset + viewport;

  let first = firstIndexEndingAfter(source, offset);
  if (first >= count) {
    // Все элементы нулевого размера: показываем последний как опорный.
    first = count - 1;
  }

  const last = lastIndexStartingBefore(source, viewEnd);
  if (last < first) {
    return emptyRange(count);
  }

  const over = normalizeOverscan(overscan, 0);
  let overscanStart = Math.max(0, first - over);
  let overscanEnd = Math.min(count - 1, last + over);

  if (rangeExtractor !== undefined) {
    const extracted = sanitizeIndices(
      rangeExtractor({
        startIndex: first,
        endIndex: last,
        overscanStartIndex: overscanStart,
        overscanEndIndex: overscanEnd,
        count,
      }),
      count,
    );
    if (extracted.length > 0) {
      const min = extracted[0] ?? overscanStart;
      const max = extracted[extracted.length - 1] ?? overscanEnd;
      overscanStart = Math.min(overscanStart, min);
      overscanEnd = Math.max(overscanEnd, max);
    }
  }

  return {
    startIndex: first,
    endIndex: last,
    overscanStartIndex: overscanStart,
    overscanEndIndex: overscanEnd,
    count,
  };
}

/**
 * Внутренняя форма `computeRange`: готовый источник вместо массива.
 * Позволяет движку переиспользовать ту же чистую логику без материализации
 * `VirtualItem`.
 *
 * @internal
 */
export interface RangeSourceOptions {
  /** Готовый источник измерений. */
  readonly source: RangeSource;
  /** Текущее смещение прокрутки. */
  scrollOffset: number;
  /** Размер вьюпорта вдоль главной оси. */
  viewportSize: number;
  /** Запас рендера в элементах. */
  overscan: number;
  /** Extractor либо `undefined`. */
  rangeExtractor: RangeExtractor | undefined;
}

/**
 * Вычисляет диапазон видимых и «запасных» индексов по готовому массиву
 * измерений. Чистая функция: не мутирует вход и не хранит состояние.
 *
 * Требование к входу: `measurements` отсортированы по `start` по возрастанию
 * (это гарантирует `VirtualizerCore.measurements()`). Элементы разных дорожек
 * могут перекрываться — поиск учитывает префиксный максимум `end`, поэтому
 * первый пересекающий вьюпорт элемент находится корректно.
 *
 * @param options Смещение, вьюпорт, измерения, overscan и extractor.
 * @returns Диапазон с включительными границами.
 */
export function computeRange(options: ComputeRangeOptions): Range;
/**
 * Внутренняя перегрузка для движка — работает по `RangeSource`.
 *
 * @internal
 */
export function computeRange(options: RangeSourceOptions): Range;
export function computeRange(
  options: ComputeRangeOptions | RangeSourceOptions,
): Range {
  if ("source" in options) {
    return computeRangeFromSource(
      options.source,
      options.scrollOffset,
      options.viewportSize,
      options.overscan,
      options.rangeExtractor,
    );
  }

  const measurements = options.measurements;
  const count = measurements.length;
  if (count === 0) {
    return emptyRange(0);
  }

  const maxEnds = new Float64Array(count);
  let runningMax = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < count; index++) {
    const item = measurements[index];
    const end = item === undefined ? 0 : item.start + item.size;
    runningMax = Math.max(runningMax, end);
    maxEnds[index] = runningMax;
  }

  const source: RangeSource = {
    count,
    startAt: (index) => measurements[index]?.start ?? 0,
    maxEndAt: (index) => maxEnds[index] ?? 0,
  };

  return computeRangeFromSource(
    source,
    options.scrollOffset,
    options.viewportSize,
    options.overscan,
    options.rangeExtractor,
  );
}

/**
 * Возвращает все индексы окна `overscanStartIndex..overscanEndIndex`
 * включительно. Удобен как база для пользовательских `rangeExtractor`.
 *
 * @param range Диапазон, для которого нужен список индексов.
 * @returns Отсортированный по возрастанию массив индексов (пустой для пустого диапазона).
 */
export function defaultRangeExtractor(range: Range): number[] {
  const indices: number[] = [];
  for (
    let index = range.overscanStartIndex;
    index <= range.overscanEndIndex;
    index++
  ) {
    indices.push(index);
  }
  return indices;
}
