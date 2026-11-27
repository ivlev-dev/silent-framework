import type { Children } from "@ivlev-dev/silent-core";
import {
  For,
  Show,
  createMemo,
  createSignal,
  onCleanup,
  useId,
} from "@ivlev-dev/silent-core";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSensor,
  useSensors,
  useSortable,
} from "@ivlev-dev/silent-dnd";
import type { DragEndEvent, UseSortableReturn } from "@ivlev-dev/silent-dnd";
import { clientEffect } from "../../internal/overlay.js";
import { ExpandMoreIcon } from "../../icons/expand-more.js";
import { useUiConfig } from "../../theme/config.js";
import { Button } from "../button/button.js";
import { EmptyState } from "../empty-state/empty-state.js";
import { Pagination } from "../pagination/pagination.js";
import { Skeleton } from "../skeleton/skeleton.js";
import { resolveSlot } from "../../internal/slot.js";
import {
  clearDataTableSettings,
  clampColumnWidth,
  columnWidthBounds,
  FALLBACK_COLUMN_WIDTH,
  orderColumns,
  readDataTableSettings,
  resolveColumnWidth,
  resolveColumnWidths,
  writeDataTableSettings,
} from "./settings.js";
import type {
  DataTableColumn,
  DataTableProps,
  DataTableSelection,
  DataTableSortDirection,
} from "./types.js";

interface DataTableSettingsState {
  readonly order: readonly string[];
  readonly widths: Readonly<Record<string, number>>;
}

const EMPTY_SETTINGS: DataTableSettingsState = { order: [], widths: {} };
const DEFAULT_PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
const SKELETON_WIDTHS = ["72%", "54%", "88%", "64%", "46%"] as const;
const RESIZE_STEP = 8;
const RESIZE_STEP_LARGE = 32;

function widthStyle(width: number | undefined): Record<string, string> | undefined {
  if (width === undefined) return undefined;
  return { width: `${width}px` };
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

function isInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest("a[href], button, input, select, textarea, summary, [role='button']") !== null
  );
}

function statusTemplate(start: number, end: number, total: number): string {
  if (total <= 0) return "Нет строк";
  return `${start}–${end} из ${total}`;
}

function GripIcon(): Node {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="6" cy="4" r="1.2" />
      <circle cx="10" cy="4" r="1.2" />
      <circle cx="6" cy="8" r="1.2" />
      <circle cx="10" cy="8" r="1.2" />
      <circle cx="6" cy="12" r="1.2" />
      <circle cx="10" cy="12" r="1.2" />
    </svg>
  );
}

const NO_WRITE = (): void => {};

interface TableCheckboxProps {
  readonly checked: () => boolean;
  readonly indeterminate?: (() => boolean) | undefined;
  readonly label: string;
  readonly onChange: (checked: boolean) => void;
}

function readCheckbox(props: TableCheckboxProps): boolean | "mixed" {
  if (props.indeterminate?.() === true) return "mixed";
  return props.checked();
}

function TableCheckbox(props: TableCheckboxProps): Node {
  const read = (): boolean | "mixed" => readCheckbox(props);
  return (
    <input
      class="sui-data-table__checkbox"
      type="checkbox"
      aria-label={props.label}
      bindChecked={[read, NO_WRITE]}
      onClick={(event) => {
        event.stopPropagation();
      }}
      onChange={(event) => {
        const target = event.target;
        if (target instanceof HTMLInputElement) props.onChange(target.checked);
      }}
    />
  );
}

interface ResizeSession {
  readonly startX: number;
  readonly startWidth: number;
  lastWidth: number;
  readonly move: (event: PointerEvent) => void;
  readonly end: (event: PointerEvent) => void;
}

interface HeaderCellProps<Row> {
  readonly column: DataTableColumn<Row>;
  readonly width: () => number | undefined;
  readonly sorted: () => boolean;
  readonly direction: () => DataTableSortDirection | undefined;
  readonly reorderable: boolean;
  readonly onSort: ((key: string, direction: DataTableSortDirection) => void) | undefined;
  readonly onResize: (key: string, width: number | undefined, commit: boolean) => void;
}

