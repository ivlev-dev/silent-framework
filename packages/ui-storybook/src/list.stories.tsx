import type { Meta, StoryObj } from "@storybook/html-vite";
import { fn } from "storybook/test";
import {
  Avatar,
  Badge,
  Grid,
  List,
  ListItem,
  Stack,
  Text,
} from "@ivlev-dev/silent-ui";
import { silentStory } from "./silent-story.js";

const ROWS = ["Входящие", "Отправленные", "Черновики", "Корзина"] as const;

interface ListArgs {
  readonly selected: number;
  readonly interactive: boolean;
  readonly divider: boolean;
  readonly dense: boolean;
  readonly onSelect: (event: MouseEvent | KeyboardEvent) => void;
}

const meta = {
  title: "Components/List",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: [
          "Список: `selectable` включает `role=\"listbox\"` и `aria-selected` у строк,",
          "`divider`/`dense` меняют плотность. Строка активируется Enter/Space,",
          "`selected` даёт `aria-selected`, `current` — `aria-current=\"page\"`.",
        ].join(" "),
      },
      canvas: { sourceState: "shown" },
    },
  },
  argTypes: {
    selected: {
      control: { type: "range", min: 0, max: 3, step: 1 },
      description: "Индекс выбранной строки",
      table: { defaultValue: { summary: "0" } },
    },
    interactive: {
      control: "boolean",
      description: "Строки активируются мышью и клавиатурой",
      table: { defaultValue: { summary: "false" } },
    },
    divider: {
      control: "boolean",
      description: "Разделители между строками",
      table: { defaultValue: { summary: "false" } },
    },
    dense: {
      control: "boolean",
      description: "Плотный режим",
      table: { defaultValue: { summary: "false" } },
    },
    onSelect: { action: "select", description: "Выбор строки" },
  },
  args: { selected: 0, interactive: true, divider: true, dense: false, onSelect: fn() },
} satisfies Meta<ListArgs>;

export default meta;

type Story = StoryObj<ListArgs>;

export const Playground: Story = {
  render: silentStory<ListArgs>((args) => (
    <List
      selectable
      divider={args.divider}
      dense={args.dense}
      attrs={{ "aria-label": "Почтовые разделы" }}
    >
      {ROWS.map((row, index) => (
        <ListItem
          selected={index === args.selected}
          interactive={args.interactive}
          leading={<Badge count={index + 1} variant="neutral" decorative />}
          trailing={<Text variant="label-small" tone="muted">{`${index + 1}`}</Text>}
          onClick={args.onSelect}
        >
          {row}
        </ListItem>
      ))}
    </List>
  )),
};

interface ListItemArgs {
  readonly label: string;
  readonly selected: boolean;
  readonly interactive: boolean;
  readonly current: boolean;
  readonly disabled: boolean;
  readonly divider: boolean;
  readonly lines: 0 | 1 | 2 | 3;
  readonly onClick: (event: MouseEvent | KeyboardEvent) => void;
}

export const ListItemPlayground: StoryObj<ListItemArgs> = {
  name: "ListItem",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        story: [
          "Строка списка: слоты `leading`/`trailing`, выбор (`aria-selected`),",
          "текущая страница (`aria-current`), недоступность и обрезка текста по",
          "строкам. Активируется Enter/Space, только когда `interactive`.",
        ].join(" "),
      },
    },
  },
  argTypes: {
    label: { control: "text", description: "Текст строки (children)" },
    selected: {
      control: "boolean",
      description: "Выбрана (`aria-selected`); в `List` включает `role=\"option\"`",
      table: { defaultValue: { summary: "false" } },
    },
    interactive: {
      control: "boolean",
      description: "Активируется мышью и Enter/Space",
      table: { defaultValue: { summary: "false" } },
    },
    current: {
      control: "boolean",
      description: "Текущая страница (`aria-current=\"page\"`)",
      table: { defaultValue: { summary: "false" } },
    },
    disabled: {
      control: "boolean",
      description: "Недоступна (`aria-disabled`)",
      table: { defaultValue: { summary: "false" } },
    },
    divider: {
      control: "boolean",
      description: "Разделитель сверху",
      table: { defaultValue: { summary: "false" } },
    },
    lines: {
      control: "inline-radio",
      options: [0, 1, 2, 3],
      description: "Обрезка текста по строкам (`0` — без обрезки)",
      table: { defaultValue: { summary: "0" } },
    },
    onClick: { action: "click", description: "Активация строки" },
  },
  args: {
    label:
      "Длинная строка списка, которая обрезается по выбранному числу строк, чтобы не растягивать ряд",
    selected: true,
    interactive: true,
    current: false,
    disabled: false,
    divider: false,
    lines: 1,
    onClick: fn(),
  },
  render: silentStory<ListItemArgs>((args) => (
    <List selectable attrs={{ "aria-label": "Демонстрационная строка" }}>
      <ListItem
        selected={args.selected}
        interactive={args.interactive}
        current={args.current}
        disabled={args.disabled}
        divider={args.divider}
        lines={args.lines === 0 ? undefined : args.lines}
        leading={<Badge count={3} variant="primary" decorative />}
        trailing={<Text variant="label-small" tone="muted">мета</Text>}
        onClick={args.onClick}
      >
        {args.label}
      </ListItem>
    </List>
  )),
};

export const States: Story = {
  name: "States",
  parameters: { controls: { disable: true } },  render: () => (
    <Grid columns={2} gap={6} min="md">
      <Stack gap={2}>
        <Text variant="label-large">Выбор и слоты</Text>
        <List selectable divider attrs={{ "aria-label": "Выбор участника" }}>
          <ListItem selected leading={<Avatar size="sm" initials="АБ" />} trailing={<Badge count={4} />}>
            Анна Борисова
          </ListItem>
          <ListItem selected={false} leading={<Avatar size="sm" initials="ИП" />}>
            Иван Петров
          </ListItem>
          <ListItem selected={false} disabled leading={<Avatar size="sm" initials="СМ" />}>
            Сергей Максимов (недоступен)
          </ListItem>
        </List>
      </Stack>
      <Stack gap={2}>
        <Text variant="label-large">Плотный список</Text>
        <List dense>
          <ListItem divider current>
            Текущая страница (aria-current)
          </ListItem>
          <ListItem divider>Раздел два</ListItem>
          <ListItem divider lines={2}>
            Длинная строка списка, которая обрезается по двум строкам, чтобы не
            растягивать ряд
          </ListItem>
        </List>
      </Stack>
    </Grid>
  ),
};
