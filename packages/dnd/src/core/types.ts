/**
 * Публичный контракт ядра `@ivlev-dev/silent-dnd`.
 *
 * Модуль полностью независим от DOM: все структуры — plain-объекты,
 * поэтому ядро можно использовать в браузере, SSR и тестах без jsdom.
 */

/** Идентификатор draggable/droppable-элемента. */
export type UniqueIdentifier = string | number;

/** Точка в двумерной системе координат. */
export interface Coordinates {
  x: number;
  y: number;
}

/**
 * Прямоугольник в координатах viewport.
 *
 * `width`/`height` всегда положительны и согласованы с `right`/`bottom`.
 */
export interface ClientRect {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

/**
 * Аффинное преобразование перетаскиваемого элемента.
 *
 * `scaleX`/`scaleY` опциональны: если не заданы, масштаб считается равным `1`.
 */
export interface Transform {
  x: number;
  y: number;
  scaleX?: number;
  scaleY?: number;
}

/** Произвольные данные, прикреплённые к draggable/droppable-элементу. */
export type Data = Record<string, unknown>;

/** Результат работы collision detection: кандидат на «over»-элемент. */
export interface Collision {
  id: UniqueIdentifier;
  data?: Data;
}

/** Промежуточное описание коллизии с полным набором кандидатов. */
export interface CollisionDescriptor {
  collisions: Collision[];
  id: UniqueIdentifier;
}

/** Активный (перетаскиваемый) элемент. */
export interface Active {
  id: UniqueIdentifier;
  data: Data;
  /** Измеренный прямоугольник элемента; `null`, пока элемент не измерен. */
  rect: ClientRect | null;
}

/** Элемент, над которым находится активный элемент. */
export interface Over {
  id: UniqueIdentifier;
  data: Data;
  rect: ClientRect | null;
  disabled: boolean;
}

/** Описание draggable-узла без привязки к DOM. */
export interface DraggableNode {
  id: UniqueIdentifier;
  data?: Data;
  disabled?: boolean;
  rect?: ClientRect | null;
}

/** Описание droppable-контейнера без привязки к DOM. */
export interface DroppableContainer {
  id: UniqueIdentifier;
  data?: Data;
  disabled?: boolean;
  rect?: ClientRect | null;
}

/** Общие поля всех событий жизненного цикла drag&drop. */
export interface DragEventBase {
  active: Active;
  over: Over | null;
  delta: Transform;
  collisions: Collision[] | null;
  activatorEvent: Event | null;
}

/** Событие начала перетаскивания. */
export interface DragStartEvent extends DragEventBase {}

/** Событие перемещения активного элемента. */
export interface DragMoveEvent extends DragEventBase {}

/** Событие смены элемента под курсором. */
export interface DragOverEvent extends DragEventBase {}

/** Событие завершения перетаскивания. */
export interface DragEndEvent extends DragEventBase {}

/** Событие отмены перетаскивания. */
export interface DragCancelEvent extends DragEventBase {}

/** Событие ожидания активации (до старта drag). */
export interface DragPendingEvent extends DragEventBase {
  id: UniqueIdentifier;
  initialCoordinates: Coordinates | null;
}

/** Событие прерывания активации. */
export interface DragAbortEvent extends DragEventBase {
  id: UniqueIdentifier;
}

/**
 * Аргументы collision detection.
 *
 * `droppableRects` содержит уже измеренные прямоугольники контейнеров.
 * Контейнеры без записи в `droppableRects` игнорируются.
 */
export interface CollisionArgs {
  active: Active;
  collisionRect: ClientRect;
  droppableRects: Map<UniqueIdentifier, ClientRect>;
  droppableContainers: readonly DroppableContainer[];
  pointerCoordinates: Coordinates | null;
}

/** Чистая функция определения коллизий. */
export type CollisionDetection = (args: CollisionArgs) => Collision[];

/**
 * Аргументы модификатора.
 *
 * Контекст (`containerRect`, `scrollableAncestorRect`, `windowRect`,
 * `pointerCoordinates`) опционален: модификаторы обязаны корректно работать
 * и без него, возвращая исходный transform.
 */
export interface ModifierArgs {
  transform: Transform;
  draggingNodeRect: ClientRect | null;
  activatorEvent: Event | null;
  active: Active;
  over: Over | null;
  containerRect?: ClientRect;
  scrollableAncestorRect?: ClientRect;
  windowRect?: ClientRect;
  pointerCoordinates?: Coordinates;
}

/** Чистая функция-модификатор transform. */
export type Modifier = (args: ModifierArgs) => Transform;

/** Упорядоченный список модификаторов. */
export type Modifiers = Modifier[];

/** Аргументы стратегии сортировки sortable-списка. */
export interface SortingStrategyArgs {
  activeIndex: number;
  overIndex: number;
  index: number;
  rects: readonly (ClientRect | null)[];
  activeNodeRect: ClientRect | null;
  overRect?: ClientRect | null;
}

/**
 * Стратегия сортировки: вычисляет смещение элемента `index`.
 *
 * `null` означает, что элемент не должен смещаться (или данных недостаточно).
 */
export type SortingStrategy = (args: SortingStrategyArgs) => Transform | null;

/** Колбэки объявлений для screen reader. */
export interface Announcements {
  onDragStart(event: DragStartEvent): string | undefined;
  onDragMove?(event: DragMoveEvent): string | undefined;
  onDragOver?(event: DragOverEvent): string | undefined;
  onDragEnd?(event: DragEndEvent): string | undefined;
  onDragCancel?(event: DragCancelEvent): string | undefined;
}

/** Инструкции для screen reader до начала drag&drop. */
export interface ScreenReaderInstructions {
  draggable: string;
}