function HeaderCell<Row>(props: HeaderCellProps<Row>): Node {
  const config = useUiConfig();
  const sortable: UseSortableReturn = useSortable({
    id: props.column.key,
    disabled: !props.reorderable,
    data: { key: props.column.key },
  });
  const [resizeSession, setResizeSession] = createSignal<ResizeSession | null>(null);

  const stopResize = (): void => {
    const session = resizeSession();
    if (session === null) return;
    window.removeEventListener("pointermove", session.move);
    window.removeEventListener("pointerup", session.end);
    window.removeEventListener("pointercancel", session.end);
    setResizeSession(null);
  };

  onCleanup(() => {
    stopResize();
  });

  const cell = (node: Element | null): void => {
    sortable.setDroppableNodeRef(node instanceof HTMLElement ? node : null);
  };

  const handle = (node: Element | null): void => {
    const element = node instanceof HTMLElement ? node : null;
    sortable.setDraggableNodeRef(element);
    sortable.setActivatorNodeRef(element);
  };

  const startResize = (event: PointerEvent): void => {
    if (props.column.resizable === false) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = columnWidthBounds(props.column);
    const node = (event.currentTarget as HTMLElement | null)?.closest("th");
    const measured = node?.getBoundingClientRect().width ?? 0;
    const startWidth =
      measured > 0 ? measured : props.width() ?? FALLBACK_COLUMN_WIDTH;
    const session: ResizeSession = {
      startX: event.clientX,
      startWidth,
      lastWidth: startWidth,
      move: (moveEvent: PointerEvent) => {
        const next = Math.min(
          bounds.max,
          Math.max(bounds.min, startWidth + (moveEvent.clientX - session.startX)),
        );
        session.lastWidth = Math.round(next);
        props.onResize(props.column.key, session.lastWidth, false);
      },
      end: (endEvent: PointerEvent) => {
        const sessionNode = resizeSession();
        if (sessionNode !== null) {
          window.removeEventListener("pointermove", sessionNode.move);
          window.removeEventListener("pointerup", sessionNode.end);
          window.removeEventListener("pointercancel", sessionNode.end);
        }
        setResizeSession(null);
        props.onResize(props.column.key, session.lastWidth, true);
        endEvent.preventDefault();
      },
    };
    setResizeSession(session);
    window.addEventListener("pointermove", session.move);
    window.addEventListener("pointerup", session.end);
    window.addEventListener("pointercancel", session.end);
  };

  const resizeWithKeyboard = (event: KeyboardEvent): void => {
    if (props.column.resizable === false) return;
    const bounds = columnWidthBounds(props.column);
    const current =
      props.width() ?? (event.currentTarget as HTMLElement | null)?.closest("th")?.getBoundingClientRect().width ?? FALLBACK_COLUMN_WIDTH;
    if (event.key === "Home") {
      event.preventDefault();
      props.onResize(props.column.key, undefined, true);
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step = event.shiftKey ? RESIZE_STEP_LARGE : RESIZE_STEP;
    const next =
      event.key === "ArrowRight" ? current + step : current - step;
    props.onResize(
      props.column.key,
      Math.min(bounds.max, Math.max(bounds.min, next)),
      true,
    );
  };

  const headerTitle =
    typeof props.column.header === "string" ? props.column.header : undefined;
  const width = () => props.width();
  const sortTransform = () => {
    const transform = sortable.transform();
    if (transform === null) return undefined;
    return {
      transform: `translate(${transform.x}px, ${transform.y}px)`,
      transition: sortable.transition() ?? undefined,
    };
  };

  const resizerLabel = `Изменить ширину колонки «${headerTitle ?? props.column.key}»`;
  const dragLabel = `Переместить колонку «${headerTitle ?? props.column.key}»`;

  return (
    <th
      ref={cell}
      class="sui-data-table__th"
      scope="col"
      data-column-key={props.column.key}
      data-align={props.column.align ?? "start"}
      data-sortable={props.column.sortable === true ? "" : undefined}
      data-sorted={props.sorted() ? "" : undefined}
      data-dragging={sortable.isDragging() ? "" : undefined}
      data-over={sortable.isOver() ? "" : undefined}
      aria-sort={
        props.sorted()
          ? props.direction()
          : props.column.sortable === true
            ? "none"
            : undefined
      }
      onPointerDown={(event: PointerEvent) => {
        sortable.listeners.onPointerDown(event);
      }}
      style={[widthStyle(width()), sortTransform()]}
    >
      <div class="sui-data-table__th-inner">
        <Show when={props.reorderable}>
          <button
            ref={handle}
            class="sui-data-table__drag-handle"
            type="button"
            aria-label={dragLabel}
            title={dragLabel}
            {...sortable.attributes}
            {...sortable.listeners}
          >
            <GripIcon />
          </button>
        </Show>
        <Show
          when={props.column.sortable === true}
          fallback={
            <span class="sui-data-table__header-label" title={headerTitle}>
              {props.column.header}
            </span>
          }
        >
          <button
            class="sui-data-table__sort"
            type="button"
            onClick={() => {
              const next: DataTableSortDirection =
                props.sorted() && props.direction() === "ascending"
                  ? "descending"
                  : "ascending";
              props.onSort?.(props.column.key, next);
            }}
          >
            <span class="sui-data-table__header-label" title={headerTitle}>
              {props.column.header}
            </span>
            <span class="sui-data-table__sort-icon" aria-hidden="true">
              <ExpandMoreIcon size="sm" />
            </span>
            <span class="sui-data-table__sort-hint">
              {props.direction() === "ascending"
                ? config.strings.sortDescending
                : config.strings.sortAscending}
            </span>
          </button>
        </Show>
        <Show when={props.column.resizable !== false}>
          <button
            class="sui-data-table__resizer"
            type="button"
            aria-label={resizerLabel}
            title={resizerLabel}
            data-column-key={props.column.key}
            onPointerDown={startResize}
            onDblClick={(event: MouseEvent) => {
              event.preventDefault();
              event.stopPropagation();
              props.onResize(props.column.key, undefined, true);
            }}
            onKeyDown={resizeWithKeyboard}
          >
            <span class="sui-data-table__resizer-grip" aria-hidden="true" />
          </button>
        </Show>
      </div>
    </th>
  );
}

interface DataTableRowProps<Row> {
  readonly row: Row;
  readonly index: number;
  readonly columns: readonly DataTableColumn<Row>[];
  readonly rowKey: string | number;
  readonly selected: () => boolean;
  readonly onSelectionChange: ((key: string | number, selected: boolean) => void) | undefined;
  readonly onRowClick: ((row: Row) => void) | undefined;
}

function DataTableRow<Row>(props: DataTableRowProps<Row>): Node {
  return (
    <tr
      class="sui-data-table__tr"
      data-selected={props.selected() ? "" : undefined}
      tabindex={props.onRowClick !== undefined ? 0 : undefined}
      onClick={(event) => {
        if (props.onRowClick === undefined) return;
        if (isInteractiveTarget(event.target)) return;
        props.onRowClick(props.row);
      }}
      onKeyDown={(event) => {
        if (props.onRowClick === undefined) return;
        if (isInteractiveTarget(event.target)) return;
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        props.onRowClick(props.row);
      }}
    >
      <Show when={props.onSelectionChange !== undefined}>
        <td class="sui-data-table__td" data-select="">
          <TableCheckbox
            checked={props.selected}
            label={`Выбрать строку ${props.index + 1}`}
            onChange={(checked) => {
              props.onSelectionChange?.(props.rowKey, checked);
            }}
          />
        </td>
      </Show>
      {props.columns.map((column) => (
        <td
          class="sui-data-table__td"
          data-align={column.align ?? "start"}
          data-truncate={column.truncate === true ? "" : undefined}
        >
          <span class="sui-data-table__cell-content">
            {resolveSlot(
              column.render !== undefined
                ? column.render(props.row, props.index)
                : defaultCell(props.row, column.key),
            )}
          </span>
        </td>
      ))}
    </tr>
  );
}

interface DataTableBodyProps<Row> {
  readonly rows: readonly Row[];
  readonly columns: readonly DataTableColumn<Row>[];
  readonly rowKey: (row: Row, index: number) => string | number;
  readonly selection: () => DataTableSelection | undefined;
  readonly onSelectionChange: (key: string | number, selected: boolean) => void;
  readonly onRowClick: ((row: Row) => void) | undefined;
}

function DataTableBody<Row>(props: DataTableBodyProps<Row>): Node {
  return (
    <For each={props.rows} keyOf={(row, index) => props.rowKey(row, index)}>
      {(row, index) => {
        const key = props.rowKey(row, index());
        return (
          <DataTableRow
            row={row}
            index={index()}
            columns={props.columns}
            rowKey={key}
            selected={() => props.selection()?.selected.has(key) === true}
            onSelectionChange={
              props.selection() === undefined ? undefined : props.onSelectionChange
            }
            onRowClick={props.onRowClick}
          />
        );
      }}
    </For>
  );
}

export function DataTable<Row>(props: DataTableProps<Row>): Node {
  const config = useUiConfig();
  const pageSizeId = useId("data-table-page-size");
  const [settings, setSettings] = createSignal<DataTableSettingsState>(EMPTY_SETTINGS);
  const [loaded, setLoaded] = createSignal(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  clientEffect(() => {
    const tableKey = props.tableKey;
    const stored = readDataTableSettings(tableKey);
    setSettings({
      order: stored.order,
      widths: resolveColumnWidths(props.columns, stored.widths),
    });
    setLoaded(true);
  });

  const orderedColumns = createMemo(() =>
    orderColumns(props.columns, settings().order),
  );
  const orderedKeys = (): readonly string[] =>
    orderedColumns().map((column) => column.key);

  const effectiveWidth = (column: DataTableColumn<Row>): number | undefined =>
    resolveColumnWidth(column, settings().widths[column.key]);

  const persist = (next: DataTableSettingsState): void => {
    writeDataTableSettings(props.tableKey, next);
  };

  const sanitizeWidths = (
    widths: Readonly<Record<string, number>>,
  ): Readonly<Record<string, number>> => {
    const available = new Set(props.columns.map((column) => column.key));
    const result: Record<string, number> = {};
    for (const [key, value] of Object.entries(widths)) {
      if (available.has(key)) result[key] = value;
    }
    return result;
  };

  const commitSettings = (next: DataTableSettingsState): void => {
    const normalized: DataTableSettingsState = {
      order: next.order,
      widths: sanitizeWidths(next.widths),
    };
    setSettings(normalized);
    persist(normalized);
  };

  const resizeColumn = (
    key: string,
    width: number | undefined,
    commit: boolean,
  ): void => {
    const column = props.columns.find((entry) => entry.key === key);
    if (column === undefined) return;
    if (width === undefined) {
      if (!commit) return;
      const widths = { ...settings().widths };
      delete widths[key];
      commitSettings({ order: orderedKeys(), widths });
      return;
    }
    const clamped = clampColumnWidth(column, width);
    const next: DataTableSettingsState = {
      order: orderedKeys(),
      widths: { ...settings().widths, [key]: clamped },
    };
    setSettings(next);
    if (commit) persist(next);
  };

  const resetView = (): void => {
    setSettings(EMPTY_SETTINGS);
    clearDataTableSettings(props.tableKey);
  };

  const handleDragEnd = (event: DragEndEvent): void => {
    if (event.over === null) return;
    const current = orderedKeys();
    const from = current.indexOf(String(event.active.id));
    const to = current.indexOf(String(event.over.id));
    if (from === -1 || to === -1 || from === to) return;
    commitSettings({
      order: arrayMove([...current], from, to),
      widths: settings().widths,
    });
  };

  const selection = (): DataTableSelection | undefined => props.selection;

  const toggleSelection = (key: string | number, selected: boolean): void => {
    const current = selection();
    if (current === undefined) return;
    const next = new Set(current.selected);
    if (selected) {
      next.add(key);
    } else {
      next.delete(key);
    }
    current.onChange(next);
  };

  const selectedCount = (): number => {
    const current = selection();
    if (current === undefined) return 0;
    return props.rows.reduce(
      (count, row, index) =>
        count + (current.selected.has(props.rowKey(row, index)) ? 1 : 0),
      0,
    );
  };
  const allSelected = (): boolean =>
    props.rows.length > 0 && selectedCount() === props.rows.length;
  const someSelected = (): boolean =>
    selectedCount() > 0 && !allSelected();

  const toggleAll = (checked: boolean): void => {
    const current = selection();
    if (current === undefined) return;
    const next = new Set(current.selected);
    for (let index = 0; index < props.rows.length; index += 1) {
      const row = props.rows[index];
      if (row === undefined) continue;
      const key = props.rowKey(row, index);
      if (checked) {
        next.add(key);
      } else {
        next.delete(key);
      }
    }
    current.onChange(next);
  };

  const pageSizeOptions = (): readonly number[] => {
    const requested = props.pageSizeOptions ?? DEFAULT_PAGE_SIZE_OPTIONS;
    const values = new Set<number>();
    for (const size of requested) {
      if (Number.isFinite(size) && size > 0) values.add(Math.trunc(size));
    }
    if (Number.isFinite(props.pageSize) && props.pageSize > 0) {
      values.add(Math.trunc(props.pageSize));
    }
    return [...values].sort((left, right) => left - right);
  };

  const pageCount = (): number => {
    if (!Number.isFinite(props.pageSize) || props.pageSize <= 0) return 1;
    return Math.max(1, Math.ceil(props.total / props.pageSize));
  };

  const currentPage = (): number => {
    if (!Number.isFinite(props.page)) return 1;
    return Math.min(Math.max(1, Math.trunc(props.page)), pageCount());
  };

  const rangeStart = (): number => {
    if (props.total <= 0) return 0;
    return (currentPage() - 1) * props.pageSize + 1;
  };
  const rangeEnd = (): number => {
    if (props.total <= 0) return 0;
    return Math.min(props.total, currentPage() * props.pageSize);
  };

  const hasError = (): boolean =>
    props.error !== undefined && props.error !== null;
  const isLoading = (): boolean => props.loading === true;
  const isEmpty = (): boolean => props.rows.length === 0;

  const skeletonRows = (): readonly number[] => {
    const count = Math.min(Math.max(1, Math.trunc(props.pageSize) || 5), 100);
    return Array.from({ length: count }, (_value, index) => index);
  };

  const columnCount = (): number =>
    orderedColumns().length + (selection() === undefined ? 0 : 1);

  const tableLabel = (): string => {
    const value = props.attrs?.["aria-label"];
    return typeof value === "string" && value !== "" ? value : "Таблица данных";
  };
  const tableLabelledBy = (): string | undefined => {
    const value = props.attrs?.["aria-labelledby"];
    return typeof value === "string" && value !== "" ? value : undefined;
  };

  return (
    <div
      {...props.attrs}
      class={["sui-data-table", props.class]}
      style={props.style}
      data-density={props.density ?? "standard"}
      data-loading={isLoading() ? "" : undefined}
      data-loaded={loaded() ? "" : undefined}
    >
      <div class="sui-data-table__toolbar">
        <div class="sui-data-table__toolbar-slot">{props.toolbar}</div>
        <Button
          variant="text"
          size="sm"
          class="sui-data-table__reset"
          attrs={{ "data-testid": "data-table-reset" }}
          onClick={resetView}
        >
          Сбросить вид
        </Button>
      </div>
      <DndContext
        sensors={sensors}
        onDragEnd={handleDragEnd}
        accessibility={{ ariaRoleDescription: "Перетаскиваемая колонка" }}
      >
        <SortableContext items={orderedKeys} strategy={horizontalListSortingStrategy}>
          <div class="sui-data-table__scroll">
            <table
              class="sui-data-table__table"
              role="grid"
              aria-label={tableLabelledBy() === undefined ? tableLabel() : undefined}
              aria-labelledby={tableLabelledBy()}
              aria-busy={isLoading() ? "true" : undefined}
              aria-colcount={columnCount()}
              aria-rowcount={props.total + 1}
              data-sticky-header=""
            >
              <colgroup>
                <Show when={selection() !== undefined}>
                  <col class="sui-data-table__col" style={{ width: "48px" }} />
                </Show>
                {orderedColumns().map((column) => (
                  <col
                    class="sui-data-table__col"
                    data-column-key={column.key}
                    style={widthStyle(effectiveWidth(column))}
                  />
                ))}
              </colgroup>
              <thead class="sui-data-table__thead">
                <tr class="sui-data-table__tr">
                  <Show when={selection() !== undefined}>
                    <th class="sui-data-table__th" scope="col" data-select="">
                      <TableCheckbox
                        checked={allSelected}
                        indeterminate={someSelected}
                        label="Выбрать все строки"
                        onChange={toggleAll}
                      />
                    </th>
                  </Show>
                  {orderedColumns().map((column) => (
                    <HeaderCell
                      column={column}
                      width={() => effectiveWidth(column)}
                      sorted={() =>
                        props.sortKey === column.key &&
                        props.sortDirection !== undefined
                      }
                      direction={() =>
                        props.sortKey === column.key ? props.sortDirection : undefined
                      }
                      reorderable={orderedColumns().length > 1}
                      onSort={props.onSort}
                      onResize={resizeColumn}
                    />
                  ))}
                </tr>
              </thead>
              <tbody class="sui-data-table__tbody">
                <Show when={isLoading()}>
                  {skeletonRows().map((rowIndex) => (
                    <tr class="sui-data-table__tr" data-skeleton="">
                      <Show when={selection() !== undefined}>
                        <td class="sui-data-table__td" data-select="">
                          <Skeleton variant="rect" width={20} height={20} />
                        </td>
                      </Show>
                      {orderedColumns().map((column, columnIndex) => (
                        <td
                          class="sui-data-table__td"
                          data-align={column.align ?? "start"}
                        >
                          <Skeleton
                            variant="text"
                            width={
                              SKELETON_WIDTHS[
                                (rowIndex + columnIndex) % SKELETON_WIDTHS.length
                              ]
                            }
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </Show>
                <Show when={!isLoading() && hasError()}>
                  <tr class="sui-data-table__tr">
                    <td
                      class="sui-data-table__state-cell"
                      colspan={columnCount()}
                      role="alert"
                    >
                      <div class="sui-data-table__error">{props.error}</div>
                    </td>
                  </tr>
                </Show>
                <Show when={!isLoading() && !hasError() && isEmpty()}>
                  <tr class="sui-data-table__tr">
                    <td class="sui-data-table__state-cell" colspan={columnCount()}>
                      <div class="sui-data-table__empty">
                        {props.empty !== undefined && props.empty !== null ? (
                          props.empty
                        ) : (
                          <EmptyState compact title={config.strings.noData} />
                        )}
                      </div>
                    </td>
                  </tr>
                </Show>
                <Show when={!isLoading() && !hasError() && !isEmpty()}>
                  <DataTableBody
                    rows={props.rows}
                    columns={orderedColumns()}
                    rowKey={props.rowKey}
                    selection={selection}
                    onSelectionChange={toggleSelection}
                    onRowClick={props.onRowClick}
                  />
                </Show>
              </tbody>
            </table>
          </div>
        </SortableContext>
      </DndContext>
      <div class="sui-data-table__footer">
        <span class="sui-data-table__status" aria-live="polite">
          {statusTemplate(rangeStart(), rangeEnd(), props.total)}
        </span>
        <div class="sui-data-table__pagination-controls">
          <label class="sui-data-table__page-size" for={pageSizeId}>
            Строк на странице
          </label>
          <select
            id={pageSizeId}
            class="sui-data-table__select"
            value={String(props.pageSize)}
            onChange={(event) => {
              const target = event.target;
              if (!(target instanceof HTMLSelectElement)) return;
              const size = Number(target.value);
              if (Number.isFinite(size) && size > 0) props.onPageSizeChange?.(size);
            }}
          >
            {pageSizeOptions().map((size) => (
              <option value={String(size)} selected={size === props.pageSize}>
                {String(size)}
              </option>
            ))}
          </select>
          <Show when={props.total > 0}>
            <Pagination
              page={currentPage()}
              pageCount={pageCount()}
              onChange={props.onPageChange}
            />
          </Show>
        </div>
      </div>
    </div>
  );
}
