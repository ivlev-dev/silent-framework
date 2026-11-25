# DnD API

Пакет `@ivlev-dev/silent-dnd` — headless drag-and-drop для Silent Framework: контекст, хуки, сенсоры, коллизии, модификаторы, сортируемые стратегии и доступность для скринридеров. Пакет не рисует разметку сам: `DndContext` предоставляет состояние, хуки отдают пропсы для ваших элементов, а `DragOverlay` — единственный компонент-оверлей.

Статус: runtime-слой реализован — `DndContext`, `DragOverlay`, `SortableContext`, хуки, сенсоры и a11y-регионы. Публичный API — то, что экспортирует `packages/dnd/dist/index.d.ts`.

Доступность: пакет следует модели dnd-kit — клавиатурная сенсорика с координатами сортировки, объявления `defaultAnnouncements` и инструкции `defaultScreenReaderInstructions` для `aria-describedby`. Контекст не создаёт глобальных обработчиков на `document`, пока не смонтирован, поэтому серверный рендер безопасен: на сервере состояние — это «ничего не перетаскивается», а обработчики навешиваются после монтирования.

## Экспорты

Значения: `DndContext`, `DragOverlay`, `SortableContext`, `useDraggable`, `useDroppable`, `useSortable`, `useDndContext`, `useDndMonitor`, `useSensor`, `useSensors`, `PointerSensor`, `MouseSensor`, `TouchSensor`, `KeyboardSensor`, `defaultKeyboardCoordinateGetter`, `sortableKeyboardCoordinates`, `rectIntersection`, `closestCenter`, `closestCorners`, `pointerWithin`, `getFirstCollision`, `applyModifiers`, `restrictToVerticalAxis`, `restrictToHorizontalAxis`, `restrictToWindowEdges`, `restrictToParentElement`, `restrictToFirstScrollableAncestor`, `createSnapModifier`, `snapCenterToCursor`, `verticalListSortingStrategy`, `horizontalListSortingStrategy`, `rectSortingStrategy`, `rectSwappingStrategy`, `arrayMove`, `arraySwap`, `defaultAnimateLayoutChanges`, `defaultNewIndexGetter`, `hasSortableData`, `defaultAnnouncements`, `defaultScreenReaderInstructions`, `defaultDropAnimation`, `defaultDropAnimationSideEffects`, `defaultCoordinates`, `distanceBetween`, `getCenter`, `getClientRect`, `getScrollableAncestors`, `CSS`, `KeyboardCode`, `TraversalOrder`, `AutoScrollActivator`, `MeasuringStrategy`, `MeasuringFrequency`.

Типы: `DndContextProps`, `DndContextValue`, `DragOverlayProps`, `DragOverlaySideEffects`, `DragOverlaySource`, `DropAnimation`, `DropAnimationArgs`, `DropAnimationOption`, `DropAnimationSideEffects`, `DropAnimationSideEffectsArgs`, `DropAnimationSideEffectsOptions`, `SortableContextProps`, `SortableContextValue`, `UseDraggableArguments`, `UseDraggableReturn`, `DraggableAttributeValue`, `DraggableListeners`, `UseDroppableArguments`, `UseDroppableReturn`, `UseSortableArguments`, `UseSortableReturn`, `DndMonitorListener`, `DragStatus`, `PendingDrag`, `DragResult`, `AccessibilityOptions`, `Sensor`, `SensorDescriptor`, `SensorOptions`, `PointerSensorOptions`, `ActivationConstraint`, `DistanceActivationConstraint`, `DelayActivationConstraint`, `KeyboardSensorOptions`, `KeyboardCoordinateGetter`, `KeyboardCoordinateGetterArgs`, `KeyboardCoordinateGetterContext`, `CollisionDetection`, `CollisionArgs`, `Collision`, `Modifier`, `Modifiers`, `ModifierArgs`, `SortingStrategy`, `SortingStrategyArgs`, `MeasuringOptions`, `DroppableMeasuringOptions`, `MeasuringStrategyValue`, `MeasuringFrequencyValue`, `AutoScrollOptions`, `CancelDrop`, `CancelDropArgs`, `Announcements`, `ScreenReaderInstructions`, `Active`, `Over`, `DroppableContainer`, `UniqueIdentifier`, `Coordinates`, `ClientRect`, `Transform`, `DragStartEvent`, `DragMoveEvent`, `DragOverEvent`, `DragEndEvent`, `DragCancelEvent`, `DragPendingEvent`, `DragAbortEvent`, `DragEventBase`.

