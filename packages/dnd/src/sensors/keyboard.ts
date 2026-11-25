import { applyTransform, getCenter } from "../core/geometry.js";
import { KeyboardCode } from "../core/enums.js";
import type {
  ClientRect,
  Coordinates,
  DroppableContainer,
  UniqueIdentifier,
} from "../core/types.js";
import type {
  DndContextValue,
  KeyboardCoordinateGetter,
  KeyboardCoordinateGetterContext,
  Sensor,
  SensorOptions,
} from "../runtime/types.js";

export interface KeyboardSensorOptions extends SensorOptions {
  readonly coordinateGetter?: KeyboardCoordinateGetter;
  /** Пользовательский фильтр: `true` запрещает активацию с клавиатуры. */
  readonly preventActivation?: (event: KeyboardEvent) => boolean;
}

const ARROW_KEYS = new Set<string>([
  KeyboardCode.Up,
  KeyboardCode.Down,
  KeyboardCode.Left,
  KeyboardCode.Right,
]);

const MOVEMENT_KEYS = new Set<string>([
  ...ARROW_KEYS,
  KeyboardCode.Home,
  KeyboardCode.End,
]);

const EDITABLE_SELECTOR = [
  "input",
  "textarea",
  "select",
  "[contenteditable='true']",
].join(",");

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(EDITABLE_SELECTOR) !== null;
}

function isActivationKey(key: string): boolean {
  return key === " " || key === "Spacebar" || key === "Enter";
}

function isEndKey(key: string): boolean {
  return key === " " || key === "Spacebar" || key === "Enter" || key === "Tab";
}

function arrowDelta(event: KeyboardEvent): Coordinates | null {
  const step = event.shiftKey ? 50 : 10;
  switch (event.key) {
    case "ArrowUp":
      return { x: 0, y: -step };
    case "ArrowDown":
      return { x: 0, y: step };
    case "ArrowLeft":
      return { x: -step, y: 0 };
    case "ArrowRight":
      return { x: step, y: 0 };
    default:
      return null;
  }
}

/** Координаты по умолчанию: шаг 10 px, с Shift — 50 px. */
export const defaultKeyboardCoordinateGetter: KeyboardCoordinateGetter = (
  event,
  { currentCoordinates },
) => {
  const delta = arrowDelta(event);
  if (delta === null) {
    return currentCoordinates;
  }
  return {
    x: currentCoordinates.x + delta.x,
    y: currentCoordinates.y + delta.y,
  };
};

interface MeasuredContainer {
  readonly container: DroppableContainer;
  readonly rect: ClientRect;
  readonly center: Coordinates;
}

interface DirectedCandidate {
  readonly target: MeasuredContainer;
  readonly primary: number;
  readonly secondary: number;
  readonly order: number;
}

const DIRECTIONS = [
  KeyboardCode.Up,
  KeyboardCode.Down,
  KeyboardCode.Left,
  KeyboardCode.Right,
] as const;

function matchesCode(event: KeyboardEvent, code: KeyboardCode): boolean {
  return event.key === code || event.code === code;
}

function resolveDirection(event: KeyboardEvent): KeyboardCode | null {
  for (const code of DIRECTIONS) {
    if (matchesCode(event, code)) {
      return code;
    }
  }
  return null;
}

function resolveEdge(event: KeyboardEvent): "home" | "end" | null {
  if (matchesCode(event, KeyboardCode.Home)) {
    return "home";
  }
  if (matchesCode(event, KeyboardCode.End)) {
    return "end";
  }
  return null;
}

function pointRect(point: Coordinates): ClientRect {
  return {
    top: point.y,
    left: point.x,
    right: point.x,
    bottom: point.y,
    width: 0,
    height: 0,
  };
}

