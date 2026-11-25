import { defaultKey } from "./keys.js";
import type {
  LaneAssignmentMode,
  ResolvedVirtualizerOptions,
  VirtualizerOptions,
} from "./types.js";

/** Запас рендера по умолчанию. */
const DEFAULT_OVERSCAN = 5;

/**
 * Нормализует количество элементов: отрицательные, `NaN` и бесконечные
 * значения превращаются в `0`, дробные усекаются.
 */
export function normalizeCount(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.floor(value);
}

/**
 * Нормализует размер: отрицательные, `NaN` и бесконечные значения
 * превращаются в `0`.
 */
export function normalizeSize(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return value;
}

/**
 * Нормализует `overscan`: отсутствие значения даёт `fallback`, некорректные
 * значения — `0`, дробные усекаются.
 */
export function normalizeOverscan(
  value: number | undefined,
  fallback: number = DEFAULT_OVERSCAN,
): number {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.floor(value);
}

/**
 * Нормализует количество дорожек: минимум `1`, дробные усекаются.
 */
export function normalizeLanes(value: number | undefined): number {
  if (value === undefined) {
    return 1;
  }
  if (!Number.isFinite(value) || value < 1) {
    return 1;
  }
  return Math.floor(value);
}

/**
 * Нормализует числовое смещение: `NaN`/бесконечность превращаются в `0`,
 * отрицательные значения сохраняются (клампинг выполняется вызывающим кодом).
 */
export function normalizeOffset(value: number | undefined): number {
  if (value === undefined) {
    return 0;
  }
  return Number.isFinite(value) ? value : 0;
}

/**
 * Нормализует неотрицательный отступ (`gap`, `padding*`): некорректные и
 * отрицательные значения дают `0`.
 */
export function normalizeSpacing(value: number | undefined): number {
  if (value === undefined) {
    return 0;
  }
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return value;
}

/**
 * Подставляет значения по умолчанию и нормализует все числовые поля.
 * Функции сохраняются по ссылке, чтобы движок мог определить их замену.
 */
export function resolveVirtualizerOptions(
  options: VirtualizerOptions,
): ResolvedVirtualizerOptions {
  const laneAssignmentMode: LaneAssignmentMode =
    options.laneAssignmentMode === "measured" ? "measured" : "estimate";

  return {
    count: normalizeCount(options.count),
    estimateSize: options.estimateSize,
    getItemKey: options.getItemKey ?? defaultKey,
    overscan: normalizeOverscan(options.overscan),
    horizontal: options.horizontal === true,
    paddingStart: normalizeSpacing(options.paddingStart),
    paddingEnd: normalizeSpacing(options.paddingEnd),
    gap: normalizeSpacing(options.gap),
    scrollMargin: normalizeOffset(options.scrollMargin),
    lanes: normalizeLanes(options.lanes),
    laneAssignmentMode,
    rangeExtractor: options.rangeExtractor,
    enabled: options.enabled !== false,
  };
}
