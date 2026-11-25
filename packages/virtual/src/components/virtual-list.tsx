import type { Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import { Show, createMemo } from "@ivlev-dev/silent-core";
import type {
  Range,
  VirtualItem,
  VirtualKey,
} from "../core/types.js";
import {
  clientEffect,
  createVirtualizer,
  type MaybeAccessor,
} from "../adapter/create-virtualizer.js";
import { readEach, readProp, toKey } from "./props.js";
import { VirtualRows, type VirtualRowEntry } from "./rows.js";

type VirtualAttrs = Readonly<
  Record<string, string | number | boolean | null | undefined>
>;

/** Пропсы `VirtualList`. */
export interface VirtualListProps<T> {
  /** Исходные элементы: массив или аксессор массива. */
  readonly each: readonly T[] | (() => readonly T[]);
  /** Стабильный ключ элемента. */
  readonly keyOf: (item: T, index: number) => VirtualKey;
  /** Размер строки в пикселях или функция оценки по элементу и индексу. */
  readonly estimateSize: ((item: T, index: number) => number) | number;
  /** Запас рендера в строках с каждой стороны. */
  readonly overscan?: MaybeAccessor<number> | undefined;
  /** Горизонтальная прокрутка. */
  readonly horizontal?: MaybeAccessor<boolean> | undefined;
  /** Промежуток между строками. */
  readonly gap?: MaybeAccessor<number> | undefined;
  /** Отступ перед первой строкой. */
  readonly paddingStart?: MaybeAccessor<number> | undefined;
  /** Отступ после последней строки. */
  readonly paddingEnd?: MaybeAccessor<number> | undefined;
  /** Смещение списка внутри прокручиваемого контейнера. */
  readonly scrollMargin?: MaybeAccessor<number> | undefined;
  /** Начальное смещение для SSR-среза. */
  readonly initialOffset?: MaybeAccessor<number> | undefined;
  /** Начальный размер вьюпорта для SSR-среза. */
  readonly initialViewportSize?: MaybeAccessor<number> | undefined;
  /** Класс прокручиваемого контейнера. */
  readonly class?: ClassNameValue | undefined;
  /** Инлайн-стили прокручиваемого контейнера. */
  readonly style?: StyleInput;
  /** Дополнительные атрибуты прокручиваемого контейнера. */
  readonly attrs?: VirtualAttrs | undefined;
  /** Класс внутреннего spacer-элемента. */
  readonly containerClass?: ClassNameValue | undefined;
  /** Содержимое пустого списка. */
  readonly empty?: Children;
  /** Колбэк при изменении видимого диапазона. */
  readonly onRangeChange?: ((range: Range) => void) | undefined;
  /** Рендер строки: элемент, его индекс и виртуальная позиция. */
  readonly children: (
    item: T,
    index: number,
    virtualItem: VirtualItem,
  ) => Children;
}

function toVirtualItem<T>(entry: VirtualRowEntry<T>): VirtualItem {
  return {
    index: entry.index,
    key: entry.key,
    start: entry.start,
    end: entry.end,
    size: entry.size,
    lane: entry.lane,
  };
}

function rowStyle<T>(entry: VirtualRowEntry<T>): StyleInput {
  if (entry.horizontal) {
    return {
      position: "absolute",
      top: 0,
      left: 0,
      height: "100%",
      width: entry.size,
      transform: `translateX(${entry.start}px)`,
    };
  }
  return {
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: entry.size,
    transform: `translateY(${entry.start}px)`,
  };
}

/**
 * Вертикальный или горизонтальный виртуализированный список.
 *
 * Контейнер прокручивается (`overflow: auto`), внутри лежит spacer полной
 * высоты (или ширины) и абсолютно позиционированные строки. Строки получают
 * `data-index` и ref, поэтому `measureElement` измеряет их после монтирования.
 */
export function VirtualList<T>(props: VirtualListProps<T>): Node {
  let source: readonly T[] = [];

  const items = createMemo(() => {
    const value = readEach(props.each);
    source = value;
    return value;
  });

  const estimateAt = (index: number): number => {
    const estimate = props.estimateSize;
    if (typeof estimate === "number") {
      return estimate;
    }
    return estimate(source[index] as T, index);
  };

  const getItemKey = (index: number): VirtualKey =>
    toKey(props.keyOf(source[index] as T, index), index);

  // Собственный контроллер списка: `createVirtualizer` регистрирует
  // `onCleanup(dispose)` у владельца рендера, поэтому размонтирование снимает
  // scroll/ResizeObserver/rAF. Чужой контроллер компонент не создаёт и не
  // освобождает.
  const virtualizer = createVirtualizer({
    count: () => items().length,
    estimateSize: estimateAt,
    getItemKey,
    overscan: props.overscan,
    horizontal: props.horizontal,
    paddingStart: props.paddingStart,
    paddingEnd: props.paddingEnd,
    gap: props.gap,
    scrollMargin: props.scrollMargin,
    initialOffset: props.initialOffset,
    initialViewportSize: props.initialViewportSize,
  });

  const horizontalNow = (): boolean => readProp(props.horizontal, false);

  const entries = createMemo<VirtualRowEntry<T>[]>(() => {
    const list = items();
    const virtualItems = virtualizer.virtualItems();
    const horizontal = horizontalNow();
    const result: VirtualRowEntry<T>[] = [];
    for (const virtualItem of virtualItems) {
      const index = virtualItem.index;
      if (index < 0 || index >= list.length) {
        continue;
      }
      result.push({
        index,
        key: virtualItem.key,
        start: virtualItem.start,
        end: virtualItem.end,
        size: virtualItem.size,
        lane: virtualItem.lane,
        item: list[index] as T,
        horizontal,
      });
    }
    return result;
  });

  const spacerStyle = (): StyleInput => {
    const size = virtualizer.totalSize();
    if (horizontalNow()) {
      return {
        position: "relative",
        top: 0,
        left: 0,
        width: size,
        height: "100%",
        minWidth: 0,
      };
    }
    return {
      position: "relative",
      top: 0,
      left: 0,
      width: "100%",
      height: size,
      minHeight: 0,
    };
  };

  if (props.onRangeChange !== undefined) {
    let previous: Range | null = null;
    clientEffect(() => {
      const range = virtualizer.range();
      if (
        previous === null
        || previous.startIndex !== range.startIndex
        || previous.endIndex !== range.endIndex
        || previous.overscanStartIndex !== range.overscanStartIndex
        || previous.overscanEndIndex !== range.overscanEndIndex
        || previous.count !== range.count
      ) {
        previous = range;
        props.onRangeChange?.(range);
      }
    });
  }

  return (
    <div
      {...props.attrs}
      class={props.class}
      style={[{ overflow: "auto" }, props.style]}
      ref={virtualizer.setScrollElement}
      data-scrolling={virtualizer.isScrolling() ? "" : undefined}
    >
      <div class={props.containerClass} style={spacerStyle()}>
        <VirtualRows
          entries={entries}
          render={(entry) => (
            <div
              data-index={entry.index}
              ref={virtualizer.measureElement}
              style={rowStyle(entry)}
            >
              {props.children(
                entry.item,
                entry.index,
                toVirtualItem(entry),
              )}
            </div>
          )}
        />
      </div>
      <Show when={items().length === 0}>{props.empty}</Show>
    </div>
  );
}