function measuredContainers(
  context: KeyboardCoordinateGetterContext,
): MeasuredContainer[] {
  const result: MeasuredContainer[] = [];
  for (const container of context.droppableContainers) {
    if (container.disabled === true) {
      continue;
    }
    const rect = context.droppableRects.get(container.id);
    if (rect === undefined) {
      continue;
    }
    result.push({ container, rect, center: getCenter(rect) });
  }
  return result;
}

function isInDirection(
  direction: KeyboardCode,
  reference: ClientRect,
  rect: ClientRect,
): boolean {
  switch (direction) {
    case KeyboardCode.Down:
      return reference.top < rect.top;
    case KeyboardCode.Up:
      return reference.top > rect.top;
    case KeyboardCode.Left:
      return reference.left > rect.left;
    case KeyboardCode.Right:
      return reference.left < rect.left;
    default:
      return false;
  }
}

function findEdge(
  targets: readonly MeasuredContainer[],
  edge: "home" | "end",
): MeasuredContainer | null {
  let best: MeasuredContainer | null = null;
  for (const target of targets) {
    if (best === null) {
      best = target;
      continue;
    }
    const isBefore = edge === "home"
      ? target.rect.top < best.rect.top
        || (target.rect.top === best.rect.top && target.rect.left < best.rect.left)
      : target.rect.bottom > best.rect.bottom
        || (target.rect.bottom === best.rect.bottom && target.rect.right > best.rect.right);
    if (isBefore) {
      best = target;
    }
  }
  return best;
}

/**
 * Координаты для клавиатуры в сортируемом наборе.
 *
 * Для стрелок выбирается ближайший droppable в направлении движения: сначала
 * сравнивается расстояние по основной оси, затем по поперечной, а при полном
 * равенстве сохраняется порядок регистрации. Возвращается центр целевого
 * прямоугольника. `Home`/`End` ведут к первому/последнему элементу набора
 * (сверху-слева и снизу-справа соответственно).
 */
export const sortableKeyboardCoordinates: KeyboardCoordinateGetter = (
  event,
  { active, currentCoordinates, context },
) => {
  const direction = resolveDirection(event);
  const edge = direction === null ? resolveEdge(event) : null;

  if (direction === null && edge === null) {
    return undefined;
  }

  const targets = measuredContainers(context);
  if (targets.length === 0) {
    return undefined;
  }

  if (edge !== null) {
    const target = findEdge(targets, edge);
    return target === null
      ? undefined
      : { x: target.center.x, y: target.center.y };
  }

  const reference = context.collisionRect ?? pointRect(currentCoordinates);
  const referenceCenter = getCenter(reference);
  const vertical =
    direction === KeyboardCode.Up || direction === KeyboardCode.Down;

  const candidates: DirectedCandidate[] = [];
  for (const target of targets) {
    if (target.container.id === active.id) {
      continue;
    }
    if (!isInDirection(direction as KeyboardCode, reference, target.rect)) {
      continue;
    }
    candidates.push({
      target,
      primary: vertical
        ? Math.abs(target.center.y - referenceCenter.y)
        : Math.abs(target.center.x - referenceCenter.x),
      secondary: vertical
        ? Math.abs(target.center.x - referenceCenter.x)
        : Math.abs(target.center.y - referenceCenter.y),
      order: candidates.length,
    });
  }

  if (candidates.length === 0) {
    return undefined;
  }

  candidates.sort(
    (a, b) =>
      a.primary - b.primary
      || a.secondary - b.secondary
      || a.order - b.order,
  );

  let index = 0;
  if (
    candidates.length > 1
    && candidates[0]?.target.container.id === context.over?.id
  ) {
    index = 1;
  }

  const chosen = candidates[index]?.target;
  return chosen === undefined
    ? undefined
    : { x: chosen.center.x, y: chosen.center.y };
};

