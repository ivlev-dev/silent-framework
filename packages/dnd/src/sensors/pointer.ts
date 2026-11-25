import type { Coordinates, UniqueIdentifier } from "../core/types.js";
import type {
  DndContextValue,
  Sensor,
  SensorOptions,
} from "../runtime/types.js";

/** Ограничение активации по расстоянию. */
export interface DistanceActivationConstraint {
  readonly distance?: number;
}

/** Ограничение активации по времени удержания. */
export interface DelayActivationConstraint {
  readonly delay?: number;
  readonly tolerance?: number;
}

export type ActivationConstraint =
  | DistanceActivationConstraint
  | DelayActivationConstraint;

export interface PointerSensorOptions extends SensorOptions {
  readonly activationConstraint?: ActivationConstraint;
}

type PointEvent = Event & {
  readonly clientX?: number;
  readonly clientY?: number;
  readonly pointerId?: number;
  readonly pointerType?: string;
  readonly isPrimary?: boolean;
  readonly button?: number;
};

interface TouchLike {
  readonly clientX: number;
  readonly clientY: number;
}

type TouchEventLike = Event & {
  readonly touches?: ArrayLike<TouchLike>;
  readonly changedTouches?: ArrayLike<TouchLike>;
};

export interface EventSensorConfig {
  readonly name: string;
  readonly downEvent: string;
  readonly moveEvent: string;
  readonly upEvent: string;
  readonly cancelEvent?: string;
  readonly pointOf: (event: Event) => Coordinates | null;
  readonly isPrimary: (event: Event) => boolean;
  readonly defaultConstraint: (event: Event) => ActivationConstraint | null;
  readonly preventScrollOnMove?: boolean;
}

const INTERACTIVE_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  "summary",
  "[contenteditable='true']",
  "[role='button']",
  "[role='link']",
  "[role='textbox']",
].join(",");

/** Интерактивный потомок не должен запускать drag с последующим click. */
function isInteractiveTarget(
  target: EventTarget | null,
  node: HTMLElement,
): boolean {
  if (!(target instanceof Element) || target === node) {
    return false;
  }
  const interactive = target.closest(INTERACTIVE_SELECTOR);
  return interactive !== null && interactive !== node;
}

function distance(a: Coordinates, b: Coordinates): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function tryCapture(node: HTMLElement, event: Event | null): void {
  if (event === null) {
    return;
  }
  const pointerId = (event as PointEvent).pointerId;
  if (typeof pointerId !== "number") {
    return;
  }
  const target = node as HTMLElement & {
    setPointerCapture?: (pointerId: number) => void;
  };
  if (typeof target.setPointerCapture !== "function") {
    return;
  }
  try {
    target.setPointerCapture(pointerId);
  } catch {
    // jsdom и синтетические события могут не поддерживать capture.
  }
}

function releaseCapture(node: HTMLElement, event: Event | null): void {
  if (event === null) {
    return;
  }
  const pointerId = (event as PointEvent).pointerId;
  if (typeof pointerId !== "number") {
    return;
  }
  const target = node as HTMLElement & {
    releasePointerCapture?: (pointerId: number) => void;
  };
  if (typeof target.releasePointerCapture !== "function") {
    return;
  }
  try {
    target.releasePointerCapture(pointerId);
  } catch {
    // См. tryCapture.
  }
}

/**
 * Общая реализация сенсоров на событиях указателя/мыши/касаний.
 *
 * Держит только замыкание одного `attach`: глобальные слушатели появляются
 * после `down` и гарантированно снимаются в `cleanup`.
 */
