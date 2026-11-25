import { For } from "@ivlev-dev/silent-core";
import type { VirtualKey } from "../core/types.js";

/**
 * Строка списка: поля `VirtualItem` развёрнуты на верхний уровень.
 *
 * Плоская форма нужна `For`: он сравнивает элементы поверхностно и не
 * перерисовывает строку, если позиция, размер и исходный элемент не
 * изменились. Вложенный объект `VirtualItem` ломал бы это сравнение.
 */
export interface VirtualRowEntry<T> {
  readonly index: number;
  readonly key: VirtualKey;
  readonly start: number;
  readonly end: number;
  readonly size: number;
  readonly lane: number;
  readonly item: T;
  readonly horizontal: boolean;
}

/** Ячейка виртуализированной строки сетки. */
export interface GridCell<T> {
  readonly index: number;
  readonly key: VirtualKey;
  readonly item: T;
}

/** Строка сетки: поля `VirtualRowEntry` плюс ячейки и номер строки. */
export interface VirtualGridRowEntry<T> extends Omit<VirtualRowEntry<T>, "horizontal" | "item"> {
  readonly rowIndex: number;
  readonly columns: number;
  readonly gap: number;
  readonly cells: readonly GridCell<T>[];
}

interface VirtualRowsProps<T> {
  readonly entries: () => readonly VirtualRowEntry<T>[];
  readonly render: (entry: VirtualRowEntry<T>) => Node;
}

/**
 * Обёртка над `For`: без отдельного компонента компилятор превращает список
 * в direct-режим `parent`/`marker`, и при SSR его разметка теряется.
 */
export function VirtualRows<T>(props: VirtualRowsProps<T>): Node {
  return (
    <For each={props.entries} keyOf={(entry) => entry.key}>
      {(entry) => props.render(entry)}
    </For>
  );
}

interface GridCellsProps<T> {
  readonly cells: readonly GridCell<T>[];
  readonly render: (cell: GridCell<T>) => Node;
}

/** Обёртка над `For` для ячеек одной строки сетки. */
export function GridCells<T>(props: GridCellsProps<T>): Node {
  return (
    <For each={props.cells} keyOf={(cell) => cell.key}>
      {(cell) => props.render(cell)}
    </For>
  );
}

interface VirtualGridRowsProps<T> {
  readonly rows: () => readonly VirtualGridRowEntry<T>[];
  readonly render: (row: VirtualGridRowEntry<T>) => Node;
}

/** Обёртка над `For` для строк сетки. */
export function VirtualGridRows<T>(props: VirtualGridRowsProps<T>): Node {
  return (
    <For each={props.rows} keyOf={(row) => row.key}>
      {(row) => props.render(row)}
    </For>
  );
}
