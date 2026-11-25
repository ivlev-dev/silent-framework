import { normalizeKey } from "./keys.js";
import {
  normalizeLanes,
  normalizeOffset,
  normalizeSize,
  resolveVirtualizerOptions,
} from "./measurements.js";
import { computeRange, emptyRange } from "./range.js";
import type { RangeSource } from "./range.js";
import type {
  Range,
  RangeExtractor,
  ResolvedVirtualizerOptions,
  ScrollAlignment,
  VirtualItem,
  VirtualKey,
  VirtualizerOptions,
  VirtualizerSnapshot,
} from "./types.js";

/**
 * Движок виртуализации без побочных эффектов и без DOM.
 *
 * Хранит измерения по ключу, строит раскладку (start/end/size/lane) лениво и
 * инкрементально: изменение размера элемента перестраивает только хвост
 * начиная с этого элемента. Публичные методы не мутируют переданные данные и
 * не обращаются к браузерным API.
 *
 * ```ts
 * const core = new VirtualizerCore({ count: 10_000, estimateSize: () => 32 });
 * const range = core.rangeFor(scrollOffset, viewportSize);
 * const items = core.measurements().slice(range.overscanStartIndex, range.overscanEndIndex + 1);
 * ```
 */
export class VirtualizerCore {
  private options: ResolvedVirtualizerOptions;

  /** Измеренные размеры по ключу элемента. */
  private readonly measured = new Map<VirtualKey, number>();

  /** Первый индекс, в котором встретился ключ (для инвалидации дубликатов). */
  private readonly keyFirstIndex = new Map<VirtualKey, number>();

  /** Разрешённые размеры по индексу. */
  private sizes: Float64Array = new Float64Array(0);
  /** Начала элементов по индексу. */
  private starts: Float64Array = new Float64Array(0);
  /** Префиксный максимум `end` по индексу. */
  private endBounds: Float64Array = new Float64Array(0);
  /** Номер дорожки по индексу. */
  private lanesOf: Uint32Array = new Uint32Array(0);
  /** Кэш ключей по индексу. */
  private keys: Array<VirtualKey | undefined> = [];
  /** Снимки курсоров дорожек: `(count + 1) * lanes` значений. */
  private cursors: Float64Array = new Float64Array(0);

  /** Количество индексов, для которых раскладка валидна (`[0, builtUntil)`). */
  private builtUntil = 0;
  /** Первый индекс, с которого раскладка устарела. */
  private dirtyFrom = 0;
  /** Полный размер контента вдоль главной оси. */
  private totalSizeCache = 0;

  /** Последнее смещение из `rangeFor` — используется выравниванием `"auto"`. */
  private lastScrollOffset = 0;
  /** Последний размер вьюпорта из `rangeFor` — используется `"auto"`. */
  private lastViewportSize = 0;

  /**
   * @param options Начальные настройки; нормализуются сразу.
   */
  constructor(options: VirtualizerOptions) {
    this.options = resolveVirtualizerOptions(options);
    this.resetLayout();
  }

  /**
   * Частично обновляет настройки и сбрасывает раскладку (она пересчитается
   * лениво при следующем обращении).
   *
   * Кэш измерений сохраняется, если не изменилась функция `getItemKey`
   * (ключи перестают соответствовать индексам) и виртуализация не
   * выключается. Передача `rangeExtractor: undefined` убирает extractor.
   *
   * @param partial Подмножество настроек.
   */
  setOptions(partial: Partial<VirtualizerOptions>): void {
    const previous = this.options;
    const hasOwn = (key: keyof VirtualizerOptions): boolean =>
      Object.prototype.hasOwnProperty.call(partial, key);

    const rangeExtractor: RangeExtractor | undefined = hasOwn("rangeExtractor")
      ? partial.rangeExtractor
      : previous.rangeExtractor;

    const next = resolveVirtualizerOptions({
      count: partial.count ?? previous.count,
      estimateSize: partial.estimateSize ?? previous.estimateSize,
      getItemKey: partial.getItemKey ?? previous.getItemKey,
      overscan: partial.overscan ?? previous.overscan,
      horizontal: partial.horizontal ?? previous.horizontal,
      paddingStart: partial.paddingStart ?? previous.paddingStart,
      paddingEnd: partial.paddingEnd ?? previous.paddingEnd,
      gap: partial.gap ?? previous.gap,
      scrollMargin: partial.scrollMargin ?? previous.scrollMargin,
      lanes: partial.lanes ?? previous.lanes,
      laneAssignmentMode:
        partial.laneAssignmentMode ?? previous.laneAssignmentMode,
      enabled: partial.enabled ?? previous.enabled,
      ...(rangeExtractor === undefined ? {} : { rangeExtractor }),
    });

    const keysChanged = next.getItemKey !== previous.getItemKey;
    this.options = next;

    if (keysChanged || !next.enabled) {
      this.measured.clear();
      this.keyFirstIndex.clear();
    }

    this.resetLayout();
  }

