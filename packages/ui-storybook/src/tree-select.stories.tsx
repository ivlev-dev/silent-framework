import type { Meta, StoryObj } from "@storybook/html-vite";
import { fn } from "storybook/test";
import { userEvent, within } from "storybook/test";
import { Box, Stack } from "@ivlev-dev/silent-ui";
import { TreeSelect } from "@ivlev-dev/silent-ui/form/tree-select";
import type {
  TreeSelectNode,
  TreeSelectValue,
} from "@ivlev-dev/silent-ui/form/tree-select";
import { silentStory } from "./silent-story.js";

interface TreeSelectArgs {
  readonly label: string;
  readonly hint: string;
  readonly error: string;
  readonly placeholder: string;
  readonly multiple: boolean;
  readonly checkable: boolean;
  readonly searchable: boolean;
  readonly clearable: boolean;
  readonly showSelectAll: boolean;
  readonly disabled: boolean;
  readonly readOnly: boolean;
  readonly size: "sm" | "md" | "lg";
  readonly value: string;
  readonly onValueChange: (value: TreeSelectValue) => void;
}

const CATEGORIES: readonly TreeSelectNode[] = [
  {
    value: "electronics",
    label: "Электроника",
    children: [
      { value: "phones", label: "Смартфоны", description: "iOS и Android" },
      {
        value: "laptops",
        label: "Ноутбуки",
        children: [
          { value: "ultrabooks", label: "Ультрабуки" },
          { value: "gaming", label: "Игровые" },
        ],
      },
      { value: "audio", label: "Аудио", keywords: ["наушники", "колонки"] },
    ],
  },
  {
    value: "home",
    label: "Дом",
    children: [
      { value: "kitchen", label: "Кухня" },
      { value: "furniture", label: "Мебель", disabled: true },
    ],
  },
  {
    value: "services",
    label: "Услуги",
    hasChildren: true,
  },
];

const meta = {
  title: "Components/TreeSelect",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: [
          "Иерархический выбор на `role=\"tree\"`: каскадные чекбоксы,",
          "indeterminate, чипы, поиск с подсветкой, ленивые дети через `load`.",
          "Клавиатура: стрелки, влево/вправо, Home/End, Enter/Space и typeahead;",
          "фокус остаётся на `combobox`, активная строка — `aria-activedescendant`.",
          "Большие деревья рендерятся окном через `@ivlev-dev/silent-virtual`.",
        ].join(" "),
      },
      canvas: { sourceState: "shown" },
    },
  },
  argTypes: {
    label: { control: "text", description: "Подпись поля" },
    hint: { control: "text", description: "Подсказка" },
    error: { control: "text", description: "Ошибка" },
    placeholder: { control: "text", description: "Плейсхолдер" },
    multiple: { control: "boolean", description: "Множественный выбор" },
    checkable: { control: "boolean", description: "Каскадные чекбоксы" },
    searchable: { control: "boolean", description: "Поиск в панели" },
    clearable: { control: "boolean", description: "Кнопка очистки" },
    showSelectAll: { control: "boolean", description: "Кнопка «Выбрать все»" },
    disabled: { control: "boolean", description: "Недоступно" },
    readOnly: { control: "boolean", description: "Только чтение" },
    size: {
      control: "inline-radio",
      options: ["sm", "md", "lg"],
      description: "Размер контрола",
    },
    value: { control: "text", description: "Значение для одиночного режима" },
    onValueChange: { action: "valueChange", description: "Значение изменилось" },
  },
  args: {
    label: "Категория",
    hint: "Выберите раздел каталога",
    error: "",
    placeholder: "Начните вводить категорию",
    multiple: true,
    checkable: true,
    searchable: true,
    clearable: true,
    showSelectAll: true,
    disabled: false,
    readOnly: false,
    size: "md",
    value: "phones",
    onValueChange: fn(),
  },
} satisfies Meta<TreeSelectArgs>;

