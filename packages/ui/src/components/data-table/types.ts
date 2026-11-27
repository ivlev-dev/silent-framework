import type { Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import type { Attrs } from "../../internal/props.js";

export type DataTableAlign = "start" | "center" | "end";
export type DataTableSortDirection = "ascending" | "descending";
export type DataTableDensity = "compact" | "standard";

export interface DataTableColumn<Row> {
  readonly key: string;
  readonly header: Children;
  readonly width?: number | undefined;
  readonly minWidth?: number | undefined;
  readonly maxWidth?: number | undefined;
  readonly resizable?: boolean | undefined;
  readonly sortable?: boolean | undefined;
  readonly align?: DataTableAlign | undefined;
  readonly truncate?: boolean | undefined;
  readonly render?: ((row: Row, index: number) => Children) | undefined;
}

export interface DataTableSelection {
  readonly selected: ReadonlySet<string | number>;
  readonly onChange: (keys: ReadonlySet<string | number>) => void;
}

export interface DataTableProps<Row> {
  readonly tableKey: string;
  readonly columns: readonly DataTableColumn<Row>[];
  readonly rows: readonly Row[];
  readonly rowKey: (row: Row, index: number) => string | number;
  readonly loading?: boolean | undefined;
  readonly error?: Children;
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly pageSizeOptions?: readonly number[] | undefined;
  readonly sortKey?: string | undefined;
  readonly sortDirection?: DataTableSortDirection | undefined;
  readonly onSort?:
    | ((key: string, direction: DataTableSortDirection) => void)
    | undefined;
  readonly onPageChange?: ((page: number) => void) | undefined;
  readonly onPageSizeChange?: ((size: number) => void) | undefined;
  readonly onRowClick?: ((row: Row) => void) | undefined;
  readonly toolbar?: Children;
  readonly empty?: Children;
  readonly selection?: DataTableSelection | undefined;
  readonly density?: DataTableDensity | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
}
