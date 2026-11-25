import type {
  Active,
  ClientRect,
  SortingStrategy,
  Transform,
  UniqueIdentifier,
} from "./types.js";

/** Длительность и кривая sortable-перехода. */
export interface SortableTransition {
  readonly duration: number;
  readonly easing: string;
}

/** Аргументы `AnimateLayoutChanges`. */
export interface AnimateLayoutChangesArgs {
  readonly active: Active | null;
  readonly containerId: UniqueIdentifier;
  readonly isDragging: boolean;
  readonly isSorting: boolean;
  readonly id: UniqueIdentifier;
  readonly index: number;
  readonly items: readonly UniqueIdentifier[];
  readonly previousItems: readonly UniqueIdentifier[];
  readonly previousContainerId: UniqueIdentifier;
  readonly newIndex: number;
  readonly transition: SortableTransition | null;
  readonly wasDragging: boolean;
}

/** Решает, анимировать ли изменение layout после сортировки. */
export type AnimateLayoutChanges = (args: AnimateLayoutChangesArgs) => boolean;

/** Аргументы `NewIndexGetter`. */
export interface NewIndexGetterArgs {
  readonly id: UniqueIdentifier;
  readonly items: readonly UniqueIdentifier[];
  readonly activeIndex: number;
  readonly overIndex: number;
}

/** Вычисляет индекс элемента после применения сортировки. */
export type NewIndexGetter = (args: NewIndexGetterArgs) => number;

/** Полезная нагрузка `data.current.sortable`, совместимая с dnd-kit. */
export interface SortableData {
  readonly containerId: UniqueIdentifier;
  readonly index: number;
  readonly items?: readonly UniqueIdentifier[];
}

/**
 * Нормализует индекс в диапазон `[0, length - 1]`.
 *
 * Отрицательные индексы считаются с конца, как в `Array#splice`.
 * Некорректные (нечисловые) индексы приводятся к `0`.
 */
function normalizeIndex(index: number, length: number): number {
  const integer = Number.isFinite(index) ? Math.trunc(index) : 0;
  const normalized = integer < 0 ? length + integer : integer;

  return Math.min(Math.max(normalized, 0), length - 1);
}

/**
 * Иммутабельно перемещает элемент массива.
 *
 * Возвращает новый массив; исходный не изменяется. Индексы нормализуются:
 * отрицательные значения считаются с конца, выход за границы ограничивается
 * допустимым диапазоном.
 */
export function arrayMove<T>(
  array: readonly T[],
  from: number,
  to: number,
): T[] {
  const length = array.length;

  if (length === 0) {
    return [];
  }

  const fromIndex = normalizeIndex(from, length);
  const toIndex = normalizeIndex(to, length);

  if (fromIndex === toIndex) {
    return array.slice();
  }

  const next = array.slice();
  const item = next[fromIndex] as T;
  next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);

  return next;
}

/**
 * Иммутабельно меняет два элемента массива местами.
 *
 * Индексы нормализуются так же, как в {@link arrayMove}.
 */
export function arraySwap<T>(array: readonly T[], i: number, j: number): T[] {
  const length = array.length;

  if (length === 0) {
    return [];
  }

  const first = normalizeIndex(i, length);
  const second = normalizeIndex(j, length);

  if (first === second) {
    return array.slice();
  }

  const next = array.slice();
  const item = next[first] as T;
  next[first] = next[second] as T;
  next[second] = item;

  return next;
}

