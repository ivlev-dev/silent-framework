import type { Meta, StoryObj } from "@storybook/html-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { createSignal } from "@ivlev-dev/silent-core";
import { Stack, Text } from "@ivlev-dev/silent-ui";
import {
  DataTable,
  dataTableStorageKey,
  type DataTableColumn,
  type DataTableDensity,
  type DataTableLayout,
  type DataTableScrollMode,
  type DataTableSelectionBarPosition,
  type DataTableSortDirection,
  type DataTableTree,
} from "../../ui/src/components/data-table/index.js";
import { silentStory } from "./silent-story.js";

interface Person {
  readonly id: number;
  readonly name: string;
  readonly role: string;
  readonly score: number;
}

const NAMES = [
  "Ада Ловлейс",
  "Грейс Хоппер",
  "Алан Тьюринг",
  "Кэтрин Джонсон",
  "Джон фон Нейман",
  "Маргарет Гамильтон",
  "Эдсгер Дейкстра",
  "Барбара Лисков",
  "Дональд Кнут",
  "Фрэнсис Аллен",
  "Кен Томпсон",
  "Деннис Ритчи",
  "Анита Борг",
  "Тим Бернерс-Ли",
  "Винтон Серф",
  "Лесли Лэмпорт",
  "Джуда Перл",
  "Шафи Гольдвассер",
  "Рональд Ривест",
  "Ади Шамир",
  "Леонард Адлеман",
  "Софи Уилсон",
  "Чарльз Бэббидж",
];

const ROLES = [
  "Инженер",
  "Архитектор",
  "Исследователь",
  "Математик",
  "Руководитель",
];

const PEOPLE: readonly Person[] = NAMES.map((name, index) => ({
  id: index + 1,
  name,
  role: ROLES[index % ROLES.length] ?? "Инженер",
  score: 99 - ((index * 7) % 40),
}));

const COLUMNS: readonly DataTableColumn<Person>[] = [
  {
    key: "name",
    header: "Имя",
    width: 220,
    minWidth: 140,
    maxWidth: 360,
    sortable: true,
    truncate: true,
  },
  { key: "role", header: "Роль", width: 180, minWidth: 120, sortable: true },
  {
    key: "score",
    header: "Баллы",
    width: 120,
    minWidth: 88,
    align: "end",
    sortable: true,
  },
];

const LOCKED_COLUMNS: readonly DataTableColumn<Person>[] = [
  {
    key: "name",
    header: "Имя",
    width: 220,
    minWidth: 140,
    maxWidth: 360,
    sortable: true,
    truncate: true,
    locked: true,
  },
  {
    key: "role",
    header: "Роль",
    width: 180,
    minWidth: 120,
    sortable: true,
    settingsLabel: "Должность",
  },
  {
    key: "score",
    header: "Баллы",
    width: 120,
    minWidth: 88,
    align: "end",
    sortable: true,
  },
  {
    key: "actions",
    header: "",
    settingsLabel: "Действия",
    width: 96,
    minWidth: 80,
    resizable: false,
    locked: true,
    render: () => <span class="sui-data-table__demo-action">Изменить</span>,
  },
];

interface DataTableArgs {
  readonly tableKey: string;
  readonly page: number;
  readonly pageSize: number;
  readonly loading: boolean;
  readonly error: string;
  readonly empty: boolean;
  readonly density: DataTableDensity;
  readonly selectionEnabled: boolean;
  readonly initialSelected?: readonly (string | number)[] | undefined;
  readonly selectionBarPosition?: DataTableSelectionBarPosition | undefined;
  readonly layout?: DataTableLayout | undefined;
  readonly stickyFooter: boolean;
  readonly scrollMode: DataTableScrollMode;
  readonly title: string;
  readonly subtitle: string;
  readonly cards: boolean;
  readonly toolbarText: string;
  readonly columns?: readonly DataTableColumn<Person>[];
  readonly rows?: readonly Person[];
  readonly sortKey?: string;
  readonly sortDirection?: DataTableSortDirection;
  readonly onSort: (key: string, direction: DataTableSortDirection) => void;
  readonly onPageChange: (page: number) => void;
  readonly onPageSizeChange: (size: number) => void;
  readonly onSelectionChange: (keys: ReadonlySet<string | number>) => void;
  readonly onRowClick: (row: Person) => void;
  readonly onCellEdit: (edit: {
    readonly row: Person;
    readonly key: string;
    readonly value: string;
    readonly rowKey: string | number;
  }) => void;
  readonly onTreeMove: (move: {
    readonly row: Department;
    readonly target: Department;
    readonly position: "before" | "inside" | "after";
  }) => void;
}

