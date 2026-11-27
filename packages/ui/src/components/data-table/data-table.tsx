import type { Child, Children, StyleInput } from "@ivlev-dev/silent-core";
import {
  For,
  Show,
  createMemo,
  createSignal,
  onCleanup,
  useId,
} from "@ivlev-dev/silent-core";
import { createVirtualizer } from "@ivlev-dev/silent-virtual";
import { clientEffect } from "../../internal/overlay.js";
import { ExpandMoreIcon } from "../../icons/expand-more.js";
import { ChevronEndIcon } from "../../icons/chevron-end.js";
import { MoreVertIcon } from "../../icons/more-vert.js";
import { CardsIcon } from "../../icons/cards.js";
import { TableIcon } from "../../icons/table.js";
import { useUiConfig } from "../../theme/config.js";
import { Button } from "../button/button.js";
import { Dialog } from "../dialog/dialog.js";
import { EmptyState } from "../empty-state/empty-state.js";
import { IconButton } from "../icon-button/icon-button.js";
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
  resolveScrollMode,
  writeDataTableSettings,
} from "./settings.js";
import type {
  DataTableApi,
  DataTableCardContext,
  DataTableColumn,
  DataTableDensity,
  DataTableLayout,
  DataTableProps,
  DataTableResolvedScrollMode,
  DataTableSelection,
  DataTableSortDirection,
  DataTableTreeDropPosition,
} from "./types.js";

interface DataTableSettingsState {
  readonly order: readonly string[];
  readonly widths: Readonly<Record<string, number>>;
  readonly visible: Readonly<Record<string, boolean>>;
  readonly density: DataTableDensity | null;
  readonly layout: DataTableLayout | null;
  readonly stickyHeader: boolean | null;
  readonly stickyFooter: boolean | null;
  readonly scrollMode: DataTableResolvedScrollMode | null;
}

const EMPTY_SETTINGS: DataTableSettingsState = {
  order: [],
  widths: {},
  visible: {},
  density: null,
  layout: null,
  stickyHeader: null,
  stickyFooter: null,
  scrollMode: null,
};

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
const SKELETON_WIDTHS = ["72%", "54%", "88%", "64%", "46%"] as const;
const ROW_HEIGHT_STANDARD = 56;
const ROW_HEIGHT_COMPACT = 48;
const HEADER_HEIGHT = 48;
const RESIZE_STEP = 8;
const RESIZE_STEP_LARGE = 32;
const RESIZE_THRESHOLD = 3;
const DRAG_THRESHOLD = 6;
const DRAG_HYSTERESIS = 4;
const FLIP_TIMEOUT = 400;
const TREE_INDENT = 20;
const NARROW_QUERY = "(max-width: 63.99em)";
const VIRTUAL_THRESHOLD = 40;
const VIRTUAL_OVERSCAN = 10;
const MAX_SKELETON_ROWS = 100;
const MAX_FILLER_ROWS = 500;
const HEADER_SELECTOR = "thead th[data-column-key]";
const SETTINGS_SELECTOR = ".sui-data-table__settings-row[data-column-key]";
const SPACER_TOP_KEY = "\u0000sui-data-table-spacer-top";
const SPACER_BOTTOM_KEY = "\u0000sui-data-table-spacer-bottom";

interface RectSnapshot {
  readonly left: number;
  readonly top: number;
}

interface DropTarget {
  readonly key: string;
  readonly edge: "before" | "after";
}

interface RowDropTarget {
  readonly key: string | number;
  readonly position: DataTableTreeDropPosition;
}

function snapshotRects(
  root: ParentNode | null,
  selector: string,
): Map<string, RectSnapshot> {
  const result = new Map<string, RectSnapshot>();
  if (root === null) return result;
  root.querySelectorAll<HTMLElement>(selector).forEach((node) => {
    const key = node.getAttribute("data-column-key");
    if (key === null) return;
    const rect = node.getBoundingClientRect();
    result.set(key, { left: rect.left, top: rect.top });
  });
  return result;
}

function animateReflow(
  before: Map<string, RectSnapshot>,
  root: ParentNode | null,
  selector: string,
): void {
  if (typeof window === "undefined" || before.size === 0) return;
  if (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    return;
  }
  queueMicrotask(() => {
    if (root === null) return;
    root.querySelectorAll<HTMLElement>(selector).forEach((node) => {
      const key = node.getAttribute("data-column-key");
      if (key === null) return;
      const previous = before.get(key);
      if (previous === undefined) return;
      const rect = node.getBoundingClientRect();
      const dx = previous.left - rect.left;
      const dy = previous.top - rect.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      node.style.transition = "none";
      node.style.transform = `translate(${String(dx)}px, ${String(dy)}px)`;
      const play = (): void => {
        node.style.transition =
          "transform var(--sui-motion-short-4) var(--sui-easing-emphasized)";
        node.style.transform = "";
        const clear = (): void => {
          node.style.transition = "";
          node.style.transform = "";
          node.removeEventListener("transitionend", clear);
        };
        node.addEventListener("transitionend", clear);
        window.setTimeout(clear, FLIP_TIMEOUT);
      };
      if (typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(play);
      } else {
        play();
      }
    });
  });
}

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

function rawCellValue<Row>(row: Row, key: string): string {
  const value = (row as unknown as Record<string, unknown>)[key];
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function cellTitle<Row>(column: DataTableColumn<Row>, content: Children): string | undefined {
  if (column.truncate !== true) return undefined;
  if (typeof content === "string") return content.trim() === "" ? undefined : content;
  if (typeof content === "number" || typeof content === "bigint") return String(content);
  return undefined;
}

function cellContent<Row>(column: DataTableColumn<Row>, row: Row, index: number): Children {
  return resolveSlot(
    column.render !== undefined ? column.render(row, index) : defaultCell(row, column.key),
  );
}

function statusTemplate(start: number, end: number, total: number): string {
  if (total <= 0) return "Нет строк";
  return `${String(start)}–${String(end)} из ${String(total)}`;
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

function LockIcon(): Node {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M5 7V5.5a3 3 0 0 1 6 0V7"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
      />
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" fill="currentColor" />
    </svg>
  );
}

function humanizeColumnKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_-]+/)
    .filter((part) => part !== "");
  if (words.length === 0) return key;
  return words
    .map((part, index) =>
      index === 0 ? `${part.charAt(0).toUpperCase()}${part.slice(1)}` : part.toLowerCase(),
    )
    .join(" ");
}

function settingsLabelFor<Row>(column: DataTableColumn<Row>): string {
  if (column.settingsLabel !== undefined && column.settingsLabel.trim() !== "") {
    return column.settingsLabel.trim();
  }
  if (typeof column.header === "string" && column.header.trim() !== "") {
    return column.header.trim();
  }
  const cardLabel = column.card?.label;
  if (cardLabel !== undefined && cardLabel.trim() !== "") return cardLabel.trim();
  if (column.key === "actions") return "Действия";
  return humanizeColumnKey(column.key);
}

const NO_WRITE = (): void => {};

