import { clamp, getCenter } from "./geometry.js";
import type {
  ClientRect,
  Modifier,
  ModifierArgs,
  Modifiers,
  Transform,
} from "./types.js";

function clampToRect(
  transform: Transform,
  draggingNodeRect: ClientRect,
  containerRect: ClientRect,
): Transform {
  return {
    ...transform,
    x: clamp(
      transform.x,
      containerRect.left - draggingNodeRect.left,
      containerRect.right - draggingNodeRect.right,
    ),
    y: clamp(
      transform.y,
      containerRect.top - draggingNodeRect.top,
      containerRect.bottom - draggingNodeRect.bottom,
    ),
  };
}

/**
 * Запрещает горизонтальное смещение: обнуляет `x`.
 */
export const restrictToVerticalAxis: Modifier = ({
  transform,
}: ModifierArgs): Transform => ({
  ...transform,
  x: 0,
});

/**
 * Запрещает вертикальное смещение: обнуляет `y`.
 */
export const restrictToHorizontalAxis: Modifier = ({
  transform,
}: ModifierArgs): Transform => ({
  ...transform,
  y: 0,
});

function applyWindowEdges(args: ModifierArgs): Transform {
  const { transform, draggingNodeRect, windowRect } = args;

  if (!draggingNodeRect || !windowRect) {
    return transform;
  }

  return clampToRect(transform, draggingNodeRect, windowRect);
}

/**
 * Не позволяет элементу выйти за границы окна.
 *
 * Поддерживает два способа использования:
 * - как обычный модификатор — `restrictToWindowEdges(args)`, если
 *   `windowRect` передан в {@link ModifierArgs};
 * - как фабрику — `restrictToWindowEdges({ windowRect })`, возвращающую
 *   модификатор с зафиксированным прямоугольником окна.
 *
 * Без `windowRect` возвращает transform без изменений.
 */
export function restrictToWindowEdges(args: ModifierArgs): Transform;
export function restrictToWindowEdges(context: {
  windowRect: ClientRect;
}): Modifier;
export function restrictToWindowEdges(
  argsOrContext: ModifierArgs | { windowRect: ClientRect },
): Transform | Modifier {
  if ("transform" in argsOrContext) {
    return applyWindowEdges(argsOrContext);
  }

  const { windowRect } = argsOrContext;

  return (args: ModifierArgs): Transform =>
    applyWindowEdges({ ...args, windowRect });
}

/**
 * Не позволяет элементу выйти за границы родительского контейнера.
 *
 * Контекст: `containerRect` — прямоугольник родителя,
 * `draggingNodeRect` — исходный прямоугольник перетаскиваемого элемента.
 */
export const restrictToParentElement: Modifier = ({
  transform,
  draggingNodeRect,
  containerRect,
}: ModifierArgs): Transform => {
  if (!draggingNodeRect || !containerRect) {
    return transform;
  }

  return clampToRect(transform, draggingNodeRect, containerRect);
};

/**
 * Не позволяет элементу выйти за границы первого scrollable-предка.
 *
 * Контекст: `scrollableAncestorRect` — прямоугольник ближайшего
 * прокручиваемого предка.
 */
export const restrictToFirstScrollableAncestor: Modifier = ({
  transform,
  draggingNodeRect,
  scrollableAncestorRect,
}: ModifierArgs): Transform => {
  if (!draggingNodeRect || !scrollableAncestorRect) {
    return transform;
  }

  return clampToRect(transform, draggingNodeRect, scrollableAncestorRect);
};

/**
 * Создаёт модификатор, привязывающий смещение к сетке.
 *
 * @param gridSize Размер ячейки сетки; должен быть положительным конечным числом.
 * @throws RangeError Если `gridSize` не является положительным конечным числом.
 */
export function createSnapModifier(gridSize: number): Modifier {
  if (!Number.isFinite(gridSize) || gridSize <= 0) {
    throw new RangeError("gridSize must be a positive finite number");
  }

  return ({ transform }: ModifierArgs): Transform => ({
    ...transform,
    x: Math.round(transform.x / gridSize) * gridSize,
    y: Math.round(transform.y / gridSize) * gridSize,
  });
}

/**
 * Центрирует перетаскиваемый элемент под указателем.
 *
 * Контекст: `pointerCoordinates` — текущая позиция указателя,
 * `draggingNodeRect` — исходный прямоугольник элемента.
 */
export const snapCenterToCursor: Modifier = ({
  transform,
  draggingNodeRect,
  pointerCoordinates,
}: ModifierArgs): Transform => {
  if (!draggingNodeRect || !pointerCoordinates) {
    return transform;
  }

  const center = getCenter(draggingNodeRect);

  return {
    ...transform,
    x: transform.x + pointerCoordinates.x - center.x,
    y: transform.y + pointerCoordinates.y - center.y,
  };
};

/**
 * Последовательно применяет модификаторы к transform.
 *
 * Каждый следующий модификатор получает transform, возвращённый предыдущим.
 * Пустой список возвращает исходный transform без создания копии.
 */
export function applyModifiers(
  modifiers: Modifiers | null | undefined,
  args: ModifierArgs,
): Transform {
  if (!modifiers || modifiers.length === 0) {
    return args.transform;
  }

  let transform = args.transform;

  for (const modifier of modifiers) {
    transform = modifier({ ...args, transform });
  }

  return transform;
}
