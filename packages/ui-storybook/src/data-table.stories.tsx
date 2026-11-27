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

interface DataTableArgs {
  readonly tableKey: string;
  readonly page: number;
  readonly pageSize: number;
  readonly loading: boolean;
  readonly error: string;
  readonly empty: boolean;
  readonly density: DataTableDensity;
  readonly selectionEnabled: boolean;
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
          "или с клавиатуры (Space, стрелки, Space). Ресайз фиксирует измеренные",
          "ширины и показывает текущий размер. Настройки (видимость, порядок,",
          "плотность, sticky, layout) хранятся в localStorage; узкий экран",
          "переключает таблицу в карточки, массовые действия закреплены сверху.",
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
    layout: {
      control: "inline-radio",
      options: ["table", "cards"],
      description: "Раскладка; без пропса узкий экран выбирает карточки",
    },
    stickyFooter: { control: "boolean", description: "Закрепить подвал при прокрутке" },
    scrollMode: {
      control: "inline-radio",
      options: ["page", "contained"],
      description: "Скролл страницы или контейнера",
    },
    title: { control: "text", description: "Заголовок таблицы" },
    subtitle: { control: "text", description: "Подзаголовок" },
    cards: { control: "boolean", description: "Показать карточки вместо таблицы" },
    toolbarText: { control: "text", description: "Текст в слоте toolbar" },
    columns: {
      control: false,
      description: "Колонки: ключ, заголовок, ширины, сортировка, рендер",
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
    stickyFooter: false,
    scrollMode: "page",
    title: "Команда",
    subtitle: "Данные обновляются на сервере",
    cards: false,
    toolbarText: "Серверная таблица",
    onSort: fn(),
    onPageChange: fn(),
    onPageSizeChange: fn(),
    onSelectionChange: fn(),
    onRowClick: fn(),
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
  const [selected, setSelected] = createSignal<ReadonlySet<string | number>>(new Set());
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

  return (
    <Stack gap={3}>
      <Text variant="body-small" tone="muted">
        Данные и сортировка приходят с сервера, компонент только запрашивает изменения.
      </Text>
      <DataTable
        tableKey={args.tableKey}
        columns={COLUMNS}
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
        selection={
          args.selectionEnabled
            ? {
                selected: selected(),
                onChange: (keys: ReadonlySet<string | number>) => {
                  setSelected(keys);
                  args.onSelectionChange(keys);
                },
              }
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

    const rect = resizer.getBoundingClientRect();
    resizer.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    }));
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

export const Cards: Story = {
  name: "Карточки",
  args: {
    tableKey: "storybook-data-table-cards",
    selectionEnabled: true,
    pageSize: 5,
  },
  render: silentStory<DataTableArgs>((args) => DataTableDemo(args)),
  play: async ({ canvasElement }) => {
    const toggle = canvasElement.querySelector<HTMLButtonElement>(".sui-data-table__layout-toggle");
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
  },
  render: silentStory<DataTableArgs>((args) => DataTableDemo(args)),
  play: async ({ canvasElement }) => {
    const all = canvasElement.querySelector<HTMLInputElement>("input[aria-label='Выбрать все строки']");
    if (all === null) throw new Error("нет выбора всех строк");
    await userEvent.click(all);
    await expect(canvasElement.querySelector(".sui-data-table__selection-bar")).not.toBeNull();
    await expect(canvasElement.querySelector(".sui-data-table__selection-count")?.textContent).toContain("10");
    const clear = canvasElement.querySelector<HTMLButtonElement>("[data-action='clear-selection']");
    if (clear === null) throw new Error("нет очистки выбора");
    await userEvent.click(clear);
    await expect(canvasElement.querySelector(".sui-data-table__selection-bar")).toBeNull();
  },
};

export const StickyFooter: Story = {
  name: "Sticky header и footer",
  args: {
    tableKey: "storybook-data-table-sticky",
    stickyFooter: true,
    scrollMode: "contained",
    pageSize: 10,
  },
  render: silentStory<DataTableArgs>((args) => (
    <div style={{ blockSize: "420px" }}>
      <DataTableDemo {...args} />
    </div>
  )),
  play: async ({ canvasElement }) => {
    await expect(
      canvasElement.querySelector(".sui-data-table__footer")?.hasAttribute("data-sticky"),
    ).toBe(true);
    await expect(canvasElement.querySelector("thead th[data-column-key]")).not.toBeNull();
  },
};

export const Dark: Story = {
  name: "Тёмная тема",
  args: {
    tableKey: "storybook-data-table-dark",
    selectionEnabled: true,
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
  },
};
