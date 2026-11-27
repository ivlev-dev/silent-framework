import type { Child, Children } from "@ivlev-dev/silent-core";
import {
  For,
  Show,
  createMemo,
  createSignal,
  onCleanup,
  useId,
} from "@ivlev-dev/silent-core";
import { clientEffect } from "../../internal/overlay.js";
import { ExpandMoreIcon } from "../../icons/expand-more.js";
import { ChevronEndIcon } from "../../icons/chevron-end.js";
import { MoreVertIcon } from "../../icons/more-vert.js";
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
  writeDataTableSettings,
} from "./settings.js";
import type {
  DataTableCardContext,
  DataTableColumn,
  DataTableDensity,
  DataTableLayout,
  DataTableProps,
  DataTableSelection,
  DataTableSortDirection,
} from "./types.js";

interface DataTableSettingsState {
  readonly order: readonly string[];
  readonly widths: Readonly<Record<string, number>>;
  readonly visible: Readonly<Record<string, boolean>>;
  readonly density: DataTableDensity | null;
  readonly layout: DataTableLayout | null;
  readonly stickyHeader: boolean | null;
  readonly stickyFooter: boolean | null;
}

const EMPTY_SETTINGS: DataTableSettingsState = {
  order: [],
  widths: {},
  visible: {},
  density: null,
  layout: null,
  stickyHeader: null,
  stickyFooter: null,
};
const DEFAULT_PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
const SKELETON_WIDTHS = ["72%", "54%", "88%", "64%", "46%"] as const;
const RESIZE_STEP = 8;
const RESIZE_STEP_LARGE = 32;
const TREE_INDENT = 20;
const NARROW_QUERY = "(max-width: 63.99em)";

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
  readonly dragging: boolean;
  readonly over: boolean;
  readonly armed: boolean;
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

  const freezeWidths = (): Readonly<Record<string, number>> => {
    const table = props.tableElement();
    const widths: Record<string, number> = {};
    if (table === null) return widths;
    const headers = table.querySelectorAll<HTMLElement>("thead th[data-column-key]");
    headers.forEach((header) => {
      const key = header.getAttribute("data-column-key");
      if (key === null) return;
      const width = header.getBoundingClientRect().width;
      if (width <= 0) return;
      const rounded = Math.round(width);
      widths[key] = rounded;
      const col = colFor(key);
      if (col !== null) col.style.width = `${rounded}px`;
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
    const frozen = freezeWidths();
    const header = resizer?.closest<HTMLElement>("th");
    const measured = header?.getBoundingClientRect().width ?? 0;
    const startWidth =
      frozen[props.column.key] ??
      (measured > 0 ? Math.round(measured) : props.width() ?? FALLBACK_COLUMN_WIDTH);
    const col = colFor(props.column.key);
    if (col !== null) col.style.width = `${Math.round(startWidth)}px`;
    document.body.classList.add("sui-data-table--resizing");
    setResizing(Math.round(startWidth));

    const next: ResizeSession = {
      startX: event.clientX,
      startWidth,
      frozen,
      key: props.column.key,
      lastWidth: Math.round(startWidth),
      move: (moveEvent: PointerEvent) => {
        const current = session;
        if (current === null) return;
        const px = clampWidth(Math.round(current.startWidth + moveEvent.clientX - current.startX));
        current.lastWidth = px;
        const target = colFor(current.key);
        if (target !== null) target.style.width = `${px}px`;
        setResizing(px);
      },
      end: (endEvent: PointerEvent) => {
        const current = session;
        if (current !== null) {
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
    headerTitle ?? (typeof props.column.header === "string" ? props.column.header : props.column.key);
  const sortTransform = props.dragging
    ? { transform: "translateY(-1px)", transition: undefined }
    : undefined;
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
      data-armed={props.armed ? "" : undefined}
      data-dragging={props.dragging ? "" : undefined}
      data-over={props.over ? "" : undefined}
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
        props.onHeaderPointerDown(props.column.key, event, event.currentTarget as HTMLElement);
      }}
      onKeyDown={(event: KeyboardEvent) => {
        props.onHeaderKeyDown(props.column.key, event);
      }}
      style={sortTransform}
    >
      <div class="sui-data-table__th-inner">
        <Show when={props.reorderable}>
          <span class="sui-data-table__drag-grip" aria-hidden="true">
            <GripIcon />
          </span>
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
  readonly tree: boolean;
  readonly onToggleExpand: ((key: string | number) => void) | undefined;
  readonly loadingChildren: boolean;
}

function DataTableRow<Row>(props: DataTableRowProps<Row>): Node {
  return (
    <tr
      class="sui-data-table__tr"
      data-key={String(props.flat.key)}
      data-level={props.tree ? props.flat.level : undefined}
      data-selected={props.selected ? "" : undefined}
      data-expanded={props.flat.expanded ? "" : undefined}
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
      <Show when={props.onSelectionChange !== undefined}>
        <td class="sui-data-table__td" data-select="">
          <TableCheckbox
            checked={() => props.selected}
            label={`Выбрать строку ${String(props.flat.index + 1)}`}
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
        return (
          <td
            class="sui-data-table__td"
            data-align={column.align ?? "start"}
            data-truncate={column.truncate === true ? "" : undefined}
            data-numeric={column.align === "end" ? "" : undefined}
          >
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
  readonly onToggle: (visible: boolean) => void;
  readonly onMove: (direction: -1 | 1) => void;
  readonly onDragStart: () => void;
  readonly onDrop: () => void;
}

function SettingsColumnRow(props: SettingsColumnRowProps): Node {
  return (
    <li
      class="sui-data-table__settings-row"
      draggable="true"
      onDragStart={(event: DragEvent) => {
        event.dataTransfer?.setData("text/plain", props.columnKey);
        props.onDragStart();
      }}
      onDragOver={(event: DragEvent) => {
        event.preventDefault();
      }}
      onDrop={(event: DragEvent) => {
        event.preventDefault();
        props.onDrop();
      }}
    >
      <span class="sui-data-table__settings-grip" aria-hidden="true">
        <GripIcon />
      </span>
      <label class="sui-data-table__settings-label">
        <input
          type="checkbox"
          checked={props.visible}
          disabled={props.locked}
          onChange={(event) => {
            const target = event.target;
            if (target instanceof HTMLInputElement) props.onToggle(target.checked);
          }}
        />
        <span>{props.label}</span>
      </label>
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
    </li>
  );
}

export function DataTable<Row>(props: DataTableProps<Row>): Node {
  const config = useUiConfig();
  const pageSizeId = useId("data-table-page-size");
  const settingsTitleId = useId("data-table-settings");
  const [settings, setSettings] = createSignal<DataTableSettingsState>(EMPTY_SETTINGS);
  const [loaded, setLoaded] = createSignal(false);
  const [narrow, setNarrow] = createSignal(false);
  const [layoutOverride, setLayoutOverride] = createSignal<DataTableLayout | null>(null);
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [draggingKey, setDraggingKey] = createSignal<string | null>(null);
  const [armedKey, setArmedKey] = createSignal<string | null>(null);
  const [overKey, setOverKey] = createSignal<string | null>(null);
  const [internalExpanded, setInternalExpanded] = createSignal<ReadonlySet<string>>(
    new Set((props.tree?.defaultExpandedKeys ?? []).map(String)),
  );
  const [tableElement, setTableElement] = createSignal<HTMLTableElement | null>(null);
  let settingsDragKey: string | null = null;
  let headerDrag: { key: string; startX: number; moved: boolean } | null = null;

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
    });
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
    settings().visible[column.key] ?? column.defaultVisible !== false;

  const orderedColumns = createMemo(() =>
    orderedAllColumns().filter((column) => isVisible(column)),
  );

  const orderedKeys = (): readonly string[] =>
    orderedAllColumns().map((column) => column.key);

  const effectiveWidth = (column: DataTableColumn<Row>): number | undefined =>
    resolveColumnWidth(column, settings().widths[column.key]);

  const density = (): DataTableDensity =>
    props.density ?? settings().density ?? "standard";

  const layout = (): DataTableLayout =>
    layoutOverride() ?? props.layout ?? settings().layout ?? (narrow() ? "cards" : "table");

  const stickyHeader = (): boolean =>
    props.stickyHeader ?? settings().stickyHeader ?? true;

  const stickyFooter = (): boolean =>
    props.stickyFooter ?? settings().stickyFooter ?? false;

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
    clearDataTableSettings(props.tableKey);
  };

  const moveColumn = (key: string, direction: -1 | 1): void => {
    const current = orderedKeys();
    const from = current.indexOf(key);
    const to = from + direction;
    if (from === -1 || to < 0 || to >= current.length) return;
    const next = [...current];
    const [moved] = next.splice(from, 1);
    if (moved === undefined) return;
    next.splice(to, 0, moved);
    commitSettings({ ...settings(), order: next });
  };

  const reorderColumn = (fromKey: string, toKey: string): void => {
    if (fromKey === toKey) return;
    const current = orderedKeys();
    const from = current.indexOf(fromKey);
    const to = current.indexOf(toKey);
    if (from === -1 || to === -1) return;
    const next = [...current];
    const [moved] = next.splice(from, 1);
    if (moved === undefined) return;
    next.splice(to, 0, moved);
    commitSettings({ ...settings(), order: next });
  };

  const setLayout = (next: DataTableLayout): void => {
    setLayoutOverride(next);
    props.onLayoutChange?.(next);
    commitSettings({ ...settings(), layout: next });
  };

  const toggleColumn = (key: string, visible: boolean): void => {
    commitSettings({ ...settings(), visible: { ...settings().visible, [key]: visible } });
  };

  const changeDensity = (value: string): void => {
    const next: DataTableDensity = value === "compact" ? "compact" : "standard";
    commitSettings({ ...settings(), density: next });
  };

  const changeStickyHeader = (value: boolean): void => {
    commitSettings({ ...settings(), stickyHeader: value });
  };

  const changeStickyFooter = (value: boolean): void => {
    commitSettings({ ...settings(), stickyFooter: value });
  };

  const onHeaderPointerDown = (key: string, event: PointerEvent, node: HTMLElement): void => {
    if (event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest("button") !== null) return;
    headerDrag = { key, startX: event.clientX, moved: false };
    const startX = event.clientX;
    const pointerId = (event as PointerEvent & { pointerId?: number }).pointerId;
    if (pointerId !== undefined && typeof node.setPointerCapture === "function") {
      try {
        node.setPointerCapture(pointerId);
      } catch {
        // jsdom
      }
    }
    const move = (moveEvent: PointerEvent): void => {
      const current = headerDrag;
      if (current === null) return;
      if (!current.moved && Math.abs(moveEvent.clientX - startX) < 6) return;
      current.moved = true;
      setDraggingKey(current.key);
      const table = tableElement();
      if (table === null) return;
      const headers = [...table.querySelectorAll<HTMLElement>("thead th[data-column-key]")];
      const target = headers.find((header) => {
        const rect = header.getBoundingClientRect();
        return moveEvent.clientX >= rect.left && moveEvent.clientX <= rect.right;
      });
      const over = target?.getAttribute("data-column-key") ?? null;
      setOverKey(over);
    };
    const finish = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      const current = headerDrag;
      headerDrag = null;
      setDraggingKey(null);
      const target = overKey();
      setOverKey(null);
      if (current !== null && current.moved && target !== null) {
        reorderColumn(current.key, target);
      }
      if (pointerId !== undefined && typeof node.releasePointerCapture === "function") {
        try {
          node.releasePointerCapture(pointerId);
        } catch {
          // jsdom
        }
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  const onHeaderKeyDown = (key: string, event: KeyboardEvent): void => {
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

  const descendantKeys = (key: string | number): readonly (string | number)[] => {
    const keys: (string | number)[] = [];
    const collect = (parent: string | number): void => {
      for (const entry of flatRows()) {
        if (entry.parentKey === parent) {
          keys.push(entry.key);
          collect(entry.key);
        }
      }
    };
    collect(key);
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

  const selectionBar = (): Node => (
    <div
      class="sui-data-table__selection-bar"
      data-position={props.selectionBarPosition ?? "top"}
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
        attrs={{ "data-action": "select-page" }}
      >
        Выбрать все на странице
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

  return (
    <div
      {...props.attrs}
      class={["sui-data-table", props.class]}
      style={props.style}
      data-density={density()}
      data-layout={layout()}
      data-loading={isLoading() ? "" : undefined}
      data-loaded={loaded() ? "" : undefined}
      data-scroll={props.scrollMode ?? "page"}
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
          <Button
            variant="text"
            size="sm"
            class="sui-data-table__layout-toggle"
            attrs={{ "aria-pressed": layout() === "cards" ? "true" : "false" }}
            onClick={() => setLayout(layout() === "cards" ? "table" : "cards")}
          >
            {layout() === "cards" ? "Таблица" : "Карточки"}
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
      <Show when={(props.selectionBarPosition ?? "top") === "top" && selectedCount() > 0}>
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
        <div class="sui-data-table__scroll">
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
                      props.sortKey === column.key && props.sortDirection !== undefined
                    }
                    direction={() => (props.sortKey === column.key ? props.sortDirection : undefined)}
                    reorderable={column.locked !== true && orderedColumns().length > 1}
                    dragging={draggingKey() === column.key}
                    over={overKey() === column.key && draggingKey() !== column.key}
                    armed={armedKey() === column.key}
                    onSort={props.onSort}
                    onResizeCommit={resizeCommit}
                    onResizeReset={resizeReset}
                    onHeaderPointerDown={onHeaderPointerDown}
                    onHeaderKeyDown={onHeaderKeyDown}
                    tableElement={tableElement}
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
                <For each={flatRows()} keyOf={(entry) => entry.key}>
                  {(entry) => (
                    <DataTableRow
                      row={entry.row}
                      flat={entry}
                      columns={orderedColumns()}
                      selected={selection()?.selected.has(entry.key) === true}
                      selectable={isSelectable(entry.row, entry.index)}
                      onSelectionChange={
                        selection() === undefined ? undefined : toggleSelection
                      }
                      onRowClick={rowsInteractive() ? handleRowActivate : undefined}
                      tree={props.tree !== undefined}
                      onToggleExpand={toggleExpand}
                      loadingChildren={
                        props.tree?.loadingKeys?.has(String(entry.key)) === true
                      }
                    />
                  )}
                </For>
              </Show>
            </tbody>
          </table>
        </div>
      </Show>
      <Show when={(props.selectionBarPosition ?? "top") === "bottom" && selectedCount() > 0}>
        {selectionBar()}
      </Show>
      <div class="sui-data-table__footer" data-sticky={stickyFooter() ? "" : undefined}>
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
              siblingCount={narrow() ? 0 : 1}
              onChange={props.onPageChange}
            />
          </Show>
        </div>
      </div>
      <Show when={props.settings !== false}>
        <Dialog
          open={settingsOpen()}
          onOpenChange={setSettingsOpen}
          title="Настройки таблицы"
          description="Порядок и видимость колонок, плотность и закрепление."
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
              <ul class="sui-data-table__settings-list">
                {orderedAllColumns().map((column) => (
                  <SettingsColumnRow
                    key={column.key}
                    columnKey={column.key}
                    label={typeof column.header === "string" ? column.header : column.key}
                    locked={column.locked === true}
                    visible={isVisible(column)}
                    onToggle={(visible) => toggleColumn(column.key, visible)}
                    onMove={(direction) => moveColumn(column.key, direction)}
                    onDragStart={() => {
                      settingsDragKey = column.key;
                    }}
                    onDrop={() => {
                      if (settingsDragKey !== null) reorderColumn(settingsDragKey, column.key);
                      settingsDragKey = null;
                    }}
                  />
                ))}
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
              <h3 class="sui-data-table__settings-title">Раскладка и закрепление</h3>
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
