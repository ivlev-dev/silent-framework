import {
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  onCleanup,
} from "@ivlev-dev/silent-reactivity";
import { isServerMode } from "@ivlev-dev/silent-core";
import { VirtualizerCore } from "../core/engine.js";
import { computeServerSlice } from "../core/ssr.js";
import type {
  Range,
  RangeExtractor,
  ScrollAlignment,
  VirtualItem,
  VirtualKey,
  VirtualizerOptions,
  VirtualizerSnapshot,
} from "../core/types.js";

/**
 * Значение или аксессор значения.
 *
 * Аксессор — обычная функция без аргументов: виртуализатор перечитывает его
 * в эффекте и пересчитывает раскладку при изменении сигнала.
 */
export type MaybeAccessor<T> = T | (() => T);

/** Настройки `createVirtualizer`: каждое числовое/булево поле — значение или аксессор. */
export interface CreateVirtualizerOptions {
  /** Количество элементов. */
  count: MaybeAccessor<number>;
  /** Оценка размера элемента по индексу вдоль главной оси. */
  estimateSize: (index: number) => number;
  /** Ключ элемента; по умолчанию — индекс. */
  getItemKey?: ((index: number) => VirtualKey) | undefined;
  /** Запас рендера в элементах с каждой стороны. По умолчанию `5`. */
  overscan?: MaybeAccessor<number> | undefined;
  /** Горизонтальная прокрутка: `translateX`/`scrollLeft` вместо `translateY`/`scrollTop`. */
  horizontal?: MaybeAccessor<boolean> | undefined;
  /** Отступ перед содержимым. */
  paddingStart?: MaybeAccessor<number> | undefined;
  /** Отступ после содержимого. */
  paddingEnd?: MaybeAccessor<number> | undefined;
  /** Промежуток между соседними элементами. */
  gap?: MaybeAccessor<number> | undefined;
  /** Смещение списка внутри прокручиваемого контейнера. */
  scrollMargin?: MaybeAccessor<number> | undefined;
  /** Количество дорожек masonry. По умолчанию `1`. */
  lanes?: MaybeAccessor<number> | undefined;
  /** Пользовательское расширение окна рендера. */
  rangeExtractor?: RangeExtractor | undefined;
  /** Начальное смещение для SSR-среза. По умолчанию `0`. */
  initialOffset?: MaybeAccessor<number> | undefined;
  /** Начальный размер вьюпорта для SSR-среза. По умолчанию `0`. */
  initialViewportSize?: MaybeAccessor<number> | undefined;
  /** `false` отключает виртуализацию. */
  enabled?: MaybeAccessor<boolean> | undefined;
  /** Задержка сброса `isScrolling`, мс. По умолчанию `150`. */
  isScrollingResetDelay?: MaybeAccessor<number> | undefined;
}

/** Императивный дескриптор виртуализации, привязанный к DOM-контейнеру. */
export interface Virtualizer {
  /** Видимые элементы вместе с overscan, в порядке индексов. */
  virtualItems: () => VirtualItem[];
  /** Текущий диапазон индексов. */
  range: () => Range;
  /** Полный размер содержимого вдоль главной оси. */
  totalSize: () => number;
  /** Идёт ли прокрутка прямо сейчас. */
  isScrolling: () => boolean;
  /** Ref-колбэк прокручиваемого контейнера. */
  setScrollElement: (node: Element | null) => void;
  /** Прокрутить к элементу по индексу. */
  scrollToIndex: (
    index: number,
    options?: { align?: ScrollAlignment | undefined; behavior?: ScrollBehavior | undefined },
  ) => void;
  /** Прокрутить к координате вдоль главной оси. */
  scrollToOffset: (
    offset: number,
    options?: { behavior?: ScrollBehavior | undefined },
  ) => void;
  /** Прокрутить в конец содержимого. */
  scrollToEnd: () => void;
  /** Ref-колбэк строки: измеряет размер узла с `data-index`. */
  measureElement: (node: Element | null) => void;
  /** Координата прокрутки для индекса с учётом выравнивания. */
  getOffsetForIndex: (index: number, align?: ScrollAlignment) => number;
  /** Частично обновить настройки. */
  setOptions: (patch: Partial<CreateVirtualizerOptions>) => void;
  /** JSON-сериализуемый снимок измерений и позиции. */
  snapshot: () => unknown;
  /** Восстановить снимок, полученный из `snapshot()`. */
  restore: (snapshot: unknown) => void;
  /** Освободить эффекты и слушатели. Идемпотентно. */
  dispose: () => void;
}

