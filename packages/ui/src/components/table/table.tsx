import type { Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import {
  For,
  Show,
  createMemo,
  createSignal,
  onCleanup,
} from "@ivlev-dev/silent-core";
import { createVirtualizer } from "@ivlev-dev/silent-virtual";
import { clientEffect } from "../../internal/overlay.js";
import type { Attrs } from "../../internal/props.js";
import { resolveSlot } from "../../internal/slot.js";
import { ExpandMoreIcon } from "../../icons/expand-more.js";
import { InfoIcon } from "../../icons/info.js";
import { useUiConfig } from "../../theme/config.js";
import { EmptyState } from "../empty-state/empty-state.js";

export type TableAlign = "start" | "center" | "end";
export type TableSortDirection = "ascending" | "descending";

export interface TableColumn<Row> {
  /** Ключ колонки: он же ключ сортировки и ключ значения строки по умолчанию. */
  readonly key: string;
  readonly header: Children;
  readonly align?: TableAlign | undefined;
  /** CSS-ширина: число трактуется как `px`. */
  readonly width?: string | number | undefined;
  readonly sortable?: boolean | undefined;
  /** Одна строка с многоточием: длинные значения не раздувают колонку. */
  readonly truncate?: boolean | undefined;
  /** Обрезка по числу строк (1–3) вместо переноса на любое число строк. */
  readonly lines?: 1 | 2 | 3 | undefined;
  /** Ячейка строки. Без рендерера берётся `row[column.key]`. */
  readonly renderCell?: ((row: Row, rowIndex: number) => Children) | undefined;
}

export interface TableProps<Row> {
  readonly columns: readonly TableColumn<Row>[];
  readonly rows: readonly Row[];
  /** Стабильный ключ строки для `For`/SSR-гидрации. */
  readonly rowKey: (row: Row, index: number) => string | number;
  /** Управляемая сортировка: какой столбец отсортирован. */
  readonly sortKey?: string | undefined;
  readonly sortDirection?: TableSortDirection | undefined;
  /** Запрос сортировки; сами строки сортирует потребитель. */
  readonly onSort?:
    | ((key: string, direction: TableSortDirection) => void)
    | undefined;
  /**
   * Оконный рендер строк. Включён по умолчанию для любой непустой таблицы;
   * `false` — единственный способ отключить окно и отрендерить все строки.
   */
  readonly virtual?: boolean | undefined;
  /** Оценка высоты строки в пикселях; по умолчанию 49, для `dense` — 41. */
  readonly rowHeight?: number | undefined;
  /** Максимальная высота скролл-контейнера при виртуализации; по умолчанию 480. */
  readonly maxHeight?: number | undefined;
  /** Высота вьюпорта для детерминированного SSR-среза; по умолчанию 480. */
  readonly initialViewportSize?: number | undefined;
  readonly dense?: boolean | undefined;
  readonly stickyHeader?: boolean | undefined;
  readonly caption?: Children;
  /** Доступное имя, если `caption` нет. */
  readonly label?: string | undefined;
  /** Переопределяет пустое состояние таблицы. */
  readonly empty?: Children;
  readonly emptyTitle?: string | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
  readonly ref?: ((node: Element | null) => void) | undefined;
}

const DEFAULT_ROW_HEIGHT = 49;
const DENSE_ROW_HEIGHT = 41;
const DEFAULT_MAX_HEIGHT = 480;
const DEFAULT_INITIAL_VIEWPORT_SIZE = 480;
const VIRTUAL_OVERSCAN = 8;

/** Ключи spacer-строк не пересекаются с ключами данных. */
const SPACER_TOP_KEY = "\u0000sui-table-spacer-top";
const SPACER_BOTTOM_KEY = "\u0000sui-table-spacer-bottom";

function widthStyle(width: string | number | undefined): StyleInput {
  if (width === undefined) return undefined;
  return { width: typeof width === "number" ? `${width}px` : width };
}

function defaultCell<Row>(row: Row, key: string): Children {
  const value = (row as unknown as Record<string, unknown>)[key];
  if (value === undefined || value === null) return "";
  if (value instanceof Node) return value;
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
    return value;
  }
  if (typeof value === "boolean") return value;
  return String(value);
}

