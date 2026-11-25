/**
 * Выравнивание элемента относительно окна прокрутки.
 *
 * - `"start"` — координата начала элемента;
 * - `"center"` — координата центра элемента (чтобы совместить центры,
 *   потребитель вычитает половину размера вьюпорта);
 * - `"end"` — координата конца элемента (потребитель вычитает размер
 *   вьюпорта);
 * - `"auto"` — минимальная прокрутка: если элемент уже полностью виден,
 *   смещение не меняется, иначе выбирается ближайшая граница.
 */
export type ScrollAlignment = "start" | "center" | "end" | "auto";

/**
 * Стратегия распределения элементов по дорожкам (lanes/masonry).
 *
 * - `"estimate"` — курсоры дорожек двигаются сразу, по оценке размера
 *   (если для ключа уже есть измерение, используется оно);
 * - `"measured"` — неизмеренный элемент не занимает место в дорожке
 *   (курсор не двигается), раскладка уточняется после `measureItem`.
 */
export type LaneAssignmentMode = "estimate" | "measured";

/**
 * Ключ элемента. Должен быть примитивом, пригодным для `Map` и JSON,
 * чтобы кэш измерений и снапшоты оставались сериализуемыми.
 */
export type VirtualKey = string | number;

/**
 * Одно измеренное (или оценённое) положение элемента вдоль главной оси.
 *
 * Все координаты — пиксели вдоль главной оси прокрутки; они уже включают
 * `scrollMargin`, `paddingStart` и `gap`.
 */
export interface VirtualItem {
  /** Порядковый номер элемента в исходном списке. */
  index: number;
  /** Ключ элемента из `getItemKey` (по умолчанию — сам индекс). */
  key: VirtualKey;
  /** Начало элемента (включительно). */
  start: number;
  /** Конец элемента (исключительно): `start + size`. */
  end: number;
  /** Размер элемента вдоль главной оси. */
  size: number;
  /** Номер дорожки, в которую распределён элемент (0 при `lanes = 1`). */
  lane: number;
}

/**
 * Диапазон индексов для рендера.
 *
 * Все границы — **включительно**, кроме `count`, который равен общему числу
 * элементов.
 *
 * Для пустого диапазона (пустой список, нулевой/отрицательный вьюпорт,
 * отсутствие видимых элементов) используется каноническая пара:
 * `startIndex = 0`, `endIndex = -1`, `overscanStartIndex = 0`,
 * `overscanEndIndex = -1`.
 *
 * `overscanStartIndex`/`overscanEndIndex` — непрерывная оболочка, покрывающая
 * окно с запасом `overscan` **и** все индексы, которые вернул
 * `rangeExtractor` (после фильтрации и сортировки). Отдельного списка
 * индексов в `Range` нет, поэтому пользовательский extractor расширяет
 * оболочку до минимального/максимального запрошенного индекса.
 */
export interface Range {
  /** Первый видимый индекс (включительно). */
  startIndex: number;
  /** Последний видимый индекс (включительно); `-1` для пустого диапазона. */
  endIndex: number;
  /** Первый индекс окна с overscan (включительно). */
  overscanStartIndex: number;
  /** Последний индекс окна с overscan (включительно); `-1` для пустого. */
  overscanEndIndex: number;
  /** Общее число элементов в списке. */
  count: number;
}

/**
 * Функция, расширяющая окно рендера (например, для закреплённых элементов).
 *
 * Возвращает произвольные индексы: нечисловые и выходящие за
 * `[0, count - 1]` отбрасываются, дробные усекаются, дубликаты удаляются,
 * результат сортируется по возрастанию. Так как `Range` описывает
 * непрерывную оболочку, итоговое окно объединяется с окном `overscan`.
 */
export type RangeExtractor = (range: Range) => readonly number[];

/**
 * Настройки ядра виртуализации.
 *
 * Все размеры и отступы — в пикселях вдоль главной оси.
 */
