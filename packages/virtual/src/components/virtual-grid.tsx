import { Show, createMemo } from "@ivlev-dev/silent-core";
import type { Children, StyleInput } from "@ivlev-dev/silent-core";
import type { Range, VirtualItem, VirtualKey } from "../core/types.js";
import {
  clientEffect,
  createVirtualizer,
} from "../adapter/create-virtualizer.js";
import { readEach, readProp, toKey } from "./props.js";
import {
  GridCells,
  VirtualGridRows,
  type GridCell,
  type VirtualGridRowEntry,
} from "./rows.js";
import type { VirtualListProps } from "./virtual-list.js";

/** Пропсы `VirtualGrid`: виртуализируются строки, внутри рендерятся ячейки. */
export interface VirtualGridProps<T>
  extends Omit<VirtualListProps<T>, "estimateSize" | "horizontal" | "children"> {
  /** Число колонок; строка всегда содержит до `columns` ячеек. */
  readonly columns: number | (() => number);
  /** Высота строки в пикселях или функция оценки по номеру строки. */
  readonly estimateRowHeight: ((rowIndex: number) => number) | number;
  /** Рендер ячейки: элемент, его индекс и позиция строки. */
  readonly children: (
    item: T,
    index: number,
    virtualItem: VirtualItem,
  ) => Children;
}

function toRowVirtualItem<T>(row: VirtualGridRowEntry<T>): VirtualItem {
  return {
    index: row.index,
    key: row.key,
    start: row.start,
    end: row.end,
    size: row.size,
    lane: row.lane,
  };
}

function gridRowStyle<T>(row: VirtualGridRowEntry<T>): StyleInput {
  return {
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: row.size,
    display: "grid",
    gridTemplateColumns: `repeat(${row.columns}, minmax(0, 1fr))`,
    columnGap: row.gap,
    transform: `translateY(${row.start}px)`,
  };
}

/**
 * Виртуализированная сетка с фиксированным числом колонок.
 *
 * Виртуализация работает по строкам: `count = ceil(each.length / columns)`.
 * Строка позиционируется абсолютно, ячейки раскладываются CSS grid внутри
 * строки. Masonry не поддерживается.
 */
export function VirtualGrid<T>(props: VirtualGridProps<T>): Node {
  let source: readonly T[] = [];
  const cellsCache = new WeakMap<
    readonly T[],
    Map<string, readonly GridCell<T>[]>
  >();

  const items = createMemo(() => {
    const value = readEach(props.each);
    source = value;
    return value;
  });

  const columnCount = (): number => {
    const value = readProp(props.columns, 1);
    return Number.isFinite(value) && value >= 1 ? Math.floor(value) : 1;
  };

  const estimateRowAt = (rowIndex: number): number => {
    const estimate = props.estimateRowHeight;
    if (typeof estimate === "number") {
      return estimate;
    }
    return estimate(rowIndex);
  };

  const getItemKey = (rowIndex: number): VirtualKey => {
    const columns = columnCount();
    const startIndex = rowIndex * columns;
    if (startIndex < 0 || startIndex >= source.length) {
      return rowIndex;
    }
    return toKey(props.keyOf(source[startIndex] as T, startIndex), startIndex);
  };

  // Собственный контроллер сетки: жизненным циклом управляет owner рендера
  // через `onCleanup` внутри `createVirtualizer`; чужие контроллеры не
  // освобождаются.
  const virtualizer = createVirtualizer({
    count: () => {
      const columns = columnCount();
      return Math.ceil(items().length / columns);
    },
    estimateSize: estimateRowAt,
    getItemKey,
    overscan: props.overscan,
    paddingStart: props.paddingStart,
    paddingEnd: props.paddingEnd,
    gap: props.gap,
    scrollMargin: props.scrollMargin,
    initialOffset: props.initialOffset,
    initialViewportSize: props.initialViewportSize,
  });

  const rows = createMemo<VirtualGridRowEntry<T>[]>(() => {
    const list = items();
    const virtualRows = virtualizer.virtualItems();
    const columns = columnCount();
    const gap = readProp(props.gap, 0);
    let cache = cellsCache.get(list);
    if (cache === undefined) {
      cache = new Map();
      cellsCache.set(list, cache);
    }
    const result: VirtualGridRowEntry<T>[] = [];
    for (const virtualRow of virtualRows) {
      const startIndex = virtualRow.index * columns;
      if (startIndex < 0 || startIndex >= list.length) {
        continue;
      }
      const cacheKey = `${columns}:${virtualRow.index}`;
      let cells = cache.get(cacheKey);
      if (cells === undefined) {
        const end = Math.min(list.length, startIndex + columns);
        const built: GridCell<T>[] = [];
        for (let index = startIndex; index < end; index += 1) {
          const item = list[index] as T;
          built.push({
            index,
            key: toKey(props.keyOf(item, index), index),
            item,
          });
        }
        cells = built;
        cache.set(cacheKey, cells);
      }
      result.push({
        index: virtualRow.index,
        key: virtualRow.key,
        start: virtualRow.start,
        end: virtualRow.end,
        size: virtualRow.size,
        lane: virtualRow.lane,
        rowIndex: virtualRow.index,
        columns,
        gap,
        cells,
      });
    }
    return result;
  });

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
      <div
        class={props.containerClass}
        style={{
          position: "relative",
          top: 0,
          left: 0,
          width: "100%",
          height: virtualizer.totalSize(),
          minHeight: 0,
        }}
      >
        <VirtualGridRows
          rows={rows}
          render={(row) => (
            <div
              data-row={row.rowIndex}
              data-index={row.index}
              ref={virtualizer.measureElement}
              style={gridRowStyle(row)}
            >
              <GridCells
                cells={row.cells}
                render={(cell) => (
                  <div data-index={cell.index} style={{ minWidth: 0 }}>
                    {props.children(
                      cell.item,
                      cell.index,
                      toRowVirtualItem(row),
                    )}
                  </div>
                )}
              />
            </div>
          )}
        />
      </div>
      <Show when={items().length === 0}>{props.empty}</Show>
    </div>
  );
}
