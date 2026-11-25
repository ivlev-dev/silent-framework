# @ivlev-dev/silent-virtual

Виртуализация списков и сеток для Silent Framework. Пакет состоит из двух слоёв:

- чистое ядро — расчёт видимого диапазона, раскладка по линиям, измерения и детерминированный срез для SSR;
- runtime-адаптер — `createVirtualizer`, `VirtualList` и `VirtualGrid`, которые связывают ядро с DOM через сигналы, `clientEffect`, `onCleanup` и ref-колбэки.

Ядро не создаёт DOM и не навешивает обработчиков. Адаптер работает только на клиенте: на сервере он не подписывается на события и возвращает SSR-срез.

[![npm version](https://img.shields.io/npm/v/@ivlev-dev/silent-virtual)](https://www.npmjs.com/package/@ivlev-dev/silent-virtual) [![license](https://img.shields.io/npm/l/@ivlev-dev/silent-virtual)](https://github.com/ivlev-dev/silent-framework/blob/main/LICENSE) [![node](https://img.shields.io/node/v/@ivlev-dev/silent-virtual)](https://www.npmjs.com/package/@ivlev-dev/silent-virtual)

## Возможности

- `VirtualizerCore` — состояние виртуализации: измерения по ключу, текущий `Range`, `VirtualItem[]` и полный размер содержимого.
- `computeRange`, `defaultRangeExtractor` — видимый диапазон и overscan как отдельные чистые функции.
- `computeServerSlice` — детерминированный срез для SSR и пререндера без `window`, `ResizeObserver` и `IntersectionObserver`.
- `defaultKey` — ключ элемента по умолчанию.
- `createVirtualizer` — императивный дескриптор с прокруткой, измерением строк, `snapshot`/`restore` и очисткой эффектов.
- `VirtualList` — вертикальный или горизонтальный список с абсолютно позиционированными строками.
- `VirtualGrid` — сетка с фиксированным числом колонок; виртуализируются строки.
- Нет зависимости от UI-пакета и нет CSS: разметку и оформление задаёт приложение.

## Установка

```bash
pnpm add @ivlev-dev/silent-virtual
```

```bash
npm install @ivlev-dev/silent-virtual
```

```bash
yarn add @ivlev-dev/silent-virtual
```

`@ivlev-dev/silent-core` и `@ivlev-dev/silent-reactivity` объявлены peer-зависимостями с диапазоном `>=0.14.0 <0.15.0`; npm 7+ и pnpm устанавливают их автоматически. Пакет поставляется только как ESM. Требуется Node.js 22 или новее.

## Обзор API

Значения: `VirtualizerCore`, `computeRange`, `defaultRangeExtractor`, `computeServerSlice`, `defaultKey`, `createVirtualizer`, `VirtualList`, `VirtualGrid`.

Типы: `VirtualItem`, `VirtualizerOptions`, `Range`, `ScrollAlignment`, `LaneAssignmentMode`, `Virtualizer`, `CreateVirtualizerOptions`, `VirtualListProps`, `VirtualGridProps`.

Полный справочник — [`docs/api/virtual.md`](../../docs/api/virtual.md).

## VirtualList

```tsx
import { VirtualList } from "@ivlev-dev/silent-virtual";

interface Issue {
  readonly id: string;
  readonly title: string;
}

export function IssueList(props: { readonly issues: readonly Issue[] }): Node {
  return (
    <VirtualList
      each={props.issues}
      keyOf={(issue) => issue.id}
      estimateSize={48}
      overscan={6}
      initialViewportSize={600}
      style={{ height: 600 }}
    >
      {(issue) => <div>{issue.title}</div>}
    </VirtualList>
  );
}
```

`each` принимает массив или аксессор массива. `estimateSize` — число или функция `(item, index) => number`. Внешний контейнер прокручивается (`overflow: auto`), внутри лежит spacer полного размера, строки позиционируются через `transform` и получают `data-index`. Пустой список показывает `empty`; `onRangeChange` сообщает о смене диапазона на клиенте.

Строки не читают сигналы: `children(item, index, virtualItem)` получает только аргументы, поэтому на каждую строку не создаётся отдельный эффект.

## VirtualGrid

```tsx
import { VirtualGrid } from "@ivlev-dev/silent-virtual";

interface Card {
  readonly id: string;
  readonly title: string;
}

export function CardGrid(props: { readonly cards: readonly Card[] }): Node {
  return (
    <VirtualGrid
      each={props.cards}
      keyOf={(card) => card.id}
      columns={3}
      estimateRowHeight={120}
      gap={16}
      initialViewportSize={600}
      style={{ height: 600 }}
    >
      {(card) => <article>{card.title}</article>}
    </VirtualGrid>
  );
}
```

Виртуализируются строки: `count = ceil(each.length / columns)`. Ячейки раскладываются CSS grid внутри строки; строка получает `data-row` и `data-index`, ячейка — свой `data-index`.

## createVirtualizer

```ts
import { createVirtualizer } from "@ivlev-dev/silent-virtual";

const rows = ["Первый", "Второй", "Третий"];

const virtualizer = createVirtualizer({
  count: rows.length,
  estimateSize: () => 48,
  getItemKey: (index) => index,
  initialViewportSize: 600,
  overscan: 6,
});

const visible = virtualizer.virtualItems();
virtualizer.scrollToIndex(1, { align: "start" });
```

Дескриптор предоставляет `virtualItems()`, `range()`, `totalSize()`, `isScrolling()`, `setScrollElement(node)`, `scrollToIndex()`, `scrollToOffset()`, `scrollToEnd()`, `measureElement(node)`, `getOffsetForIndex()`, `setOptions()`, `snapshot()`/`restore()` и `dispose()`.

Опции принимают значения или аксессоры (`count: () => rows().length`), поэтому изменение сигналов пересчитывает раскладку. На клиенте scroll и `ResizeObserver` подключаются через `clientEffect`; при отсутствии `ResizeObserver` используется `window.resize`. События скролла троттлятся через `requestAnimationFrame`, а `isScrolling` сбрасывается по таймауту `isScrollingResetDelay` (по умолчанию 150 мс). Слушатели и таймер чистятся в `onCleanup`.

## Измерения

`VirtualList` и `VirtualGrid` сами вешают `measureElement` на строки. При использовании `createVirtualizer` напрямую ref-колбэк нужно повесить на узел строки с `data-index`:

```tsx
import { createVirtualizer } from "@ivlev-dev/silent-virtual";

export function VirtualRows(): Node {
  const virtualizer = createVirtualizer({
    count: 1000,
    estimateSize: () => 32,
    initialViewportSize: 600,
  });

  return (
    <div
      ref={virtualizer.setScrollElement}
      style={{ height: 600, overflow: "auto" }}
    >
      <div style={{ position: "relative", height: virtualizer.totalSize() }}>
        {virtualizer.virtualItems().map((item) => (
          <div
            data-index={item.index}
            ref={virtualizer.measureElement}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${item.start}px)`,
            }}
          >
            Строка {item.index}
          </div>
        ))}
      </div>
    </div>
  );
}
```

Измеренный размер кэшируется по ключу элемента; изменение размера перестраивает хвост раскладки. `snapshot()` и `restore()` переносят измерения и позицию прокрутки между экземплярами.

## SSR

`computeServerSlice` и SSR-путь адаптера не обращаются к браузерным API. Одинаковые входы дают одинаковый срез на сервере и в первом клиентском рендере. Чтобы серверная разметка совпала с клиентской до гидрации, передавайте `initialOffset` и `initialViewportSize` — те же значения на сервере и на клиенте.

Серверный HTML содержит только видимую часть списка; остальные элементы появляются после монтирования и измерения контейнера. При использовании `createVirtualizer` на сервере `virtualItems()` возвращает срез `computeServerSlice`, а `setScrollElement()` не навешивает слушателей.

## Ограничения

- Пакет не поставляет CSS. Позиционирование строк задаётся инлайн-стилями, а `class`, `style`, `attrs` и `containerClass` — для оформления потребителем.
- Горизонтальный режим `VirtualList` требует, чтобы потребитель задал высоту контейнера: пакет не выставляет её сам.
- SSR-срез `computeServerSlice` не учитывает `lanes`. Для `lanes > 1` серверный и первый клиентский срезы совпадают между собой, но отличаются от клиентской раскладки после монтирования.
- `VirtualGrid` поддерживает только вертикальную прокрутку и фиксированное число колонок; masonry не поддерживается.

## Доступность

Виртуализация скрывает часть элементов из DOM, поэтому:

- держите семантику списка (`ul`/`li` или `role="list"`/`role="listitem"`) на реальных элементах, а не на обёртке-скроллере;
- сообщайте общее количество через `aria-setsize`/`aria-posinset`, если элементы имеют `role="listitem"`;
- не полагайтесь на то, что нефокусированный элемент существует в DOM: при программном фокусе сначала прокручивайте к индексу, затем фокусируйте;
- для клавиатурной навигации обрабатывайте `Home`/`End`/`PageUp`/`PageDown` по полному списку, а не по текущему срезу.

## Ядро

- `VirtualizerCore` — измерения по ключу, ленивая инкрементальная раскладка, `rangeFor`, `offsetForIndex`, `totalSize`, `snapshot`/`restore`.
- `computeRange` — диапазон с overscan и пользовательским экстрактором.
- `defaultRangeExtractor` — все индексы окна `overscanStartIndex..overscanEndIndex`.
- `computeServerSlice` — видимые элементы, полный размер и `Range` без DOM.
- `defaultKey` — индекс элемента в качестве ключа.

Типы ядра: `VirtualItem`, `VirtualizerOptions`, `Range`, `ScrollAlignment`, `LaneAssignmentMode`.