const meta = {
  title: "Components/DataTable",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: [
          "Серверная таблица: данные, сортировка и пагинация управляются снаружи.",
          "Ширины и порядок колонок сохраняются в localStorage по `tableKey`;",
          "новые колонки добавляются в конец, удалённые игнорируются, ширины",
          "валидируются по `minWidth`/`maxWidth`. Колонки переставляются",
          "перетаскиванием за заголовок (клик по сортировке и ресайзер не мешают)",
          "или с клавиатуры (Space, стрелки, Space); при перетаскивании сама",
          "колонка следует за курсором, остальные перестраиваются с FLIP-анимацией.",
          "Ресайз начинает применяться только после первого движения указателя и",
          "показывает текущий размер. Настройки (видимость, порядок, плотность,",
          "sticky, layout) хранятся в localStorage; выбранная в настройках",
          "плотность перекрывает `density`, но сам prop остаётся значением по",
          "умолчанию. Узкий экран переключает таблицу в карточки, массовые",
          "действия живут в подвале над пагинацией и закрепляются вместе с ним.",
          "Колонку с `locked` нельзя скрыть, переставить или утащить;",
          "`settingsLabel` задаёт её подпись в настройках.",
        ].join(" "),
      },
      canvas: { sourceState: "shown" },
    },
  },
  argTypes: {
    tableKey: {
      control: "text",
      description: "Ключ localStorage для порядка и ширин колонок",
    },
    page: { control: { type: "number", min: 1 }, description: "Текущая страница" },
    pageSize: { control: "select", options: [5, 10, 20, 50], description: "Строк на странице" },
    loading: { control: "boolean", description: "Показать skeleton-строки" },
    error: { control: "text", description: "Текст ошибки вместо строк" },
    empty: { control: "boolean", description: "Пустой набор данных" },
    density: {
      control: "inline-radio",
      options: ["standard", "compact"] satisfies readonly DataTableDensity[],
      description: "Плотность строк",
    },
    selectionEnabled: { control: "boolean", description: "Колонка выбора строк" },
    initialSelected: {
      control: "object",
      description: "Ключи предвыбранных строк (для демонстрации панели действий)",
    },
    selectionBarPosition: {
      control: "inline-radio",
      options: ["bottom", "top"],
      description: "Где показывать панель массовых действий",
    },
    layout: {
      control: "inline-radio",
      options: ["table", "cards"],
      description: "Раскладка; без пропса узкий экран выбирает карточки",
    },
    stickyFooter: { control: "boolean", description: "Закрепить подвал при прокрутке" },
    scrollMode: {
      control: "inline-radio",
      options: ["internal", "external"],
      description: "Прокрутка внутри тела таблицы или страницы",
    },
    title: { control: "text", description: "Заголовок таблицы" },
    subtitle: { control: "text", description: "Подзаголовок" },
    cards: { control: "boolean", description: "Показать карточки вместо таблицы" },
    toolbarText: { control: "text", description: "Текст в слоте toolbar" },
    columns: {
      control: false,
      description: "Колонки: ключ, заголовок, ширины, сортировка, рендер, locked и settingsLabel",
      table: { type: { summary: "readonly DataTableColumn<Row>[]" } },
    },
    rows: {
      control: false,
      description: "Строки текущей страницы",
      table: { type: { summary: "readonly Row[]" } },
    },
    sortKey: {
      control: false,
      description: "Управляемый ключ сортировки",
      table: { type: { summary: "string | undefined" } },
    },
    sortDirection: {
      control: false,
      description: "Направление сортировки",
      table: { type: { summary: "DataTableSortDirection | undefined" } },
    },
    onSort: { action: "sort", description: "Запрос серверной сортировки" },
    onPageChange: { action: "page-change", description: "Запрос страницы" },
    onPageSizeChange: { action: "page-size-change", description: "Запрос размера страницы" },
    onSelectionChange: { action: "selection-change", description: "Новый набор выбранных строк" },
    onRowClick: { action: "row-click", description: "Клик по строке" },
    onCellEdit: { action: "cell-edit", description: "Сохранение значения ячейки" },
    onTreeMove: { action: "tree-move", description: "Перенос узла дерева" },
  },
  args: {
    tableKey: "storybook-data-table",
    page: 1,
    pageSize: 10,
    loading: false,
    error: "",
    empty: false,
    density: "standard",
    selectionEnabled: false,
    initialSelected: [],
    selectionBarPosition: "bottom",
    stickyFooter: false,
    scrollMode: "internal",
    title: "Команда",
    subtitle: "Данные обновляются на сервере",
    cards: false,
    toolbarText: "Серверная таблица",
    onSort: fn(),
    onPageChange: fn(),
    onPageSizeChange: fn(),
    onSelectionChange: fn(),
    onRowClick: fn(),
    onCellEdit: fn(),
    onTreeMove: fn(),
  },
} satisfies Meta<DataTableArgs>;

export default meta;

type Story = StoryObj<DataTableArgs>;

function sortRows(
  rows: readonly Person[],
  key: string | undefined,
  direction: DataTableSortDirection | undefined,
): readonly Person[] {
  if (key === undefined || direction === undefined) return rows;
  const sign = direction === "ascending" ? 1 : -1;
  return [...rows].sort((left, right) => {
    const leftValue = left[key as keyof Person];
    const rightValue = right[key as keyof Person];
    if (typeof leftValue === "number" && typeof rightValue === "number") {
      return (leftValue - rightValue) * sign;
    }
    return String(leftValue).localeCompare(String(rightValue), "ru") * sign;
  });
}