/** Полный текст обрезанной ячейки — в `title`, чтобы значение было доступно. */
function cellTitle<Row>(column: TableColumn<Row>, content: Children): string | undefined {
  if (column.truncate !== true && column.lines === undefined) return undefined;
  if (typeof content === "string") return content.trim() === "" ? undefined : content;
  if (typeof content === "number" || typeof content === "bigint") return String(content);
  return undefined;
}

function positive(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

interface TableRowListProps<Row> {
  readonly rows: readonly Row[];
  readonly columns: readonly TableColumn<Row>[];
  readonly rowKey: (row: Row, index: number) => string | number;
}

/**
 * Строки отдельным компонентом с `For` в корне: `For` внутри фрагмента или
 * как единственный ребёнок `<tbody>` теряет разметку в SSR.
 */
function TableRowList<Row>(props: TableRowListProps<Row>): Node {
  return (
    <For each={props.rows} keyOf={(row, index) => props.rowKey(row, index)}>
      {(row, index) => (
        <tr class="sui-table__row">
          {props.columns.map((column) => {
            const content = resolveSlot(
              column.renderCell !== undefined
                ? column.renderCell(row, index())
                : defaultCell(row, column.key),
            );
            return (
              <td
                class="sui-table__cell"
                data-align={column.align ?? "start"}
                data-truncate={column.truncate === true ? "" : undefined}
                data-lines={column.lines}
              >
                <span
                  class="sui-table__cell-content"
                  title={cellTitle(column, content)}
                >
                  {content}
                </span>
              </td>
            );
          })}
        </tr>
      )}
    </For>
  );
}

interface VirtualSpacerEntry {
  readonly kind: "spacer";
  readonly key: string;
  readonly edge: "top" | "bottom";
  readonly height: number;
}

interface VirtualRowEntry<Row> {
  readonly kind: "row";
  readonly key: string | number;
  readonly index: number;
  readonly row: Row;
}

type VirtualEntry<Row> = VirtualSpacerEntry | VirtualRowEntry<Row>;

interface VirtualTableRowsProps<Row> {
  readonly entries: () => readonly VirtualEntry<Row>[];
  readonly columns: readonly TableColumn<Row>[];
  readonly measure: (node: Element | null) => void;
}

/**
 * Оконные строки. `For` — корень компонента, поэтому SSR/hydration видят ту
 * же разметку, что и обычный список. Spacer-строки — обычные `<tr>` с
 * фиксированной высотой: таблица остаётся нативной, без absolute-позиций.
 */
function VirtualTableRows<Row>(props: VirtualTableRowsProps<Row>): Node {
  return (
    <For each={props.entries} keyOf={(entry) => entry.key}>
      {(entry) =>
        entry.kind === "spacer" ? (
          <tr
            class="sui-table__spacer-row"
            data-edge={entry.edge}
            aria-hidden="true"
            style={{ height: `${entry.height}px` }}
          >
            <td
              class="sui-table__spacer-cell"
              colspan={props.columns.length}
              style={{ height: `${entry.height}px` }}
            />
          </tr>
        ) : (
          <tr
            class="sui-table__row"
            data-index={entry.index}
            aria-rowindex={entry.index + 2}
            ref={props.measure}
          >
            {props.columns.map((column) => {
              const content = resolveSlot(
                column.renderCell !== undefined
                  ? column.renderCell(entry.row, entry.index)
                  : defaultCell(entry.row, column.key),
              );
              return (
                <td
                  class="sui-table__cell"
                  data-align={column.align ?? "start"}
                  data-truncate={column.truncate === true ? "" : undefined}
                  data-lines={column.lines}
                >
                  <span
                    class="sui-table__cell-content"
                    title={cellTitle(column, content)}
                  >
                    {content}
                  </span>
                </td>
              );
            })}
          </tr>
        )
      }
    </For>
  );
}

/**
 * Таблица: семантические `table/thead/tbody/th/td`, `scope="col"`,
 * `aria-sort` и управляемая сортировка через `onSort`. Строки не
 * сортируются внутри — это ответственность потребителя.
 *
 * Корень — `.sui-table-scroll`: на узких экранах он скроллит таблицу по
 * горизонтали, поэтому широкая таблица не ломает страницу. Сам `<table>`
 * сохраняет `class`/`style`/`attrs`/`ref` и остаётся семантической таблицей.
 *
 * При `virtual` корень становится ещё и вертикальным скролл-контейнером:
 * `thead` остаётся внутри, поэтому sticky-заголовок продолжает работать, а
 * видимые строки рендерятся окном с `data-index` для измерения высоты.
 */
export function Table<Row>(props: TableProps<Row>): Node {
  const config = useUiConfig();
  const hasCaption =
    props.caption !== undefined && props.caption !== null && props.caption !== "";

  const isVirtual = (): boolean =>
    props.virtual !== false && props.rows.length > 0;

  const rowHeight = positive(
    props.rowHeight,
    props.dense === true ? DENSE_ROW_HEIGHT : DEFAULT_ROW_HEIGHT,
  );
  const maxHeight = positive(props.maxHeight, DEFAULT_MAX_HEIGHT);
  const initialViewportSize = positive(
    props.initialViewportSize,
    DEFAULT_INITIAL_VIEWPORT_SIZE,
  );

  // Контроллер создаётся всегда, но при выключенной виртуализации его count
  // равен нулю: разметка обычной таблицы не меняется, слушатели не мешают.
  const virtualizer = createVirtualizer({
    count: () => (isVirtual() ? props.rows.length : 0),
    estimateSize: () => rowHeight,
    getItemKey: (index) => {
      const row = props.rows[index];
      return row === undefined ? index : props.rowKey(row, index);
    },
    overscan: VIRTUAL_OVERSCAN,
    initialViewportSize,
  });

  // Подключаем контроллер к `.sui-table-scroll` только после реального
  // измерения контейнера: нулевой `clientHeight` (jsdom, скрытая вкладка)
  // иначе схлопнул бы окно в пустой список. ResizeObserver дожидается
  // появления размера, не меняя SSR-срез.
  const [scrollElement, setScrollElement] = createSignal<Element | null>(null);
  clientEffect(() => {
    const node = scrollElement();
    virtualizer.setScrollElement(null);
    if (node === null) return;
    let observer: ResizeObserver | null = null;
    const attach = (): boolean => {
      if (node.clientHeight <= 0) return false;
      virtualizer.setScrollElement(node);
      observer?.disconnect();
      observer = null;
      return true;
    };
    if (!attach() && typeof ResizeObserver === "function") {
      observer = new ResizeObserver(() => {
        attach();
      });
      observer.observe(node);
    }
    onCleanup(() => {
      observer?.disconnect();
      observer = null;
    });
  });

  // Кэш сохраняет идентичность записей между прокрутками: `For` двигает
  // существующие `<tr>`, а не пересоздаёт весь видимый диапазон.
  let rowCache = new Map<string | number, VirtualRowEntry<Row>>();

  const entries = createMemo<VirtualEntry<Row>[]>(() => {
    const rows = props.rows;
    const items = virtualizer.virtualItems();
    const total = virtualizer.totalSize();
    const nextCache = new Map<string | number, VirtualRowEntry<Row>>();
    const visible: VirtualRowEntry<Row>[] = [];
    const first = items[0];
    const last = items[items.length - 1];

    for (const item of items) {
      const row = rows[item.index];
      if (row === undefined) continue;
      const key = props.rowKey(row, item.index);
      const cached = rowCache.get(key);
      const entry =
        cached !== undefined &&
        cached.row === row &&
        cached.index === item.index
          ? cached
          : { kind: "row" as const, key, index: item.index, row };
      nextCache.set(key, entry);
      visible.push(entry);
    }
    rowCache = nextCache;

    const topHeight = first === undefined ? 0 : Math.max(0, first.start);
    const bottomHeight =
      last === undefined ? 0 : Math.max(0, total - last.end);
    const result: VirtualEntry<Row>[] = [];
    // Нулевые spacer-строки не рендерим: в начале и в конце списка они не
    // нужны, а разметка малой таблицы остаётся без лишних `<tr>`.
    if (topHeight > 0) {
      result.push({
        kind: "spacer",
        key: SPACER_TOP_KEY,
        edge: "top",
        height: topHeight,
      });
    }
    result.push(...visible);
    if (bottomHeight > 0) {
      result.push({
        kind: "spacer",
        key: SPACER_BOTTOM_KEY,
        edge: "bottom",
        height: bottomHeight,
      });
    }
    return result;
  });

  const measureRow = (node: Element | null): void => {
    if (node === null) return;
    // `measureElement` читает `getBoundingClientRect().height` у `<tr>`.
    virtualizer.measureElement(node);
    // Ref срабатывает до вставки детей; повторное измерение видит уже
    // собранную строку.
    queueMicrotask(() => {
      virtualizer.measureElement(node);
    });
  };

  return (
    <div
      class="sui-table-scroll"
      data-virtual={isVirtual() ? "" : undefined}
      style={
        isVirtual()
          ? { "--sui-table-virtual-max-height": `${maxHeight}px` }
          : undefined
      }
      ref={setScrollElement}
    >
      <table
        {...props.attrs}
        ref={props.ref}
        class={["sui-table", props.class]}
        style={props.style}
        data-dense={props.dense === true ? "" : undefined}
        data-sticky-header={props.stickyHeader === true ? "" : undefined}
        aria-rowcount={isVirtual() ? props.rows.length + 1 : undefined}
        aria-label={hasCaption ? undefined : props.label}
      >
        <Show when={hasCaption}>
          {() => <caption class="sui-table__caption">{props.caption}</caption>}
        </Show>
        <thead class="sui-table__head">
          <tr class="sui-table__row" aria-rowindex={isVirtual() ? 1 : undefined}>
            {props.columns.map((column) => {
              const sorted =
                props.sortKey === column.key && props.sortDirection !== undefined;
              const direction = sorted ? props.sortDirection : undefined;
              const ariaSort =
                direction ?? (column.sortable === true ? "none" : undefined);
              const headerTitle =
                typeof column.header === "string" ? column.header : undefined;
              return (
                <th
                  class="sui-table__header-cell"
                  scope="col"
                  data-align={column.align ?? "start"}
                  data-sortable={column.sortable === true ? "" : undefined}
                  data-sorted={sorted ? "" : undefined}
                  aria-sort={ariaSort}
                  style={widthStyle(column.width)}
                >
                  {column.sortable === true ? (
                    <button
                      class="sui-table__sort"
                      type="button"
                      onClick={() => {
                        const next: TableSortDirection =
                          sorted && props.sortDirection === "ascending"
                            ? "descending"
                            : "ascending";
                        props.onSort?.(column.key, next);
                      }}
                    >
                      <span class="sui-table__header-label" title={headerTitle}>
                        {column.header}
                      </span>
                      <span class="sui-table__sort-icon" aria-hidden="true">
                        <ExpandMoreIcon size="sm" />
                      </span>
                      <span class="sui-table__sort-hint">
                        {direction === "ascending"
                          ? config.strings.sortDescending
                          : config.strings.sortAscending}
                      </span>
                    </button>
                  ) : (
                    <span class="sui-table__header-label" title={headerTitle}>
                      {column.header}
                    </span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody class="sui-table__body">
          <Show
            when={props.rows.length === 0}
            fallback={() => (
              <Show
                when={isVirtual()}
                fallback={() => (
                  <TableRowList
                    rows={props.rows}
                    columns={props.columns}
                    rowKey={props.rowKey}
                  />
                )}
              >
                <VirtualTableRows
                  entries={entries}
                  columns={props.columns}
                  measure={measureRow}
                />
              </Show>
            )}
          >
            {() => (
              <tr class="sui-table__empty-row">
                <td class="sui-table__empty-cell" colspan={props.columns.length}>
                  {props.empty !== undefined ? (
                    props.empty
                  ) : (
                    <EmptyState
                      compact
                      icon={<InfoIcon />}
                      title={props.emptyTitle ?? config.strings.noData}
                    />
                  )}
                </td>
              </tr>
            )}
          </Show>
        </tbody>
      </table>
    </div>
  );
}