## Компоненты

### `DndContext`

Корневой провайдер состояния перетаскивания: хранит активный элемент, цель, коллизии, координаты и настройки, вызывает `onDragStart`/`onDragMove`/`onDragOver`/`onDragEnd`/`onDragCancel`/`onDragPending`/`onDragAbort` и передаёт события мониторам. Вложенные контексты независимы.

Принимает `id`, `sensors`, `collisionDetection`, `modifiers`, `measuring`, `autoScroll`, `cancelDrop`, `accessibility` и `children`. Рендерит `role="status"`-регион объявлений и скрытые инструкции; на сервере регион пуст, глобальных слушателей нет.

### `DragOverlay`

Рендерит «летящую» копию перетаскиваемого элемента через `Portal` в `document.body` или `container`. Оверлей `position: fixed`, не перехватывает указатель (`pointer-events: none`) и скрыт от скринридеров (`aria-hidden="true"`). Содержимое задаётся детьми или функцией `(source) => Children`, где `source` — активный элемент.

Поддерживает `tag`, `disabled`, `dropAnimation`, `sideEffects`, `class`, `style`, `container`. На сервере содержимое оверлея не рендерится. Для корректной гидрации компонент оставляет в DOM обёртку `span` с `display: contents` (см. отличия от dnd-kit в README).

При завершении drag оверлей анимируется из прямоугольника активного элемента в прямоугольник `over`: смещение считается как разница `left`/`top`, длительность и `easing` берутся из `dropAnimation`. В браузере используется Web Animations API; если он недоступен (jsdom, старые движки), конечное состояние применяется сразу, а оверлей удаляется по таймеру. Завершение drag при этом не задерживается.

### `SortableContext`

Провайдер сортируемого набора: получает `items` (массив идентификаторов или аксессор), `strategy`, `disabled`, `id`, `containerId` и `children`. Порядок `items` — источник правды для стратегии; после `onDragEnd` приложение применяет `arrayMove` или `arraySwap`.

### `DndContextProps`

Пропсы `DndContext`: `id`, `sensors`, `collisionDetection`, `modifiers`, `measuring`, `autoScroll`, `cancelDrop`, `accessibility`, колбэки событий и `children`.

### `DndContextValue`

Значение контекста: аксессоры `active`, `over`, `collisions`, `activatorEvent`, `pending`, `status`, `activeTransform`, данные оверлея, список сенсоров и методы регистрации/управления. Используется хуками и сенсорами; получать его напрямую следует через `useDndContext`.

### `DragOverlayProps`

Пропсы `DragOverlay`: `children`, `tag`, `disabled`, `dropAnimation`, `sideEffects`, `class`, `style`, `container`.

### `DragOverlaySideEffects`

Настройки визуальных эффектов оверлея во время drag: `opacity` и `scale`.

### `DragOverlaySource`

Источник для функции-содержимого `DragOverlay`; алиас `Active` c идентификатором, данными и измеренным прямоугольником.

### `DropAnimation`

Параметры анимации снятия оверлея: `duration` в миллисекундах, `easing` и необязательные `sideEffects`, которые вызываются на старте и очищаются по завершении.

### `DropAnimationArgs`

Аргументы функции `DropAnimationOption`: `active` и `over`.

### `DropAnimationOption`

Варианты `dropAnimation`: объект `DropAnimation`, `null` (без анимации) или функция `(args: DropAnimationArgs) => DropAnimation | null`.

### `DropAnimationSideEffects`

Функция побочных эффектов drop-анимации: получает `DropAnimationSideEffectsArgs` и может вернуть функцию очистки, которая вызывается по завершении. Обычно создаётся через `defaultDropAnimationSideEffects`.