interface TableCheckboxProps {
  readonly checked: () => boolean;
  readonly indeterminate?: (() => boolean) | undefined;
  readonly label: string;
  readonly disabled?: boolean | undefined;
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
      disabled={props.disabled === true}
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

interface FlatRow<Row> {
  readonly row: Row;
  readonly key: string | number;
  readonly index: number;
  readonly level: number;
  readonly parentKey: string | number | null;
  readonly hasChildren: boolean;
  readonly expanded: boolean;
}

interface HeaderCellProps<Row> {
  readonly column: DataTableColumn<Row>;
  readonly width: () => number | undefined;
  readonly sorted: () => boolean;
  readonly direction: () => DataTableSortDirection | undefined;
  readonly reorderable: boolean;
  readonly dragging: () => boolean;
  readonly dropEdge: () => "before" | "after" | null;
  readonly armed: () => boolean;
  readonly onSort: ((key: string, direction: DataTableSortDirection) => void) | undefined;
  readonly onResizeCommit: (widths: Readonly<Record<string, number>>) => void;
  readonly onResizeReset: (key: string) => void;
  readonly onHeaderPointerDown: (key: string, event: PointerEvent, node: HTMLElement) => void;
  readonly onHeaderKeyDown: (key: string, event: KeyboardEvent) => void;
  readonly tableElement: () => HTMLTableElement | null;
}

interface ResizeSession {
  readonly startX: number;
  readonly startWidth: number;
  readonly frozen: Readonly<Record<string, number>>;
  readonly key: string;
  lastWidth: number;
  active: boolean;
  readonly move: (event: PointerEvent) => void;
  readonly end: (event: PointerEvent) => void;
}

function HeaderCell<Row>(props: HeaderCellProps<Row>): Node {
  const config = useUiConfig();
  const [resizing, setResizing] = createSignal<number | null>(null);
  let session: ResizeSession | null = null;

  const colFor = (key: string): HTMLTableColElement | null =>
    props.tableElement()?.querySelector<HTMLTableColElement>(
      `colgroup col[data-column-key="${key}"]`,
    ) ?? null;

  const stopResize = (): void => {
    if (session === null) return;
    window.removeEventListener("pointermove", session.move);
    window.removeEventListener("pointerup", session.end);
    window.removeEventListener("pointercancel", session.end);
    session = null;
    document.body.classList.remove("sui-data-table--resizing");
    setResizing(null);
  };

  onCleanup(stopResize);

  const clampWidth = (value: number): number => {
    const bounds = columnWidthBounds(props.column);
    return Math.min(bounds.max, Math.max(bounds.min, value));
  };

  const measureWidths = (): Readonly<Record<string, number>> => {
    const table = props.tableElement();
    const widths: Record<string, number> = {};
    if (table === null) return widths;
    table.querySelectorAll<HTMLElement>("thead th[data-column-key]").forEach((header) => {
      const key = header.getAttribute("data-column-key");
      if (key === null) return;
      const width = header.getBoundingClientRect().width;
      if (width <= 0) return;
      widths[key] = Math.round(width);
    });
    return widths;
  };

  const startResize = (event: PointerEvent): void => {
    if (props.column.resizable === false) return;
    event.preventDefault();
    event.stopPropagation();
    const resizer = event.currentTarget as HTMLElement | null;
    const pointerId = (event as PointerEvent & { pointerId?: number }).pointerId;
    if (resizer !== null && pointerId !== undefined && typeof resizer.setPointerCapture === "function") {
      try {
        resizer.setPointerCapture(pointerId);
      } catch {
        // Синтетические события и jsdom могут не поддерживать capture.
      }
    }
    const frozen = measureWidths();
    const header = resizer?.closest<HTMLElement>("th");
    const measured = header?.getBoundingClientRect().width ?? 0;
    const startWidth =
      frozen[props.column.key] ??
      (measured > 0 ? Math.round(measured) : props.width() ?? FALLBACK_COLUMN_WIDTH);
    document.body.classList.add("sui-data-table--resizing");

    const next: ResizeSession = {
      startX: event.clientX,
      startWidth,
      frozen,
      key: props.column.key,
      lastWidth: Math.round(startWidth),
      active: false,
      move: (moveEvent: PointerEvent) => {
        const current = session;
        if (current === null) return;
        if (!current.active) {
          if (Math.abs(moveEvent.clientX - current.startX) < RESIZE_THRESHOLD) return;
          current.active = true;
          for (const [key, width] of Object.entries(current.frozen)) {
            const frozenCol = colFor(key);
            if (frozenCol !== null) frozenCol.style.width = `${width}px`;
          }
        }
        const px = clampWidth(Math.round(current.startWidth + moveEvent.clientX - current.startX));
        current.lastWidth = px;
        const target = colFor(current.key);
        if (target !== null) target.style.width = `${px}px`;
        setResizing(px);
      },
      end: (endEvent: PointerEvent) => {
        const current = session;
        if (current !== null && current.active) {
          const target = colFor(current.key);
          if (target !== null) target.style.width = `${current.lastWidth}px`;
          props.onResizeCommit({ ...current.frozen, [current.key]: current.lastWidth });
        }
        stopResize();
        endEvent.preventDefault();
      },
    };
    session = next;
    window.addEventListener("pointermove", next.move);
    window.addEventListener("pointerup", next.end);
    window.addEventListener("pointercancel", next.end);
  };

  const resetWidth = (): void => {
    const col = colFor(props.column.key);
    if (col !== null) col.style.removeProperty("width");
    props.onResizeReset(props.column.key);
    setResizing(null);
  };

  const resizeWithKeyboard = (event: KeyboardEvent): void => {
    if (props.column.resizable === false) return;
    if (event.key === "Home") {
      event.preventDefault();
      resetWidth();
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const header = (event.currentTarget as HTMLElement | null)?.closest<HTMLElement>("th");
    const measured = header?.getBoundingClientRect().width ?? 0;
    const current =
      measured > 0 ? Math.round(measured) : props.width() ?? FALLBACK_COLUMN_WIDTH;
    const step = event.shiftKey ? RESIZE_STEP_LARGE : RESIZE_STEP;
    const px = clampWidth(current + (event.key === "ArrowRight" ? step : -step));
    const col = colFor(props.column.key);
    if (col !== null) col.style.width = `${px}px`;
    props.onResizeCommit({ [props.column.key]: px });
  };

  const headerTitle =
    typeof props.column.header === "string" ? props.column.header : undefined;
  const headerLabel = () =>
    headerTitle ?? props.column.key;
  const resizerLabel = `Изменить ширину колонки «${headerLabel()}»`;
  const dragLabel = `Перетащить колонку «${headerLabel()}»`;

  return (
    <th
      class="sui-data-table__th"
      scope="col"
      data-column-key={props.column.key}
      data-align={props.column.align ?? "start"}
      data-sortable={props.column.sortable === true ? "" : undefined}
      data-sorted={props.sorted() ? "" : undefined}
      data-reorderable={props.reorderable ? "" : undefined}
      data-armed={props.armed() ? "" : undefined}
      data-dragging={props.dragging() ? "" : undefined}
      data-drop={props.dropEdge() ?? undefined}
      tabindex={props.reorderable ? 0 : undefined}
      aria-roledescription={props.reorderable ? "Перетаскиваемый заголовок колонки" : undefined}
      aria-label={props.reorderable ? dragLabel : undefined}
      aria-sort={
        props.sorted()
          ? props.direction()
          : props.column.sortable === true
            ? "none"
            : undefined
      }
      onPointerDown={(event: PointerEvent) => {
        if (!props.reorderable) return;
        props.onHeaderPointerDown(props.column.key, event, event.currentTarget as HTMLElement);
      }}
      onKeyDown={(event: KeyboardEvent) => {
        props.onHeaderKeyDown(props.column.key, event);
      }}
    >
      <div class="sui-data-table__th-inner">
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
            role="separator"
            aria-orientation="vertical"
            aria-label={resizerLabel}
            title={resizerLabel}
            aria-valuenow={resizing() ?? props.width() ?? undefined}
            aria-valuemin={columnWidthBounds(props.column).min}
            aria-valuemax={columnWidthBounds(props.column).max}
            aria-valuetext={resizing() === null ? undefined : `${resizing()} px`}
            data-column-key={props.column.key}
            data-active={resizing() === null ? undefined : ""}
            onPointerDown={startResize}
            onDblClick={(event: MouseEvent) => {
              event.preventDefault();
              event.stopPropagation();
              resetWidth();
            }}
            onKeyDown={resizeWithKeyboard}
          >
            <span class="sui-data-table__resizer-grip" aria-hidden="true" />
            <Show when={resizing() !== null}>
              <span class="sui-data-table__resize-chip" aria-hidden="true">
                {`${String(resizing())} px`}
              </span>
            </Show>
          </button>
        </Show>
      </div>
      <Show when={props.dropEdge() === "before"}>
        <span class="sui-data-table__drop-indicator" data-edge="before" aria-hidden="true" />
      </Show>
      <Show when={props.dropEdge() === "after"}>
        <span class="sui-data-table__drop-indicator" data-edge="after" aria-hidden="true" />
      </Show>
    </th>
  );
}

interface DataTableRowProps<Row> {
  readonly row: Row;
  readonly flat: FlatRow<Row>;
  readonly columns: readonly DataTableColumn<Row>[];
  readonly selected: boolean;
  readonly selectable: boolean;
  readonly onSelectionChange: ((key: string | number, selected: boolean) => void) | undefined;
  readonly onRowClick: ((row: Row) => void) | undefined;
  readonly onCellEdit: DataTableProps<Row>["onCellEdit"];
  readonly tree: boolean;
  readonly onToggleExpand: ((key: string | number) => void) | undefined;
  readonly loadingChildren: boolean;
  readonly showGrip: boolean;
  readonly draggingRow: () => boolean;
  readonly dropPosition: () => DataTableTreeDropPosition | null;
  readonly onGripPointerDown: (
    key: string | number,
    event: PointerEvent,
    node: HTMLElement,
  ) => void;
}

function DataTableRow<Row>(props: DataTableRowProps<Row>): Node {
  const [editingKey, setEditingKey] = createSignal<string | null>(null);

  const startEdit = (column: DataTableColumn<Row>, event: MouseEvent): void => {
    if (column.editable !== true || props.onCellEdit === undefined) return;
    if (
      event.target instanceof Element &&
      event.target.closest("button, input, a[href], select, textarea") !== null
    ) {
      return;
    }
    event.preventDefault();
    setEditingKey(column.key);
  };

  const commitEdit = (column: DataTableColumn<Row>, value: string): void => {
    if (editingKey() !== column.key) return;
    setEditingKey(null);
    props.onCellEdit?.({
      row: props.row,
      key: column.key,
      value,
      rowKey: props.flat.key,
    });
  };

  const rowLabel = `${String(props.flat.index + 1)}`;

  return (
    <tr
      class="sui-data-table__tr"
      data-key={String(props.flat.key)}
      data-index={props.flat.index}
      data-level={props.tree ? props.flat.level : undefined}
      data-selected={props.selected ? "" : undefined}
      data-expanded={props.flat.expanded ? "" : undefined}
      data-drop={props.dropPosition() ?? undefined}
      data-row-dragging={props.draggingRow() ? "" : undefined}
      tabindex={props.onRowClick !== undefined ? 0 : undefined}
      onClick={(event) => {
        if (props.onRowClick === undefined) return;
        if (event.target instanceof Element && event.target.closest("button, input, a[href], select, textarea") !== null) {
          return;
        }
        props.onRowClick(props.row);
      }}
      onKeyDown={(event) => {
        if (props.onRowClick === undefined) return;
        if (event.target !== event.currentTarget) return;
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        props.onRowClick(props.row);
      }}
    >
      <Show when={props.showGrip}>
        <td class="sui-data-table__td" data-grip="">
          <button
            class="sui-data-table__row-grip"
            type="button"
            aria-label={`Перетащить строку ${rowLabel}`}
            title="Перетащить строку"
            onPointerDown={(event: PointerEvent) => {
              props.onGripPointerDown(
                props.flat.key,
                event,
                event.currentTarget as HTMLElement,
              );
            }}
          >
            <GripIcon />
          </button>
        </td>
      </Show>
      <Show when={props.onSelectionChange !== undefined}>
        <td class="sui-data-table__td" data-select="">
          <TableCheckbox
            checked={() => props.selected}
            label={`Выбрать строку ${rowLabel}`}
            disabled={!props.selectable}
            onChange={(checked) => {
              props.onSelectionChange?.(props.flat.key, checked);
            }}
          />
        </td>
      </Show>
      {props.columns.map((column, columnIndex) => {
        const content = cellContent(column, props.row, props.flat.index);
        const showTree = props.tree && columnIndex === 0;
        const editing = (): boolean => editingKey() === column.key;
        return (
          <td
            class="sui-data-table__td"
            data-align={column.align ?? "start"}
            data-truncate={column.truncate === true ? "" : undefined}
            data-numeric={column.align === "end" ? "" : undefined}
            data-editable={
              column.editable === true && props.onCellEdit !== undefined ? "" : undefined
            }
            onDblClick={(event: MouseEvent) => {
              startEdit(column, event);
            }}
          >
            <Show
              when={editing}
              fallback={
                <Show
                  when={showTree}
                  fallback={
                    <span
                      class="sui-data-table__cell-content"
                      title={cellTitle(column, content)}
                    >
                      {content}
                    </span>
                  }
                >
                  <span
                    class="sui-data-table__tree-cell"
                    style={{ "padding-inline-start": `${String(props.flat.level * TREE_INDENT)}px` }}
                  >
                    <Show
                      when={props.flat.hasChildren}
                      fallback={<span class="sui-data-table__tree-spacer" aria-hidden="true" />}
                    >
                      <button
                        class="sui-data-table__tree-toggle"
                        type="button"
                        aria-label={props.flat.expanded ? "Свернуть ветку" : "Развернуть ветку"}
                        aria-expanded={props.flat.expanded ? "true" : "false"}
                        data-loading={props.loadingChildren ? "" : undefined}
                        onClick={(event) => {
                          event.stopPropagation();
                          props.onToggleExpand?.(props.flat.key);
                        }}
                        onKeyDown={(event: KeyboardEvent) => {
                          if (event.key === "ArrowRight" && !props.flat.expanded) {
                            event.preventDefault();
                            props.onToggleExpand?.(props.flat.key);
                          }
                          if (event.key === "ArrowLeft" && props.flat.expanded) {
                            event.preventDefault();
                            props.onToggleExpand?.(props.flat.key);
                          }
                        }}
                      >
                        <Show
                          when={props.flat.expanded}
                          fallback={<ChevronEndIcon size="sm" />}
                        >
                          <ExpandMoreIcon size="sm" />
                        </Show>
                      </button>
                    </Show>
                    <span
                      class="sui-data-table__cell-content"
                      title={cellTitle(column, content)}
                    >
                      {content}
                    </span>
                  </span>
                </Show>
              }
            >
              <input
                class="sui-data-table__cell-editor"
                type="text"
                aria-label={`Редактировать ${settingsLabelFor(column)}`}
                value={rawCellValue(props.row, column.key)}
                ref={(node: Element | null) => {
                  if (node instanceof HTMLInputElement) {
                    node.focus();
                    node.select();
                  }
                }}
                onClick={(event) => {
                  event.stopPropagation();
                }}
                onKeyDown={(event: KeyboardEvent) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    const target = event.currentTarget;
                    if (target instanceof HTMLInputElement) commitEdit(column, target.value);
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setEditingKey(null);
                  }
                }}
                onBlur={(event: FocusEvent) => {
                  const target = event.currentTarget;
                  if (target instanceof HTMLInputElement) commitEdit(column, target.value);
                }}
              />
            </Show>
          </td>
        );
      })}
    </tr>
  );
}