function DataTableDemo(args: DataTableArgs): Node {
  const [page, setPage] = createSignal(args.page);
  const [pageSize, setPageSize] = createSignal(args.pageSize);
  const [sortKey, setSortKey] = createSignal<string | undefined>(args.sortKey);
  const [sortDirection, setSortDirection] = createSignal<DataTableSortDirection | undefined>(
    args.sortDirection,
  );
  const [selected, setSelected] = createSignal<ReadonlySet<string | number>>(
    new Set(args.initialSelected ?? []),
  );
  const [layoutOverride, setLayoutOverride] = createSignal<DataTableLayout | null>(null);
  const layout = (): DataTableLayout | undefined =>
    layoutOverride() ?? args.layout ?? (args.cards ? "cards" : undefined);

  const total = (): number => (args.empty || args.error !== "" ? 0 : PEOPLE.length);
  const rows = (): readonly Person[] => {
    if (args.empty || args.error !== "") return [];
    const sorted = sortRows(PEOPLE, sortKey(), sortDirection());
    const start = (page() - 1) * pageSize();
    return sorted.slice(start, start + pageSize());
  };

  const selectionHandle = {
    get selected(): ReadonlySet<string | number> {
      return selected();
    },
    onChange: (keys: ReadonlySet<string | number>): void => {
      setSelected(keys);
      args.onSelectionChange(keys);
    },
  };

  return (
    <Stack gap={3}>
      <Text variant="body-small" tone="muted">
        Данные и сортировка приходят с сервера, компонент только запрашивает изменения.
      </Text>
      <DataTable
        tableKey={args.tableKey}
        columns={args.columns ?? COLUMNS}
        rows={rows()}
        rowKey={(row) => row.id}
        total={total()}
        page={page()}
        pageSize={pageSize()}
        pageSizeOptions={[5, 10, 20, 50]}
        loading={args.loading}
        error={args.error === "" ? undefined : args.error}
        sortKey={sortKey()}
        sortDirection={sortDirection()}
        density={args.density}
        selectionBarPosition={args.selectionBarPosition}
        selection={
          args.selectionEnabled
            ? selectionHandle
            : undefined
        }
        layout={layout()}
        onLayoutChange={setLayoutOverride}
        stickyFooter={args.stickyFooter}
        scrollMode={args.scrollMode}
        title={args.title === "" ? undefined : args.title}
        subtitle={args.subtitle === "" ? undefined : args.subtitle}
        renderCard={(row) => (
          <div>
            <strong>{row.name}</strong>
            <p>{row.role} · {row.score}</p>
          </div>
        )}
        toolbar={<Text variant="label-large">{args.toolbarText}</Text>}
        onSort={(key, direction) => {
          setSortKey(key);
          setSortDirection(direction);
          args.onSort(key, direction);
        }}
        onPageChange={(next) => {
          setPage(next);
          args.onPageChange(next);
        }}
        onPageSizeChange={(next) => {
          setPageSize(next);
          setPage(1);
          args.onPageSizeChange(next);
        }}
        onRowClick={args.onRowClick}
        onCellEdit={args.onCellEdit}
      />
    </Stack>
  );
}

export const Playground: Story = {
  render: silentStory<DataTableArgs>((args) => DataTableDemo(args)),
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("grid")).toBeTruthy();
    const sortButton = canvasElement.querySelector<HTMLButtonElement>(
      "th[data-column-key='name'] button.sui-data-table__sort",
    );
    if (sortButton === null) throw new Error("не найдена кнопка сортировки");
    await userEvent.click(sortButton);
    await expect(args.onSort).toHaveBeenCalledWith("name", "ascending");
  },
};

export const Loading: Story = {
  args: { loading: true, pageSize: 10 },
  render: silentStory<DataTableArgs>((args) => DataTableDemo(args)),
  play: async ({ canvasElement }) => {
    const skeletons = canvasElement.querySelectorAll("tr[data-skeleton]");
    await expect(skeletons.length).toBeGreaterThan(0);
    await expect(
      canvasElement.querySelector("table")?.getAttribute("aria-busy"),
    ).toBe("true");
  },
};

export const ErrorState: Story = {
  name: "Ошибка",
  args: {
    error: "Не удалось загрузить список сотрудников. Попробуйте ещё раз.",
    tableKey: "storybook-data-table-error",
  },
  render: silentStory<DataTableArgs>((args) => DataTableDemo(args)),
  play: async ({ canvasElement }) => {
    const alert = canvasElement.querySelector("[role='alert']");
    await expect(alert?.textContent).toContain("Не удалось загрузить");
  },
};

export const Empty: Story = {
  name: "Пусто",
  args: { empty: true, tableKey: "storybook-data-table-empty" },
  render: silentStory<DataTableArgs>((args) => DataTableDemo(args)),
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector(".sui-data-table__empty")).not.toBeNull();
  },
};