function getterContext(
  controller: DndContextValue,
  current: Coordinates,
): KeyboardCoordinateGetterContext | null {
  const active = controller.active();
  if (active === null) {
    return null;
  }
  return {
    active,
    currentCoordinates: current,
    collisionRect: active.rect === null
      ? null
      : applyTransform(active.rect, controller.activeTransform()),
    droppableRects: controller.droppableRects(),
    droppableContainers: controller.droppableContainers(),
    over: controller.over(),
    activeNodeRect: active.rect,
  };
}

/** Клавиатурный сенсор: Space/Enter, стрелки, Escape, Tab. */
export const KeyboardSensor: Sensor = {
  name: "KeyboardSensor",
  attach(
    controller: DndContextValue,
    node: HTMLElement,
    options: SensorOptions,
    activatorNode?: HTMLElement | null,
  ): () => void {
    const target = activatorNode ?? node;
    const sensorOptions = options as KeyboardSensorOptions;
    const draggableId: UniqueIdentifier | null = controller.getDraggableIdByNode(node);
    if (draggableId === null) {
      return () => {};
    }
    let dragging = false;
    let coordinates: Coordinates = { x: 0, y: 0 };
    let disposeDocument: (() => void) | null = null;
    let completed = false;

    const removeDocument = (): void => {
      if (disposeDocument !== null) {
        disposeDocument();
        disposeDocument = null;
      }
    };

    const currentCoordinates = (): Coordinates => {
      const active = controller.active();
      if (active?.rect === null || active === null) {
        return coordinates;
      }
      return {
        x: active.rect.left + active.rect.width / 2 + controller.activeTransform().x,
        y: active.rect.top + active.rect.height / 2 + controller.activeTransform().y,
      };
    };

    const move = (event: KeyboardEvent): void => {
      const active = controller.active();
      if (active === null) {
        return;
      }
      const current = currentCoordinates();
      coordinates = current;
      const getter = sensorOptions.coordinateGetter ?? defaultKeyboardCoordinateGetter;
      const context = getterContext(controller, current);
      if (context === null) {
        return;
      }
      const next = getter(event, { active, currentCoordinates: current, context });
      if (next === undefined) {
        return;
      }
      if (next.x === current.x && next.y === current.y) {
        return;
      }
      coordinates = next;
      controller.moveDrag(next, event);
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (completed || !controller.claimActivator(event)) {
        return;
      }
      if (dragging) {
        if (matchesCode(event, KeyboardCode.Esc)) {
          event.preventDefault();
          controller.cancelDrag(event);
          dragging = false;
          removeDocument();
          return;
        }
        if (isEndKey(event.key)) {
          if (event.key !== KeyboardCode.Tab) {
            event.preventDefault();
          }
          controller.endDrag(event);
          dragging = false;
          removeDocument();
          return;
        }
        if (MOVEMENT_KEYS.has(event.key) || MOVEMENT_KEYS.has(event.code)) {
          event.preventDefault();
          move(event);
        }
        return;
      }

      if (!isActivationKey(event.key)) {
        return;
      }
      if (sensorOptions.preventActivation?.(event) === true) {
        return;
      }
      if (isEditableTarget(event.target)) {
        return;
      }
      event.preventDefault();
      controller.startDrag(draggableId, event);
      if (controller.status() !== "dragging") {
        return;
      }
      dragging = true;
      coordinates = currentCoordinates();
      const key = (nested: Event): void => handleKeyDown(nested as KeyboardEvent);
      document.addEventListener("keydown", key);
      disposeDocument = () => {
        document.removeEventListener("keydown", key);
      };
    };

    const disposeActivator = controller.registerActivator(
      node,
      "keydown",
      (event) => handleKeyDown(event as KeyboardEvent),
    );
    target.addEventListener("keydown", handleKeyDown);

    return () => {
      completed = true;
      removeDocument();
      target.removeEventListener("keydown", handleKeyDown);
      disposeActivator();
      if (dragging && controller.active()?.id === draggableId) {
        controller.cancelDrag();
      }
      dragging = false;
    };
  },
};