export function createEventSensor(config: EventSensorConfig): Sensor {
  return {
    name: config.name,
    attach(
      controller: DndContextValue,
      node: HTMLElement,
      options: SensorOptions,
      activatorNode?: HTMLElement | null,
    ): () => void {
      const target = activatorNode ?? node;
      const sensorOptions = options as PointerSensorOptions;
      const draggableId: UniqueIdentifier | null =
        controller.getDraggableIdByNode(node);
      if (draggableId === null) {
        return () => {};
      }

      let disposeDocument: (() => void) | null = null;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let downPoint: Coordinates | null = null;
      let downEvent: Event | null = null;
      let armed = false;
      let dragging = false;
      let completed = false;
      let pendingDistance = 0;
      let pendingTolerance = 5;

      const clearTimer = (): void => {
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
      };

      const removeDocumentListeners = (): void => {
        if (disposeDocument !== null) {
          disposeDocument();
          disposeDocument = null;
        }
      };

      const reset = (): void => {
        clearTimer();
        removeDocumentListeners();
        armed = false;
        dragging = false;
        downPoint = null;
        downEvent = null;
      };

      const start = (point: Coordinates, event: Event | null): void => {
        if (completed) {
          return;
        }
        clearTimer();
        armed = false;
        dragging = true;
        controller.startDrag(draggableId, downEvent ?? event, point);
        if (controller.status() !== "dragging") {
          reset();
          return;
        }
        tryCapture(node, downEvent ?? event);
      };

      const abortPending = (event: Event | null): void => {
        if (!armed) {
          return;
        }
        armed = false;
        clearTimer();
        controller.abortPending(event);
        removeDocumentListeners();
      };

      const complete = (event: Event): void => {
        releaseCapture(node, event);
        removeDocumentListeners();
        clearTimer();
        armed = false;
        dragging = false;
      };

      const handleMove = (event: Event): void => {
        const point = config.pointOf(event);
        if (point === null) {
          return;
        }
        if (dragging) {
          if (config.preventScrollOnMove === true && event.cancelable) {
            event.preventDefault();
          }
          controller.moveDrag(point, event);
          return;
        }
        if (!armed || downPoint === null) {
          return;
        }
        const moved = distance(point, downPoint);
        if (pendingDistance > 0) {
          if (moved >= pendingDistance) {
            start(downPoint, event);
            controller.moveDrag(point, event);
          }
          return;
        }
        if (moved > pendingTolerance) {
          abortPending(event);
        }
      };

      const handleUp = (event: Event): void => {
        if (dragging) {
          controller.endDrag(event);
          complete(event);
          return;
        }
        abortPending(event);
      };

      const handleCancel = (event: Event): void => {
        if (dragging) {
          controller.cancelDrag(event);
          complete(event);
          return;
        }
        abortPending(event);
      };

      const handleKeyDown = (event: KeyboardEvent): void => {
        if (event.key !== "Escape") {
          return;
        }
        if (dragging) {
          event.preventDefault();
          controller.cancelDrag(event);
          complete(event);
          return;
        }
        if (armed) {
          event.preventDefault();
          abortPending(event);
        }
      };

      const addDocumentListeners = (): void => {
        if (disposeDocument !== null) {
          return;
        }
        const move = (event: Event): void => handleMove(event);
        const up = (event: Event): void => handleUp(event);
        const cancel = (event: Event): void => handleCancel(event);
        const key = (event: Event): void => handleKeyDown(event as KeyboardEvent);
        document.addEventListener(config.moveEvent, move, { passive: false });
        document.addEventListener(config.upEvent, up);
        if (config.cancelEvent !== undefined) {
          document.addEventListener(config.cancelEvent, cancel);
        }
        document.addEventListener("keydown", key);
        disposeDocument = () => {
          document.removeEventListener(config.moveEvent, move);
          document.removeEventListener(config.upEvent, up);
          if (config.cancelEvent !== undefined) {
            document.removeEventListener(config.cancelEvent, cancel);
          }
          document.removeEventListener("keydown", key);
        };
      };

      const handleDown = (event: Event): void => {
        if (completed || controller.status() === "dragging") {
          return;
        }
        if (!controller.claimActivator(event)) {
          return;
        }
        if (!config.isPrimary(event)) {
          return;
        }
        if (isInteractiveTarget(event.target, node)) {
          return;
        }
        const point = config.pointOf(event);
        if (point === null) {
          return;
        }
        downPoint = point;
        downEvent = event;
        const explicit = sensorOptions.activationConstraint;
        const constraint = explicit ?? config.defaultConstraint(event);
        if (constraint === null) {
          addDocumentListeners();
          start(point, event);
          return;
        }
        controller.setPending(draggableId, event, point);
        addDocumentListeners();
        if ("delay" in constraint) {
          armed = true;
          pendingTolerance = constraint.tolerance ?? 5;
          const delay = constraint.delay ?? 0;
          if (delay <= 0) {
            start(point, event);
          } else {
            timer = setTimeout(() => {
              timer = null;
              if (armed && downPoint !== null) {
                start(downPoint, null);
              }
            }, delay);
          }
          return;
        }
        armed = true;
        pendingDistance = (constraint as DistanceActivationConstraint).distance ?? 0;
        if (pendingDistance <= 0) {
          start(point, event);
        }
      };

      const disposeActivator = controller.registerActivator(
        node,
        config.downEvent,
        handleDown,
      );
      target.addEventListener(config.downEvent, handleDown);

      return () => {
        completed = true;
        clearTimer();
        removeDocumentListeners();
        target.removeEventListener(config.downEvent, handleDown);
        disposeActivator();
        if (dragging && controller.active()?.id === draggableId) {
          controller.cancelDrag();
        }
        armed = false;
        dragging = false;
      };
    },
  };
}

