import type { Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import { For, Show } from "@ivlev-dev/silent-core";
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
          {props.columns.map((column) => (
            <td
              class="sui-table__cell"
              data-align={column.align ?? "start"}
              data-truncate={column.truncate === true ? "" : undefined}
              data-lines={column.lines}
            >
              <span class="sui-table__cell-content">
                {resolveSlot(
                  column.renderCell !== undefined
                    ? column.renderCell(row, index())
                    : defaultCell(row, column.key),
                )}
              </span>
            </td>
          ))}
        </tr>
      )}
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
 */
export function Table<Row>(props: TableProps<Row>): Node {
  const config = useUiConfig();
  const hasCaption =
    props.caption !== undefined && props.caption !== null && props.caption !== "";

  return (
    <div class="sui-table-scroll">
      <table
        {...props.attrs}
        ref={props.ref}
        class={["sui-table", props.class]}
        style={props.style}
        data-dense={props.dense === true ? "" : undefined}
        data-sticky-header={props.stickyHeader === true ? "" : undefined}
        aria-label={hasCaption ? undefined : props.label}
      >
        <Show when={hasCaption}>
          {() => <caption class="sui-table__caption">{props.caption}</caption>}
        </Show>
        <thead class="sui-table__head">
          <tr class="sui-table__row">
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
              <TableRowList
                rows={props.rows}
                columns={props.columns}
                rowKey={props.rowKey}
              />
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
