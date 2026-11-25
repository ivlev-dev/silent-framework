import type { ClientRect, Coordinates, Transform } from "./types.js";

/** Описание прямоугольника до нормализации. */
export interface RectLike {
  top: number;
  left: number;
  right?: number;
  bottom?: number;
  width?: number;
  height?: number;
}

/** Нулевые координаты. Заморожены, чтобы исключить случайную мутацию. */
export const defaultCoordinates: Coordinates = Object.freeze({ x: 0, y: 0 });

/**
 * Приводит произвольное описание прямоугольника к `ClientRect`.
 *
 * Недостающие `right`/`bottom` достраиваются из `left`/`top` и размеров,
 * а `width`/`height` — из краёв. При конфликте края имеют приоритет.
 */
export function getClientRect(rectLike: RectLike): ClientRect {
  const right = rectLike.right ?? rectLike.left + (rectLike.width ?? 0);
  const bottom = rectLike.bottom ?? rectLike.top + (rectLike.height ?? 0);
  const width = right - rectLike.left;
  const height = bottom - rectLike.top;

  return {
    top: rectLike.top,
    left: rectLike.left,
    right,
    bottom,
    width,
    height,
  };
}

/** Возвращает геометрический центр прямоугольника. */
export function getCenter(rect: ClientRect): Coordinates {
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

/** Евклидово расстояние между двумя точками. */
export function distanceBetween(a: Coordinates, b: Coordinates): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Проверяет, находится ли точка внутри прямоугольника.
 *
 * Границы включены: точка на ребре считается находящейся внутри.
 */
export function isPointWithinRect(point: Coordinates, rect: ClientRect): boolean {
  return (
    point.x >= rect.left &&
    point.x <= rect.right &&
    point.y >= rect.top &&
    point.y <= rect.bottom
  );
}

/**
 * Проверяет наличие пересечения с положительной площадью.
 *
 * Касание рёбер (нулевая площадь пересечения) пересечением не считается.
 */
export function rectsIntersect(a: ClientRect, b: ClientRect): boolean {
  return (
    a.left < b.right &&
    b.left < a.right &&
    a.top < b.bottom &&
    b.top < a.bottom
  );
}

/**
 * Отношение площади пересечения к площади объединения (IoU) в диапазоне `[0, 1]`.
 *
 * Для непересекающихся прямоугольников возвращает `0`.
 */
export function intersectionRatio(a: ClientRect, b: ClientRect): number {
  const intersectionWidth =
    Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const intersectionHeight =
    Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);

  if (intersectionWidth <= 0 || intersectionHeight <= 0) {
    return 0;
  }

  const intersectionArea = intersectionWidth * intersectionHeight;
  const aArea = Math.max(0, a.width) * Math.max(0, a.height);
  const bArea = Math.max(0, b.width) * Math.max(0, b.height);
  const unionArea = aArea + bArea - intersectionArea;

  if (unionArea <= 0) {
    return 0;
  }

  return Math.min(intersectionArea / unionArea, 1);
}

function normalizeScale(scale: number | undefined): number {
  if (scale === undefined || !Number.isFinite(scale) || scale === 0) {
    return 1;
  }

  return Math.abs(scale);
}

/**
 * Применяет translate/scale к прямоугольнику.
 *
 * Масштабирование выполняется относительно центра прямоугольника, как в CSS
 * при `transform-origin: center`. Возвращается новый `ClientRect`.
 */
export function applyTransform(rect: ClientRect, transform: Transform): ClientRect {
  const scaleX = normalizeScale(transform.scaleX);
  const scaleY = normalizeScale(transform.scaleY);
  const center = getCenter(rect);
  const width = rect.width * scaleX;
  const height = rect.height * scaleY;
  const left = center.x + transform.x - width / 2;
  const top = center.y + transform.y - height / 2;

  return {
    top,
    left,
    right: left + width,
    bottom: top + height,
    width,
    height,
  };
}

/**
 * Обратное преобразование: восстанавливает исходный прямоугольник
 * из результата {@link applyTransform}.
 *
 * Нулевой и нечисловой масштаб трактуются как `1`.
 */
export function inverseTransform(
  transform: Transform,
  rect: ClientRect,
): ClientRect {
  const scaleX = normalizeScale(transform.scaleX);
  const scaleY = normalizeScale(transform.scaleY);
  const width = rect.width / scaleX;
  const height = rect.height / scaleY;
  const center = getCenter(rect);
  const left = center.x - transform.x - width / 2;
  const top = center.y - transform.y - height / 2;

  return {
    top,
    left,
    right: left + width,
    bottom: top + height,
    width,
    height,
  };
}

/** Добавляет смещение `delta` к translate-компонентам transform. */
export function adjustTranslate(
  transform: Transform,
  delta: Coordinates,
): Transform {
  return {
    ...transform,
    x: transform.x + delta.x,
    y: transform.y + delta.y,
  };
}

/**
 * Ограничивает значение диапазоном `[min, max]`.
 *
 * Если `min > max`, возвращается `max` (поведение `Math.min(Math.max(...))`).
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