  /**
   * Возвращает нормализованные настройки с подставленными значениями по
   * умолчанию (копия, менять её бесполезно).
   */
  getOptions(): Readonly<ResolvedVirtualizerOptions> {
    return { ...this.options };
  }

  /**
   * Полные измерения списка: массив `VirtualItem` длиной `count`.
   *
   * Материализация ленивая и выполняется только при вызове этого метода.
   * `rangeFor`, `indexAtOffset`, `totalSize` работают напрямую по массивам
   * смещений и не создают объектов.
   *
   * @returns Измерения по возрастанию индекса; пустой массив при `enabled = false`.
   */
  measurements(): VirtualItem[] {
    if (!this.options.enabled) {
      return [];
    }

    this.ensureLayout();
    const count = this.options.count;
    const items = new Array<VirtualItem>(count);
    for (let index = 0; index < count; index++) {
      items[index] = this.itemAt(index);
    }
    return items;
  }

  /**
   * Полный размер контента вдоль главной оси, включая `scrollMargin`,
   * `paddingStart`, `paddingEnd` и `gap`.
   *
   * В режиме `laneAssignmentMode: "measured"` неизмеренные элементы не
   * занимают место, поэтому размер учитывает только измеренные.
   *
   * @returns Размер в пикселях; `0` при пустом списке или `enabled = false`.
   */
  totalSize(): number {
    if (!this.options.enabled) {
      return 0;
    }
    this.ensureLayout();
    return this.totalSizeCache;
  }

  /**
   * Вычисляет видимый диапазон для текущего вьюпорта.
   *
   * Смещение клампится в границы контента, `overscan` расширяет окно,
   * пользовательский `rangeExtractor` может расширить его дополнительными
   * (например, закреплёнными) индексами.
   *
   * @param scrollOffset Смещение прокрутки вдоль главной оси.
   * @param viewportSize Размер вьюпорта; `<= 0` даёт пустой диапазон.
   * @returns Диапазон с включительными границами.
   */
  rangeFor(scrollOffset: number, viewportSize: number): Range {
    const offset = normalizeOffset(scrollOffset);
    const viewport = Number.isFinite(viewportSize)
      ? Math.max(0, viewportSize)
      : 0;

    this.lastScrollOffset = offset;
    this.lastViewportSize = viewport;

    if (!this.options.enabled) {
      return emptyRange(0);
    }

    this.ensureLayout();
    const count = this.options.count;
    const source: RangeSource = {
      count,
      startAt: (index) => this.starts[index] ?? 0,
      maxEndAt: (index) => this.endBounds[index] ?? 0,
    };

    return computeRange({
      source,
      scrollOffset: offset,
      viewportSize: viewport,
      overscan: this.options.overscan,
      rangeExtractor: this.options.rangeExtractor,
    });
  }

