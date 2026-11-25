import type { Accessor, Setter } from "@ivlev-dev/silent-reactivity";
import type { Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import type {
  Active,
  Announcements,
  ClientRect,
  Collision,
  CollisionDetection,
  Coordinates,
  Data,
  DragAbortEvent,
  DragCancelEvent,
  DragEndEvent,
  DragMoveEvent,
  DragOverEvent,
  DragPendingEvent,
  DragStartEvent,
  DroppableContainer,
  Modifiers,
  Over,
  ScreenReaderInstructions,
  SortingStrategy,
  Transform,
  UniqueIdentifier,
} from "../core/types.js";

/** Состояние жизненного цикла перетаскивания. */
export type DragStatus = "idle" | "pending" | "dragging";

/** Сенсор находится в режиме ожидания активации по `activationConstraint`. */
export interface PendingDrag {
  readonly id: UniqueIdentifier;
  readonly initialCoordinates: Coordinates | null;
  readonly activatorEvent: Event | null;
}

/** Результат последнего завершённого перетаскивания (для drop-анимации). */
export interface DragResult {
  readonly active: Active;
  readonly over: Over | null;
  readonly cancelled: boolean;
}

/** Аргументы `cancelDrop`: возврат `true` отменяет сброс. */
export interface CancelDropArgs {
  readonly active: Active;
  readonly over: Over | null;
  readonly collisions: Collision[] | null;
  readonly delta: Transform;
  readonly activatorEvent: Event | null;
}

export type CancelDrop = (args: CancelDropArgs) => boolean;

/** Базовые опции сенсора. */
export type SensorOptions = Record<string, unknown>;

/**
 * Сенсор: объект с именем и функцией установки DOM-обработчиков.
 *
 * `attach` возвращает функцию очистки; повторный вызов для того же узла
 * допустим и создаёт независимый набор обработчиков.
 */
export interface Sensor<T extends SensorOptions = SensorOptions> {
  readonly name: string;
  attach(
    controller: DndContextValue,
    node: HTMLElement,
    options: T,
    activatorNode?: HTMLElement | null,
  ): () => void;
}

/** Описание сенсора для `DndContext.sensors`. */
export interface SensorDescriptor {
  readonly sensor: Sensor;
  readonly options?: SensorOptions;
}

/** Контекст для `KeyboardCoordinateGetter`. */
export interface KeyboardCoordinateGetterContext {
  readonly active: Active;
  readonly currentCoordinates: Coordinates;
  readonly collisionRect: ClientRect | null;
  readonly droppableRects: ReadonlyMap<UniqueIdentifier, ClientRect>;
  readonly droppableContainers: readonly DroppableContainer[];
  readonly over: Over | null;
  readonly activeNodeRect: ClientRect | null;
}

export interface KeyboardCoordinateGetterArgs {
  readonly active: Active;
  readonly currentCoordinates: Coordinates;
  readonly context: KeyboardCoordinateGetterContext;
}

/** Функция вычисления следующей позиции для клавиатурного сенсора. */
export type KeyboardCoordinateGetter = (
  event: KeyboardEvent,
  args: KeyboardCoordinateGetterArgs,
) => Coordinates | void;

/** Стратегия измерения droppable-контейнеров. */
export const MeasuringStrategy = {
  Always: "always",
  BeforeDragging: "beforeDragging",
  WhileDragging: "whileDragging",
} as const;

export type MeasuringStrategy =
  (typeof MeasuringStrategy)[keyof typeof MeasuringStrategy];

/** Частота повторных измерений при стратегии `Always`/`WhileDragging`. */
export const MeasuringFrequency = {
  Optimized: "optimized",
  Always: "always",
} as const;

export type MeasuringFrequency =
  (typeof MeasuringFrequency)[keyof typeof MeasuringFrequency];

export interface DroppableMeasuringOptions {
  readonly strategy?: MeasuringStrategy;
  readonly frequency?: MeasuringFrequency;
}

export interface MeasuringOptions {
  readonly droppable?: DroppableMeasuringOptions;
  readonly draggable?: DroppableMeasuringOptions;
}

/** Активатор автоскролла. */
export const AutoScrollActivator = {
  Pointer: "pointer",
  Always: "always",
} as const;

export type AutoScrollActivator =
  (typeof AutoScrollActivator)[keyof typeof AutoScrollActivator];

export interface AutoScrollOptions {
  readonly enabled?: boolean;
  readonly activator?: AutoScrollActivator;
  /** Доля меньшей стороны контейнера, считающаяся краевой зоной. */
  readonly threshold?: number;
  /** Максимальная скорость прокрутки в px за кадр. */
  readonly acceleration?: number;
}

/** Настройки доступности. */
export interface AccessibilityOptions {
  readonly announcements?: Partial<Announcements>;
  readonly screenReaderInstructions?: ScreenReaderInstructions;
  /** Возвращать фокус на активировавший элемент после drag. */
  readonly restoreFocus?: boolean;
  readonly ariaRoleDescription?: string;
}

/** Подписчик событий контекста. */
export interface DndMonitorListener {
  onDragStart?(event: DragStartEvent): void;
  onDragMove?(event: DragMoveEvent): void;
  onDragOver?(event: DragOverEvent): void;
  onDragEnd?(event: DragEndEvent): void;
  onDragCancel?(event: DragCancelEvent): void;
  onDragPending?(event: DragPendingEvent): void;
  onDragAbort?(event: DragAbortEvent): void;
}

/** Запись реестра draggable-узлов. */
export interface DraggableEntry {
  readonly id: UniqueIdentifier;
  readonly node: Accessor<HTMLElement | null>;
  readonly activatorNode: Accessor<HTMLElement | null>;
  readonly data: () => Data;
  readonly disabled: () => boolean;
  readonly setTransform: Setter<Transform | null>;
}

/** Запись реестра droppable-узлов. */
export interface DroppableEntry {
  readonly id: UniqueIdentifier;
  readonly node: Accessor<HTMLElement | null>;
  readonly data: () => Data;
  readonly disabled: () => boolean;
  readonly rect: Accessor<ClientRect | null>;
  readonly setRect: Setter<ClientRect | null>;
}

/** Запись реестра sortable-элементов. */
export interface SortableEntry {
  readonly id: UniqueIdentifier;
  readonly items: () => readonly UniqueIdentifier[];
  readonly strategy: () => SortingStrategy;
  readonly disabled: () => boolean;
  readonly setTransform: Setter<Transform | null>;
}

/** Значение контекста `DndContext`; также используется сенсорами. */
export interface DndContextValue {
  readonly id: string;
  readonly active: Accessor<Active | null>;
  readonly over: Accessor<Over | null>;
  readonly collisions: Accessor<Collision[] | null>;
  readonly activatorEvent: Accessor<Event | null>;
  readonly pending: Accessor<PendingDrag | null>;
  readonly status: Accessor<DragStatus>;
  readonly activeTransform: Accessor<Transform>;
  readonly announcement: Accessor<string>;
  readonly instructions: Accessor<ScreenReaderInstructions>;
  readonly ariaRoleDescription: Accessor<string>;
  readonly overlayVisible: Accessor<boolean>;
  readonly overlaySource: Accessor<Active | null>;
  readonly overlayTransform: Accessor<Transform>;
  readonly dragResult: Accessor<DragResult | null>;
  readonly sensors: Accessor<readonly SensorDescriptor[]>;
  readonly droppableContainers: Accessor<readonly DroppableContainer[]>;
  readonly droppableRects: Accessor<ReadonlyMap<UniqueIdentifier, ClientRect>>;
  readonly windowRect: Accessor<ClientRect | null>;

  registerDraggable(entry: DraggableEntry): () => void;
  registerDroppable(entry: DroppableEntry): () => void;
  registerSortable(entry: SortableEntry): () => void;
  registerMonitor(listener: DndMonitorListener): () => void;
  registerActivator(
    node: HTMLElement,
    eventType: string,
    handler: (event: Event) => void,
  ): () => void;
  dispatchActivator(
    id: UniqueIdentifier,
    eventType: string,
    event: Event,
  ): void;
  claimActivator(event: Event): boolean;
  getDraggableIdByNode(node: HTMLElement): UniqueIdentifier | null;
  getDraggableNode(id: UniqueIdentifier): HTMLElement | null;
  getDroppableRect(id: UniqueIdentifier): ClientRect | null;
  getActiveRect(): ClientRect | null;
  getPointerCoordinates(): Coordinates | null;

  startDrag(
    id: UniqueIdentifier,
    event: Event | null,
    coordinates?: Coordinates,
  ): void;
  moveDrag(coordinates: Coordinates, event?: Event): void;
  moveDragBy(delta: Coordinates, event?: Event): void;
  endDrag(event?: Event): void;
  cancelDrag(event?: Event): void;
  setPending(
    id: UniqueIdentifier,
    event: Event | null,
    coordinates: Coordinates | null,
  ): void;
  abortPending(event?: Event | null): void;
  clearPending(): void;

  hideOverlay(): void;
  dispose(): void;
}

/** Аргументы `useDraggable`. */
export interface UseDraggableArguments {
  readonly id: UniqueIdentifier;
  readonly data?: Data;
  readonly disabled?: boolean;
  readonly attributes?: Record<string, unknown>;
  readonly listeners?: Partial<DraggableListeners>;
}

export type DraggableAttributeValue =
  | string
  | number
  | boolean
  | undefined
  | null
  | (() => string | number | boolean | undefined | null);

export interface DraggableListeners {
  onPointerDown(event: Event): void;
  onKeyDown(event: Event): void;
}

export interface UseDraggableReturn {
  readonly attributes: Record<string, DraggableAttributeValue>;
  readonly listeners: DraggableListeners;
  readonly setNodeRef: (node: HTMLElement | null) => void;
  readonly setActivatorNodeRef: (node: HTMLElement | null) => void;
  readonly node: Accessor<HTMLElement | null>;
  readonly activatorNode: Accessor<HTMLElement | null>;
  readonly transform: Accessor<Transform | null>;
  readonly isDragging: Accessor<boolean>;
  readonly active: Accessor<Active | null>;
  readonly over: Accessor<Over | null>;
  readonly activatorEvent: Accessor<Event | null>;
  readonly data: Accessor<Data>;
}

/** Аргументы `useDroppable`. */
export interface UseDroppableArguments {
  readonly id: UniqueIdentifier;
  readonly data?: Data;
  readonly disabled?: boolean;
}

export interface UseDroppableReturn {
  readonly setNodeRef: (node: HTMLElement | null) => void;
  readonly node: Accessor<HTMLElement | null>;
  readonly rect: Accessor<ClientRect | null>;
  readonly isOver: Accessor<boolean>;
  readonly active: Accessor<Active | null>;
  readonly over: Accessor<Over | null>;
  readonly data: Accessor<Data>;
}

/** Аргументы `useSortable`. */
export interface UseSortableArguments extends UseDraggableArguments {
  readonly strategy?: SortingStrategy;
  readonly transition?: string | null;
}

export interface UseSortableReturn extends UseDraggableReturn {
  readonly rect: Accessor<ClientRect | null>;
  readonly index: Accessor<number>;
  readonly items: Accessor<readonly UniqueIdentifier[]>;
  readonly newIndex: Accessor<number>;
  readonly isSorting: Accessor<boolean>;
  readonly wasDragging: Accessor<boolean>;
  readonly isOver: Accessor<boolean>;
  readonly transition: Accessor<string | null>;
  readonly setDroppableNodeRef: (node: HTMLElement | null) => void;
  readonly setDraggableNodeRef: (node: HTMLElement | null) => void;
}

/** Значение `SortableContext`. */
export interface SortableContextValue {
  readonly id: UniqueIdentifier;
  readonly containerId: UniqueIdentifier | undefined;
  readonly items: () => readonly UniqueIdentifier[];
  readonly strategy: () => SortingStrategy;
  readonly disabled: () => boolean;
}

/** Настройки `DndContext`. */
export interface DndContextProps {
  readonly id?: string;
  readonly sensors?: readonly SensorDescriptor[];
  readonly collisionDetection?: CollisionDetection;
  readonly modifiers?: Modifiers;
  readonly measuring?: MeasuringOptions;
  readonly autoScroll?: boolean | AutoScrollOptions;
  readonly cancelDrop?: CancelDrop;
  readonly accessibility?: AccessibilityOptions;
  readonly onDragStart?: (event: DragStartEvent) => void;
  readonly onDragMove?: (event: DragMoveEvent) => void;
  readonly onDragOver?: (event: DragOverEvent) => void;
  readonly onDragEnd?: (event: DragEndEvent) => void;
  readonly onDragCancel?: (event: DragCancelEvent) => void;
  readonly onDragPending?: (event: DragPendingEvent) => void;
  readonly onDragAbort?: (event: DragAbortEvent) => void;
  readonly children?: Children;
}

/** Варианты drop-анимации оверлея. */
export interface DropAnimation {
  readonly duration?: number;
  readonly easing?: string;
  /** Побочные эффекты на время анимации; очищаются по её завершении. */
  readonly sideEffects?: DropAnimationSideEffects | null;
}

export interface DropAnimationArgs {
  readonly active: Active;
  readonly over: Over | null;
}

export type DropAnimationOption =
  | DropAnimation
  | null
  | ((args: DropAnimationArgs) => DropAnimation | null);

/** Ссылка на DOM-узел в форме `ref.current`. */
export interface DropAnimationSideEffectElement {
  readonly current: HTMLElement | null;
}

/** Аргументы функции `DropAnimationSideEffects`. */
export interface DropAnimationSideEffectsArgs {
  readonly active: Active;
  /** Узел активного элемента; может отсутствовать, если он уже удалён. */
  readonly activeNode?: HTMLElement | DropAnimationSideEffectElement | null;
  readonly dragOverlay: {
    readonly node: HTMLElement | DropAnimationSideEffectElement | null;
    readonly rect?: ClientRect | null;
  };
}

/**
 * Побочные эффекты drop-анимации.
 *
 * Вызывается один раз на старте анимации. Возвращённая функция очистки
 * вызывается по завершении анимации (или при её отмене); она необязательна.
 */
export type DropAnimationSideEffects = (
  args: DropAnimationSideEffectsArgs,
) => void | (() => void);

/** Опции фабрики `defaultDropAnimationSideEffects`. */
export interface DropAnimationSideEffectsOptions {
  readonly styles?: {
    readonly active?: Readonly<Record<string, string>>;
    readonly dragOverlay?: Readonly<Record<string, string>>;
  };
}

export interface DragOverlaySideEffects {
  readonly opacity?: string | number;
  readonly scale?: string | number;
}

export type DragOverlaySource = Active;

export interface DragOverlayProps {
  readonly children?: Children | ((source: DragOverlaySource) => Children);
  readonly tag?: string;
  readonly disabled?: boolean;
  readonly dropAnimation?: DropAnimationOption;
  readonly sideEffects?: DragOverlaySideEffects;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly container?: Element | string | (() => Element | null);
}

/** Настройки `SortableContext`. */
export interface SortableContextProps {
  readonly items: readonly UniqueIdentifier[] | (() => readonly UniqueIdentifier[]);
  readonly strategy?: SortingStrategy;
  readonly disabled?: boolean;
  readonly id?: UniqueIdentifier;
  readonly containerId?: UniqueIdentifier;
  readonly children?: Children;
}