export const Selection: Story = {
  name: "Выбор строк",
  args: { selectionEnabled: true, tableKey: "storybook-data-table-selection" },
  render: silentStory<DataTableArgs>((args) => DataTableDemo(args)),
  play: async ({ canvasElement, args }) => {
    const checkbox = canvasElement.querySelector<HTMLInputElement>(
      "input[aria-label='Выбрать строку 1']",
    );
    if (checkbox === null) throw new Error("не найден чекбокс строки");
    await userEvent.click(checkbox);
    await expect(args.onSelectionChange).toHaveBeenCalled();
    await expect(canvasElement.querySelector("tr[data-selected]")).not.toBeNull();
  },
};

export const ResizeAndReorder: Story = {
  name: "Ресайз и перестановка",
  args: {
    tableKey: "storybook-data-table-resize",
    pageSize: 10,
  },
  parameters: { controls: { disable: true } },
  render: silentStory<DataTableArgs>((args) => DataTableDemo(args)),
  play: async ({ canvasElement }) => {
    const resizer = canvasElement.querySelector<HTMLButtonElement>(
      "button.sui-data-table__resizer[data-column-key='name']",
    );
    const header = canvasElement.querySelector<HTMLElement>("th[data-column-key='name']");
    if (resizer === null || header === null) {
      throw new Error("не найдены ресайзер и заголовок");
    }
    await expect(resizer.getAttribute("aria-label")).toContain("Изменить ширину");
    await expect(header.getAttribute("aria-label")).toContain("Перетащить колонку");
    await expect(canvasElement.querySelector(".sui-data-table__drag-grip")).toBeNull();

    const rect = resizer.getBoundingClientRect();
    resizer.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    }));
    await expect(canvasElement.querySelector(".sui-data-table__resize-chip")).toBeNull();
    window.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true,
      clientX: rect.left + rect.width / 2 + 24,
      clientY: rect.top + rect.height / 2,
    }));
    await expect(canvasElement.querySelector(".sui-data-table__resize-chip")).not.toBeNull();
    window.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true,
      clientX: rect.left + rect.width / 2 + 24,
      clientY: rect.top + rect.height / 2,
    }));
    await expect(window.localStorage.getItem(dataTableStorageKey("storybook-data-table-resize"))).toContain(
      "\"name\"",
    );

    header.focus();
    await userEvent.keyboard(" ");
    await userEvent.keyboard("{ArrowRight}");
    await expect(window.localStorage.getItem(dataTableStorageKey("storybook-data-table-resize"))).toContain(
      "\"order\"",
    );

    const reset = canvasElement.querySelector<HTMLButtonElement>("[data-testid='data-table-reset']");
    if (reset === null) throw new Error("не найдена кнопка сброса");
    await userEvent.click(reset);
    await expect(window.localStorage.getItem(dataTableStorageKey("storybook-data-table-resize"))).toBeNull();
  },
};

export const DragWholeHeader: Story = {
  name: "Drag за весь заголовок",
  args: { tableKey: "storybook-data-table-drag", pageSize: 10 },
  parameters: { controls: { disable: true } },
  render: silentStory<DataTableArgs>((args) => DataTableDemo(args)),
  play: async ({ canvasElement }) => {
    const source = canvasElement.querySelector<HTMLElement>("th[data-column-key='name']");
    const target = canvasElement.querySelector<HTMLElement>("th[data-column-key='role']");
    if (source === null || target === null) throw new Error("не найдены заголовки");
    await expect(canvasElement.querySelector(".sui-data-table__drag-grip")).toBeNull();
    await expect(source.getAttribute("aria-roledescription")).toContain("Перетаскиваемый");

    const sourceRect = source.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const startX = sourceRect.left + sourceRect.width / 2;
    const endX = targetRect.left + targetRect.width / 2;
    const y = sourceRect.top + sourceRect.height / 2;

    source.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: startX,
      clientY: y,
    }));
    window.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true,
      clientX: startX + 4,
      clientY: y,
    }));
    await expect(canvasElement.querySelector("th[data-column-key='name']")?.hasAttribute("data-dragging")).toBe(false);
    window.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true,
      clientX: endX,
      clientY: y,
    }));
    await expect(canvasElement.querySelector("th[data-column-key='name']")?.hasAttribute("data-dragging")).toBe(true);
    await expect(
      canvasElement.querySelector<HTMLElement>("th[data-column-key='name']")?.style.transform,
    ).toContain("translate3d");
    await expect(document.querySelector(".sui-data-table__drag-ghost")).toBeNull();
    await expect(canvasElement.querySelector("th[data-column-key='role']")?.getAttribute("data-drop")).toBe("after");
    await expect(canvasElement.querySelector(".sui-data-table__drop-indicator")).not.toBeNull();
    await expect(
      Array.from(canvasElement.querySelectorAll("th[data-column-key]")).map((node) =>
        node.getAttribute("data-column-key"),
      ),
    ).toEqual(["name", "role", "score"]);

    window.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true,
      clientX: endX,
      clientY: y,
    }));
    await expect(
      Array.from(canvasElement.querySelectorAll("th[data-column-key]")).map((node) =>
        node.getAttribute("data-column-key"),
      ),
    ).toEqual(["role", "name", "score"]);
    const stored = window.localStorage.getItem(dataTableStorageKey("storybook-data-table-drag"));
    await expect(stored).toContain("\"role\",\"name\"");
  },
};