const DEFAULT_SCROLLING_RESET_DELAY = 150;

function readValue<T>(value: MaybeAccessor<T> | undefined, fallback: T): T {
  if (value === undefined) {
    return fallback;
  }
  return typeof value === "function" ? (value as () => T)() : value;
}

function normalizeNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function normalizeSpacing(value: number, fallback = 0): number {
  const normalized = normalizeNumber(value, fallback);
  return normalized > 0 ? normalized : 0;
}

interface ResolvedCoreOptions {
  readonly count: number;
  readonly estimateSize: (index: number) => number;
  readonly getItemKey: ((index: number) => VirtualKey) | undefined;
  readonly overscan: number;
  readonly horizontal: boolean;
  readonly paddingStart: number;
  readonly paddingEnd: number;
  readonly gap: number;
  readonly scrollMargin: number;
  readonly lanes: number;
  readonly rangeExtractor: RangeExtractor | undefined;
  readonly enabled: boolean;
}

function resolveCoreOptions(options: CreateVirtualizerOptions): ResolvedCoreOptions {
  return {
    count: normalizeNumber(readValue(options.count, 0), 0),
    estimateSize: options.estimateSize,
    getItemKey: options.getItemKey,
    overscan: normalizeNumber(readValue(options.overscan, 5), 5),
    horizontal: readValue(options.horizontal, false) === true,
    paddingStart: normalizeSpacing(readValue(options.paddingStart, 0)),
    paddingEnd: normalizeSpacing(readValue(options.paddingEnd, 0)),
    gap: normalizeSpacing(readValue(options.gap, 0)),
    scrollMargin: normalizeNumber(readValue(options.scrollMargin, 0), 0),
    lanes: normalizeNumber(readValue(options.lanes, 1), 1),
    rangeExtractor: options.rangeExtractor,
    enabled: readValue(options.enabled, true) !== false,
  };
}

function toCoreOptions(resolved: ResolvedCoreOptions): VirtualizerOptions {
  const core: VirtualizerOptions = {
    count: resolved.count,
    estimateSize: resolved.estimateSize,
    overscan: resolved.overscan,
    horizontal: resolved.horizontal,
    paddingStart: resolved.paddingStart,
    paddingEnd: resolved.paddingEnd,
    gap: resolved.gap,
    scrollMargin: resolved.scrollMargin,
    lanes: resolved.lanes,
    enabled: resolved.enabled,
  };
  if (resolved.getItemKey !== undefined) {
    core.getItemKey = resolved.getItemKey;
  }
  if (resolved.rangeExtractor !== undefined) {
    core.rangeExtractor = resolved.rangeExtractor;
  }
  return core;
}

/** Эффект только на клиенте: SSR не создаёт DOM-обработчиков. */
export function clientEffect(fn: () => void): void {
  if (isServerMode()) return;
  createEffect(fn);
}

function readNodeSize(node: Element, horizontal: boolean): number {
  const rect =
    typeof node.getBoundingClientRect === "function"
      ? node.getBoundingClientRect()
      : null;
  const element = node as Element & {
    readonly offsetWidth?: number;
    readonly offsetHeight?: number;
    readonly clientWidth?: number;
    readonly clientHeight?: number;
  };
  const primary = horizontal ? (rect?.width ?? 0) : (rect?.height ?? 0);
  if (primary > 0) {
    return primary;
  }
  const offset = horizontal ? (element.offsetWidth ?? 0) : (element.offsetHeight ?? 0);
  if (offset > 0) {
    return offset;
  }
  return horizontal ? (element.clientWidth ?? 0) : (element.clientHeight ?? 0);
}

function readViewportSize(node: Element, horizontal: boolean): number {
  const element = node as Element & {
    readonly clientWidth?: number;
    readonly clientHeight?: number;
  };
  const size = horizontal ? (element.clientWidth ?? 0) : (element.clientHeight ?? 0);
  return Number.isFinite(size) ? Math.max(0, size) : 0;
}

function readScrollOffset(node: Element, horizontal: boolean): number {
  const offset = horizontal ? node.scrollLeft : node.scrollTop;
  return Number.isFinite(offset) ? offset : 0;
}

function clampOffset(offset: number, totalSize: number, viewportSize: number): number {
  if (!Number.isFinite(offset)) {
    return 0;
  }
  const max = Math.max(0, totalSize - viewportSize);
  return Math.min(Math.max(offset, 0), max);
}

