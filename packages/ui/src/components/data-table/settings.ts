import type { DataTableColumn } from "./types.js";

export interface DataTableSettings {
  readonly order: readonly string[];
  readonly widths: Readonly<Record<string, number>>;
}

export const DATA_TABLE_STORAGE_PREFIX = "sui-data-table:";
export const DEFAULT_COLUMN_MIN_WIDTH = 64;
export const DEFAULT_COLUMN_MAX_WIDTH = 960;
export const FALLBACK_COLUMN_WIDTH = 160;

export function dataTableStorageKey(tableKey: string): string {
  return `${DATA_TABLE_STORAGE_PREFIX}${tableKey}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readDataTableSettings(tableKey: string): DataTableSettings {
  const storage = getStorage();
  if (storage === null) return { order: [], widths: {} };
  try {
    const raw = storage.getItem(dataTableStorageKey(tableKey));
    if (raw === null) return { order: [], widths: {} };
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return { order: [], widths: {} };
    const rawOrder = parsed["order"];
    const rawWidths = parsed["widths"];
    const order = Array.isArray(rawOrder)
      ? rawOrder.filter((entry): entry is string => typeof entry === "string")
      : [];
    const widths: Record<string, number> = {};
    if (isRecord(rawWidths)) {
      for (const [key, value] of Object.entries(rawWidths)) {
        if (typeof value === "number" && Number.isFinite(value) && value > 0) {
          widths[key] = value;
        }
      }
    }
    return { order, widths };
  } catch {
    return { order: [], widths: {} };
  }
}

export function writeDataTableSettings(
  tableKey: string,
  settings: DataTableSettings,
): void {
  const storage = getStorage();
  if (storage === null) return;
  try {
    storage.setItem(
      dataTableStorageKey(tableKey),
      JSON.stringify({ order: settings.order, widths: settings.widths }),
    );
  } catch {
    return;
  }
}

export function clearDataTableSettings(tableKey: string): void {
  const storage = getStorage();
  if (storage === null) return;
  try {
    storage.removeItem(dataTableStorageKey(tableKey));
  } catch {
    return;
  }
}

export function columnWidthBounds<Row>(column: DataTableColumn<Row>): {
  readonly min: number;
  readonly max: number;
} {
  const min =
    column.minWidth !== undefined &&
    Number.isFinite(column.minWidth) &&
    column.minWidth > 0
      ? column.minWidth
      : DEFAULT_COLUMN_MIN_WIDTH;
  const requestedMax =
    column.maxWidth !== undefined &&
    Number.isFinite(column.maxWidth) &&
    column.maxWidth > 0
      ? column.maxWidth
      : DEFAULT_COLUMN_MAX_WIDTH;
  return { min, max: Math.max(min, requestedMax) };
}

export function clampColumnWidth<Row>(
  column: DataTableColumn<Row>,
  width: number,
): number {
  const bounds = columnWidthBounds(column);
  if (!Number.isFinite(width)) return bounds.min;
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(width)));
}

export function resolveColumnWidth<Row>(
  column: DataTableColumn<Row>,
  saved: number | undefined,
): number | undefined {
  if (saved !== undefined) {
    if (!Number.isFinite(saved) || saved <= 0) return undefined;
    return clampColumnWidth(column, saved);
  }
  if (column.width === undefined) return undefined;
  if (!Number.isFinite(column.width) || column.width <= 0) return undefined;
  return clampColumnWidth(column, column.width);
}

export function mergeColumnOrder<Row>(
  columns: readonly DataTableColumn<Row>[],
  savedOrder: readonly string[],
): readonly string[] {
  const available = new Set(columns.map((column) => column.key));
  const result: string[] = [];
  const seen = new Set<string>();
  for (const key of savedOrder) {
    if (!available.has(key) || seen.has(key)) continue;
    seen.add(key);
    result.push(key);
  }
  for (const column of columns) {
    if (seen.has(column.key)) continue;
    seen.add(column.key);
    result.push(column.key);
  }
  return result;
}

export function orderColumns<Row>(
  columns: readonly DataTableColumn<Row>[],
  savedOrder: readonly string[],
): readonly DataTableColumn<Row>[] {
  const byKey = new Map(columns.map((column) => [column.key, column]));
  const result: DataTableColumn<Row>[] = [];
  for (const key of mergeColumnOrder(columns, savedOrder)) {
    const column = byKey.get(key);
    if (column !== undefined) result.push(column);
  }
  return result;
}

export function resolveColumnWidths<Row>(
  columns: readonly DataTableColumn<Row>[],
  saved: Readonly<Record<string, number>>,
): Readonly<Record<string, number>> {
  const widths: Record<string, number> = {};
  for (const column of columns) {
    const width = resolveColumnWidth(column, saved[column.key]);
    if (width !== undefined) widths[column.key] = width;
  }
  return widths;
}