export const DensityOverride: Story = {
  name: "Плотность из настроек",
  args: {
    tableKey: "storybook-data-table-density",
    density: "standard",
    pageSize: 10,
  },
  render: silentStory<DataTableArgs>((args) => DataTableDemo(args)),
  play: async ({ canvasElement }) => {
    const table = canvasElement.querySelector<HTMLElement>(".sui-data-table");
    await expect(table?.getAttribute("data-density")).toBe("standard");
    const open = canvasElement.querySelector<HTMLButtonElement>(
      "button[aria-label='Настройки таблицы']",
    );
    if (open === null) throw new Error("не найдена кнопка настроек");
    await userEvent.click(open);
    const dialog = canvasElement.querySelector<HTMLElement>("dialog.sui-dialog");
    const densitySelect = dialog?.querySelector<HTMLSelectElement>("select.sui-data-table__select");
    if (densitySelect === null || densitySelect === undefined) {
      throw new Error("не найден селект плотности");
    }
    densitySelect.value = "compact";
    densitySelect.dispatchEvent(new Event("change", { bubbles: true }));
    await expect(table?.getAttribute("data-density")).toBe("compact");
    await expect(
      window.localStorage.getItem(dataTableStorageKey("storybook-data-table-density")),
    ).toContain("\"density\":\"compact\"");
  },
};

export const PaginationActive: Story = {
  name: "Активная страница пагинации",
  args: {
    tableKey: "storybook-data-table-pagination",
    page: 2,
    pageSize: 5,
  },
  render: silentStory<DataTableArgs>((args) => DataTableDemo(args)),
  play: async ({ canvasElement, args }) => {
    const current = canvasElement.querySelector<HTMLElement>(
      ".sui-pagination__page[aria-current='page']",
    );
    await expect(current?.textContent).toBe("2");
    await expect(current?.hasAttribute("data-current")).toBe(true);
    await expect(canvasElement.querySelector(".sui-pagination__status")?.textContent).toContain(
      "Страница 2 из 5",
    );
    await expect(
      canvasElement.querySelector(".sui-data-table__footer .sui-data-table__pagination-controls"),
    ).not.toBeNull();

    const next = canvasElement.querySelector<HTMLButtonElement>(
      ".sui-pagination__page[aria-label='Страница 3 из 5']",
    );
    if (next === null) throw new Error("не найдена страница 3");
    await userEvent.click(next);
    await expect(args.onPageChange).toHaveBeenCalledWith(3);
  },
};

const EDITABLE_COLUMNS: readonly DataTableColumn<Person>[] = COLUMNS.map((column) =>
  column.key === "name" ? { ...column, editable: true } : column,
);

export const InlineEditing: Story = {
  name: "Редактирование ячеек",
  args: {
    tableKey: "storybook-data-table-editing",
    columns: EDITABLE_COLUMNS,
    pageSize: 5,
  },
  render: silentStory<DataTableArgs>((args) => DataTableDemo(args)),
  play: async ({ canvasElement, args }) => {
    const cell = canvasElement.querySelector<HTMLElement>("tbody td[data-editable]");
    if (cell === null) throw new Error("нет редактируемой ячейки");
    await userEvent.dblClick(cell);
    const input = cell.querySelector<HTMLInputElement>("input.sui-data-table__cell-editor");
    if (input === null) throw new Error("редактор не открылся");
    input.value = "Ада Ловлейс";
    await userEvent.keyboard("{Enter}");
    await expect(args.onCellEdit).toHaveBeenCalled();
  },
};

const MANY_ROWS: readonly Person[] = Array.from({ length: 5000 }, (_value, index) => ({
  id: index + 1,
  name: `Строка ${String(index + 1)}`,
  role: ROLES[index % ROLES.length] ?? "Инженер",
  score: 99 - (index % 40),
}));

export const VirtualizedRows: Story = {
  name: "Виртуализация 5000 строк",
  args: { tableKey: "storybook-data-table-virtual", pageSize: 5000 },
  parameters: { controls: { disable: true } },
  render: silentStory<DataTableArgs>(() => (
    <DataTable
      tableKey="storybook-data-table-virtual"
      columns={COLUMNS}
      rows={MANY_ROWS}
      rowKey={(row) => row.id}
      total={MANY_ROWS.length}
      page={1}
      pageSize={5000}
      density="compact"
      title="5000 строк"
    />
  )),
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector(".sui-data-table")?.hasAttribute("data-virtual")).toBe(true);
    const rendered = canvasElement.querySelectorAll("tbody tr.sui-data-table__tr[data-key]");
    await expect(rendered.length).toBeLessThan(100);
    await expect(canvasElement.querySelector("tr[data-spacer]")).not.toBeNull();
  },
};

