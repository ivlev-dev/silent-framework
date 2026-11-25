# Virtual API

Пакет `@ivlev-dev/silent-virtual` — виртуализация списков и сеток для Silent Framework. Ядро пакета (`VirtualizerCore`, `computeRange`, `computeServerSlice`) не создаёт DOM и не навешивает обработчиков: оно принимает размеры и смещение прокрутки, а возвращает видимые элементы. Адаптер (`createVirtualizer`, `VirtualList`, `VirtualGrid`) связывает это ядро с DOM через сигналы, `clientEffect`, `onCleanup` и ref-колбэки.

Пакет не зависит от UI-пакета и не поставляет CSS: позиционирование строк задаётся инлайн-стилями, а `class`, `style` и `attrs` нужны потребителю для собственного оформления. В SSR адаптер не обращается к `window`, `ResizeObserver` и не навешивает слушателей.

## Экспорты

Значения: `VirtualizerCore`, `computeRange`, `defaultRangeExtractor`, `computeServerSlice`, `defaultKey`, `createVirtualizer`, `VirtualList`, `VirtualGrid`.

Типы: `VirtualItem`, `VirtualizerOptions`, `Range`, `ScrollAlignment`, `LaneAssignmentMode`, `Virtualizer`, `CreateVirtualizerOptions`, `VirtualListProps`, `VirtualGridProps`.

## Ядро

### `VirtualizerCore`

Класс, который хранит измерения по ключу элемента и строит раскладку `start`/`end`/`size`/`lane` лениво и инкрементально. Экземпляр создаётся из `VirtualizerOptions`; методы `rangeFor`, `offsetForIndex`, `measureItem`, `totalSize` и `snapshot` не обращаются к DOM. Класс не мутирует переданные данные; обновление размеров и скролла выполняет вызывающий код.

`VirtualizerCore` — единственная точка, где применяются `ScrollAlignment` и `LaneAssignmentMode`; функции ниже используются им же и доступны отдельно для тестов и собственных раскладок.

### `computeRange`

Чистая функция: по смещению скролла, размеру вьюпорта и измерениям элементов вычисляет `Range` с учётом `overscan` и необязательного `rangeExtractor`. Отрицательное смещение и смещение за концом списка клампятся к границам контента, а не дают выход за массив.

### `defaultRangeExtractor`

Экстрактор диапазона по умолчанию: возвращает все индексы окна `overscanStartIndex..overscanEndIndex`. Может использоваться как база для собственной стратегии (например, «закрепить заголовок группы»).

### `computeServerSlice`

Детерминированный срез для SSR и пререндера: по количеству элементов, `estimateSize`, смещению и размеру вьюпорта возвращает видимые `VirtualItem`, полный размер и `Range` без обращения к браузерным API. Одинаковые входы дают одинаковый результат на сервере и на клиенте.

### `defaultKey`

Функция ключа по умолчанию: возвращает индекс элемента. Используется, когда `VirtualizerOptions` не задаёт `getItemKey`; для перемешиваемых и удаляемых списков задавайте ключ по доменному идентификатору.

## Адаптер

### `createVirtualizer`

Создаёт `Virtualizer`, привязанный к DOM через ref-колбэки. Опции принимают значения или аксессоры (`count: 5` или `count: () => items().length`), поэтому изменение сигналов пересчитывает раскладку.

Возвращает объект `Virtualizer`:

- `virtualItems()` — массив `VirtualItem` текущего окна вместе с overscan;
- `range()` — текущий `Range`;
- `totalSize()` — полный размер содержимого вдоль главной оси;
- `isScrolling()` — идёт ли прокрутка прямо сейчас;
- `setScrollElement(node)` — ref-колбэк прокручиваемого контейнера;
- `scrollToIndex(index, { align, behavior })`, `scrollToOffset(offset, { behavior })`, `scrollToEnd()` — программный скролл;
- `measureElement(node)` — ref-колбэк строки, измеряет узел с `data-index`;
- `getOffsetForIndex(index, align)` — координата прокрутки для индекса;
- `setOptions(patch)` — частичное обновление настроек;
- `snapshot()` и `restore(snapshot)` — сериализуемые измерения и позиция;
- `dispose()` — освобождение эффектов и слушателей вне компонента.

