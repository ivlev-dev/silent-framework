import type { Meta, StoryObj } from "@storybook/html-vite";
import { fn } from "storybook/test";
import { createSignal } from "@ivlev-dev/silent-core";
import { Stack, Text } from "@ivlev-dev/silent-ui";
import {
  Table,
  type TableColumn,
  type TableSortDirection,
} from "../../ui/src/components/table/index.js";
import { silentStory } from "./silent-story.js";

interface Person {
  readonly id: number;
  readonly name: string;
  readonly role: string;
  readonly score: number;
}

const PEOPLE: readonly Person[] = [
  { id: 1, name: "Ада Ловлейс", role: "Инженер", score: 98 },
  { id: 2, name: "Грейс Хоппер", role: "Архитектор", score: 95 },
  { id: 3, name: "Алан Тьюринг", role: "Исследователь", score: 91 },
];

const COLUMNS: readonly TableColumn<Person>[] = [
  { key: "name", header: "Имя", sortable: true },
  { key: "role", header: "Роль" },
  { key: "score", header: "Баллы", align: "end", width: 120, sortable: true },
];

interface TableArgs {
  readonly caption: string;
  readonly label: string;
  readonly dense: boolean;
  readonly stickyHeader: boolean;
  readonly empty: boolean;
  readonly emptyTitle: string;
  readonly emptyText: string;
  readonly columns?: readonly TableColumn<Person>[];
  readonly rows?: readonly Person[];
  readonly rowKey?: (row: Person, index: number) => string | number;
  readonly sortKey?: string;
  readonly sortDirection?: TableSortDirection;
  readonly onSort: (key: string, direction: TableSortDirection) => void;
}

const meta = {
  title: "Components/Table",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: [
          "Таблица данных с управляемой сортировкой: `sortKey`/`sortDirection`",
          "описывают состояние, `onSort` только запрашивает изменение — строки",
          "сортирует потребитель. `rowKey` стабилен для SSR-гидрации,",
          "`caption`/`label` задают доступное имя, пустой набор показывает",
          "`empty` или встроенное пустое состояние.",
        ].join(" "),
      },
      canvas: { sourceState: "shown" },
    },
  },
  argTypes: {
    caption: { control: "text", description: "Подпись таблицы (`<caption>`)" },
    label: {
      control: "text",
      description: "Доступное имя, если caption не задан",
      table: { category: "Доступность" },
    },
    dense: {
      control: "boolean",
      description: "Уменьшенные отступы ячеек",
      table: { defaultValue: { summary: "false" } },
    },
    stickyHeader: {
      control: "boolean",
      description: "Закрепить заголовок при скролле",
      table: { defaultValue: { summary: "false" } },
    },
    empty: { control: "boolean", description: "Показать пустое состояние" },
    emptyTitle: { control: "text", description: "Заголовок пустого состояния" },
    emptyText: { control: "text", description: "Текст пустого состояния" },
    onSort: {
      action: "sort",
      description: "Запрос сортировки: `(key, direction)`",
    },
    columns: {
      control: false,
      description: "Колонки: `key`, `header`, `align`, `width`, `sortable`",
      table: { type: { summary: "readonly TableColumn<Row>[]" } },
    },
    rows: {
      control: false,
      description: "Строки данных",
      table: { type: { summary: "readonly Row[]" } },
    },
    rowKey: {
      control: false,
      description: "Стабильный ключ строки",
      table: { type: { summary: "(row, index) => string | number" } },
    },
    sortKey: {
      control: false,
      description: "Управляемый отсортированный столбец",
      table: { type: { summary: "string | undefined" } },
    },
    sortDirection: {
      control: false,
      description: "Направление сортировки",
      table: { type: { summary: "TableSortDirection | undefined" } },
    },
  },
  args: {
    caption: "Команда",
    label: "",
    dense: false,
    stickyHeader: false,
    empty: false,
    emptyTitle: "Пока никого нет",
    emptyText: "Пригласите участников, чтобы увидеть таблицу.",
    onSort: fn(),
  },
} satisfies Meta<TableArgs>;

export default meta;

type Story = StoryObj<TableArgs>;

function TableDemo(args: TableArgs): Node {
  const [sort, setSort] = createSignal<{ key: string; direction: TableSortDirection } | null>({
    key: "score",
    direction: "descending",
  });
  const rows = (): readonly Person[] => {
    const current = sort();
    if (current === null) return PEOPLE;
    const direction = current.direction === "ascending" ? 1 : -1;
    return [...PEOPLE].sort((left, right) => {
      const leftValue = left[current.key as keyof Person];
      const rightValue = right[current.key as keyof Person];
      if (typeof leftValue === "number" && typeof rightValue === "number") {
        return (leftValue - rightValue) * direction;
      }
      return String(leftValue).localeCompare(String(rightValue), "ru") * direction;
    });
  };
  return (
    // Горизонтальная прокрутка — ответственность потребителя: таблица
    // сохраняет min-content колонок, а не расширяет страницу.
    <div
      style={{ overflowX: "auto", maxWidth: "100%" }}
      tabindex={0}
      aria-label="Таблица с горизонтальной прокруткой"
    >
      <Table
        caption={args.caption === "" ? undefined : args.caption}
        label={args.label === "" ? undefined : args.label}
        columns={COLUMNS}
        rows={args.empty ? [] : rows()}
        rowKey={(row) => row.id}
        dense={args.dense}
        stickyHeader={args.stickyHeader}
        sortKey={sort()?.key}
        sortDirection={sort()?.direction}
        onSort={(key, direction) => {
          setSort({ key, direction });
          args.onSort(key, direction);
        }}
        emptyTitle={args.emptyTitle}
        empty={args.emptyText}
      />
    </div>
  );
}

export const Playground: Story = {
  render: silentStory<TableArgs>((args) => TableDemo(args)),
};

export const Empty: Story = {
  args: { empty: true },
  render: silentStory<TableArgs>((args) => TableDemo(args)),
};

export const Dense: Story = {
  args: { dense: true, caption: "Плотная таблица" },
  render: silentStory<TableArgs>((args) => TableDemo(args)),
};

export const StickyHeader: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Stack gap={3}>
      <Text tone="muted" variant="body-small">
        Контейнер ограничен по высоте — заголовок остаётся при прокрутке.
      </Text>
      <div style={{ blockSize: "220px", overflow: "auto" }}>
        <Table
          caption="Длинный список"
          columns={COLUMNS}
          rows={[...PEOPLE, ...PEOPLE.map((row) => ({ ...row, id: row.id + 10 }))]}
          rowKey={(row) => row.id}
          stickyHeader
        />
      </div>
    </Stack>
  ),
};