export const InternalScroll: Story = {
  name: "Прокрутка внутри таблицы",
  args: {
    tableKey: "storybook-data-table-internal",
    pageSize: 10,
    scrollMode: "internal",
  },
  parameters: { controls: { disable: true } },
  render: silentStory<DataTableArgs>((args) => DataTableDemo(args)),
  play: async ({ canvasElement }) => {
    const root = canvasElement.querySelector<HTMLElement>(".sui-data-table");
    const scroll = canvasElement.querySelector<HTMLElement>(".sui-data-table__scroll");
    await expect(root?.getAttribute("data-scroll")).toBe("internal");
    await expect(scroll?.style.getPropertyValue("block-size")).toBe("608px");
    await expect(root?.hasAttribute("data-virtual")).toBe(false);
  },
};

export const TreeRowDrag: Story = {
  name: "Перенос узлов дерева",
  args: { tableKey: "storybook-data-table-tree-drag", pageSize: 10 },
  render: silentStory<DataTableArgs>((args) => TreeDemo(args)),
  play: async ({ canvasElement }) => {
    const grip = canvasElement.querySelector<HTMLElement>(
      "tbody tr[data-key='2'] .sui-data-table__row-grip",
    );
    await expect(grip).not.toBeNull();
    await expect(grip?.getAttribute("aria-label")).toContain("Перетащить строку");
  },
};

export const NarrowScreen: Story = {
  name: "Узкий экран",
  args: { tableKey: "storybook-data-table-narrow", pageSize: 5 },
  parameters: {
    viewport: { defaultViewport: "mobile360" },
    controls: { disable: true },
  },
  render: silentStory<DataTableArgs>((args) => (
    <div style={{ inlineSize: "360px", maxInlineSize: "100%" }}>
      <DataTableDemo {...args} />
    </div>
  )),
};

export const Settings: Story = {
  name: "Настройки таблицы",
  args: {
    tableKey: "storybook-data-table-settings",
    selectionEnabled: true,
    pageSize: 10,
  },
  render: silentStory<DataTableArgs>((args) => DataTableDemo(args)),
  play: async ({ canvasElement }) => {
    const open = canvasElement.querySelector<HTMLButtonElement>(
      "button[aria-label='Настройки таблицы']",
    );
    if (open === null) throw new Error("не найдена кнопка настроек");
    await userEvent.click(open);
    const dialog = canvasElement.querySelector<HTMLElement>("dialog.sui-dialog");
    await expect(dialog?.hasAttribute("open")).toBe(true);

    const first = dialog?.querySelector<HTMLInputElement>("input[type='checkbox']");
    if (first === null || first === undefined) throw new Error("нет переключателя колонки");
    await userEvent.click(first);
    await expect(
      window.localStorage.getItem(dataTableStorageKey("storybook-data-table-settings")),
    ).toContain("visible");

    const reset = dialog?.querySelector<HTMLButtonElement>(".sui-dialog__actions .sui-button");
    if (reset !== null && reset !== undefined) await userEvent.click(reset);
  },
};

export const LockedColumn: Story = {
  name: "Заблокированная колонка",
  args: {
    tableKey: "storybook-data-table-locked",
    columns: LOCKED_COLUMNS,
    pageSize: 5,
  },
  render: silentStory<DataTableArgs>((args) => DataTableDemo(args)),
  play: async ({ canvasElement }) => {
    const locked = canvasElement.querySelector<HTMLElement>("th[data-column-key='name']");
    const free = canvasElement.querySelector<HTMLElement>("th[data-column-key='role']");
    if (locked === null || free === null) throw new Error("не найдены заголовки");
    await expect(locked.hasAttribute("data-reorderable")).toBe(false);
    await expect(free.hasAttribute("data-reorderable")).toBe(true);

    const rect = locked.getBoundingClientRect();
    locked.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    }));
    window.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true,
      clientX: rect.left + rect.width + 80,
      clientY: rect.top + rect.height / 2,
    }));
    await expect(canvasElement.querySelector("th[data-column-key='name']")?.hasAttribute("data-dragging")).toBe(false);
    window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    await expect(
      Array.from(canvasElement.querySelectorAll("th[data-column-key]")).map((node) =>
        node.getAttribute("data-column-key"),
      ),
    ).toEqual(["name", "role", "score", "actions"]);

    const open = canvasElement.querySelector<HTMLButtonElement>(
      "button[aria-label='Настройки таблицы']",
    );
    if (open === null) throw new Error("не найдена кнопка настроек");
    await userEvent.click(open);
    const dialog = canvasElement.querySelector<HTMLElement>("dialog.sui-dialog");
    const nameRow = dialog?.querySelector<HTMLElement>(
      ".sui-data-table__settings-row[data-column-key='name']",
    );
    await expect(nameRow?.hasAttribute("data-locked")).toBe(true);
    await expect(nameRow?.querySelector(".sui-data-table__settings-lock")).not.toBeNull();
    await expect(nameRow?.querySelector("input[type='checkbox']")).toBeNull();
    await expect(nameRow?.querySelector("button[aria-label='Выше']")).toBeNull();
    await expect(
      dialog?.querySelector(".sui-data-table__settings-row[data-column-key='role']")?.textContent,
    ).toContain("Должность");
    await expect(
      dialog?.querySelector(".sui-data-table__settings-row[data-column-key='actions']")?.textContent,
    ).toContain("Действия");

    const roleToggle = dialog?.querySelector<HTMLInputElement>(
      ".sui-data-table__settings-row[data-column-key='role'] input[type='checkbox']",
    );
    if (roleToggle === null || roleToggle === undefined) throw new Error("нет переключателя роли");
    await userEvent.click(roleToggle);
    await expect(canvasElement.querySelector("th[data-column-key='role']")).toBeNull();
    await expect(canvasElement.querySelector("th[data-column-key='name']")).not.toBeNull();
  },
};