export interface VirtualizerOptions {
  /** Количество элементов; отрицательные и дробные значения нормализуются. */
  count: number;
  /**
   * Оценка размера элемента по индексу. Вызывается только для элементов,
   * у которых ещё нет измерения. Отрицательные/`NaN`/бесконечные значения
   * трактуются как `0`.
   */
  estimateSize: (index: number) => number;
  /**
   * Ключ элемента для кэша измерений. По умолчанию — индекс
   * (`defaultKey`). Ключи должны быть уникальными, иначе измерения
   * разделяются между элементами с одинаковым ключом.
   */
  getItemKey?: (index: number) => VirtualKey;
  /** Запас рендера в элементах с каждой стороны. По умолчанию `5`. */
  overscan?: number;
  /**
   * Флаг горизонтальной прокрутки. Ядро всегда считает смещения вдоль
   * главной оси и не меняет математику; флаг доступен потребителю через
   * `getOptions()` (например, для выбора `translateX`/`translateY`).
   */
  horizontal?: boolean;
  /** Отступ перед содержимым (входит в `start` первого элемента). По умолчанию `0`. */
  paddingStart?: number;
  /** Отступ после содержимого (входит в `totalSize`). По умолчанию `0`. */
  paddingEnd?: number;
  /** Промежуток между соседними элементами одной дорожки. По умолчанию `0`. */
  gap?: number;
  /** Смещение списка внутри прокручиваемого контейнера. По умолчанию `0`. */
  scrollMargin?: number;
  /** Количество дорожек masonry. По умолчанию `1`. */
  lanes?: number;
  /** Стратегия распределения по дорожкам. По умолчанию `"estimate"`. */
  laneAssignmentMode?: LaneAssignmentMode;
  /** Пользовательское расширение окна рендера. */
  rangeExtractor?: RangeExtractor;
  /** `false` полностью отключает виртуализацию (пустые измерения, `totalSize = 0`). */
  enabled?: boolean;
}

/**
 * Нормализованные настройки с подставленными значениями по умолчанию.
 * Возвращается из `VirtualizerCore.getOptions()`.
 */
export interface ResolvedVirtualizerOptions {
  readonly count: number;
  readonly estimateSize: (index: number) => number;
  readonly getItemKey: (index: number) => VirtualKey;
  readonly overscan: number;
  readonly horizontal: boolean;
  readonly paddingStart: number;
  readonly paddingEnd: number;
  readonly gap: number;
  readonly scrollMargin: number;
  readonly lanes: number;
  readonly laneAssignmentMode: LaneAssignmentMode;
  readonly rangeExtractor: RangeExtractor | undefined;
  readonly enabled: boolean;
}

/**
 * Плоский JSON-сериализуемый снимок состояния движка для SSR/гидрации.
 *
 * Содержит только данные (без функций): кэш измерений «ключ → размер»,
 * последнее наблюдённое смещение и размер вьюпорта. Настройки в снапшот не
 * входят — их владельцем остаётся хост-приложение.
 */
export interface VirtualizerSnapshot {
  /** Версия формата; сейчас всегда `1`. */
  readonly version: 1;
  /** Пары «ключ → измеренный размер», отсортированные по ключу. */
  readonly entries: ReadonlyArray<readonly [VirtualKey, number]>;
  /** Последнее смещение прокрутки, переданное в `rangeFor`. */
  readonly scrollOffset: number;
  /** Последний размер вьюпорта, переданный в `rangeFor`. */
  readonly viewportSize: number;
}

/** Аргументы чистой функции `computeRange`. */
export interface ComputeRangeOptions {
  /** Текущее смещение прокрутки. */
  scrollOffset: number;
  /** Размер вьюпорта вдоль главной оси; `<= 0` даёт пустой диапазон. */
  viewportSize: number;
  /**
   * Измерения, отсортированные по `start` по возрастанию (требование
   * бинарного поиска). Обычно это результат `measurements()`.
   */
  measurements: readonly VirtualItem[];
  /** Запас рендера в элементах; отрицательные значения трактуются как `0`. */
  overscan: number;
  /** Необязательное расширение окна рендера. */
  rangeExtractor?: RangeExtractor;
}

/** Аргументы детерминированного SSR-среза. */
export interface ServerSliceOptions {
  /** Количество элементов. */
  count: number;
  /** Оценка размера по индексу (на сервере измерений ещё нет). */
  estimateSize: (index: number) => number;
  /** Размер вьюпорта вдоль главной оси. */
  viewportSize: number;
  /** Смещение прокрутки. По умолчанию `0`. */
  scrollOffset?: number;
  /** Запас рендера в элементах. По умолчанию `0`. */
  overscan?: number;
  /** Промежуток между элементами. По умолчанию `0`. */
  gap?: number;
  /** Отступ перед содержимым. По умолчанию `0`. */
  paddingStart?: number;
}

/** Результат `computeServerSlice`: видимый срез и полный размер контента. */
export interface ServerSlice {
  /** Элементы окна `range.overscanStartIndex..range.overscanEndIndex` включительно. */
  items: VirtualItem[];
  /** Полный размер списка вдоль главной оси (включая отступы и промежутки). */
  totalSize: number;
  /** Диапазон индексов, соответствующий срезу. */
  range: Range;
}