interface SettingsColumnRowProps {
  readonly columnKey: string;
  readonly label: string;
  readonly locked: boolean;
  readonly visible: boolean;
  readonly dragging: () => boolean;
  readonly dropEdge: () => "before" | "after" | null;
  readonly onToggle: (visible: boolean) => void;
  readonly onMove: (direction: -1 | 1) => void;
  readonly onPointerDown: (event: PointerEvent, node: HTMLElement) => void;
}

function SettingsColumnRow(props: SettingsColumnRowProps): Node {
  return (
    <li
      class="sui-data-table__settings-row"
      data-column-key={props.columnKey}
      data-locked={props.locked ? "" : undefined}
      data-dragging={props.dragging() ? "" : undefined}
      data-drop={props.dropEdge() ?? undefined}
      onPointerDown={(event: PointerEvent) => {
        if (props.locked) return;
        if (
          event.target instanceof Element &&
          event.target.closest("input, button") !== null
        ) {
          return;
        }
        props.onPointerDown(event, event.currentTarget as HTMLElement);
      }}
    >
      <Show when={props.dropEdge() === "before"}>
        <span class="sui-data-table__settings-drop" data-edge="before" aria-hidden="true" />
      </Show>
      <Show when={props.dropEdge() === "after"}>
        <span class="sui-data-table__settings-drop" data-edge="after" aria-hidden="true" />
      </Show>
      {props.locked ? null : (
        <span class="sui-data-table__settings-grip" aria-hidden="true">
          <GripIcon />
        </span>
      )}
      <label class="sui-data-table__settings-label">
        {props.locked ? (
          <span
            class="sui-data-table__settings-lock"
            title="Колонка заблокирована"
            aria-label="Колонка заблокирована"
          >
            <LockIcon />
          </span>
        ) : (
          <input
            type="checkbox"
            checked={props.visible}
            onChange={(event) => {
              const target = event.target;
              if (target instanceof HTMLInputElement) props.onToggle(target.checked);
            }}
          />
        )}
        <span>{props.label}</span>
      </label>
      {props.locked ? null : (
        <span class="sui-data-table__settings-move">
          <button
            class="sui-data-table__settings-move-button"
            type="button"
            aria-label="Выше"
            onClick={() => props.onMove(-1)}
          >
            ↑
          </button>
          <button
            class="sui-data-table__settings-move-button"
            type="button"
            aria-label="Ниже"
            onClick={() => props.onMove(1)}
          >
            ↓
          </button>
        </span>
      )}
    </li>
  );
}

type BodyEntry<Row> =
  | { readonly kind: "row"; readonly flat: FlatRow<Row>; readonly key: string }
  | { readonly kind: "spacer"; readonly key: string; readonly height: number };