interface SortableDataCarrier {
  readonly data?: {
    readonly current?: {
      readonly sortable?: SortableData | null;
    } | null;
  } | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Проверяет, что запись содержит валидный `data.current.sortable`.
 *
 * Форма совместима с dnd-kit: объект с `containerId` и числовым `index`
 * (опционально `items`). Используется для определения принадлежности droppable
 * к сортируемому набору.
 */
export function hasSortableData(
  entry: unknown,
): entry is SortableDataCarrier & {
  readonly data: {
    readonly current: {
      readonly sortable: SortableData;
    };
  };
} {
  if (!isRecord(entry) || !isRecord(entry["data"])) {
    return false;
  }

  const data = entry["data"];
  const current = data["current"];

  if (!isRecord(current) || !isRecord(current["sortable"])) {
    return false;
  }

  const sortable = current["sortable"];
  const containerId = sortable["containerId"];

  return (
    (typeof containerId === "string" || typeof containerId === "number")
    && typeof sortable["index"] === "number"
  );
}

/**
 * Эталонный геттер нового индекса: позиция `id` после `arrayMove`.
 *
 * Совпадает с поведением `defaultNewIndexGetter` из dnd-kit.
 */
export const defaultNewIndexGetter: NewIndexGetter = ({
  id,
  items,
  activeIndex,
  overIndex,
}) => arrayMove(items, activeIndex, overIndex).indexOf(id);

/**
 * Эталонное решение об анимации layout-изменений sortable-списка.
 *
 * Без `transition` или после drag без фактического перетаскивания анимация
 * не нужна; во время сортировки она включается, а после её окончания —
 * только если индекс изменился в пределах того же контейнера.
 */
export const defaultAnimateLayoutChanges: AnimateLayoutChanges = ({
  containerId,
  isSorting,
  wasDragging,
  index,
  items,
  newIndex,
  previousItems,
  previousContainerId,
  transition,
}) => {
  if (!transition || !wasDragging) {
    return false;
  }

  if (previousItems !== items && index === newIndex) {
    return false;
  }

  if (isSorting) {
    return true;
  }

  return newIndex !== index && containerId === previousContainerId;
};

function getVerticalItemGap(
  rects: readonly (ClientRect | null)[],
  index: number,
  activeIndex: number,
): number {
  const currentRect = rects[index];
  const previousRect = rects[index - 1];
  const nextRect = rects[index + 1];

  if (!currentRect || (!previousRect && !nextRect)) {
    return 0;
  }

  if (activeIndex < index) {
    return previousRect
      ? currentRect.top - previousRect.bottom
      : nextRect
        ? nextRect.top - currentRect.bottom
        : 0;
  }

  return nextRect
    ? nextRect.top - currentRect.bottom
    : previousRect
      ? currentRect.top - previousRect.bottom
      : 0;
}

function getHorizontalItemGap(
  rects: readonly (ClientRect | null)[],
  index: number,
  activeIndex: number,
): number {
  const currentRect = rects[index];
  const previousRect = rects[index - 1];
  const nextRect = rects[index + 1];

  if (!currentRect || (!previousRect && !nextRect)) {
    return 0;
  }

  if (activeIndex < index) {
    return previousRect
      ? currentRect.left - previousRect.right
      : nextRect
        ? nextRect.left - currentRect.right
        : 0;
  }

  return nextRect
    ? nextRect.left - currentRect.right
    : previousRect
      ? currentRect.left - previousRect.right
      : 0;
}

function resolveOverRect(
  rects: readonly (ClientRect | null)[],
  overIndex: number,
  overRect: ClientRect | null | undefined,
): ClientRect | null {
  return rects[overIndex] ?? overRect ?? null;
}

/**
 * Стратегия вертикального списка.
 *
 * Сдвигает элементы между `activeIndex` и `overIndex` на высоту активного
 * элемента с учётом промежутка между соседями.
 */
export const verticalListSortingStrategy: SortingStrategy = ({
  activeIndex,
  activeNodeRect: fallbackActiveRect,
  index,
  rects,
  overIndex,
  overRect,
}): Transform | null => {
  const activeNodeRect = rects[activeIndex] ?? fallbackActiveRect;

  if (!activeNodeRect) {
    return null;
  }

  if (index === activeIndex) {
    const overIndexRect = resolveOverRect(rects, overIndex, overRect);

    if (!overIndexRect) {
      return null;
    }

    return {
      x: 0,
      y:
        activeIndex < overIndex
          ? overIndexRect.bottom - activeNodeRect.bottom
          : overIndexRect.top - activeNodeRect.top,
    };
  }

  const itemGap = getVerticalItemGap(rects, index, activeIndex);

  if (index > activeIndex && index <= overIndex) {
    return {
      x: 0,
      y: -activeNodeRect.height - itemGap,
    };
  }

  if (index < activeIndex && index >= overIndex) {
    return {
      x: 0,
      y: activeNodeRect.height + itemGap,
    };
  }

  return { x: 0, y: 0 };
};

/**
 * Стратегия горизонтального списка.
 *
 * Сдвигает элементы между `activeIndex` и `overIndex` на ширину активного
 * элемента с учётом промежутка между соседями.
 */
export const horizontalListSortingStrategy: SortingStrategy = ({
  activeIndex,
  activeNodeRect: fallbackActiveRect,
  index,
  rects,
  overIndex,
  overRect,
}): Transform | null => {
  const activeNodeRect = rects[activeIndex] ?? fallbackActiveRect;

  if (!activeNodeRect) {
    return null;
  }

  if (index === activeIndex) {
    const overIndexRect = resolveOverRect(rects, overIndex, overRect);

    if (!overIndexRect) {
      return null;
    }

    return {
      x:
        activeIndex < overIndex
          ? overIndexRect.right - activeNodeRect.right
          : overIndexRect.left - activeNodeRect.left,
      y: 0,
    };
  }

  const itemGap = getHorizontalItemGap(rects, index, activeIndex);

  if (index > activeIndex && index <= overIndex) {
    return {
      x: -activeNodeRect.width - itemGap,
      y: 0,
    };
  }

  if (index < activeIndex && index >= overIndex) {
    return {
      x: activeNodeRect.width + itemGap,
      y: 0,
    };
  }

  return { x: 0, y: 0 };
};

/**
 * Стратегия для сетки/свободного расположения.
 *
 * Переставляет прямоугольники (как {@link arrayMove}) и возвращает смещение
 * элемента в новую позицию.
 */
export const rectSortingStrategy: SortingStrategy = ({
  activeIndex,
  activeNodeRect: fallbackActiveRect,
  index,
  rects,
  overIndex,
}): Transform | null => {
  const activeNodeRect = rects[activeIndex] ?? fallbackActiveRect;

  if (!activeNodeRect) {
    return null;
  }

  const newRects = arrayMove(rects, overIndex, activeIndex);
  const oldRect = rects[index];
  const newRect = newRects[index];

  if (!oldRect || !newRect) {
    return null;
  }

  return {
    x: newRect.left - oldRect.left,
    y: newRect.top - oldRect.top,
  };
};

/**
 * Стратегия обмена местами (swap) для сетки.
 *
 * Активный элемент и элемент под ним обмениваются позициями; остальные
 * элементы остаются на месте.
 */
export const rectSwappingStrategy: SortingStrategy = ({
  activeIndex,
  index,
  rects,
  overIndex,
}): Transform | null => {
  let oldRect: ClientRect | null | undefined;
  let newRect: ClientRect | null | undefined;

  if (index === activeIndex) {
    oldRect = rects[index];
    newRect = rects[overIndex];
  }

  if (index === overIndex) {
    oldRect = rects[index];
    newRect = rects[activeIndex];
  }

  if (!oldRect || !newRect) {
    return null;
  }

  return {
    x: newRect.left - oldRect.left,
    y: newRect.top - oldRect.top,
  };
};