### `DropAnimationSideEffectsArgs`

Аргументы `DropAnimationSideEffects`: `active`, `activeNode` (узел активного элемента, может отсутствовать) и `dragOverlay` с узлом оверлея в форме `{ current }` и его прямоугольником.

### `DropAnimationSideEffectsOptions`

Опции `defaultDropAnimationSideEffects`: `styles.active` и `styles.dragOverlay` — наборы CSS-свойств, применяемые на время анимации и восстанавливаемые после.

### `defaultDropAnimation`

Эталонная конфигурация drop-анимации: `{ duration: 250, easing: "ease" }`. Используется `DragOverlay`, если `dropAnimation` не передан.

### `defaultDropAnimationSideEffects`

Фабрика `DropAnimationSideEffects`: принимает `{ styles: { active?, dragOverlay? } }`, применяет стили к узлам на старте и восстанавливает исходные значения в функции очистки. Ключи можно задавать в camelCase или kebab-case.

### `SortableContextProps`

Пропсы `SortableContext`: `items`, `strategy`, `disabled`, `id`, `containerId`, `children`.

### `SortableContextValue`

Значение контекста сортируемого набора: `id`, `containerId`, аксессоры `items`, `strategy`, `disabled`.

## Хуки

### `useDraggable`

Регистрирует draggable-узел и сенсоры, возвращает `attributes`, `listeners`, `setNodeRef`, `setActivatorNodeRef`, `transform()`, `isDragging()`, `active()`, `over()`, `activatorEvent()`, `node()` и `data()`. Регистрация выполняется в `clientEffect`, поэтому SSR не создаёт измерений и слушателей.

### `useDroppable`

Регистрирует droppable-узел и возвращает `setNodeRef`, `node()`, `rect()`, `isOver()`, `active()`, `over()` и `data()`.

### `useSortable`

Комбинирует `useDraggable` и `useDroppable` со стратегией из ближайшего `SortableContext`. Дополнительно отдаёт `index()`, `items()`, `newIndex()`, `isSorting()`, `wasDragging()`, `isOver()`, `transition()`, `rect()`, `setDroppableNodeRef` и `setDraggableNodeRef`.

### `useDndContext`

Возвращает текущий `DndContextValue`. Бросает понятную ошибку, если хук вызван вне `<DndContext>`.

### `useDndMonitor`

Подписывает объект с обработчиками `onDragStart`/`onDragMove`/`onDragOver`/`onDragEnd`/`onDragCancel`/`onDragPending`/`onDragAbort` на события текущего контекста. Подписка снимается при размонтировании.

### `useSensor`

Создаёт `SensorDescriptor` из сенсора и опций: `useSensor(PointerSensor, { activationConstraint: { distance: 8 } })`. Опции передаются сенсору без дополнительной валидации.

### `useSensors`

Собирает сенсоры в стабильный список для `DndContext.sensors`, сохраняя порядок. Контекст опрашивает сенсоры по очереди.

### `UseDraggableArguments`

Аргументы `useDraggable`: обязательный `id`, а также `data`, `disabled`, `attributes`, `listeners`.

### `UseDraggableReturn`

Результат `useDraggable`: `attributes`, `listeners`, `setNodeRef`, `setActivatorNodeRef`, `node`, `activatorNode`, `transform`, `isDragging`, `active`, `over`, `activatorEvent`, `data`.

### `DraggableAttributeValue`

Тип значения `attributes`: строка, число, boolean, `null`, `undefined` или аксессор такого значения.

### `DraggableListeners`

Стабильный объект слушателей для spread: `onPointerDown` и `onKeyDown`.

### `UseDroppableArguments`

Аргументы `useDroppable`: `id`, `data`, `disabled`.

### `UseDroppableReturn`

Результат `useDroppable`: `setNodeRef`, `node`, `rect`, `isOver`, `active`, `over`, `data`.

### `UseSortableArguments`

Аргументы `useSortable`: поля `UseDraggableArguments` плюс `strategy` и `transition`.