function pointerPoint(event: Event): Coordinates | null {
  const source = event as PointEvent;
  if (typeof source.clientX !== "number" || typeof source.clientY !== "number") {
    return null;
  }
  return { x: source.clientX, y: source.clientY };
}

function pointerPrimary(event: Event): boolean {
  const source = event as PointEvent;
  return source.button === undefined || source.button === 0;
}

function touchPoint(event: Event): Coordinates | null {
  const source = event as TouchEventLike;
  const list = source.touches !== undefined && source.touches.length > 0
    ? source.touches
    : source.changedTouches;
  const touch = list?.[0];
  if (touch === undefined) {
    return null;
  }
  return { x: touch.clientX, y: touch.clientY };
}

function touchPrimary(event: Event): boolean {
  const source = event as TouchEventLike;
  return source.touches === undefined || source.touches.length === 0
    ? (source.changedTouches?.length ?? 0) > 0
    : source.touches.length === 1;
}

/** Сенсор Pointer Events: мышь, перо и касания через единый путь. */
export const PointerSensor: Sensor = createEventSensor({
  name: "PointerSensor",
  downEvent: "pointerdown",
  moveEvent: "pointermove",
  upEvent: "pointerup",
  cancelEvent: "pointercancel",
  pointOf: pointerPoint,
  isPrimary: pointerPrimary,
  defaultConstraint(event) {
    return (event as PointEvent).pointerType === "touch"
      ? { delay: 250, tolerance: 5 }
      : null;
  },
  preventScrollOnMove: true,
});

/** Сенсор только мыши: не реагирует на touch/pen. */
export const MouseSensor: Sensor = createEventSensor({
  name: "MouseSensor",
  downEvent: "mousedown",
  moveEvent: "mousemove",
  upEvent: "mouseup",
  pointOf: pointerPoint,
  isPrimary: pointerPrimary,
  defaultConstraint: () => null,
});

/** Сенсор касаний: удержание 250 мс с допуском 5 px по умолчанию. */
export const TouchSensor: Sensor = createEventSensor({
  name: "TouchSensor",
  downEvent: "touchstart",
  moveEvent: "touchmove",
  upEvent: "touchend",
  cancelEvent: "touchcancel",
  pointOf: touchPoint,
  isPrimary: touchPrimary,
  defaultConstraint: () => ({ delay: 250, tolerance: 5 }),
  preventScrollOnMove: true,
});