  /**
   * Возвращает индекс элемента, который находится в точке `offset`
   * (или ближайшего слева, если точка попала в промежуток между элементами).
   *
   * Поиск бинарный по массиву `start`. Смещение до первого элемента даёт `0`,
   * после последнего — `count - 1`.
   *
   * @param offset Смещение вдоль главной оси.
   * @returns Индекс элемента или `-1` для пустого/отключённого списка.
   */
  indexAtOffset(offset: number): number {
    if (!this.options.enabled) {
      return -1;
    }

    const count = this.options.count;
    if (count === 0) {
      return -1;
    }

    this.ensureLayout();
    const value = normalizeOffset(offset);
    let low = 0;
    let high = count - 1;
    let result = -1;

    while (low <= high) {
      const middle = (low + high) >> 1;
      const start = this.starts[middle] ?? 0;
      if (start <= value) {
        result = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }

    return result === -1 ? 0 : result;
  }

  /**
   * Возвращает координату элемента для заданного выравнивания.
   *
   * Так как у метода нет размера вьюпорта, `"start"`/`"center"`/`"end"`
   * возвращают координаты начала/центра/конца элемента, а `"auto"`
   * использует последний вызов `rangeFor`:
   *
   * - элемент полностью виден — возвращается текущее смещение;
   * - элемент выше вьюпорта — его `start`;
   * - элемент ниже — `end - viewportSize` (не меньше `0`).
   *
   * Без предшествующего `rangeFor` `"auto"` ведёт себя как `"start"`.
   *
   * @param index Индекс элемента (клампится в границы списка).
   * @param align Выравнивание; по умолчанию `"auto"`.
   * @returns Смещение прокрутки; `0` для пустого/отключённого списка.
   */
  offsetForIndex(index: number, align: ScrollAlignment = "auto"): number {
    if (!this.options.enabled) {
      return 0;
    }

    const count = this.options.count;
    if (count === 0) {
      return 0;
    }

    this.ensureLayout();
    const target = Math.min(Math.max(Math.trunc(index), 0), count - 1);
    const start = this.starts[target] ?? 0;
    const size = this.sizes[target] ?? 0;
    const end = start + size;

    switch (align) {
      case "start":
        return start;
      case "center":
        return Math.max(0, start + size / 2);
      case "end":
        return end;
      case "auto":
        return this.autoOffset(start, end);
      default:
        return start;
    }
  }

  /**
   * Записывает измеренный размер в кэш по ключу элемента и инвалидирует
   * раскладку начиная с этого элемента (для masonry — с первого вхождения
   * ключа, потому что измерение влияет на распределение дорожек).
   *
   * @param index Индекс элемента; вне `[0, count)` вызов игнорируется.
   * @param size Размер вдоль главной оси; отрицательные/`NaN` дают `0`.
   */
  measureItem(index: number, size: number): void {
    if (!this.options.enabled) {
      return;
    }

    const target = Math.trunc(index);
    if (!(target >= 0 && target < this.options.count)) {
      return;
    }

    const key = this.keyAt(target);
    const normalized = normalizeSize(size);
    if (this.measured.get(key) === normalized) {
      return;
    }

    this.measured.set(key, normalized);
    const first = this.keyFirstIndex.get(key);
    this.markDirty(first === undefined ? target : Math.min(target, first));
  }

  /**
   * Обновляет размер элемента без семантики «измерения из DOM». Работает так
   * же, как `measureItem`: пишет в кэш по ключу и перестраивает хвост.
   *
   * @param index Индекс элемента.
   * @param size Новый размер; отрицательные/`NaN` дают `0`.
   */
  resizeItem(index: number, size: number): void {
    this.measureItem(index, size);
  }

  /**
   * Сбрасывает измерения и пересобирает раскладку.
   *
   * Без аргумента очищает весь кэш измерений. С индексом — удаляет измерение
   * ключа этого элемента (и всех его дубликатов) и перестраивает хвост.
   *
   * @param index Индекс элемента; вне `[0, count)` вызов игнорируется.
   */
  invalidate(index?: number): void {
    if (!this.options.enabled) {
      return;
    }

    if (index === undefined) {
      this.measured.clear();
      this.keyFirstIndex.clear();
      this.resetLayout();
      return;
    }

    const target = Math.trunc(index);
    if (!(target >= 0 && target < this.options.count)) {
      return;
    }

    const key = this.keyAt(target);
    const first = this.keyFirstIndex.get(key);
    this.measured.delete(key);
    this.markDirty(first === undefined ? target : Math.min(target, first));
  }

  /**
   * Меняет количество дорожек, сохраняя кэш измерений. Раскладка
   * пересчитывается лениво.
   *
   * @param lanes Количество дорожек; минимум `1`.
   */
  setLanes(lanes: number): void {
    const next = normalizeLanes(lanes);
    if (next === this.options.lanes) {
      return;
    }

    this.options = { ...this.options, lanes: next };
    this.resetLayout();
  }

  /**
   * Плоский JSON-сериализуемый снимок измерений и позиции прокрутки.
   * Порядок `entries` стабилен (сортировка по ключу), что делает снимок
   * пригодным для сравнения и передачи по сети.
   *
   * @returns Снимок версии `1`.
   */
  snapshot(): VirtualizerSnapshot {
    const entries: Array<[VirtualKey, number]> = [];
    for (const [key, size] of this.measured) {
      entries.push([key, size]);
    }
    entries.sort((left, right) => compareKeys(left[0], right[0]));

    return {
      version: 1,
      entries,
      scrollOffset: this.lastScrollOffset,
      viewportSize: this.lastViewportSize,
    };
  }

  /**
   * Восстанавливает измерения и позицию прокрутки из снимка `snapshot()`.
   *
   * Настройки не восстанавливаются: `count`, `estimateSize`, `getItemKey` и
   * прочие параметры остаются текущими. Некорректный формат или версия
   * приводят к `TypeError`.
   *
   * @param snapshot Снимок, полученный из `snapshot()` (в том числе после
   * `JSON.parse`).
   */
  restore(snapshot: VirtualizerSnapshot): void {
    const candidate = snapshot as
      | {
          version?: unknown;
          entries?: unknown;
          scrollOffset?: unknown;
          viewportSize?: unknown;
        }
      | null
      | undefined;

    if (
      candidate === null ||
      candidate === undefined ||
      candidate.version !== 1 ||
      !Array.isArray(candidate.entries)
    ) {
      throw new TypeError(
        "VirtualizerCore.restore: ожидается снимок версии 1 с массивом entries",
      );
    }

    this.measured.clear();
    this.keyFirstIndex.clear();

    if (this.options.enabled) {
      for (const entry of candidate.entries) {
        if (!Array.isArray(entry) || entry.length < 2) {
          continue;
        }
        const rawKey: unknown = entry[0];
        const rawSize: unknown = entry[1];
        if (typeof rawKey !== "string" && typeof rawKey !== "number") {
          continue;
        }
        if (typeof rawSize !== "number") {
          continue;
        }
        this.measured.set(rawKey, normalizeSize(rawSize));
      }
    }

    this.lastScrollOffset =
      typeof candidate.scrollOffset === "number"
        ? normalizeOffset(candidate.scrollOffset)
        : 0;
    this.lastViewportSize =
      typeof candidate.viewportSize === "number" &&
      Number.isFinite(candidate.viewportSize)
        ? Math.max(0, candidate.viewportSize)
        : 0;

    this.resetLayout();
  }

  /** Сбрасывает массивы раскладки под текущие настройки. */
  private resetLayout(): void {
    const count = this.options.count;
    this.sizes = new Float64Array(count);
    this.starts = new Float64Array(count);
    this.endBounds = new Float64Array(count);
    this.lanesOf = new Uint32Array(count);
    this.keys = new Array<VirtualKey | undefined>(count);
    this.cursors = new Float64Array((count + 1) * this.options.lanes);
    this.builtUntil = 0;
    this.dirtyFrom = 0;
    this.totalSizeCache = 0;
    this.keyFirstIndex.clear();
  }

  /** Достраивает раскладку, если она устарела или ещё не построена. */
  private ensureLayout(): void {
    if (!this.options.enabled) {
      return;
    }

    const count = this.options.count;
    if (this.builtUntil === count && this.dirtyFrom >= count) {
      return;
    }

    this.rebuild(Math.min(this.dirtyFrom, this.builtUntil));
  }

  /**
   * Перестраивает раскладку с индекса `from`, используя сохранённые курсоры
   * дорожек. Сложность — `O((count - from) * lanes)`.
   */
  private rebuild(from: number): void {
    const {
      count,
      gap,
      lanes,
      laneAssignmentMode,
      paddingStart,
      paddingEnd,
      scrollMargin,
    } = this.options;
    const base = scrollMargin + paddingStart;
    const measuredMode = laneAssignmentMode === "measured";
    const cursors = this.cursors;
    const cursor = new Float64Array(lanes);
    const stride = lanes;

    const snapshotOffset = from * stride;
    for (let lane = 0; lane < lanes; lane++) {
      cursor[lane] = cursors[snapshotOffset + lane] ?? 0;
    }

    for (let index = from; index < count; index++) {
      const key = this.keyAt(index);
      if (!this.keyFirstIndex.has(key)) {
        this.keyFirstIndex.set(key, index);
      }

      const size = this.resolveSize(index, key);
      this.sizes[index] = size;

      let lane = 0;
      for (let candidate = 1; candidate < lanes; candidate++) {
        if ((cursor[candidate] ?? 0) < (cursor[lane] ?? 0)) {
          lane = candidate;
        }
      }
      this.lanesOf[index] = lane;

      const start = base + (cursor[lane] ?? 0);
      this.starts[index] = start;

      const end = start + size;
      const previousBound =
        index > 0
          ? (this.endBounds[index - 1] ?? Number.NEGATIVE_INFINITY)
          : Number.NEGATIVE_INFINITY;
      this.endBounds[index] = Math.max(previousBound, end);

      // Снимок курсоров *до* размещения элемента нужен для инкрементальной
      // перестройки ровно с этого индекса.
      const writeOffset = index * stride;
      for (let laneIndex = 0; laneIndex < lanes; laneIndex++) {
        cursors[writeOffset + laneIndex] = cursor[laneIndex] ?? 0;
      }

      const advance = measuredMode && !this.measured.has(key) ? 0 : size;
      cursor[lane] = (cursor[lane] ?? 0) + advance + gap;
    }

    const finalOffset = count * stride;
    for (let lane = 0; lane < lanes; lane++) {
      cursors[finalOffset + lane] = cursor[lane] ?? 0;
    }

    let extent = 0;
    for (let lane = 0; lane < lanes; lane++) {
      extent = Math.max(extent, cursor[lane] ?? 0);
    }

    const content = count > 0 ? Math.max(0, extent - gap) : 0;
    this.totalSizeCache = count > 0 ? base + content + paddingEnd : 0;
    this.builtUntil = count;
    this.dirtyFrom = count;
  }

  /** Ключ элемента с ленивым кэшированием. */
  private keyAt(index: number): VirtualKey {
    const cached = this.keys[index];
    if (cached !== undefined) {
      return cached;
    }

    const key = normalizeKey(this.options.getItemKey(index), index);
    this.keys[index] = key;
    return key;
  }

  /** Размер элемента: измерение по ключу, иначе оценка. */
  private resolveSize(index: number, key: VirtualKey): number {
    const measured = this.measured.get(key);
    if (measured !== undefined) {
      return measured;
    }
    return normalizeSize(this.options.estimateSize(index));
  }

  /** Помечает раскладку устаревшей начиная с индекса. */
  private markDirty(index: number): void {
    const target = Math.max(
      0,
      Math.min(Math.floor(index), this.options.count),
    );
    if (target < this.dirtyFrom) {
      this.dirtyFrom = target;
    }
  }

  /** Собирает `VirtualItem` по готовой раскладке. */
  private itemAt(index: number): VirtualItem {
    const start = this.starts[index] ?? 0;
    const size = this.sizes[index] ?? 0;
    return {
      index,
      key: this.keyAt(index),
      start,
      end: start + size,
      size,
      lane: this.lanesOf[index] ?? 0,
    };
  }

  /** Выравнивание `"auto"` по последнему наблюдённому вьюпорту. */
  private autoOffset(start: number, end: number): number {
    const viewport = this.lastViewportSize;
    if (viewport <= 0) {
      return start;
    }

    const viewStart = this.lastScrollOffset;
    if (start >= viewStart && end <= viewStart + viewport) {
      return viewStart;
    }
    if (start < viewStart) {
      return start;
    }
    return Math.max(0, end - viewport);
  }
}

/** Сравнение ключей для стабильной сортировки снапшота. */
function compareKeys(left: VirtualKey, right: VirtualKey): number {
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }
  const leftText = String(left);
  const rightText = String(right);
  if (leftText < rightText) {
    return -1;
  }
  if (leftText > rightText) {
    return 1;
  }
  return 0;
}