### `UseSortableReturn`

Результат `useSortable`: поля `UseDraggableReturn` плюс `rect`, `index`, `items`, `newIndex`, `isSorting`, `wasDragging`, `isOver`, `transition`, `setDroppableNodeRef`, `setDraggableNodeRef`.

### `DndMonitorListener`

Обработчики подписки `useDndMonitor`; все поля необязательные.

### `DragStatus`

Состояние жизненного цикла: `"idle"`, `"pending"` или `"dragging"`.

### `PendingDrag`

Ожидание активации: `id`, `initialCoordinates`, `activatorEvent`.

### `DragResult`

Результат последнего завершённого drag для drop-анимации: `active`, `over`, `cancelled`.

### `AccessibilityOptions`

Настройки доступности: `announcements`, `screenReaderInstructions`, `restoreFocus`, `ariaRoleDescription`.

## Сенсоры

### `PointerSensor`

Сенсор Pointer Events для мыши, пера и касаний. Поддерживает `activationConstraint` (`distance` или `delay`/`tolerance`), захват указателя, Escape и `pointercancel`. Для `pointerType === "touch"` по умолчанию использует `delay: 250` и `tolerance: 5`.

### `MouseSensor`

Сенсор только мыши: `mousedown`/`mousemove`/`mouseup`, без touch и pen.

### `TouchSensor`

Сенсор касаний: `touchstart`/`touchmove`/`touchend`/`touchcancel`. По умолчанию ждёт 250 мс с допуском 5 px, чтобы отличить drag от прокрутки.

### `KeyboardSensor`

Клавиатурный сенсор: Space/Enter запускают и завершают drag, стрелки и Home/End двигают элемент, Escape отменяет, Tab завершает. Поддерживает `coordinateGetter` и `preventActivation`.

### `KeyboardCode`

Enum кодов клавиш сенсора: `Space`, `Down`, `Right`, `Left`, `Up`, `Esc`, `Enter`, `Tab`, `Home`, `End`. Значения совпадают с `KeyboardEvent.code` для соответствующих клавиш.

### `defaultKeyboardCoordinateGetter`

Координаты по умолчанию: шаг 10 px, с Shift — 50 px.

### `sortableKeyboardCoordinates`

Координаты для сортируемого набора. Для стрелок учитывает `active`, `over`, `collisionRect`, `droppableRects` и `droppableContainers`: отбирает включённые цели в направлении стрелки, сортирует по расстоянию вдоль основной оси, затем поперечной, и возвращает центр ближайшего прямоугольника. Текущий `over` пропускается, если есть следующая цель. `Home`/`End` ведут к первому/последнему элементу (сверху-слева и снизу-справа). При равных расстояниях сохраняется порядок регистрации.

### `PointerSensorOptions`

Опции `PointerSensor`: `activationConstraint`.

### `ActivationConstraint`

Ограничение активации: `DistanceActivationConstraint` или `DelayActivationConstraint`.

### `DistanceActivationConstraint`

Ограничение по расстоянию: `distance` в пикселях.

### `DelayActivationConstraint`

Ограничение по времени: `delay` в миллисекундах и `tolerance` в пикселях.

### `KeyboardSensorOptions`

Опции `KeyboardSensor`: `coordinateGetter` и `preventActivation(event)`.

### `KeyboardCoordinateGetter`

Функция `(event, args) => Coordinates | void`, вычисляющая следующую позицию для клавиатурного сенсора.

### `KeyboardCoordinateGetterArgs`

Аргументы `KeyboardCoordinateGetter`: `active`, `currentCoordinates`, `context`.

### `KeyboardCoordinateGetterContext`

Контекст координатного геттера: активный элемент, текущие координаты, collision rect, прямоугольники и список droppable, `over`, `activeNodeRect`.

### `Sensor`

Объект сенсора: `name` и `attach(controller, node, options, activatorNode?)`, возвращающий функцию очистки.

### `SensorDescriptor`

Описание сенсора для `DndContext.sensors`: `sensor` и необязательные `options`.

### `SensorOptions`

Базовые опции сенсора: `Record<string, unknown>`.

