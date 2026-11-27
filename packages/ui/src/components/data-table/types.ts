import type { Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import type { Attrs } from "../../internal/props.js";

export type DataTableAlign = "start" | "center" | "end";
export type DataTableSortDirection = "ascending" | "descending";
export type DataTableDensity = "compact" | "standard";
export type DataTableLayout = "table" | "cards";
/**
 * `internal` — прокрутка внутри тела таблицы, шапка и подвал на месте;
 * `external` — прокручивается страница. `contained`/`page` — устаревшие
 * алиасы, поддержаны для обратной совместимости.
 */
export type DataTableScrollMode = "internal" | "external" | "contained" | "page";
export type DataTableResolvedScrollMode = "internal" | "external";
export type DataTableSelectionBarPosition = "top" | "bottom";
export type DataTableCardSlot = "primary" | "secondary" | "badge" | "meta" | "actions";
export type DataTableTreeDropPosition = "before" | "inside" | "after";

export interface DataTableCardColumn {
  readonly slot?: DataTableCardSlot | undefined;
  readonly label?: string | undefined;
  readonly hidden?: boolean | undefined;
}

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
  /** Колонку нельзя скрыть и переместить в настройках. */
  readonly locked?: boolean | undefined;
  /** Подпись в настройках таблицы; по умолчанию берётся из header. */
  readonly settingsLabel?: string | undefined;
  /** Видимость по умолчанию; по умолчанию `true`. */
  readonly defaultVisible?: boolean | undefined;
  /** Как колонка попадает в карточку: слот, подпись и скрытие. */
  readonly card?: DataTableCardColumn | undefined;
  /** Ячейку можно редактировать двойным кликом (нужен `onCellEdit`). */
  readonly editable?: boolean | undefined;
}

export interface DataTableSelection {
  readonly selected: ReadonlySet<string | number>;
  readonly onChange: (keys: ReadonlySet<string | number>) => void;
  /** Действия массового выбора: удалить, изменить и т. п. */
  readonly actions?: Children;
  readonly isRowSelectable?: ((row: unknown, index: number) => boolean) | undefined;
  readonly selectOnRowClick?: boolean | undefined;
}

export interface DataTableTreeMove<Row> {
  readonly row: Row;
  readonly target: Row;
  readonly position: DataTableTreeDropPosition;
}

export interface DataTableTree<Row> {
  readonly getChildren: (row: Row) => readonly Row[];
  readonly hasChildren?: ((row: Row) => boolean) | undefined;
  readonly expandedKeys?: ReadonlySet<string> | undefined;
  readonly defaultExpandedKeys?: readonly string[] | undefined;
  readonly onExpandedChange?: ((keys: ReadonlySet<string>) => void) | undefined;
  readonly loadingKeys?: ReadonlySet<string> | undefined;
  readonly onLoadChildren?: ((row: Row) => void) | undefined;
  readonly cascadeSelection?: boolean | undefined;
  readonly getSearchText?: ((row: Row) => string) | undefined;
  readonly searchQuery?: string | undefined;
  /** Перетаскивание узлов; позиция `inside` делает узел дочерним. */
  readonly onMove?: ((move: DataTableTreeMove<Row>) => void) | undefined;
  /** Запрет конкретного переноса (например, в собственного потомка). */
  readonly canDrop?:
    | ((
        move: DataTableTreeMove<Row>,
        context: { readonly rowKey: string | number; readonly targetKey: string | number },
      ) => boolean)
    | undefined;
}

export interface DataTableCardContext {
  readonly selected: boolean;
  readonly index: number;
  readonly level: number;
  readonly expanded: boolean;
  readonly hasChildren: boolean;
  readonly toggleExpand: () => void;
}

export interface DataTableCellEdit<Row> {
  readonly row: Row;
  readonly key: string;
  readonly value: string;
  readonly rowKey: string | number;
}

/** Императивный API таблицы: прокрутка к строке без прыжка страницы. */
export interface DataTableApi {
  /** Прокрутить к строке по ключу; `align` — как позиционировать. */
  readonly scrollToRow: (
    key: string | number,
    align?: "start" | "center" | "end" | "auto",
  ) => void;
  /** Прокрутить тело таблицы к началу. */
  readonly scrollToTop: () => void;
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
  /** Сохранить новое значение ячейки. Без колбэка inline-редактирование выключено. */
  readonly onCellEdit?: ((edit: DataTableCellEdit<Row>) => void) | undefined;
  readonly toolbar?: Children;
  readonly empty?: Children;
  readonly selection?: DataTableSelection | undefined;
  readonly density?: DataTableDensity | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
  /** Заголовок и подзаголовок над таблицей. */
  readonly title?: Children;
  readonly subtitle?: Children;
  /** Дополнительные действия в тулбаре. */
  readonly actions?: Children;
  /** Явный layout. Без пропса узкий экран переключает таблицу в карточки. */
  readonly layout?: DataTableLayout | undefined;
  readonly defaultLayout?: DataTableLayout | undefined;
  readonly onLayoutChange?: ((layout: DataTableLayout) => void) | undefined;
  /** Показывать кнопку настроек таблицы. По умолчанию `true`. */
  readonly settings?: boolean | undefined;
  /** Карточка строки; без рендерера строится из колонок. */
  readonly renderCard?:
    | ((row: Row, context: DataTableCardContext) => Children)
    | undefined;
  readonly selectionBarPosition?: DataTableSelectionBarPosition | undefined;
  readonly stickyHeader?: boolean | undefined;
  readonly stickyFooter?: boolean | undefined;
  readonly scrollMode?: DataTableScrollMode | undefined;
  /** Максимальная высота внутреннего скролла; по умолчанию `70vh`. */
  readonly scrollHeight?: string | undefined;
  /** Оконный рендер строк. По умолчанию включён для длинных страниц. */
  readonly virtual?: boolean | undefined;
  /** Запас виртуализации в строках с каждой стороны; по умолчанию `10`. */
  readonly virtualOverscan?: number | undefined;
  readonly tree?: DataTableTree<Row> | undefined;
  /** Доступное имя переключателя layout. */
  readonly layoutLabel?: string | undefined;
  /** Колбэк с императивным API после монтирования. */
  readonly onReady?: ((api: DataTableApi) => void) | undefined;
}