/**
 * Создаёт виртуализатор, привязанный к DOM через ref-колбэки.
 *
 * На сервере не навешивает слушателей и не обращается к `ResizeObserver`:
 * `virtualItems` возвращает детерминированный срез `computeServerSlice` по
 * `initialOffset`/`initialViewportSize`. На клиенте первые рендеры до
 * подключения контейнера используют тот же срез, поэтому разметка совпадает
 * с серверной.
 */
export function createVirtualizer(options: CreateVirtualizerOptions): Virtualizer {
  const initial = resolveCoreOptions(options);
  const initialOffset = normalizeNumber(
    readValue(options.initialOffset, 0),
    0,
  );
  const initialViewportSize = Math.max(
    0,
    normalizeNumber(readValue(options.initialViewportSize, 0), 0),
  );
  const scrollingResetDelay = Math.max(
    0,
    normalizeNumber(
      readValue(options.isScrollingResetDelay, DEFAULT_SCROLLING_RESET_DELAY),
      DEFAULT_SCROLLING_RESET_DELAY,
    ),
  );

  const sliced = initial.enabled
    ? computeServerSlice({
        count: initial.count,
        estimateSize: initial.estimateSize,
        viewportSize: initialViewportSize,
        scrollOffset: initialOffset,
        overscan: initial.overscan,
        gap: initial.gap,
        // `computeServerSlice` не знает про `scrollMargin` и `paddingEnd`,
        // поэтому сдвигаем начало координат вручную: для одной дорожки это
        // даёт те же `start` и `totalSize`, что и ядро после монтирования.
        paddingStart: initial.paddingStart + initial.scrollMargin,
      })
    : computeServerSlice({
        count: 0,
        estimateSize: initial.estimateSize,
        viewportSize: 0,
        scrollOffset: 0,
        overscan: 0,
      });
  const initialSlice = {
    items: sliced.items,
    range: sliced.range,
    totalSize: sliced.totalSize + (initial.enabled ? initial.paddingEnd : 0),
  };

  let disposed = false;
  let disposeRoot: (() => void) | null = null;
  let releaseScrollElement: () => void = () => {};

  /**
   * Идемпотентное освобождение контроллера.
   *
   * Снимает `scroll`-слушатель, `ResizeObserver`/`window.resize`, отменяет
   * запланированный кадр rAF и таймер `isScrolling` (через cleanup'ы
   * эффектов), отпускает ссылку на DOM-узел и гасит внутренний root.
   */
  const dispose = (): void => {
    if (disposed) {
      return;
    }
    disposed = true;
    releaseScrollElement();
    const root = disposeRoot;
    disposeRoot = null;
    root?.();
  };

  const api = createRoot((rootDispose) => {
    disposeRoot = rootDispose;
    onCleanup(() => {
      disposed = true;
    });

    const core = new VirtualizerCore(toCoreOptions(initial));
    const [scrollOffset, setScrollOffset] = createSignal(initialOffset);
    const [viewportSize, setViewportSize] = createSignal(initialViewportSize);
    const [isScrolling, setIsScrolling] = createSignal(false);
    const [activated, setActivated] = createSignal(false);
    const [element, setElement] = createSignal<Element | null>(null);
    const [version, setVersion] = createSignal(0);

    releaseScrollElement = () => {
      setElement(null);
    };

    const measuredNodes = new WeakMap<Element, number>();
    let horizontalNow = initial.horizontal;
    let scrollingDelayNow = scrollingResetDelay;

    const bump = (): void => {
      if (disposed) return;
      setVersion((value) => value + 1);
    };

    clientEffect(() => {
      const resolved = resolveCoreOptions(options);
      horizontalNow = resolved.horizontal;
      scrollingDelayNow = Math.max(
        0,
        normalizeNumber(
          readValue(options.isScrollingResetDelay, DEFAULT_SCROLLING_RESET_DELAY),
          DEFAULT_SCROLLING_RESET_DELAY,
        ),
      );
      core.setOptions(toCoreOptions(resolved));
      bump();
    });

    clientEffect(() => {
      const node = element();
      if (node === null || disposed) {
        return;
      }

      let frame: number | null = null;
      let framePending = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let observer: ResizeObserver | null = null;
      let onWindowResize: (() => void) | null = null;

      const sync = (): void => {
        if (disposed) return;
        setViewportSize(readViewportSize(node, horizontalNow));
        setScrollOffset(readScrollOffset(node, horizontalNow));
        setActivated(true);
      };

      const runFrame = (): void => {
        framePending = false;
        frame = null;
        sync();
      };

      const schedule = (): void => {
        if (typeof requestAnimationFrame === "function") {
          if (framePending) {
            return;
          }
          framePending = true;
          frame = requestAnimationFrame(runFrame);
          return;
        }
        sync();
      };

      const onScroll = (): void => {
        setIsScrolling(true);
        if (timer !== null) {
          clearTimeout(timer);
        }
        timer = setTimeout(() => {
          timer = null;
          if (!disposed) {
            setIsScrolling(false);
          }
        }, scrollingDelayNow);
        schedule();
      };

      node.addEventListener("scroll", onScroll, { passive: true });

      if (typeof ResizeObserver === "function") {
        observer = new ResizeObserver(schedule);
        observer.observe(node);
      } else if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
        onWindowResize = schedule;
        window.addEventListener("resize", onWindowResize, { passive: true });
      }

      onCleanup(() => {
        node.removeEventListener("scroll", onScroll);
        if (frame !== null && typeof cancelAnimationFrame === "function") {
          cancelAnimationFrame(frame);
        }
        frame = null;
        framePending = false;
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
        if (observer !== null) {
          observer.disconnect();
          observer = null;
        }
        if (onWindowResize !== null && typeof window !== "undefined") {
          window.removeEventListener("resize", onWindowResize);
          onWindowResize = null;
        }
        // Сбрасываем флаг только при освобождении: при смене узла эффект
        // перезапустится сам и лишний цикл через сигнал не нужен.
        if (disposed) {
          setIsScrolling(false);
        }
      });

      sync();
    });

    const layout = createMemo(() => {
      version();
      return core.measurements();
    });

    const view = createMemo(() => {
      if (!activated()) {
        return { items: initialSlice.items, range: initialSlice.range };
      }
      const offset = scrollOffset();
      const viewport = viewportSize();
      const range = core.rangeFor(offset, viewport);
      const all = layout();
      const start = Math.max(0, range.overscanStartIndex);
      const end = Math.min(all.length, range.overscanEndIndex + 1);
      return {
        items: end > start ? all.slice(start, end) : [],
        range,
      };
    });

    const totalSize = createMemo(() => {
      if (!activated()) {
        return initialSlice.totalSize;
      }
      version();
      return core.totalSize();
    });

    const measureElement = (node: Element | null): void => {
      if (node === null || disposed || isServerMode()) {
        return;
      }
      const raw = node.getAttribute("data-index");
      if (raw === null) {
        return;
      }
      const index = Number.parseInt(raw, 10);
      if (!Number.isFinite(index)) {
        return;
      }
      const size = readNodeSize(node, horizontalNow);
      if (!(size > 0)) {
        return;
      }
      if (measuredNodes.get(node) === size) {
        return;
      }
      measuredNodes.set(node, size);
      core.measureItem(index, size);
      if (!activated()) {
        setActivated(true);
      }
      bump();
    };

    const getOffsetForIndex = (
      index: number,
      align: ScrollAlignment = "auto",
    ): number => {
      const resolved = core.getOptions();
      if (!resolved.enabled || resolved.count === 0) {
        return 0;
      }
      const start = core.offsetForIndex(index, "start");
      const end = core.offsetForIndex(index, "end");
      const size = end - start;
      const viewport = Math.max(0, viewportSize());
      const total = core.totalSize();
      let offset: number;
      switch (align) {
        case "start":
          offset = start;
          break;
        case "center":
          offset = start + size / 2 - viewport / 2;
          break;
        case "end":
          offset = end - viewport;
          break;
        case "auto": {
          const current = scrollOffset();
          if (start >= current && end <= current + viewport) {
            offset = current;
          } else if (start < current) {
            offset = start;
          } else {
            offset = end - viewport;
          }
          break;
        }
        default:
          offset = start;
          break;
      }
      return clampOffset(offset, total, viewport);
    };

    const applyScroll = (
      node: Element,
      offset: number,
      behavior: ScrollBehavior | undefined,
    ): void => {
      if (behavior === "smooth" && typeof node.scrollTo === "function") {
        node.scrollTo({
          [horizontalNow ? "left" : "top"]: offset,
          behavior: "smooth",
        });
        return;
      }
      if (horizontalNow) {
        node.scrollLeft = offset;
      } else {
        node.scrollTop = offset;
      }
    };

    const scrollToOffset = (
      offset: number,
      scrollOptions: { behavior?: ScrollBehavior | undefined } = {},
    ): void => {
      if (disposed) return;
      const viewport = Math.max(0, viewportSize());
      const total = core.totalSize();
      const target = clampOffset(offset, total, viewport);
      setScrollOffset(target);
      setActivated(true);
      const node = element();
      if (node !== null) {
        applyScroll(node, target, scrollOptions.behavior);
      }
    };

    const scrollToIndex = (
      index: number,
      scrollOptions: {
        align?: ScrollAlignment | undefined;
        behavior?: ScrollBehavior | undefined;
      } = {},
    ): void => {
      const target = getOffsetForIndex(index, scrollOptions.align ?? "auto");
      scrollToOffset(target, { behavior: scrollOptions.behavior });
    };

    const scrollToEnd = (): void => {
      const viewport = Math.max(0, viewportSize());
      scrollToOffset(Math.max(0, core.totalSize() - viewport));
    };

    const setOptions = (patch: Partial<CreateVirtualizerOptions>): void => {
      if (disposed) return;
      const has = (key: keyof CreateVirtualizerOptions): boolean =>
        Object.prototype.hasOwnProperty.call(patch, key);
      const corePatch: Partial<VirtualizerOptions> = {};
      if (has("count")) {
        corePatch.count = normalizeNumber(readValue(patch.count, 0), 0);
      }
      if (has("estimateSize") && patch.estimateSize !== undefined) {
        corePatch.estimateSize = patch.estimateSize;
      }
      if (has("getItemKey")) {
        if (patch.getItemKey !== undefined) {
          corePatch.getItemKey = patch.getItemKey;
        }
      }
      if (has("overscan")) {
        corePatch.overscan = normalizeNumber(readValue(patch.overscan, 5), 5);
      }
      if (has("horizontal")) {
        const horizontal = readValue(patch.horizontal, false) === true;
        horizontalNow = horizontal;
        corePatch.horizontal = horizontal;
      }
      if (has("paddingStart")) {
        corePatch.paddingStart = normalizeNumber(readValue(patch.paddingStart, 0), 0);
      }
      if (has("paddingEnd")) {
        corePatch.paddingEnd = normalizeNumber(readValue(patch.paddingEnd, 0), 0);
      }
      if (has("gap")) {
        corePatch.gap = normalizeNumber(readValue(patch.gap, 0), 0);
      }
      if (has("scrollMargin")) {
        corePatch.scrollMargin = normalizeNumber(readValue(patch.scrollMargin, 0), 0);
      }
      if (has("lanes")) {
        corePatch.lanes = normalizeNumber(readValue(patch.lanes, 1), 1);
      }
      if (has("rangeExtractor")) {
        if (patch.rangeExtractor !== undefined) {
          corePatch.rangeExtractor = patch.rangeExtractor;
        }
      }
      if (has("enabled")) {
        corePatch.enabled = readValue(patch.enabled, true) !== false;
      }
      if (has("isScrollingResetDelay")) {
        scrollingDelayNow = Math.max(
          0,
          normalizeNumber(
            readValue(patch.isScrollingResetDelay, DEFAULT_SCROLLING_RESET_DELAY),
            DEFAULT_SCROLLING_RESET_DELAY,
          ),
        );
      }
      if (has("initialOffset")) {
        setScrollOffset(normalizeNumber(readValue(patch.initialOffset, 0), 0));
      }
      if (has("initialViewportSize")) {
        setViewportSize(
          Math.max(
            0,
            normalizeNumber(readValue(patch.initialViewportSize, 0), 0),
          ),
        );
      }
      core.setOptions(corePatch);
      bump();
    };

    const restore = (snapshot: unknown): void => {
      if (disposed) return;
      core.restore(snapshot as VirtualizerSnapshot);
      const normalized = core.snapshot() as { scrollOffset: number; viewportSize: number };
      setScrollOffset(normalized.scrollOffset);
      setViewportSize(normalized.viewportSize);
      setActivated(normalized.viewportSize > 0);
      bump();
    };

    return {
      virtualItems: () => view().items,
      range: () => view().range,
      totalSize,
      isScrolling,
      setScrollElement(node: Element | null): void {
        if (disposed || isServerMode()) {
          return;
        }
        setElement(node);
      },
      scrollToIndex,
      scrollToOffset,
      scrollToEnd,
      measureElement,
      getOffsetForIndex,
      setOptions,
      snapshot: () => core.snapshot(),
      restore,
      dispose,
    } satisfies Virtualizer;
  });

  // Владелец рендера (компонент, `createRoot`, эффект) освобождает
  // контроллер сам — явный `dispose()` нужен только вне owner'а.
  // Внутренний root остаётся отдельным: эксплицитный `dispose()` не трогает
  // чужие эффекты и сигналы, а повторный вызов безопасен.
  onCleanup(dispose);

  return api;
}
