import type { Meta, StoryObj } from "@storybook/html-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { createSignal } from "@ivlev-dev/silent-core";
import { Stack, Text } from "@ivlev-dev/silent-ui";
import {
  DataTable,
  dataTableStorageKey,
  type DataTableColumn,
  type DataTableDensity,
  type DataTableSortDirection,
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
          "перетаскиванием за ручку или с клавиатуры (Space, стрелки, Space).",
          "На узких экранах таблица прокручивается по горизонтали.",
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

  const total = (): number => (args.empty || args.error !== "" ? 0 : PEOPLE.length);
  const rows = (): readonly Person[] => {
    if (args.empty || args.error !== "") return [];
    const sorted = sortRows(PEOPLE, sortKey(), sortDirection());
    const start = (page() - 1) * pageSize();
    return sorted.slice(start, start + pageSize());
  };

  const selection = args.selectionEnabled
    ? {
        selected: selected(),
        onChange: (keys: ReadonlySet<string | number>) => {
          setSelected(keys);
          args.onSelectionChange(keys);
        },
      }
    : undefined;

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
        selection={selection}
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
    const dragHandle = canvasElement.querySelector<HTMLButtonElement>(
      "button.sui-data-table__drag-handle[data-dnd-id='name']",
    );
    if (resizer === null || dragHandle === null) {
      throw new Error("не найдены ручки ресайза и перестановки");
    }
    await expect(resizer.getAttribute("aria-label")).toContain("Изменить ширину");
    await expect(dragHandle.getAttribute("aria-label")).toContain("Переместить колонку");

    resizer.focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect(window.localStorage.getItem(dataTableStorageKey("storybook-data-table-resize"))).toContain(
      "\"name\"",
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