export function DataTable<Row>(props: DataTableProps<Row>): Node {
  const config = useUiConfig();
  const pageSizeId = useId("data-table-page-size");
  const settingsTitleId = useId("data-table-settings");
  const [settings, setSettings] = createSignal<DataTableSettingsState>(EMPTY_SETTINGS);
  const [loaded, setLoaded] = createSignal(false);
  const [narrow, setNarrow] = createSignal(false);
  const [layoutOverride, setLayoutOverride] = createSignal<DataTableLayout | null>(null);
  const [scrollOverride, setScrollOverride] =
    createSignal<DataTableResolvedScrollMode | null>(null);
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [draggingKey, setDraggingKey] = createSignal<string | null>(null);
  const [armedKey, setArmedKey] = createSignal<string | null>(null);
  const [dropTarget, setDropTarget] = createSignal<DropTarget | null>(null);
  const [internalExpanded, setInternalExpanded] = createSignal<ReadonlySet<string>>(
    new Set((props.tree?.defaultExpandedKeys ?? []).map(String)),
  );
  const [tableElement, setTableElement] = createSignal<HTMLTableElement | null>(null);
  const [scrollElement, setScrollElement] = createSignal<HTMLElement | null>(null);
  const [settingsList, setSettingsList] = createSignal<HTMLUListElement | null>(null);
  const [densityOverride, setDensityOverride] = createSignal<DataTableDensity | null>(null);
  const [settingsDragKey, setSettingsDragKey] = createSignal<string | null>(null);
  const [settingsDrop, setSettingsDrop] = createSignal<DropTarget | null>(null);
  const [draggingRow, setDraggingRow] = createSignal<string | number | null>(null);
  const [rowDrop, setRowDrop] = createSignal<RowDropTarget | null>(null);

  let headerDrag: {
    key: string;
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
    order: readonly string[];
    moved: boolean;
    node: HTMLElement | null;
    tx: number;
    ty: number;
    lastX: number;
    lastY: number;
    frame: number | null;
  } | null = null;
  let settingsDrag: {
    key: string;
    startY: number;
    offsetY: number;
    order: readonly string[];
    moved: boolean;
    node: HTMLElement | null;
    ty: number;
    lastY: number;
    frame: number | null;
  } | null = null;
  let rowDrag: {
    key: string | number;
    row: Row;
    startY: number;
    moved: boolean;
    target: RowDropTarget | null;
    frame: number | null;
    lastY: number;
    pointerId: number | undefined;
    node: HTMLElement | null;
  } | null = null;
  let headerDragCleanup: (() => void) | null = null;
  let settingsDragCleanup: (() => void) | null = null;
  let rowDragCleanup: (() => void) | null = null;
  let suppressClick = false;
  let suppressTimer: number | null = null;

  const scheduleSuppressReset = (): void => {
    suppressClick = true;
    if (typeof window === "undefined") return;
    if (suppressTimer !== null) window.clearTimeout(suppressTimer);
    suppressTimer = window.setTimeout(() => {
      suppressTimer = null;
      suppressClick = false;
    }, 0);
  };

  onCleanup(() => {
    headerDragCleanup?.();
    settingsDragCleanup?.();
    rowDragCleanup?.();
    if (suppressTimer !== null && typeof window !== "undefined") {
      window.clearTimeout(suppressTimer);
    }
  });

  clientEffect(() => {
    const stored = readDataTableSettings(props.tableKey);
    setSettings({
      order: stored.order,
      widths: resolveColumnWidths(props.columns, stored.widths),
      visible: stored.visible ?? {},
      density: stored.density ?? null,
      layout: stored.layout ?? null,
      stickyHeader: stored.stickyHeader ?? null,
      stickyFooter: stored.stickyFooter ?? null,
      scrollMode: stored.scrollMode ?? null,
    });
    setDensityOverride(stored.density ?? null);
    setLoaded(true);
  });

  clientEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(NARROW_QUERY);
    const update = (): void => {
      setNarrow(query.matches);
    };
    update();
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", update);
      onCleanup(() => query.removeEventListener("change", update));
    }
  });

  const orderedAllColumns = createMemo(() =>
    orderColumns(props.columns, settings().order),
  );

  const isVisible = (column: DataTableColumn<Row>): boolean =>
    column.locked === true ||
    (settings().visible[column.key] ?? column.defaultVisible !== false);

  const orderedColumns = createMemo(() =>
    orderedAllColumns().filter((column) => isVisible(column)),
  );

  const orderedKeys = (): readonly string[] =>
    orderedAllColumns().map((column) => column.key);

  const effectiveWidth = (column: DataTableColumn<Row>): number | undefined =>
    resolveColumnWidth(column, settings().widths[column.key]);

  const density = (): DataTableDensity =>
    densityOverride() ?? settings().density ?? props.density ?? "standard";

  const rowHeight = (): number =>
    density() === "compact" ? ROW_HEIGHT_COMPACT : ROW_HEIGHT_STANDARD;

  const layout = (): DataTableLayout =>
    layoutOverride() ?? (narrow() ? "cards" : props.layout ?? settings().layout ?? "table");

  const stickyHeader = (): boolean =>
    props.stickyHeader ?? settings().stickyHeader ?? true;

  const stickyFooter = (): boolean =>
    props.stickyFooter ?? settings().stickyFooter ?? false;

  const scrollMode = (): DataTableResolvedScrollMode =>
    scrollOverride() ??
    resolveScrollMode(props.scrollMode) ??
    settings().scrollMode ??
    "internal";

  const internalScroll = (): boolean => scrollMode() === "internal";

  const persist = (next: DataTableSettingsState): void => {
    writeDataTableSettings(props.tableKey, next);
  };

  const commitSettings = (next: DataTableSettingsState): void => {
    setSettings(next);
    persist(next);
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

  const resizeCommit = (widths: Readonly<Record<string, number>>): void => {
    commitSettings({
      ...settings(),
      order: orderedKeys(),
      widths: sanitizeWidths(widths),
    });
  };

  const resizeReset = (key: string): void => {
    const widths = { ...settings().widths };
    delete widths[key];
    commitSettings({ ...settings(), order: orderedKeys(), widths });
  };

  const resetView = (): void => {
    setSettings(EMPTY_SETTINGS);
    setLayoutOverride(null);
    setDensityOverride(null);
    setScrollOverride(null);
    clearDataTableSettings(props.tableKey);
  };

  const preservesLocked = (order: readonly string[]): boolean => {
    const current = orderedKeys();
    return props.columns.every(
      (column) =>
        column.locked !== true || order.indexOf(column.key) === current.indexOf(column.key),
    );
  };

  const applyOrder = (
    order: readonly string[],
    persistOrder: boolean,
  ): boolean => {
    if (!preservesLocked(order)) return false;
    const table = tableElement();
    const list = settingsList();
    const headerBefore = snapshotRects(table, HEADER_SELECTOR);
    const settingsBefore = snapshotRects(list, SETTINGS_SELECTOR);
    if (persistOrder) {
      commitSettings({ ...settings(), order });
    } else {
      setSettings({ ...settings(), order });
    }
    animateReflow(headerBefore, tableElement(), HEADER_SELECTOR);
    animateReflow(settingsBefore, settingsList(), SETTINGS_SELECTOR);
    return true;
  };

  const insertionOrder = (
    current: readonly string[],
    fromKey: string,
    toKey: string,
    edge: "before" | "after",
  ): readonly string[] | null => {
    if (fromKey === toKey) return null;
    const from = current.indexOf(fromKey);
    const target = current.indexOf(toKey);
    if (from === -1 || target === -1) return null;
    const next = [...current];
    const [moved] = next.splice(from, 1);
    if (moved === undefined) return null;
    const targetIndex = next.indexOf(toKey);
    next.splice(edge === "after" ? targetIndex + 1 : targetIndex, 0, moved);
    return preservesLocked(next) ? next : null;
  };

  const moveColumn = (key: string, direction: -1 | 1): void => {
    const current = orderedKeys();
    const from = current.indexOf(key);
    const to = from + direction;
    if (from === -1 || to < 0 || to >= current.length) return;
    const target = current[to];
    if (target === undefined) return;
    const next = insertionOrder(current, key, target, direction < 0 ? "before" : "after");
    if (next !== null) applyOrder(next, true);
  };

  const setLayout = (next: DataTableLayout): void => {
    setLayoutOverride(next);
    props.onLayoutChange?.(next);
    commitSettings({ ...settings(), layout: next });
  };

  const toggleColumn = (key: string, visible: boolean): void => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    const column = props.columns.find((entry) => entry.key === key);
    if (column === undefined || column.locked === true) return;
    commitSettings({ ...settings(), visible: { ...settings().visible, [key]: visible } });
  };

  const changeDensity = (value: string): void => {
    const next: DataTableDensity = value === "compact" ? "compact" : "standard";
    setDensityOverride(next);
    commitSettings({ ...settings(), density: next });
  };

  const changeScrollMode = (value: string): void => {
    const next = resolveScrollMode(value as DataTableResolvedScrollMode) ?? "internal";
    setScrollOverride(next);
    commitSettings({ ...settings(), scrollMode: next });
  };

  const changeStickyHeader = (value: boolean): void => {
    commitSettings({ ...settings(), stickyHeader: value });
  };

  const changeStickyFooter = (value: boolean): void => {
    commitSettings({ ...settings(), stickyFooter: value });
  };

  const headerNode = (key: string): HTMLElement | null => {
    const table = tableElement();
    if (table === null) return null;
    for (const header of table.querySelectorAll<HTMLElement>(HEADER_SELECTOR)) {
      if (header.getAttribute("data-column-key") === key) return header;
    }
    return null;
  };

  const settingsNode = (key: string): HTMLElement | null => {
    const list = settingsList();
    if (list === null) return null;
    for (const row of list.querySelectorAll<HTMLElement>(SETTINGS_SELECTOR)) {
      if (row.getAttribute("data-column-key") === key) return row;
    }
    return null;
  };

  const clearHeaderTransform = (node: HTMLElement | null): void => {
    if (node === null) return;
    node.style.transition = "";
    node.style.transform = "";
    node.style.willChange = "";
    node.style.zIndex = "";
  };

  const positionHeaderDrag = (clientX: number, clientY: number): void => {
    const drag = headerDrag;
    if (drag === null || !drag.moved) return;
    const node = headerNode(drag.key);
    if (node === null) return;
    if (node !== drag.node) {
      drag.node = node;
      drag.tx = 0;
      drag.ty = 0;
    }
    const rect = node.getBoundingClientRect();
    drag.tx += clientX - drag.offsetX - rect.left;
    drag.ty += clientY - drag.offsetY - rect.top;
    node.style.transition = "none";
    node.style.transform = `translate3d(${String(drag.tx)}px, ${String(drag.ty)}px, 0)`;
    node.style.zIndex = "30";
    node.style.willChange = "transform";
  };

  const positionSettingsDrag = (clientY: number): void => {
    const drag = settingsDrag;
    if (drag === null || !drag.moved) return;
    const node = settingsNode(drag.key);
    if (node === null) return;
    if (node !== drag.node) {
      drag.node = node;
      drag.ty = 0;
    }
    const rect = node.getBoundingClientRect();
    drag.ty += clientY - drag.offsetY - rect.top;
    node.style.transition = "none";
    node.style.transform = `translate3d(0, ${String(drag.ty)}px, 0)`;
    node.style.zIndex = "5";
    node.style.willChange = "transform";
  };

  const findHeaderTarget = (clientX: number, draggedKey: string): DropTarget | null => {
    const table = tableElement();
    if (table === null) return null;
    let fallback: DropTarget | null = null;
    for (const header of table.querySelectorAll<HTMLElement>(HEADER_SELECTOR)) {
      const key = header.getAttribute("data-column-key");
      if (key === null || key === draggedKey) continue;
      const rect = header.getBoundingClientRect();
      if (rect.width <= 0) continue;
      const midpoint = rect.left + rect.width / 2;
      const edge: "before" | "after" = clientX < midpoint ? "before" : "after";
      if (clientX >= rect.left && clientX <= rect.right) {
        const distance = Math.abs(clientX - midpoint);
        const previous = dropTarget();
        if (
          previous !== null &&
          previous.key === key &&
          previous.edge !== edge &&
          distance < DRAG_HYSTERESIS
        ) {
          return previous;
        }
        return { key, edge };
      }
      if (fallback === null && clientX < rect.left) {
        fallback = { key, edge: "before" };
      }
    }
    return fallback;
  };

  const findSettingsTarget = (clientY: number, draggedKey: string): DropTarget | null => {
    const list = settingsList();
    if (list === null) return null;
    for (const row of list.querySelectorAll<HTMLElement>(SETTINGS_SELECTOR)) {
      const key = row.getAttribute("data-column-key");
      if (key === null || key === draggedKey) continue;
      const rect = row.getBoundingClientRect();
      if (rect.height <= 0) continue;
      const midpoint = rect.top + rect.height / 2;
      if (clientY < rect.top || clientY > rect.bottom) continue;
      const edge: "before" | "after" = clientY < midpoint ? "before" : "after";
      const distance = Math.abs(clientY - midpoint);
      const previous = settingsDrop();
      if (
        previous !== null &&
        previous.key === key &&
        previous.edge !== edge &&
        distance < DRAG_HYSTERESIS
      ) {
        return previous;
      }
      return { key, edge };
    }
    return null;
  };

  const requestFrame = (callback: () => void): number | null => {
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      return window.requestAnimationFrame(callback);
    }
    callback();
    return null;
  };

  const cancelFrame = (frame: number | null): void => {
    if (
      frame !== null &&
      typeof window !== "undefined" &&
      typeof window.cancelAnimationFrame === "function"
    ) {
      window.cancelAnimationFrame(frame);
    }
  };

  const onHeaderPointerDown = (key: string, event: PointerEvent, node: HTMLElement): void => {
    if (event.button !== 0) return;
    if (
      event.target instanceof Element &&
      event.target.closest(".sui-data-table__resizer") !== null
    ) {
      return;
    }
    suppressClick = false;
    const rect = node.getBoundingClientRect();
    headerDrag = {
      key,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      order: orderedKeys(),
      moved: false,
      node,
      tx: 0,
      ty: 0,
      lastX: event.clientX,
      lastY: event.clientY,
      frame: null,
    };
    const pointerId = (event as PointerEvent & { pointerId?: number }).pointerId;
    if (pointerId !== undefined && typeof node.setPointerCapture === "function") {
      try {
        node.setPointerCapture(pointerId);
      } catch {
        // jsdom
      }
    }
    const updateTarget = (): void => {
      const current = headerDrag;
      if (current === null || !current.moved) return;
      const target = findHeaderTarget(current.lastX, current.key);
      if (target === null) {
        setDropTarget(null);
        return;
      }
      const next = insertionOrder(current.order, current.key, target.key, target.edge);
      setDropTarget(next === null ? null : target);
    };
    const move = (moveEvent: PointerEvent): void => {
      const current = headerDrag;
      if (current === null) return;
      const dx = moveEvent.clientX - current.startX;
      const dy = moveEvent.clientY - current.startY;
      if (!current.moved) {
        if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
        current.moved = true;
        suppressClick = true;
        setDraggingKey(current.key);
      }
      current.lastX = moveEvent.clientX;
      current.lastY = moveEvent.clientY;
      positionHeaderDrag(moveEvent.clientX, moveEvent.clientY);
      if (current.frame !== null) return;
      current.frame = requestFrame(() => {
        if (current !== null) current.frame = null;
        updateTarget();
      });
    };
    const finish = (commit: boolean): void => {
      headerDragCleanup?.();
      headerDragCleanup = null;
      const current = headerDrag;
      headerDrag = null;
      if (current === null) return;
      cancelFrame(current.frame);
      if (pointerId !== undefined && typeof node.releasePointerCapture === "function") {
        try {
          node.releasePointerCapture(pointerId);
        } catch {
          // jsdom
        }
      }
      if (!current.moved) {
        clearHeaderTransform(current.node);
        setDraggingKey(null);
        setDropTarget(null);
        return;
      }
      const before = snapshotRects(tableElement(), HEADER_SELECTOR);
      const nodeNow = headerNode(current.key) ?? current.node;
      clearHeaderTransform(nodeNow);
      setDraggingKey(null);
      setDropTarget(null);
      if (commit) {
        const target = findHeaderTarget(current.lastX, current.key);
        const order =
          target === null
            ? null
            : insertionOrder(current.order, current.key, target.key, target.edge);
        if (order !== null) {
          commitSettings({ ...settings(), order });
          scheduleSuppressReset();
        }
      }
      animateReflow(before, tableElement(), HEADER_SELECTOR);
      setArmedKey(null);
    };
    const onUp = (): void => {
      finish(true);
    };
    const onCancel = (): void => {
      finish(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    headerDragCleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  };

  const onSettingsPointerDown = (
    key: string,
    event: PointerEvent,
    node: HTMLElement,
  ): void => {
    if (event.button !== 0) return;
    suppressClick = false;
    if (
      event.target instanceof Element &&
      event.target.closest("input, button") !== null
    ) {
      return;
    }
    const rect = node.getBoundingClientRect();
    settingsDrag = {
      key,
      startY: event.clientY,
      offsetY: event.clientY - rect.top,
      order: orderedKeys(),
      moved: false,
      node,
      ty: 0,
      lastY: event.clientY,
      frame: null,
    };
    const pointerId = (event as PointerEvent & { pointerId?: number }).pointerId;
    if (pointerId !== undefined && typeof node.setPointerCapture === "function") {
      try {
        node.setPointerCapture(pointerId);
      } catch {
        // jsdom
      }
    }
    const updateTarget = (): void => {
      const current = settingsDrag;
      if (current === null || !current.moved) return;
      const target = findSettingsTarget(current.lastY, current.key);
      if (target === null) {
        setSettingsDrop(null);
        return;
      }
      const next = insertionOrder(current.order, current.key, target.key, target.edge);
      setSettingsDrop(next === null ? null : target);
    };
    const move = (moveEvent: PointerEvent): void => {
      const current = settingsDrag;
      if (current === null) return;
      const dy = moveEvent.clientY - current.startY;
      if (!current.moved) {
        if (Math.abs(dy) < DRAG_THRESHOLD) return;
        current.moved = true;
        suppressClick = true;
        setSettingsDragKey(current.key);
      }
      current.lastY = moveEvent.clientY;
      positionSettingsDrag(moveEvent.clientY);
      if (current.frame !== null) return;
      current.frame = requestFrame(() => {
        if (current !== null) current.frame = null;
        updateTarget();
      });
    };
    const finish = (commit: boolean): void => {
      settingsDragCleanup?.();
      settingsDragCleanup = null;
      const current = settingsDrag;
      settingsDrag = null;
      if (current === null) return;
      cancelFrame(current.frame);
      if (pointerId !== undefined && typeof node.releasePointerCapture === "function") {
        try {
          node.releasePointerCapture(pointerId);
        } catch {
          // jsdom
        }
      }
      if (!current.moved) {
        clearHeaderTransform(current.node);
        setSettingsDragKey(null);
        setSettingsDrop(null);
        return;
      }
      const before = snapshotRects(settingsList(), SETTINGS_SELECTOR);
      const nodeNow = settingsNode(current.key) ?? current.node;
      clearHeaderTransform(nodeNow);
      setSettingsDragKey(null);
      setSettingsDrop(null);
      if (commit) {
        const target = findSettingsTarget(current.lastY, current.key);
        const order =
          target === null
            ? null
            : insertionOrder(current.order, current.key, target.key, target.edge);
        if (order !== null) {
          commitSettings({ ...settings(), order });
          scheduleSuppressReset();
        }
      }
      animateReflow(before, settingsList(), SETTINGS_SELECTOR);
    };
    const onUp = (): void => {
      finish(true);
    };
    const onCancel = (): void => {
      finish(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    settingsDragCleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  };

  const focusHeader = (key: string): void => {
    if (typeof window === "undefined") return;
    const apply = (): void => {
      const table = tableElement();
      if (table === null) return;
      const node = [...table.querySelectorAll<HTMLElement>(HEADER_SELECTOR)].find(
        (header) => header.getAttribute("data-column-key") === key,
      );
      node?.focus();
    };
    queueMicrotask(apply);
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(apply);
    }
  };

  const onHeaderKeyDown = (key: string, event: KeyboardEvent): void => {
    suppressClick = false;
    if (event.target !== event.currentTarget) return;
    if (event.key === " " || event.key === "Spacebar" || event.key === "Enter") {
      event.preventDefault();
      setArmedKey(armedKey() === key ? null : key);
      return;
    }
    if (event.key === "Escape") {
      setArmedKey(null);
      return;
    }
    if (armedKey() !== key) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    moveColumn(key, event.key === "ArrowLeft" ? -1 : 1);
    focusHeader(key);
  };

  const selection = (): DataTableSelection | undefined => props.selection;

  const isSelectable = (row: Row, index: number): boolean => {
    const current = selection();
    if (current === undefined) return false;
    if (current.isRowSelectable === undefined) return true;
    return current.isRowSelectable(row, index);
  };

  const expandedKeys = (): ReadonlySet<string> => {
    const external = props.tree?.expandedKeys;
    if (external === undefined) return internalExpanded();
    return new Set([...external].map(String));
  };

  const toggleExpand = (key: string | number): void => {
    if (props.tree === undefined) return;
    const current = new Set(expandedKeys());
    const stringKey = String(key);
    if (current.has(stringKey)) {
      current.delete(stringKey);
    } else {
      current.add(stringKey);
      const flat = flatRows().find((entry) => entry.key === key);
      if (flat !== undefined && flat.hasChildren) {
        props.tree.onLoadChildren?.(flat.row);
      }
    }
    if (props.tree.expandedKeys === undefined) setInternalExpanded(current);
    props.tree.onExpandedChange?.(current);
  };

  const flatRows = createMemo<readonly FlatRow<Row>[]>(() => {
    const tree = props.tree;
    const query = tree?.getSearchText !== undefined
      ? (tree.searchQuery ?? "").trim().toLowerCase()
      : "";
    const expanded = expandedKeys();
    const result: FlatRow<Row>[] = [];
    let counter = 0;

    const matches = (row: Row): boolean =>
      query === "" ||
      tree?.getSearchText === undefined ||
      tree.getSearchText(row).toLowerCase().includes(query);

    const hasMatchingDescendant = (row: Row): boolean => {
      if (tree === undefined) return false;
      return tree.getChildren(row).some(
        (child) => matches(child) || hasMatchingDescendant(child),
      );
    };

    const walk = (
      rows: readonly Row[],
      level: number,
      parentKey: string | number | null,
    ): void => {
      for (const row of rows) {
        if (tree !== undefined && query !== "" && !matches(row) && !hasMatchingDescendant(row)) {
          continue;
        }
        const index = counter;
        counter += 1;
        const key = props.rowKey(row, index);
        const children = tree === undefined ? [] : tree.getChildren(row);
        const hasChildren =
          tree !== undefined &&
          (children.length > 0 || tree.hasChildren?.(row) === true);
        const isExpanded =
          tree !== undefined &&
          (expanded.has(String(key)) || (query !== "" && hasChildren));
        result.push({ row, key, index, level, parentKey, hasChildren, expanded: isExpanded });
        if (hasChildren && isExpanded) {
          walk(children, level + 1, key);
        }
      }
    };

    walk(props.rows, 0, null);
    return result;
  });

  const childrenIndex = createMemo(() => {
    const index = new Map<string, (string | number)[]>();
    for (const entry of flatRows()) {
      if (entry.parentKey === null) continue;
      const parent = String(entry.parentKey);
      const list = index.get(parent);
      if (list === undefined) index.set(parent, [entry.key]);
      else list.push(entry.key);
    }
    return index;
  });

  const descendantKeys = (key: string | number): readonly (string | number)[] => {
    const keys: (string | number)[] = [];
    const stack = [...(childrenIndex().get(String(key)) ?? [])];
    while (stack.length > 0) {
      const next = stack.pop();
      if (next === undefined) continue;
      keys.push(next);
      stack.push(...(childrenIndex().get(String(next)) ?? []));
    }
    return keys;
  };

  const toggleSelection = (key: string | number, selected: boolean): void => {
    const current = selection();
    if (current === undefined) return;
    const next = new Set(current.selected);
    const keys = props.tree?.cascadeSelection === true
      ? [key, ...descendantKeys(key)]
      : [key];
    for (const item of keys) {
      if (selected) {
        next.add(item);
      } else {
        next.delete(item);
      }
    }
    current.onChange(next);
  };

  const selectableRows = (): readonly FlatRow<Row>[] =>
    flatRows().filter((entry) => isSelectable(entry.row, entry.index));

  const selectedCount = (): number => {
    const current = selection();
    if (current === undefined) return 0;
    return selectableRows().reduce(
      (count, entry) => count + (current.selected.has(entry.key) ? 1 : 0),
      0,
    );
  };
  const allSelected = (): boolean => {
    const rows = selectableRows();
    return rows.length > 0 && selectedCount() === rows.length;
  };
  const someSelected = (): boolean => selectedCount() > 0 && !allSelected();

  const toggleAll = (checked: boolean): void => {
    const current = selection();
    if (current === undefined) return;
    const next = new Set(current.selected);
    for (const entry of selectableRows()) {
      if (checked) {
        next.add(entry.key);
      } else {
        next.delete(entry.key);
      }
    }
    current.onChange(next);
  };

  const clearSelection = (): void => {
    selection()?.onChange(new Set());
  };

  const handleRowActivate = (row: Row): void => {
    const current = selection();
    if (current?.selectOnRowClick === true) {
      const entry = flatRows().find((candidate) => candidate.row === row);
      if (entry !== undefined && isSelectable(entry.row, entry.index)) {
        toggleSelection(entry.key, !current.selected.has(entry.key));
      }
    }
    props.onRowClick?.(row);
  };

  const rowsInteractive = (): boolean =>
    props.onRowClick !== undefined || selection()?.selectOnRowClick === true;

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

  const hasError = (): boolean => props.error !== undefined && props.error !== null;
  const isLoading = (): boolean => props.loading === true;
  const isEmpty = (): boolean => props.rows.length === 0;

  const bodyRows = (): number => {
    const size = Number.isFinite(props.pageSize) && props.pageSize > 0
      ? Math.trunc(props.pageSize)
      : 0;
    if (props.total > 0) return Math.min(Math.max(size, props.rows.length), props.total);
    return Math.max(size, props.rows.length, 1);
  };

  const skeletonRows = (): readonly number[] => {
    const count = Math.min(Math.max(1, bodyRows()), MAX_SKELETON_ROWS);
    return Array.from({ length: count }, (_value, index) => index);
  };

  const fillerRows = (): readonly number[] => {
    if (isLoading() || hasError() || isEmpty()) return [];
    if (virtualEnabled()) return [];
    const missing = bodyRows() - flatRows().length;
    if (missing <= 0) return [];
    return Array.from(
      { length: Math.min(missing, MAX_FILLER_ROWS) },
      (_value, index) => index,
    );
  };

  const columnCount = (): number =>
    orderedColumns().length +
    (selection() === undefined ? 0 : 1) +
    (treeDragEnabled() ? 1 : 0);

  const tableLabel = (): string => {
    const value = props.attrs?.["aria-label"];
    return typeof value === "string" && value !== "" ? value : "Таблица данных";
  };
  const tableLabelledBy = (): string | undefined => {
    const value = props.attrs?.["aria-labelledby"];
    return typeof value === "string" && value !== "" ? value : undefined;
  };

  const cardContext = (entry: FlatRow<Row>): DataTableCardContext => ({
    selected: selection()?.selected.has(entry.key) === true,
    index: entry.index,
    level: entry.level,
    expanded: entry.expanded,
    hasChildren: entry.hasChildren,
    toggleExpand: () => toggleExpand(entry.key),
  });

  const cardColumn = (slot: string): DataTableColumn<Row> | undefined =>
    orderedColumns().find((column) => column.card?.slot === slot);

  const defaultCard = (entry: FlatRow<Row>): Children => {
    const columns = orderedColumns().filter((column) => column.card?.hidden !== true);
    const hasSlots = columns.some((column) => column.card?.slot !== undefined);
    const actionColumn =
      cardColumn("actions") ?? columns.find((column) => column.key === "actions");
    const body = columns.filter((column) => column !== actionColumn);
    const primary = cardColumn("primary") ?? body[0];
    const fallback = body.filter((column) => column !== primary);
    const secondary = cardColumn("secondary") ?? (hasSlots ? undefined : fallback[0]);
    const badge = cardColumn("badge");
    const meta = hasSlots
      ? body.filter((column) => column.card?.slot === "meta" && column !== primary)
      : fallback.filter((column) => column !== secondary);
    return (
      <div class="sui-data-table__card-default">
        <div class="sui-data-table__card-head">
          <Show when={primary !== undefined}>
            <span class="sui-data-table__card-primary">
              {primary === undefined ? null : cellContent(primary, entry.row, entry.index)}
            </span>
          </Show>
          <Show when={badge !== undefined}>
            <span class="sui-data-table__card-badge">
              {badge === undefined ? null : cellContent(badge, entry.row, entry.index)}
            </span>
          </Show>
        </div>
        <Show when={secondary !== undefined}>
          <p class="sui-data-table__card-secondary">
            {secondary === undefined ? null : cellContent(secondary, entry.row, entry.index)}
          </p>
        </Show>
        <Show when={meta.length > 0}>
          <dl class="sui-data-table__card-meta">
            {meta.map((column) => (
              <div class="sui-data-table__card-meta-row">
                <dt>{column.card?.label ?? column.header}</dt>
                <dd>{cellContent(column, entry.row, entry.index)}</dd>
              </div>
            ))}
          </dl>
        </Show>
        <Show when={actionColumn !== undefined}>
          <div class="sui-data-table__card-actions">
            {actionColumn === undefined
              ? null
              : cellContent(actionColumn, entry.row, entry.index)}
          </div>
        </Show>
      </div>
    );
  };

  const renderCardEntry = (entry: FlatRow<Row>): Children =>
    props.renderCard !== undefined
      ? props.renderCard(entry.row, cardContext(entry))
      : defaultCard(entry);

  const treeDragEnabled = (): boolean =>
    props.tree !== undefined && props.tree.onMove !== undefined;

  const virtualEnabled = (): boolean =>
    props.virtual !== false &&
    layout() === "table" &&
    internalScroll() &&
    flatRows().length > VIRTUAL_THRESHOLD;

  const virtualizer = createVirtualizer({
    count: () => (virtualEnabled() ? flatRows().length : 0),
    estimateSize: () => rowHeight(),
    getItemKey: (index) => {
      const entry = flatRows()[index];
      return entry === undefined ? index : entry.key;
    },
    overscan: () => props.virtualOverscan ?? VIRTUAL_OVERSCAN,
    initialViewportSize: 480,
  });

  clientEffect(() => {
    const node = scrollElement();
    virtualizer.setScrollElement(null);
    if (node === null || !virtualEnabled()) return;
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

  const bodyEntries = createMemo<readonly BodyEntry<Row>[]>(() => {
    const rows = flatRows();
    if (!virtualEnabled()) {
      return rows.map((flat) => ({ kind: "row" as const, flat, key: String(flat.key) }));
    }
    const items = virtualizer.virtualItems();
    const total = virtualizer.totalSize();
    const visible: BodyEntry<Row>[] = items
      .map((item) => rows[item.index])
      .filter((flat): flat is FlatRow<Row> => flat !== undefined)
      .map((flat) => ({ kind: "row" as const, flat, key: String(flat.key) }));
    const first = items[0];
    const last = items[items.length - 1];
    const top = first === undefined ? 0 : Math.max(0, first.start);
    const bottom = last === undefined ? 0 : Math.max(0, total - last.end);
    const result: BodyEntry<Row>[] = [];
    if (top > 0) {
      result.push({ kind: "spacer", key: SPACER_TOP_KEY, height: top });
    }
    result.push(...visible);
    if (bottom > 0) {
      result.push({ kind: "spacer", key: SPACER_BOTTOM_KEY, height: bottom });
    }
    return result;
  });

  const scrollToRow = (
    key: string | number,
    align: "start" | "center" | "end" | "auto" = "auto",
  ): void => {
    const index = flatRows().findIndex((entry) => entry.key === key);
    if (index === -1) return;
    if (virtualEnabled()) {
      virtualizer.scrollToIndex(index, { align });
      return;
    }
    const scroller = scrollElement();
    const table = tableElement();
    if (scroller === null || table === null) return;
    const row = table.querySelector<HTMLElement>(`tbody tr[data-key="${String(key)}"]`);
    if (row === null) return;
    const rowRect = row.getBoundingClientRect();
    const scrollRect = scroller.getBoundingClientRect();
    const header = HEADER_HEIGHT;
    let delta = 0;
    if (align === "start") delta = rowRect.top - scrollRect.top - header;
    else if (align === "center") delta = rowRect.top - scrollRect.top - (scroller.clientHeight - rowRect.height) / 2;
    else if (align === "end") delta = rowRect.bottom - scrollRect.bottom;
    else if (rowRect.top < scrollRect.top + header) delta = rowRect.top - scrollRect.top - header;
    else if (rowRect.bottom > scrollRect.bottom) delta = rowRect.bottom - scrollRect.bottom;
    if (delta !== 0) scroller.scrollTop += delta;
  };

  const api: DataTableApi = {
    scrollToRow,
    scrollToTop: () => {
      const scroller = scrollElement();
      if (scroller !== null) scroller.scrollTop = 0;
      else if (typeof window !== "undefined") window.scrollTo({ top: 0 });
    },
  };

  clientEffect(() => {
    props.onReady?.(api);
  });

  const rowDragDescendant = (dragged: Row, target: Row): boolean => {
    const tree = props.tree;
    if (tree === undefined) return false;
    const targetKey = String(props.rowKey(target, 0));
    const stack: Row[] = [...tree.getChildren(dragged)];
    while (stack.length > 0) {
      const next = stack.pop();
      if (next === undefined) continue;
      if (String(props.rowKey(next, 0)) === targetKey) return true;
      stack.push(...tree.getChildren(next));
    }
    return false;
  };

  const rowDropAllowed = (
    row: Row,
    target: Row,
    position: DataTableTreeDropPosition,
  ): boolean => {
    if (props.tree === undefined) return false;
    if (row === target) return false;
    if (rowDragDescendant(row, target)) return false;
    if (props.tree.canDrop !== undefined) {
      return props.tree.canDrop(
        { row, target, position },
        {
          rowKey: props.rowKey(row, 0),
          targetKey: props.rowKey(target, 0),
        },
      );
    }
    return true;
  };

  const findRowDropTarget = (clientY: number): RowDropTarget | null => {
    const table = tableElement();
    if (table === null) return null;
    for (const row of table.querySelectorAll<HTMLElement>("tbody tr[data-key]")) {
      const key = row.getAttribute("data-key");
      if (key === null) continue;
      const entry = flatRows().find((candidate) => String(candidate.key) === key);
      if (entry === undefined) continue;
      const rect = row.getBoundingClientRect();
      if (rect.height <= 0) continue;
      if (clientY < rect.top || clientY > rect.bottom) continue;
      const ratio = (clientY - rect.top) / rect.height;
      const position: DataTableTreeDropPosition =
        ratio < 0.25 ? "before" : ratio > 0.75 ? "after" : "inside";
      return { key: entry.key, position };
    }
    return null;
  };

  const onGripPointerDown = (
    key: string | number,
    event: PointerEvent,
    node: HTMLElement,
  ): void => {
    if (event.button !== 0 || props.tree === undefined || props.tree.onMove === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    const entry = flatRows().find((candidate) => candidate.key === key);
    if (entry === undefined) return;
    rowDrag = {
      key,
      row: entry.row,
      startY: event.clientY,
      moved: false,
      target: null,
      frame: null,
      lastY: event.clientY,
      pointerId: (event as PointerEvent & { pointerId?: number }).pointerId,
      node,
    };
    const updateTarget = (): void => {
      const current = rowDrag;
      if (current === null || !current.moved) return;
      const target = findRowDropTarget(current.lastY);
      if (target === null) {
        setRowDrop(null);
        return;
      }
      const targetEntry = flatRows().find((candidate) => candidate.key === target.key);
      if (targetEntry === undefined) {
        setRowDrop(null);
        return;
      }
      const allowed = rowDropAllowed(current.row, targetEntry.row, target.position);
      setRowDrop(allowed ? target : null);
    };
    const move = (moveEvent: PointerEvent): void => {
      const current = rowDrag;
      if (current === null) return;
      if (!current.moved) {
        if (Math.abs(moveEvent.clientY - current.startY) < DRAG_THRESHOLD) return;
        current.moved = true;
        setDraggingRow(current.key);
      }
      current.lastY = moveEvent.clientY;
      if (current.frame !== null) return;
      current.frame = requestFrame(() => {
        if (current !== null) current.frame = null;
        updateTarget();
      });
    };
    const finish = (commit: boolean): void => {
      rowDragCleanup?.();
      rowDragCleanup = null;
      const current = rowDrag;
      rowDrag = null;
      if (current === null) return;
      cancelFrame(current.frame);
      setDraggingRow(null);
      setRowDrop(null);
      if (!commit || !current.moved || props.tree?.onMove === undefined) return;
      const target = findRowDropTarget(current.lastY);
      if (target === null) return;
      const targetEntry = flatRows().find((candidate) => candidate.key === target.key);
      if (targetEntry === undefined) return;
      if (!rowDropAllowed(current.row, targetEntry.row, target.position)) return;
      if (target.position === "inside") {
        const wasExpanded = targetEntry.expanded;
        if (!wasExpanded) toggleExpand(targetEntry.key);
      }
      props.tree.onMove({
        row: current.row,
        target: targetEntry.row,
        position: target.position,
      });
    };
    const onUp = (): void => {
      finish(true);
    };
    const onCancel = (): void => {
      finish(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    rowDragCleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  };

  const selectionBar = (): Node => (
    <div
      class="sui-data-table__selection-bar"
      data-position={props.selectionBarPosition ?? "bottom"}
      role="toolbar"
      aria-label="Действия с выбранными строками"
    >
      <span class="sui-data-table__selection-count">
        {`Выбрано: ${String(selectedCount())}`}
      </span>
      <Button
        variant="text"
        size="sm"
        onClick={() => toggleAll(true)}
        attrs={{ "data-action": "select-all" }}
      >
        Выбрать всё
      </Button>
      <Button
        variant="text"
        size="sm"
        onClick={clearSelection}
        attrs={{ "data-action": "clear-selection" }}
      >
        Очистить
      </Button>
      <Show when={selection()?.actions !== undefined}>
        <div class="sui-data-table__selection-actions">{selection()?.actions}</div>
      </Show>
    </div>
  );

  const scrollInlineStyle = (): StyleInput => {
    const base: Record<string, string | number> = {
      "--sui-data-table-row-size": `${String(rowHeight())}px`,
      "--sui-data-table-head-size": `${String(HEADER_HEIGHT)}px`,
      "--sui-data-table-page-rows": String(bodyRows()),
    };
    if (props.scrollHeight !== undefined) {
      base["--sui-data-table-max-block"] = props.scrollHeight;
    }
    return base;
  };

  const scrollBodyStyle = (): StyleInput | undefined =>
    internalScroll()
      ? { blockSize: `${String(HEADER_HEIGHT + bodyRows() * rowHeight())}px` }
      : undefined;

  return (
    <div
      {...props.attrs}
      class={["sui-data-table", props.class]}
      style={[scrollInlineStyle(), props.style]}
      data-density={density()}
      data-layout={layout()}
      data-loading={isLoading() ? "" : undefined}
      data-loaded={loaded() ? "" : undefined}
      data-scroll={scrollMode()}
      data-virtual={virtualEnabled() ? "" : undefined}
      data-sticky-footer={stickyFooter() ? "" : undefined}
    >
      <Show when={props.title !== undefined || props.subtitle !== undefined}>
        <header class="sui-data-table__header">
          <div class="sui-data-table__heading">
            <Show when={props.title !== undefined}>
              <h2 class="sui-data-table__title">{props.title}</h2>
            </Show>
            <Show when={props.subtitle !== undefined}>
              <p class="sui-data-table__subtitle">{props.subtitle}</p>
            </Show>
          </div>
        </header>
      </Show>
      <div class="sui-data-table__toolbar">
        <div class="sui-data-table__toolbar-slot">{props.toolbar}</div>
        <div class="sui-data-table__toolbar-actions">
          {resolveSlot(props.actions) as Child}
          <Show when={layout() === "cards"}>
            <label class="sui-data-table__card-sort">
              <span class="sui-data-table__visually-hidden">Сортировка</span>
              <select
                class="sui-data-table__select"
                value={
                  props.sortKey === undefined || props.sortDirection === undefined
                    ? ""
                    : `${props.sortKey}:${props.sortDirection}`
                }
                onChange={(event) => {
                  const target = event.target;
                  if (!(target instanceof HTMLSelectElement)) return;
                  const [key, direction] = target.value.split(":");
                  if (key === undefined || key === "") return;
                  props.onSort?.(
                    key,
                    direction === "descending" ? "descending" : "ascending",
                  );
                }}
              >
                <option value="" selected={props.sortKey === undefined}>
                  Сортировка
                </option>
                {orderedColumns()
                  .filter((column) => column.sortable === true)
                  .map((column) => (
                    <option
                      value={`${column.key}:ascending`}
                      selected={
                        props.sortKey === column.key &&
                        props.sortDirection === "ascending"
                      }
                    >
                      {`${typeof column.header === "string" ? column.header : column.key} ↑`}
                    </option>
                  ))}
                {orderedColumns()
                  .filter((column) => column.sortable === true)
                  .map((column) => (
                    <option
                      value={`${column.key}:descending`}
                      selected={
                        props.sortKey === column.key &&
                        props.sortDirection === "descending"
                      }
                    >
                      {`${typeof column.header === "string" ? column.header : column.key} ↓`}
                    </option>
                  ))}
              </select>
            </label>
          </Show>
          <div
            class="sui-data-table__view-toggle"
            role="group"
            aria-label={config.strings.layout ?? "Раскладка таблицы"}
          >
            <button
              type="button"
              class="sui-data-table__view-option"
              data-layout-target="table"
              aria-pressed={layout() === "table" ? "true" : "false"}
              title={config.strings.tableView ?? "Таблица"}
              onClick={() => setLayout("table")}
            >
              <TableIcon />
              <span class="sui-data-table__visually-hidden">
                {config.strings.tableView ?? "Таблица"}
              </span>
            </button>
            <button
              type="button"
              class="sui-data-table__view-option"
              data-layout-target="cards"
              aria-pressed={layout() === "cards" ? "true" : "false"}
              title={config.strings.cardsView ?? "Карточки"}
              onClick={() => setLayout("cards")}
            >
              <CardsIcon />
              <span class="sui-data-table__visually-hidden">
                {config.strings.cardsView ?? "Карточки"}
              </span>
            </button>
          </div>
          <Button
            variant="text"
            size="sm"
            class="sui-data-table__scroll-toggle"
            attrs={{
              "data-action": "toggle-scroll-mode",
              "aria-pressed": internalScroll() ? "true" : "false",
            }}
            onClick={() => {
              changeScrollMode(internalScroll() ? "external" : "internal");
            }}
          >
            {internalScroll() ? "Скролл: внутри" : "Скролл: страница"}
          </Button>
          <Show when={props.settings !== false}>
            <IconButton
              size="sm"
              variant="standard"
              label="Настройки таблицы"
              onClick={() => setSettingsOpen(true)}
            >
              <MoreVertIcon size="sm" />
            </IconButton>
            <Button
              variant="text"
              size="sm"
              class="sui-data-table__reset"
              attrs={{ "data-testid": "data-table-reset" }}
              onClick={resetView}
            >
              Сбросить вид
            </Button>
          </Show>
        </div>
      </div>
      <Show when={(props.selectionBarPosition ?? "bottom") === "top" && selectedCount() > 0}>
        {selectionBar()}
      </Show>
      <Show
        when={layout() === "table"}
        fallback={
          <div class="sui-data-table__cards" role="list">
            <Show when={isLoading()}>
              {skeletonRows().map(() => (
                <div class="sui-data-table__card-skeleton" aria-hidden="true">
                  <Skeleton variant="text" width="60%" />
                  <Skeleton variant="text" width="90%" />
                  <Skeleton variant="text" width="40%" />
                </div>
              ))}
            </Show>
            <Show when={!isLoading() && hasError()}>
              <div class="sui-data-table__error" role="alert">{props.error}</div>
            </Show>
            <Show when={!isLoading() && !hasError() && isEmpty()}>
              <div class="sui-data-table__empty">
                {props.empty !== undefined && props.empty !== null ? (
                  props.empty
                ) : (
                  <EmptyState compact title={config.strings.noData} />
                )}
              </div>
            </Show>
            <Show when={!isLoading() && !hasError() && !isEmpty()}>
              <For each={flatRows()} keyOf={(entry) => entry.key}>
                {(entry) => (
                  <article
                    class="sui-data-table__card"
                    role="listitem"
                    data-selected={selection()?.selected.has(entry.key) === true ? "" : undefined}
                    data-level={props.tree === undefined ? undefined : entry.level}
                    tabindex={rowsInteractive() ? 0 : undefined}
                    onClick={(event) => {
                      if (!rowsInteractive()) return;
                      if (event.target instanceof Element && event.target.closest("button, input, a[href]") !== null) return;
                      handleRowActivate(entry.row);
                    }}
                    onKeyDown={(event) => {
                      if (!rowsInteractive() || event.target !== event.currentTarget) return;
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      handleRowActivate(entry.row);
                    }}
                  >
                    <Show when={selection() !== undefined}>
                      <div class="sui-data-table__card-select">
                        <TableCheckbox
                          checked={() => selection()?.selected.has(entry.key) === true}
                          label={`Выбрать строку ${String(entry.index + 1)}`}
                          disabled={!isSelectable(entry.row, entry.index)}
                          onChange={(checked) => toggleSelection(entry.key, checked)}
                        />
                      </div>
                    </Show>
                    <Show when={props.tree !== undefined && entry.hasChildren}>
                      <Button
                        variant="text"
                        size="sm"
                        class="sui-data-table__card-expander"
                        attrs={{ "aria-expanded": entry.expanded ? "true" : "false" }}
                        onClick={() => toggleExpand(entry.key)}
                      >
                        {entry.expanded ? "Свернуть" : "Развернуть"}
                      </Button>
                    </Show>
                    {resolveSlot(renderCardEntry(entry)) as Child}
                  </article>
                )}
              </For>
            </Show>
          </div>
        }
      >
        <div
          class="sui-data-table__scroll"
          style={scrollBodyStyle()}
          ref={(node: Element | null) => {
            setScrollElement(node instanceof HTMLElement ? node : null);
          }}
        >
          <table
            ref={(node: Element | null) => setTableElement(node instanceof HTMLTableElement ? node : null)}
            class="sui-data-table__table"
            role="grid"
            aria-label={tableLabelledBy() === undefined ? tableLabel() : undefined}
            aria-labelledby={tableLabelledBy()}
            aria-busy={isLoading() ? "true" : undefined}
            aria-colcount={columnCount()}
            aria-rowcount={props.total + 1}
            data-sticky-header={stickyHeader() ? "" : undefined}
          >
            <colgroup>
              <Show when={treeDragEnabled()}>
                <col class="sui-data-table__col" style={{ width: "32px" }} />
              </Show>
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
                <Show when={treeDragEnabled()}>
                  <th class="sui-data-table__th" scope="col" data-grip="">
                    <span class="sui-data-table__visually-hidden">Перетаскивание</span>
                  </th>
                </Show>
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
                {orderedColumns().map((column) => {
                  return (
                    <HeaderCell
                      column={column}
                      width={() => effectiveWidth(column)}
                      sorted={() =>
                        props.sortKey === column.key && props.sortDirection !== undefined
                      }
                      direction={() => (props.sortKey === column.key ? props.sortDirection : undefined)}
                      reorderable={column.locked !== true && orderedColumns().length > 1}
                      dragging={() => draggingKey() === column.key}
                      dropEdge={() => {
                        const current = dropTarget();
                        return current !== null &&
                          current.key === column.key &&
                          draggingKey() !== column.key
                          ? current.edge
                          : null;
                      }}
                      armed={() => armedKey() === column.key}
                      onSort={(sortKey, direction) => {
                        if (suppressClick) {
                          suppressClick = false;
                          return;
                        }
                        props.onSort?.(sortKey, direction);
                      }}
                      onResizeCommit={resizeCommit}
                      onResizeReset={resizeReset}
                      onHeaderPointerDown={onHeaderPointerDown}
                      onHeaderKeyDown={onHeaderKeyDown}
                      tableElement={tableElement}
                    />
                  );
                })}
              </tr>
            </thead>
            <tbody class="sui-data-table__tbody">
              <Show when={isLoading()}>
                {skeletonRows().map((rowIndex) => (
                  <tr class="sui-data-table__tr" data-skeleton="">
                    <Show when={treeDragEnabled()}>
                      <td class="sui-data-table__td" data-grip="" />
                    </Show>
                    <Show when={selection() !== undefined}>
                      <td class="sui-data-table__td" data-select="">
                        <Skeleton variant="rect" width={20} height={20} />
                      </td>
                    </Show>
                    {orderedColumns().map((column, columnIndex) => (
                      <td class="sui-data-table__td" data-align={column.align ?? "start"}>
                        <Skeleton
                          variant="text"
                          width={SKELETON_WIDTHS[(rowIndex + columnIndex) % SKELETON_WIDTHS.length]}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </Show>
              <Show when={!isLoading() && hasError()}>
                <tr class="sui-data-table__tr">
                  <td class="sui-data-table__state-cell" colspan={columnCount()} role="alert">
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
                <For each={bodyEntries()} keyOf={(entry) => entry.key}>
                  {(entry) => {
                    if (entry.kind === "spacer") {
                      return (
                        <tr class="sui-data-table__spacer" data-spacer="" aria-hidden="true">
                          <td
                            class="sui-data-table__spacer-cell"
                            colspan={columnCount()}
                            style={{ blockSize: `${String(entry.height)}px` }}
                          />
                        </tr>
                      );
                    }
                    return (
                      <DataTableRow
                        row={entry.flat.row}
                        flat={entry.flat}
                        columns={orderedColumns()}
                        selected={selection()?.selected.has(entry.flat.key) === true}
                        selectable={isSelectable(entry.flat.row, entry.flat.index)}
                        onSelectionChange={
                          selection() === undefined ? undefined : toggleSelection
                        }
                        onRowClick={rowsInteractive() ? handleRowActivate : undefined}
                        onCellEdit={props.onCellEdit}
                        tree={props.tree !== undefined}
                        onToggleExpand={toggleExpand}
                        loadingChildren={
                          props.tree?.loadingKeys?.has(String(entry.flat.key)) === true
                        }
                        showGrip={treeDragEnabled()}
                        dropPosition={() => {
                          const current = rowDrop();
                          return current !== null && current.key === entry.flat.key
                            ? current.position
                            : null;
                        }}
                        draggingRow={() => draggingRow() === entry.flat.key}
                        onGripPointerDown={onGripPointerDown}
                      />
                    );
                  }}
                </For>
                {fillerRows().map(() => (
                  <tr class="sui-data-table__filler" data-filler="" aria-hidden="true">
                    <td
                      class="sui-data-table__spacer-cell"
                      colspan={columnCount()}
                    />
                  </tr>
                ))}
              </Show>
            </tbody>
          </table>
        </div>
      </Show>
      <div
        class="sui-data-table__footer"
        data-sticky={stickyFooter() ? "" : undefined}
        data-selection={
          (props.selectionBarPosition ?? "bottom") === "bottom" && selectedCount() > 0
            ? ""
            : undefined
        }
      >
        <Show when={(props.selectionBarPosition ?? "bottom") === "bottom" && selectedCount() > 0}>
          {selectionBar()}
        </Show>
        <div class="sui-data-table__footer-main">
          <span class="sui-data-table__status" aria-live="polite">
            {statusTemplate(rangeStart(), rangeEnd(), props.total)}
          </span>
          <div class="sui-data-table__pagination-controls">
            <label class="sui-data-table__page-size" for={pageSizeId}>
              <span class="sui-data-table__visually-hidden">Строк на странице</span>
              <select
                id={pageSizeId}
                class="sui-data-table__select"
                aria-label="Строк на странице"
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
                    {`${String(size)} / стр.`}
                  </option>
                ))}
              </select>
            </label>
            <Show when={props.total > 0}>
              <Pagination
                page={currentPage()}
                pageCount={pageCount()}
                size="sm"
                siblingCount={narrow() ? 0 : 1}
                onChange={props.onPageChange}
              />
            </Show>
          </div>
        </div>
      </div>
      <Show when={props.settings !== false}>
        <Dialog
          open={settingsOpen()}
          onOpenChange={setSettingsOpen}
          title="Настройки таблицы"
          description="Порядок и видимость колонок, плотность, прокрутка и закрепление."
          actions={[
            <Button variant="text" onClick={resetView}>Сбросить</Button>,
            <Button variant="filled" onClick={() => setSettingsOpen(false)}>Готово</Button>,
          ]}
        >
          <div class="sui-data-table__settings" aria-labelledby={settingsTitleId}>
            <section class="sui-data-table__settings-section">
              <h3 class="sui-data-table__settings-title" id={settingsTitleId}>
                Колонки
              </h3>
              <ul
                ref={(node: Element | null) => {
                  setSettingsList(node instanceof HTMLUListElement ? node : null);
                }}
                class="sui-data-table__settings-list"
              >
                {orderedAllColumns().map((column) => {
                  return (
                    <SettingsColumnRow
                      key={column.key}
                      columnKey={column.key}
                      label={settingsLabelFor(column)}
                      locked={column.locked === true}
                      visible={isVisible(column)}
                      dragging={() => settingsDragKey() === column.key}
                      dropEdge={() => {
                        const current = settingsDrop();
                        return current !== null &&
                          current.key === column.key &&
                          settingsDragKey() !== column.key
                          ? current.edge
                          : null;
                      }}
                      onToggle={(visible) => toggleColumn(column.key, visible)}
                      onMove={(direction) => moveColumn(column.key, direction)}
                      onPointerDown={(event, node) => {
                        onSettingsPointerDown(column.key, event, node);
                      }}
                    />
                  );
                })}
              </ul>
            </section>
            <section class="sui-data-table__settings-section">
              <h3 class="sui-data-table__settings-title">Плотность</h3>
              <label class="sui-data-table__settings-field">
                <span>Высота строк</span>
                <select
                  class="sui-data-table__select"
                  value={density()}
                  onChange={(event) => {
                    const target = event.target;
                    if (target instanceof HTMLSelectElement) changeDensity(target.value);
                  }}
                >
                  <option value="standard" selected={density() === "standard"}>
                    Стандартная
                  </option>
                  <option value="compact" selected={density() === "compact"}>
                    Компактная
                  </option>
                </select>
              </label>
            </section>
            <section class="sui-data-table__settings-section">
              <h3 class="sui-data-table__settings-title">Раскладка и прокрутка</h3>
              <label class="sui-data-table__settings-field">
                <span>Раскладка</span>
                <select
                  class="sui-data-table__select"
                  value={layout()}
                  onChange={(event) => {
                    const target = event.target;
                    if (!(target instanceof HTMLSelectElement)) return;
                    setLayout(target.value === "cards" ? "cards" : "table");
                  }}
                >
                  <option value="table" selected={layout() === "table"}>Таблица</option>
                  <option value="cards" selected={layout() === "cards"}>Карточки</option>
                </select>
              </label>
              <label class="sui-data-table__settings-field">
                <span>Прокрутка</span>
                <select
                  class="sui-data-table__select"
                  data-setting="scroll-mode"
                  value={scrollMode()}
                  onChange={(event) => {
                    const target = event.target;
                    if (target instanceof HTMLSelectElement) changeScrollMode(target.value);
                  }}
                >
                  <option value="internal" selected={scrollMode() === "internal"}>
                    Внутри таблицы
                  </option>
                  <option value="external" selected={scrollMode() === "external"}>
                    Страница
                  </option>
                </select>
              </label>
            </section>
            <section class="sui-data-table__settings-section">
              <h3 class="sui-data-table__settings-title">Закрепление</h3>
              <label class="sui-data-table__settings-check">
                <input
                  type="checkbox"
                  checked={stickyHeader()}
                  onChange={(event) => {
                    const target = event.target;
                    if (target instanceof HTMLInputElement) changeStickyHeader(target.checked);
                  }}
                />
                <span>Закрепить заголовок</span>
              </label>
              <label class="sui-data-table__settings-check">
                <input
                  type="checkbox"
                  checked={stickyFooter()}
                  onChange={(event) => {
                    const target = event.target;
                    if (target instanceof HTMLInputElement) changeStickyFooter(target.checked);
                  }}
                />
                <span>Закрепить подвал</span>
              </label>
            </section>
          </div>
        </Dialog>
      </Show>
    </div>
  );
}
