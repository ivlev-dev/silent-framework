# @ivlev-dev/silent-dnd

Headless drag-and-drop для Silent Framework: контекст перетаскивания, сенсоры, стратегии коллизий, модификаторы, сортируемые списки и доступность для скринридеров. Разметку и стили задаёт приложение — пакет отдаёт состояние и пропсы.

[![npm version](https://img.shields.io/npm/v/@ivlev-dev/silent-dnd)](https://www.npmjs.com/package/@ivlev-dev/silent-dnd) [![license](https://img.shields.io/npm/l/@ivlev-dev/silent-dnd)](https://github.com/ivlev-dev/silent-framework/blob/main/LICENSE) [![node](https://img.shields.io/node/v/@ivlev-dev/silent-dnd)](https://www.npmjs.com/package/@ivlev-dev/silent-dnd)

## Возможности

- `DndContext`, `DragOverlay`, `SortableContext` — состояние drag, слой «летящей» копии и сортируемые наборы.
- Хуки `useDraggable`, `useDroppable`, `useSortable`, `useDndContext`, `useDndMonitor`, `useSensor`, `useSensors`.
- Сенсоры `PointerSensor`, `MouseSensor`, `TouchSensor`, `KeyboardSensor` с `activationConstraint`, `coordinateGetter` и координатами сортировки.
- Коллизии: `rectIntersection`, `closestCenter`, `closestCorners`, `pointerWithin`, `getFirstCollision`.
- Модификаторы: ограничение по осям, границам окна/родителя/скроллера, привязка к сетке и центру курсора; `applyModifiers` как единая точка применения.
- Стратегии: `verticalListSortingStrategy`, `horizontalListSortingStrategy`, `rectSortingStrategy`, `rectSwappingStrategy`.
- Доступность: `defaultAnnouncements`, `defaultScreenReaderInstructions`, `aria-pressed`, `aria-roledescription`, live-region и возврат фокуса.
- Утилиты `arrayMove`, `arraySwap`, геометрия (`getClientRect`, `getCenter`, `distanceBetween`).

## Установка

```bash
pnpm add @ivlev-dev/silent-dnd
```

```bash
npm install @ivlev-dev/silent-dnd
```

```bash
yarn add @ivlev-dev/silent-dnd
```

`@ivlev-dev/silent-core` и `@ivlev-dev/silent-reactivity` объявлены peer-зависимостями с диапазоном `>=0.14.0 <0.15.0`; npm 7+ и pnpm устанавливают их автоматически. Пакет поставляется только как ESM. Требуется Node.js 22 или новее.

## Быстрый старт

Базовый drag-and-drop: `DndContext` держит состояние, `useDraggable`/`useDroppable` дают пропсы для узлов, `DragOverlay` рисует копию элемента.

```tsx
import { DndContext, DragOverlay, useDraggable, useDroppable } from "@ivlev-dev/silent-dnd";

function Card() {
  const draggable = useDraggable({ id: "card" });
  const cardStyle = () => {
    const transform = draggable.transform();
    return transform === null
      ? {}
      : { transform: `translate(${transform.x}px, ${transform.y}px)` };
  };

  return (
    <div
      ref={draggable.setNodeRef}
      {...draggable.attributes}
      {...draggable.listeners}
      style={cardStyle()}
    >
      Card
    </div>
  );
}

function Zone() {
  const droppable = useDroppable({ id: "zone" });
  return (
    <div ref={droppable.setNodeRef} data-over={() => String(droppable.isOver())}>
      Zone
    </div>
  );
}

let droppedOn: string | number | null = null;

export function Board() {
  return (
    <DndContext
      onDragEnd={(event) => {
        droppedOn = event.over?.id ?? null;
      }}
    >
      <Card />
      <Zone />
      <DragOverlay>
        <div>Card</div>
      </DragOverlay>
    </DndContext>
  );
}
```

Сортируемый список: `SortableContext` принимает массив идентификаторов или аксессор, а `useSortable` объединяет draggable и droppable.

```tsx
import { For, createSignal } from "@ivlev-dev/silent-core";
import {
  DndContext,
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@ivlev-dev/silent-dnd";

function Row(props: { readonly id: string }) {
  const sortable = useSortable({ id: props.id });
  const rowStyle = () => {
    const transform = sortable.transform();
    return transform === null
      ? { opacity: sortable.isDragging() ? "0.4" : "1" }
      : {
          transform: `translate(${transform.x}px, ${transform.y}px)`,
          transition: sortable.transition() ?? undefined,
        };
  };

  return (
    <li
      ref={sortable.setNodeRef}
      {...sortable.attributes}
      {...sortable.listeners}
      style={rowStyle()}
    >
      {props.id}
    </li>
  );
}

export function SortableList() {
  const [items, setItems] = createSignal(["a", "b", "c"]);

  return (
    <DndContext
      onDragEnd={(event) => {
        if (event.over === null) return;
        const from = items().indexOf(String(event.active.id));
        const to = items().indexOf(String(event.over.id));
        if (from !== -1 && to !== -1) {
          setItems((current) => arrayMove(current, from, to));
        }
      }}
    >
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        <ul>
          <For each={items}>{(id) => <Row id={id} />}</For>
        </ul>
      </SortableContext>
    </DndContext>
  );
}
```

## Обзор API

Компоненты:

- `DndContext` — провайдер состояния, сенсоров, коллизий, модификаторов, измерений, авто-скролла, `cancelDrop` и a11y.
- `DragOverlay` — портал с «летящей» копией активного элемента.
- `SortableContext` — провайдер порядка `items` и стратегии для `useSortable`.

Хуки:

- `useDraggable`, `useDroppable`, `useSortable` — регистрация узлов и пропсы для разметки.
- `useDndContext` — доступ к `DndContextValue`.
- `useDndMonitor` — подписка на события без участия в drag.
- `useSensor`, `useSensors` — сборка `SensorDescriptor[]` для `DndContext.sensors`.

Сенсоры:

- `PointerSensor`, `MouseSensor`, `TouchSensor`, `KeyboardSensor`.
- `defaultKeyboardCoordinateGetter`, `sortableKeyboardCoordinates`.
- `Sensor`, `SensorDescriptor`, `SensorOptions`, `PointerSensorOptions`, `KeyboardSensorOptions`, `ActivationConstraint`, `DistanceActivationConstraint`, `DelayActivationConstraint`, `KeyboardCoordinateGetter`.

Коллизии:

- `rectIntersection`, `closestCenter`, `closestCorners`, `pointerWithin`, `getFirstCollision`.
- `Collision`, `CollisionArgs`, `CollisionDetection`.

Модификаторы:

- `applyModifiers`, `restrictToVerticalAxis`, `restrictToHorizontalAxis`, `restrictToWindowEdges`, `restrictToParentElement`, `restrictToFirstScrollableAncestor`, `createSnapModifier`, `snapCenterToCursor`.
- `Modifier`, `Modifiers`, `ModifierArgs`.

Стратегии и утилиты:

- `verticalListSortingStrategy`, `horizontalListSortingStrategy`, `rectSortingStrategy`, `rectSwappingStrategy`.
- `SortingStrategy`, `SortingStrategyArgs`, `arrayMove`, `arraySwap`.
- `defaultCoordinates`, `distanceBetween`, `getCenter`, `getClientRect`.

Настройки:

- `MeasuringStrategy`, `MeasuringFrequency`, `MeasuringOptions`, `DroppableMeasuringOptions`.
- `AutoScrollActivator`, `AutoScrollOptions`.
- `AccessibilityOptions`, `CancelDrop`, `CancelDropArgs`.

Типы состояния и событий:

- `DndContextProps`, `DndContextValue`, `DragStatus`, `PendingDrag`, `DragResult`, `DndMonitorListener`.
- `UseDraggableArguments`, `UseDraggableReturn`, `DraggableAttributeValue`, `DraggableListeners`, `UseDroppableArguments`, `UseDroppableReturn`, `UseSortableArguments`, `UseSortableReturn`.
- `DragOverlayProps`, `DragOverlaySideEffects`, `DragOverlaySource`, `DropAnimation`, `DropAnimationArgs`, `DropAnimationOption`.
- `SortableContextProps`, `SortableContextValue`.
- `Active`, `Over`, `DroppableContainer`, `UniqueIdentifier`, `Coordinates`, `ClientRect`, `Transform`.
- `DragStartEvent`, `DragMoveEvent`, `DragOverEvent`, `DragEndEvent`, `DragCancelEvent`, `DragPendingEvent`, `DragAbortEvent`, `DragEventBase`.

Доступность:

- `defaultAnnouncements`, `defaultScreenReaderInstructions`, `Announcements`, `ScreenReaderInstructions`.

Полный справочник — [`docs/api/dnd.md`](../../docs/api/dnd.md).

## Отличия от React dnd-kit

- **Хуки возвращают аксессоры**, а не снимки: `transform()`, `isDragging()`, `over()`, `active()`, `index()`, `newIndex()` и т.д. Значения читаются в реактивном контексте Silent.
- **`attributes` — стабильный объект.** Часть ARIA (`aria-pressed`, `aria-disabled`, `aria-roledescription`) обновляется эффектом хука, потому что `spread` в Silent резолвит функции-значения один раз.
- **`DragOverlay` рендерит обёртку** `span[style="display: contents"]`: она нужна для корректной гидрации `Show`, визуально бокса не создаёт. Содержимое оверлея на сервере отсутствует.
- **`dropAnimation` не интерполирует оверлей в целевой rect:** соблюдаются `duration`/`easing`, оверлей скрывается по `opacity`/`scale`, затем удаляется.
- **`sortableKeyboardCoordinates` — упрощённая эвристика** по основной оси: выбирается ближайшая цель в направлении стрелки, без полной геометрии dnd-kit.
- **`wasDragging` — алиас `isDragging`:** отдельного состояния после drop нет.

## SSR

`DndContext` не навешивает глобальных обработчиков до монтирования, поэтому серверный рендер безопасен: сервер отдаёт разметку в состоянии «ничего не перетаскивается», а содержимое `DragOverlay` на сервере не рендерится. Клиентская и серверная разметка списка должны совпадать до гидрации — не меняйте порядок элементов по случайным или клиентским признакам.

## Доступность

- Клавиатурный сценарий: `KeyboardSensor` + `sortableKeyboardCoordinates`; пробел/Enter запускают и завершают перетаскивание, стрелки двигают, Escape отменяет, Tab завершает и передаёт фокус дальше.
- `defaultScreenReaderInstructions` вешаются на `aria-describedby` перетаскиваемого элемента, `defaultAnnouncements` — на `role="status"` live-region с `aria-live="assertive"`.
- `useDraggable` выставляет `role="button"`, `tabindex`, `aria-pressed`, `aria-disabled`, `aria-roledescription`; после завершения drag фокус возвращается на активировавший элемент (отключается через `accessibility.restoreFocus`).
- Источник перетаскивания должен быть фокусируемым элементом с корректной ролью; цель не должна быть интерактивной, если перетаскивание на неё не предусмотрено.
- Не полагайтесь только на цвет: состояние `isDragging()`/`isOver()` дублируйте текстом или иконкой.
- Уважайте `prefers-reduced-motion`: анимации `transform`/`transition` отключайте, если пользователь просил уменьшить движение.