export default meta;

type Story = StoryObj<TreeSelectArgs>;

export const Playground: Story = {
  name: "TreeSelect / playground",
  render: silentStory<TreeSelectArgs>((args) => (
    <Box padding={4} style={{ "max-inline-size": "420px" }}>
      <TreeSelect
        nodes={CATEGORIES}
        label={args.label}
        hint={args.hint === "" ? undefined : args.hint}
        error={args.error === "" ? undefined : args.error}
        placeholder={args.placeholder}
        multiple={args.multiple}
        checkable={args.checkable}
        searchable={args.searchable}
        clearable={args.clearable}
        showSelectAll={args.showSelectAll}
        disabled={args.disabled}
        readOnly={args.readOnly}
        size={args.size}
        defaultValue={args.multiple ? ["phones"] : args.value}
        defaultExpanded={["electronics"]}
        onValueChange={args.onValueChange}
      />
    </Box>
  )),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("combobox"));
    await canvas.findByRole("tree");
  },
};

export const Single: Story = {
  name: "TreeSelect / одиночный",
  parameters: { controls: { disable: true } },
  render: silentStory(() => (
    <Box padding={4} style={{ "max-inline-size": "420px" }}>
      <TreeSelect
        nodes={CATEGORIES}
        label="Раздел"
        defaultValue="ultrabooks"
        defaultExpanded={["electronics", "laptops"]}
        placeholder="Выберите раздел"
      />
    </Box>
  )),
};

export const AsyncLoading: Story = {
  name: "TreeSelect / ленивые дети и поиск",
  parameters: { controls: { disable: true } },
  render: silentStory(() => {
    const delayed = (
      nodes: readonly TreeSelectNode[],
    ): Promise<readonly TreeSelectNode[]> =>
      new Promise((resolve) => {
        setTimeout(() => resolve(nodes), 450);
      });
    return (
      <Box padding={4} style={{ "max-inline-size": "420px" }}>
        <TreeSelect
          nodes={CATEGORIES.slice(0, 2)}
          label="Каталог с API"
          hint="«Услуги» подгружаются при раскрытии, поиск идёт через load"
          searchable
          multiple
          searchDelay={300}
          load={(query, parent) => {
            if (parent !== undefined) {
              return delayed([
                { value: "repair", label: "Ремонт" },
                { value: "delivery", label: "Доставка" },
              ]);
            }
            const source: readonly TreeSelectNode[] = [
              { value: "api-docs", label: "Документация" },
              { value: "api-support", label: "Поддержка" },
              { value: "api-training", label: "Обучение" },
            ];
            const needle = query.trim().toLowerCase();
            return delayed(
              needle === ""
                ? source
                : source.filter((node) =>
                    String(node.label).toLowerCase().includes(needle),
                  ),
            );
          }}
        />
      </Box>
    );
  }),
};

export const States: Story = {
  name: "TreeSelect / размеры и состояния",
  parameters: { controls: { disable: true } },
  render: silentStory(() => (
    <Box padding={4} style={{ "max-inline-size": "420px" }}>
      <Stack gap={4}>
        <TreeSelect nodes={CATEGORIES} label="sm" size="sm" defaultValue="phones" />
        <TreeSelect nodes={CATEGORIES} label="md" defaultValue="phones" />
        <TreeSelect nodes={CATEGORIES} label="lg" size="lg" defaultValue="phones" />
        <TreeSelect nodes={CATEGORIES} label="Ошибка" error="Выберите раздел" />
        <TreeSelect nodes={CATEGORIES} label="disabled" disabled placeholder="Недоступно" />
        <TreeSelect nodes={CATEGORIES} label="readOnly" readOnly defaultValue="phones" />
        <TreeSelect
          nodes={CATEGORIES}
          label="Несколько"
          multiple
          defaultValue={["phones", "audio"]}
          defaultExpanded={["electronics"]}
        />
      </Stack>
    </Box>
  )),
};