export const Cards: Story = {
  name: "Карточки",
  args: {
    tableKey: "storybook-data-table-cards",
    selectionEnabled: true,
    pageSize: 5,
  },
  render: silentStory<DataTableArgs>((args) => DataTableDemo(args)),
  play: async ({ canvasElement }) => {
    const toggle = canvasElement.querySelector<HTMLButtonElement>("[data-layout-target='cards']");
    if (toggle === null) throw new Error("нет переключателя раскладки");
    await userEvent.click(toggle);
    await expect(canvasElement.querySelectorAll(".sui-data-table__card").length).toBe(5);
    await expect(canvasElement.querySelector(".sui-data-table__card strong")?.textContent).toContain("Ада");
  },
};

interface Department extends Person {
  readonly parentId: number | null;
}

const DEPARTMENTS: readonly Department[] = [
  { id: 1, name: "Инженерия", role: "Отдел", score: 0, parentId: null },
  { id: 2, name: "Ада Ловлейс", role: "Инженер", score: 98, parentId: 1 },
  { id: 3, name: "Грейс Хоппер", role: "Архитектор", score: 95, parentId: 1 },
  { id: 4, name: "Исследования", role: "Отдел", score: 0, parentId: null },
  { id: 5, name: "Алан Тьюринг", role: "Исследователь", score: 91, parentId: 4 },
  { id: 6, name: "Кэтрин Джонсон", role: "Математик", score: 89, parentId: 4 },
];

const DEPARTMENT_ROOTS = DEPARTMENTS.filter((row) => row.parentId === null);

function TreeDemo(args: DataTableArgs): Node {
  const [selected, setSelected] = createSignal<ReadonlySet<string | number>>(new Set());
  const tree: DataTableTree<Department> = {
    getChildren: (row) => DEPARTMENTS.filter((entry) => entry.parentId === row.id),
    defaultExpandedKeys: ["1", "4"],
    cascadeSelection: true,
    onMove: (move) => {
      args.onTreeMove(move);
    },
  };
  return (
    <DataTable
      tableKey={args.tableKey}
      columns={COLUMNS as readonly DataTableColumn<Department>[]}
      rows={DEPARTMENT_ROOTS}
      rowKey={(row) => row.id}
      total={DEPARTMENTS.length}
      page={1}
      pageSize={10}
      tree={tree}
      title={args.title}
      subtitle={args.subtitle}
      selection={{
        selected: selected(),
        onChange: (keys) => {
          setSelected(keys);
          args.onSelectionChange(keys);
        },
        actions: <button type="button">Удалить</button>,
      }}
      onRowClick={args.onRowClick}
    />
  );
}

export const TreeRows: Story = {
  name: "Дерево строк",
  args: {
    tableKey: "storybook-data-table-tree",
    pageSize: 10,
  },
  render: silentStory<DataTableArgs>((args) => TreeDemo(args)),
  play: async ({ canvasElement, args }) => {
    const toggle = canvasElement.querySelector<HTMLButtonElement>(
      "tbody tr[data-key='1'] button.sui-data-table__tree-toggle",
    );
    if (toggle === null) throw new Error("нет раскрытия ветки");
    await expect(toggle.getAttribute("aria-expanded")).toBe("true");
    await userEvent.click(toggle);
    await expect(toggle.getAttribute("aria-expanded")).toBe("false");

    const parent = canvasElement.querySelector<HTMLInputElement>(
      "input[aria-label='Выбрать строку 1']",
    );
    if (parent === null) throw new Error("нет выбора строки");
    await userEvent.click(parent);
    await expect(canvasElement.querySelector(".sui-data-table__selection-count")).not.toBeNull();
    await expect(args.onSelectionChange).toHaveBeenCalled();
  },
};