## Определения коллизий

### `rectIntersection`

Стратегия по площади пересечения прямоугольников: возвращает цели, отсортированные по убыванию доли перекрытия.

### `closestCenter`

Стратегия по расстоянию между центрами активного элемента и целей; значение по умолчанию для `DndContext`.

### `closestCorners`

Стратегия по среднему расстоянию между соответствующими углами прямоугольников.

### `pointerWithin`

Стратегия по положению указателя: цель совпадает, только если курсор внутри её прямоугольника.

### `getFirstCollision`

Возвращает первую коллизию из списка или `null`; можно отфильтровать по `id`.

### `CollisionDetection`

Сигнатура стратегии коллизий: принимает `CollisionArgs` и возвращает отсортированный список `Collision`.

### `CollisionArgs`

Аргументы collision detection: `active`, `collisionRect`, `droppableRects`, `droppableContainers`, `pointerCoordinates`.

### `Collision`

Описание совпадения с целью: `id` и необязательные `data`.

## Модификаторы

### `applyModifiers`

Последовательно применяет `Modifiers` к transform слева направо.

### `restrictToVerticalAxis`

Обнуляет горизонтальную составляющую transform.

### `restrictToHorizontalAxis`

Обнуляет вертикальную составляющую transform.

### `restrictToWindowEdges`

Не даёт активному элементу выйти за границы окна.

### `restrictToParentElement`

Удерживает элемент в прямоугольнике родительского узла.

### `restrictToFirstScrollableAncestor`

Удерживает элемент в границах ближайшего прокручиваемого предка.

### `createSnapModifier`

Фабрика модификатора, привязывающего transform к сетке с заданным шагом.

### `snapCenterToCursor`

Совмещает центр перетаскиваемого элемента с курсором.

### `Modifier`

Функция-модификатор: получает `ModifierArgs` и возвращает новый `Transform`.

### `Modifiers`

Упорядоченный список `Modifier`.

### `ModifierArgs`

Аргументы модификатора: transform, прямоугольник активного элемента, activator event, active, over и опциональный контекст контейнера/скроллера/окна/указателя.

## Сортируемые стратегии

### `verticalListSortingStrategy`

Сдвигает соседей вертикального списка на высоту активного элемента с учётом промежутка.

### `horizontalListSortingStrategy`

Сдвигает соседей горизонтального списка на ширину активного элемента с учётом промежутка.

### `rectSortingStrategy`

Переставляет прямоугольники и возвращает смещение элемента в новую позицию.

### `rectSwappingStrategy`

Обменивает активный элемент и элемент под ним; остальные остаются на месте.

### `hasSortableData`

Проверяет, что у записи есть `data.current.sortable` формы dnd-kit (`containerId`, `index`, опционально `items`). Работает как type guard и не бросает на `null`/`undefined`.

### `defaultNewIndexGetter`

Эталонный геттер нового индекса sortable-элемента: возвращает позицию `id` после `arrayMove(items, activeIndex, overIndex)`.

### `defaultAnimateLayoutChanges`

Эталонное решение об анимации layout-изменений: `false` без `transition` или без фактического drag; `true` во время сортировки; после неё — только при смене индекса в том же контейнере и неизменном списке либо реальном перемещении элемента.

### `TraversalOrder`

Enum порядка обхода sortable-элементов: `BreadthFirst` (в ширину) и `DepthFirst` (в глубину).

### `SortingStrategy`

Сигнатура стратегии: получает `SortingStrategyArgs` и возвращает `Transform | null`.

### `SortingStrategyArgs`

Аргументы стратегии: `activeIndex`, `overIndex`, `index`, `rects`, `activeNodeRect`, `overRect`.

## Измерения, авто-скролл и отмена сброса

### `MeasuringStrategy`

Константа и одноимённый тип стратегии измерения droppable: `Always`, `BeforeDragging`, `WhileDragging`.

### `MeasuringFrequency`

Константа и одноимённый тип частоты измерений: `Optimized`, `Always`.

### `MeasuringStrategyValue`

