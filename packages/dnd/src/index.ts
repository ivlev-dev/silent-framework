/**
 * `@ivlev-dev/silent-dnd` — headless drag&drop для Silent Framework.
 *
 * Ядро (коллизии, модификаторы, стратегии) не зависит от DOM. Runtime-слой
 * добавляет контекст, хуки, сенсоры, сортируемые списки и доступность.
 */

export {
  closestCenter,
  closestCorners,
  getFirstCollision,
  pointerWithin,
  rectIntersection,
} from "./core/collisions.js";

export {
  applyModifiers,
  createSnapModifier,
  restrictToFirstScrollableAncestor,
  restrictToHorizontalAxis,
  restrictToParentElement,
  restrictToVerticalAxis,
  restrictToWindowEdges,
  snapCenterToCursor,
} from "./core/modifiers.js";

export {
  arrayMove,
  arraySwap,
  defaultAnimateLayoutChanges,
  defaultNewIndexGetter,
  hasSortableData,
  horizontalListSortingStrategy,
  rectSortingStrategy,
  rectSwappingStrategy,
  verticalListSortingStrategy,
} from "./core/sortable.js";

export { CSS } from "./core/css.js";
export { KeyboardCode, TraversalOrder } from "./core/enums.js";

export {
  defaultCoordinates,
  distanceBetween,
  getCenter,
  getClientRect,
} from "./core/geometry.js";

export type {
  Active,
  Announcements,
  ClientRect,
  Collision,
  CollisionArgs,
  CollisionDetection,
  Coordinates,
  DragAbortEvent,
  DragCancelEvent,
  DragEndEvent,
  DragEventBase,
  DragMoveEvent,
  DragOverEvent,
  DragPendingEvent,
  DragStartEvent,
  DroppableContainer,
  Modifier,
  ModifierArgs,
  Modifiers,
  Over,
  ScreenReaderInstructions,
  SortingStrategy,
  SortingStrategyArgs,
  Transform,
  UniqueIdentifier,
} from "./core/types.js";

export {
  defaultAnnouncements,
  defaultScreenReaderInstructions,
} from "./a11y/defaults.js";

export {
  defaultDropAnimation,
  defaultDropAnimationSideEffects,
} from "./runtime/drop-animation.js";
export { getScrollableAncestors } from "./runtime/dom.js";

export { DndContext } from "./components/dnd-context.js";
export { DragOverlay } from "./components/drag-overlay.js";
export { SortableContext } from "./components/sortable-context.js";

export { useDndContext } from "./runtime/context.js";
export { useDraggable } from "./hooks/use-draggable.js";
export { useDroppable } from "./hooks/use-droppable.js";
export { useSortable } from "./hooks/use-sortable.js";
export { useDndMonitor } from "./hooks/use-monitor.js";
export { useSensor, useSensors } from "./hooks/use-sensor.js";

export {
  KeyboardSensor,
  defaultKeyboardCoordinateGetter,
  sortableKeyboardCoordinates,
} from "./sensors/keyboard.js";
export type { KeyboardSensorOptions } from "./sensors/keyboard.js";
export {
  MouseSensor,
  PointerSensor,
  TouchSensor,
} from "./sensors/pointer.js";
export type {
  ActivationConstraint,
  DelayActivationConstraint,
  DistanceActivationConstraint,
  PointerSensorOptions,
} from "./sensors/pointer.js";

export {
  AutoScrollActivator,
  MeasuringFrequency,
  MeasuringStrategy,
} from "./runtime/types.js";

export type {
  AccessibilityOptions,
  AutoScrollOptions,
  CancelDrop,
  CancelDropArgs,
  DndContextProps,
  DndContextValue,
  DndMonitorListener,
  DragOverlayProps,
  DragOverlaySideEffects,
  DragOverlaySource,
  DragResult,
  DragStatus,
  DraggableAttributeValue,
  DraggableListeners,
  DropAnimation,
  DropAnimationArgs,
  DropAnimationOption,
  DropAnimationSideEffects,
  DropAnimationSideEffectsArgs,
  DropAnimationSideEffectsOptions,
  DroppableMeasuringOptions,
  KeyboardCoordinateGetter,
  KeyboardCoordinateGetterArgs,
  KeyboardCoordinateGetterContext,
  MeasuringFrequency as MeasuringFrequencyValue,
  MeasuringOptions,
  MeasuringStrategy as MeasuringStrategyValue,
  PendingDrag,
  Sensor,
  SensorDescriptor,
  SensorOptions,
  SortableContextProps,
  SortableContextValue,
  UseDraggableArguments,
  UseDraggableReturn,
  UseDroppableArguments,
  UseDroppableReturn,
  UseSortableArguments,
  UseSortableReturn,
} from "./runtime/types.js";