export const BulkActions: Story = {
  name: "Массовые действия",
  args: {
    tableKey: "storybook-data-table-bulk",
    selectionEnabled: true,
    initialSelected: [1, 2],
  },
  render: silentStory<DataTableArgs>((args) => DataTableDemo(args)),
  play: async ({ canvasElement, args }) => {
    const bar = canvasElement.querySelector(".sui-data-table__selection-bar");
    await expect(bar).not.toBeNull();
    await expect(canvasElement.querySelector(".sui-data-table__footer .sui-data-table__selection-bar")).not.toBeNull();
    await expect(
      bar?.nextElementSibling?.classList.contains("sui-data-table__footer-main"),
    ).toBe(true);
    await expect(canvasElement.querySelector(".sui-data-table__selection-count")?.textContent).toContain("2");
    const clear = canvasElement.querySelector<HTMLButtonElement>("[data-action='clear-selection']");
    if (clear === null) throw new Error("нет очистки выбора");
    await userEvent.click(clear);
    await expect(args.onSelectionChange).toHaveBeenCalled();
  },
};

export const BulkOverlay: Story = {
  name: "Массовые действия поверх подвала",
  args: {
    tableKey: "storybook-data-table-bulk-sticky",
    selectionEnabled: true,
    initialSelected: [1, 2, 3],
    stickyFooter: true,
    scrollMode: "internal",
    pageSize: 10,
  },
  render: silentStory<DataTableArgs>((args) => (
    <div style={{ blockSize: "420px", overflow: "auto" }}>
      <DataTableDemo {...args} />
    </div>
  )),
  play: async ({ canvasElement, args }) => {
    const footer = canvasElement.querySelector<HTMLElement>(".sui-data-table__footer");
    const bar = footer?.querySelector<HTMLElement>(".sui-data-table__selection-bar");
    await expect(footer?.hasAttribute("data-sticky")).toBe(true);
    await expect(bar).not.toBeNull();
    await expect(bar?.getAttribute("data-position")).toBe("bottom");
    await expect(
      bar?.nextElementSibling?.classList.contains("sui-data-table__footer-main"),
    ).toBe(true);
    await expect(footer?.querySelector(".sui-data-table__pagination-controls")).not.toBeNull();
    await expect(
      canvasElement.querySelector(".sui-data-table__toolbar .sui-data-table__selection-bar"),
    ).toBeNull();
    await expect(getComputedStyle(footer as HTMLElement).position).toBe("sticky");
    await expect(canvasElement.querySelector(".sui-data-table__selection-count")?.textContent).toContain(
      "3",
    );
    const clear = canvasElement.querySelector<HTMLButtonElement>("[data-action='clear-selection']");
    if (clear === null) throw new Error("нет очистки выбора");
    await userEvent.click(clear);
    await expect(args.onSelectionChange).toHaveBeenCalled();
  },
};

export const StickyFooter: Story = {
  name: "Sticky footer",
  args: {
    tableKey: "storybook-data-table-sticky",
    stickyFooter: true,
    pageSize: 10,
  },
  render: silentStory<DataTableArgs>((args) => (
    <div
      data-testid="sticky-scroll"
      style={{ blockSize: "420px", overflow: "auto" }}
    >
      <DataTableDemo {...args} />
    </div>
  )),
  play: async ({ canvasElement }) => {
    const footer = canvasElement.querySelector<HTMLElement>(".sui-data-table__footer");
    const scroller = canvasElement.querySelector<HTMLElement>("[data-testid='sticky-scroll']");
    if (footer === null || scroller === null) throw new Error("нет подвала или скроллера");
    await expect(footer.hasAttribute("data-sticky")).toBe(true);
    await expect(getComputedStyle(footer).position).toBe("sticky");
    await expect(canvasElement.querySelector("thead th[data-column-key]")).not.toBeNull();

    scroller.scrollTop = scroller.scrollHeight;
    const footerRect = footer.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    await expect(footerRect.bottom).toBeLessThanOrEqual(scrollerRect.bottom + 1);
    await expect(footerRect.top).toBeGreaterThanOrEqual(scrollerRect.top - 1);
  },
};

export const Dark: Story = {
  name: "Тёмная тема",
  args: {
    tableKey: "storybook-data-table-dark",
    selectionEnabled: true,
    initialSelected: [1, 2, 3],
    stickyFooter: true,
    pageSize: 5,
  },
  render: silentStory<DataTableArgs>((args) => (
    <div
      data-theme="dark"
      style={{
        padding: "var(--sui-space-4)",
        background: "var(--sui-color-surface)",
        color: "var(--sui-color-on-surface)",
      }}
    >
      <DataTableDemo {...args} />
    </div>
  )),
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('[data-theme="dark"] .sui-data-table')).not.toBeNull();
    await expect(canvasElement.querySelectorAll("tbody tr.sui-data-table__tr").length).toBe(5);
    const footer = canvasElement.querySelector<HTMLElement>(".sui-data-table__footer");
    await expect(footer?.hasAttribute("data-sticky")).toBe(true);
    await expect(footer?.querySelector(".sui-data-table__selection-bar")).not.toBeNull();
    await expect(canvasElement.querySelector(".sui-pagination__page[aria-current='page']")).not.toBeNull();
  },
};