На клиенте `clientEffect` подписывается на `scroll` (passive) и `ResizeObserver`; при отсутствии `ResizeObserver` используется `window.resize`. События скролла троттлятся через `requestAnimationFrame`, а при отсутствии rAF обновление выполняется синхронно. `isScrolling` включается на scroll и выключается по таймауту `isScrollingResetDelay` (по умолчанию 150 мс); таймер и слушатели чистятся в `onCleanup`.

На сервере слушатели не создаются: `virtualItems()` возвращает детерминированный срез `computeServerSlice` по `initialOffset` и `initialViewportSize`. Клиент использует тот же срез до подключения контейнера, поэтому серверная разметка и первый клиентский рендер совпадают.

### `Virtualizer`

Интерфейс дескриптора, который возвращает `createVirtualizer`. Содержит методы чтения состояния, ref-колбэки, программный скролл, `setOptions`, `snapshot`/`restore` и `dispose`.

### `VirtualList`

Вертикальный (или горизонтальный при `horizontal`) виртуализированный список. Внешний контейнер прокручивается (`overflow: auto`), внутри лежит spacer полного размера и абсолютно позиционированные строки. Каждая строка получает `data-index`, `transform: translateY(...)` (или `translateX(...)`) и ref `measureElement`.

Пропсы: `each` (массив или аксессор), `keyOf`, `estimateSize` (число или функция), `overscan`, `horizontal`, `gap`, `paddingStart`, `paddingEnd`, `scrollMargin`, `initialOffset`, `initialViewportSize`, `class`, `style`, `attrs`, `containerClass`, `empty`, `onRangeChange` и `children(item, index, virtualItem)`.

`children` вызывается только с переданными аргументами: строки не читают сигналы, поэтому на каждую строку не создаётся лишний эффект. Пустой массив показывает `empty`; `onRangeChange` вызывается на клиенте при изменении диапазона.

### `VirtualGrid`

Виртуализированная сетка с фиксированным числом колонок. Виртуализируются строки: `count = ceil(each.length / columns)`, внутри строки ячейки раскладываются CSS grid. Строка получает `data-row` и `data-index`, ячейка — свой `data-index`. Masonry не поддерживается.

Пропсы: те же, что у `VirtualList`, но вместо `estimateSize`/`horizontal` используются `columns` и `estimateRowHeight`; `children(item, index, virtualItem)` получает позицию строки. `gap` задаёт и вертикальный промежуток между строками, и `column-gap` внутри строки.

### `CreateVirtualizerOptions`

Настройки `createVirtualizer`: `count`, `estimateSize`, `getItemKey`, `overscan`, `horizontal`, `paddingStart`, `paddingEnd`, `gap`, `scrollMargin`, `lanes`, `rangeExtractor`, `initialOffset`, `initialViewportSize`, `enabled`, `isScrollingResetDelay`. Числовые и булевы поля принимают значение или аксессор.

### `VirtualListProps`

Пропсы `VirtualList`: источник `each`, ключ `keyOf`, оценка `estimateSize`, параметры прокрутки и отступов, `class`/`style`/`attrs`/`containerClass`, `empty`, `onRangeChange` и рендер строки `children`.

### `VirtualGridProps`

Пропсы `VirtualGrid`: общие с `VirtualList` поля плюс `columns` и `estimateRowHeight`; `horizontal` и masonry-режим не поддерживаются.

## Типы ядра

### `VirtualItem`

Описание одного виртуального элемента: индекс в исходном списке, ключ, начало и конец по главной оси, размер и номер линии. Этот набор возвращают `VirtualizerCore`, `computeServerSlice` и `virtualItems()`.

### `VirtualizerOptions`

Параметры ядра: количество элементов, оценка размера, ключ, overscan, горизонтальность, отступы, `scrollMargin`, число линий, экстрактор диапазона и флаг `enabled`. Все поля читаются как значения; сигналы разыменовывает адаптер.

### `Range`

Диапазон индексов `[start, end]` включительно, а также окно с overscan. Пустой диапазон представляется канонической парой `startIndex = 0`, `endIndex = -1`.

### `ScrollAlignment`

Режим выравнивания при программном скролле к элементу: начало, центр, конец или ближайший край (`auto`). Влияет на вычисляемое смещение, но не на сам диапазон видимых элементов.

### `LaneAssignmentMode`

Режим распределения элементов по линиям в многоколоночной раскладке: `estimate` двигает курсор по оценке размера, `measured` учитывает только измеренные элементы.
