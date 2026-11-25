import {
  distanceBetween,
  getCenter,
  intersectionRatio,
  isPointWithinRect,
} from "./geometry.js";
import type {
  ClientRect,
  Collision,
  CollisionArgs,
  CollisionDetection,
  Coordinates,
  Data,
  DroppableContainer,
  UniqueIdentifier,
} from "./types.js";

function toCollision(
  container: DroppableContainer,
  data: Data | undefined = container.data,
): Collision {
  return data === undefined ? { id: container.id } : { id: container.id, data };
}

interface RankedCollision {
  collision: Collision;
  score: number;
}

/**
 * Сортирует коллизии по метрике возрастанию.
 *
 * `Array#sort` в современном JavaScript стабилен, поэтому при равных метриках
 * сохраняется исходный порядок `droppableContainers` — как в классическом
 * `@dnd-kit/core`, без дополнительного tie-break.
 */
function resolveCollisions(ranked: RankedCollision[]): Collision[] {
  return ranked
    .sort((a, b) => a.score - b.score)
    .map((entry) => entry.collision);
}

function isMeasured(
  container: DroppableContainer,
  droppableRects: Map<UniqueIdentifier, ClientRect>,
): boolean {
  return !container.disabled && droppableRects.has(container.id);
}

/**
 * Пересечение прямоугольников.
 *
 * Возвращает только контейнеры с положительной площадью пересечения,
 * отсортированные по убыванию IoU. Касание рёбер пересечением не считается.
 */
export const rectIntersection: CollisionDetection = ({
  collisionRect,
  droppableContainers,
  droppableRects,
}: CollisionArgs): Collision[] => {
  const ranked: RankedCollision[] = [];

  for (const container of droppableContainers) {
    if (!isMeasured(container, droppableRects)) {
      continue;
    }

    const rect = droppableRects.get(container.id);

    if (!rect) {
      continue;
    }

    const ratio = intersectionRatio(collisionRect, rect);

    if (ratio <= 0) {
      continue;
    }

    ranked.push({
      collision: toCollision(container),
      // Сортировка по убыванию: инвертируем метрику.
      score: -ratio,
    });
  }

  return resolveCollisions(ranked);
};

/**
 * Ближайший к центру активного элемента контейнер.
 *
 * Сортирует все измеренные контейнеры по расстоянию между центрами
 * (по возрастанию).
 */
export const closestCenter: CollisionDetection = ({
  collisionRect,
  droppableContainers,
  droppableRects,
}: CollisionArgs): Collision[] => {
  const activeCenter = getCenter(collisionRect);
  const ranked: RankedCollision[] = [];

  for (const container of droppableContainers) {
    if (!isMeasured(container, droppableRects)) {
      continue;
    }

    const rect = droppableRects.get(container.id);

    if (!rect) {
      continue;
    }

    ranked.push({
      collision: toCollision(container),
      score: distanceBetween(activeCenter, getCenter(rect)),
    });
  }

  return resolveCollisions(ranked);
};

type RectCorners = readonly [
  topLeft: Coordinates,
  topRight: Coordinates,
  bottomLeft: Coordinates,
  bottomRight: Coordinates,
];

function getCorners(rect: ClientRect): RectCorners {
  return [
    { x: rect.left, y: rect.top },
    { x: rect.right, y: rect.top },
    { x: rect.left, y: rect.bottom },
    { x: rect.right, y: rect.bottom },
  ];
}

/**
 * Среднее расстояние между соответствующими углами двух прямоугольников.
 *
 * Пары фиксированы: topLeft↔topLeft, topRight↔topRight,
 * bottomLeft↔bottomLeft, bottomRight↔bottomRight. Результат округляется
 * до 4 знаков, как в `@dnd-kit/core`.
 */
function averageCornerDistance(a: ClientRect, b: ClientRect): number {
  const [aTopLeft, aTopRight, aBottomLeft, aBottomRight] = getCorners(a);
  const [bTopLeft, bTopRight, bBottomLeft, bBottomRight] = getCorners(b);

  const distanceSum =
    distanceBetween(aTopLeft, bTopLeft) +
    distanceBetween(aTopRight, bTopRight) +
    distanceBetween(aBottomLeft, bBottomLeft) +
    distanceBetween(aBottomRight, bBottomRight);

  return Number((distanceSum / 4).toFixed(4));
}

/**
 * Ближайший по среднему расстоянию между соответствующими углами контейнер.
 *
 * Метрика: сумма расстояний четырёх соответствующих углов, делённая на 4
 * (эталон `@dnd-kit/core`). При равных значениях сохраняется порядок
 * `droppableContainers`.
 */
export const closestCorners: CollisionDetection = ({
  collisionRect,
  droppableContainers,
  droppableRects,
}: CollisionArgs): Collision[] => {
  const ranked: RankedCollision[] = [];

  for (const container of droppableContainers) {
    if (!isMeasured(container, droppableRects)) {
      continue;
    }

    const rect = droppableRects.get(container.id);

    if (!rect) {
      continue;
    }

    ranked.push({
      collision: toCollision(container),
      score: averageCornerDistance(collisionRect, rect),
    });
  }

  return resolveCollisions(ranked);
};

/**
 * Контейнеры, в прямоугольник которых попадает указатель.
 *
 * Без координат указателя возвращает пустой массив. Границы включены.
 * Контейнеры упорядочены по среднему расстоянию от указателя до их углов
 * (как в классическом `@dnd-kit/core`); при равенстве сохраняется порядок
 * `droppableContainers`.
 */
export const pointerWithin: CollisionDetection = ({
  droppableContainers,
  droppableRects,
  pointerCoordinates,
}: CollisionArgs): Collision[] => {
  if (!pointerCoordinates) {
    return [];
  }

  const ranked: RankedCollision[] = [];

  for (const container of droppableContainers) {
    if (!isMeasured(container, droppableRects)) {
      continue;
    }

    const rect = droppableRects.get(container.id);

    if (!rect || !isPointWithinRect(pointerCoordinates, rect)) {
      continue;
    }

    const corners = getCorners(rect);
    let distanceSum = 0;

    for (const corner of corners) {
      distanceSum += distanceBetween(pointerCoordinates, corner);
    }

    ranked.push({
      collision: toCollision(container),
      score: Number((distanceSum / corners.length).toFixed(4)),
    });
  }

  return resolveCollisions(ranked);
};

/**
 * Возвращает первую коллизию из списка.
 *
 * Если передан `id`, ищется коллизия именно с этим идентификатором.
 * Для пустого/отсутствующего списка возвращается `null`.
 */
export function getFirstCollision(
  collisions: readonly Collision[] | null | undefined,
  id?: UniqueIdentifier,
): Collision | null {
  if (!collisions || collisions.length === 0) {
    return null;
  }

  if (id === undefined) {
    return collisions[0] ?? null;
  }

  return collisions.find((collision) => collision.id === id) ?? null;
}