Тип-алиас значения `MeasuringStrategy`, экспортируется наряду с одноимённой константой.

### `MeasuringFrequencyValue`

Тип-алиас значения `MeasuringFrequency`, экспортируется наряду с одноимённой константой.

### `MeasuringOptions`

Настройки измерения: `droppable` и `draggable` c `DroppableMeasuringOptions`.

### `DroppableMeasuringOptions`

Настройки измерения droppable: `strategy` и `frequency`.

### `AutoScrollActivator`

Константа и одноимённый тип активатора авто-скролла: `Pointer`, `Always`.

### `AutoScrollOptions`

Настройки авто-скролла: `enabled`, `activator`, `threshold`, `acceleration`.

### `CancelDrop`

Функция `(args: CancelDropArgs) => boolean`; возврат `true` превращает завершение в отмену.

### `CancelDropArgs`

Аргументы `cancelDrop`: `active`, `over`, `collisions`, `delta`, `activatorEvent`.

## Доступность

### `defaultAnnouncements`

Объявления по умолчанию для `aria-live`: старт, наведение на цель, завершение и отмена.

### `defaultScreenReaderInstructions`

Инструкции по умолчанию для `aria-describedby` перетаскиваемого элемента.

### `Announcements`

Интерфейс объявлений: `onDragStart`, `onDragMove`, `onDragOver`, `onDragEnd`, `onDragCancel`.

### `ScreenReaderInstructions`

Интерфейс инструкций: строка `draggable`.

## Геометрия и утилиты

### `arrayMove`

Иммутабельно перемещает элемент массива из одной позиции в другую.

### `arraySwap`

Иммутабельно меняет два элемента массива местами.

### `defaultCoordinates`

Замороженные координаты `{ x: 0, y: 0 }`.

### `distanceBetween`

Евклидово расстояние между двумя точками.

### `getCenter`

Центр прямоугольника.

### `getClientRect`

Нормализует прямоугольник к `ClientRect`, достраивая недостающие края и размеры.

### `getScrollableAncestors`

DOM-утилита: возвращает прокручиваемых предков узла (`overflow` = `auto`/`scroll`/`overlay`) от ближайшего к дальнему, включая сам узел, если он прокручивается, и `document.scrollingElement` последним. Дубли исключены; на сервере возвращается пустой массив. Проверяется только CSS-стиль, без фактических размеров прокрутки — как в dnd-kit.

### `CSS`

Утилиты сериализации CSS. `CSS.Transform.toString(transform)` возвращает `translate3d(xpx, ypx, 0) scaleX(...) scaleY(...)`, `CSS.Translate.toString(transform)` — только смещение, `CSS.Transition.toString({property, duration, easing, delay?})` — строку перехода вида `transform 250ms ease`. Для `null`/`undefined` возвращается `undefined`.

## Базовые типы

### `UniqueIdentifier`

Идентификатор элемента или цели: `string | number`.

### `Coordinates`

Пара `x`/`y`.

### `ClientRect`

Прямоугольник в координатах viewport: `top`, `left`, `right`, `bottom`, `width`, `height`.

### `Transform`

Аффинное преобразование: `x`, `y` и опциональные `scaleX`/`scaleY`.

### `Active`

Активный элемент: `id`, `data`, измеренный `rect` или `null`.

### `Over`

Элемент под активным: `id`, `data`, `rect`, `disabled`.

### `DroppableContainer`

Описание droppable-контейнера: `id`, `data`, `disabled`, `rect`.

### `DragEventBase`

Общие поля событий: `active`, `over`, `delta`, `collisions`, `activatorEvent`.

### `DragStartEvent`

Событие начала перетаскивания.

### `DragMoveEvent`

Событие перемещения активного элемента.

### `DragOverEvent`

Событие смены элемента под активным.

### `DragEndEvent`

Событие завершения перетаскивания.

### `DragCancelEvent`

Событие отмены перетаскивания.

### `DragPendingEvent`

Событие ожидания активации: дополнительно `id` и `initialCoordinates`.

### `DragAbortEvent`

Событие прерывания активации: дополнительно `id`.
