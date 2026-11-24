import type { Meta, StoryObj } from "@storybook/html-vite";
import { fn } from "storybook/test";
import { createSignal } from "@ivlev-dev/silent-core";
import {
  Accordion,
  AddIcon,
  Avatar,
  Box,
  Button,
  CheckIcon,
  Chip,
  Heading,
  Inline,
  InfoIcon,
  SearchIcon,
  SearchField,
  SegmentedButton,
  Stack,
  StarIcon,
  Surface,
  Table,
  Tag,
  Text,
  EmptyState,
  Fab,
  type AccordionItemData,
  type AccordionValue,
  type ChipVariant,
  type FabPosition,
  type FabSize,
  type FabVariant,
  type HeadingLevel,
  type SegmentedButtonSize,
  type TableColumn,
  type TableSortDirection,
  type TagSize,
  type TagVariant,
} from "@ivlev-dev/silent-ui";
import { silentStory } from "./silent-story.js";

/*
 * Extras — компоненты «второго плана»: FAB, Chip, Tag, SegmentedButton,
 * EmptyState, Accordion, SearchField и витрина возможностей Table
 * (`truncate`/`lines`/`sticky`). Каждая история объявляет собственные
 * `argTypes` с настоящими именами props, поэтому controls описывают именно
 * тот компонент, который отрисован. Полная autodocs-страница Table живёт в
 * `table.stories.tsx`; здесь — сценарии, которых там нет.
 */

interface ExtrasArgs {
  readonly label: string;
  readonly variant: FabVariant;
  readonly size: FabSize | SegmentedButtonSize | TagSize;
  readonly disabled: boolean;
  readonly onClick: (event: MouseEvent) => void;
  readonly onRemove: (event: MouseEvent) => void;
}

const meta = {
  title: "Components/Extras",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: [
          "Дополнительные компоненты дизайн-системы: FAB (4 варианта, 3 размера,",
          "extended), Chip (assist/filter/input/suggestion), Tag (7 тонов),",
          "SegmentedButton (roving tabindex), EmptyState (compact/illustration),",
          "Accordion (single/multiple, truncate) и SearchField с очисткой.",
          "Table показан со сценариями `truncate`/`lines`, закреплённым",
          "заголовком, пустым состоянием и горизонтальной прокруткой на узком",
          "экране. Все интерактивные истории управляются `args`: значение по",
          "умолчанию приходит из controls, а дальнейшие изменения — события",
          "компонента.",
        ].join(" "),
      },
      canvas: { sourceState: "shown" },
    },
  },
  argTypes: {
    label: { control: "text", description: "Подпись/текст компонента" },
    variant: {
      control: "select",
      options: ["primary", "secondary", "tertiary", "surface"],
      description: "Вариант FAB",
      table: { category: "Fab" },
    },
    size: {
      control: "inline-radio",
      options: ["sm", "md", "lg"],
      description: "Размер (FAB, SegmentedButton, Tag: sm/md)",
    },
    disabled: { control: "boolean", description: "Недоступно" },
    onClick: { action: "click", description: "Нажатие" },
    onRemove: { action: "remove", description: "Удаление (Chip/Tag)" },
    extended: {
      control: "boolean",
      description: "Fab: иконка + видимая подпись",
      table: { category: "Fab" },
    },
    ariaLabel: {
      control: "text",
      description: "Fab: доступное имя icon-only кнопки",
      table: { category: "Fab" },
    },
    position: {
      control: "select",
      options: ["none", "top-start", "top-end", "bottom-start", "bottom-end"],
      description: "Fab: позиция внутри `position: relative` контейнера",
      table: { category: "Fab" },
    },
    icon: {
      control: false,
      description: "Fab / EmptyState: глиф слева",
      table: { category: "Fab", type: { summary: "Children" } },
    },
    selected: {
      control: "boolean",
      description: "Chip: отмеченное состояние (`filter` → aria-pressed)",
      table: { category: "Chip" },
    },
    removable: {
      control: "boolean",
      description: "Chip / Tag: кнопка удаления",
      table: { category: "Chip" },
    },
    leading: {
      control: "boolean",
      description: "Chip / Tag: иконка слева",
      table: { category: "Chip" },
    },
    avatar: {
      control: "boolean",
      description: "Chip: аватар слева (приоритетнее иконки)",
      table: { category: "Chip" },
    },
    fullWidth: {
      control: "boolean",
      description: "SegmentedButton: растянуть на всю ширину",
      table: { category: "SegmentedButton" },
    },
    withIcons: {
      control: "boolean",
      description: "SegmentedButton: иконки в сегментах",
      table: { category: "SegmentedButton" },
    },
    title: {
      control: "text",
      description: "EmptyState: заголовок",
      table: { category: "EmptyState" },
    },
    description: {
      control: "text",
      description: "EmptyState: описание",
      table: { category: "EmptyState" },
    },
    compact: {
      control: "boolean",
      description: "EmptyState: компактный вариант",
      table: { category: "EmptyState" },
    },
    withActions: {
      control: "boolean",
      description: "EmptyState: слот действий",
      table: { category: "EmptyState" },
    },
    withIllustration: {
      control: "boolean",
      description: "EmptyState: иллюстрация вместо иконки",
      table: { category: "EmptyState" },
    },
    titleLevel: {
      control: "select",
      options: [1, 2, 3, 4, 5, 6],
      description: "EmptyState / Accordion: уровень заголовка",
      table: { category: "EmptyState" },
    },
    items: {
      control: false,
      description: "Accordion: `{ key, title, content, truncate, disabled }[]`",
      table: { category: "Accordion", type: { summary: "AccordionItemData[]" } },
    },
    selectionMode: {
      control: "inline-radio",
      options: ["single", "multiple"],
      description: "Accordion: сколько пунктов открыто одновременно",
      table: { category: "Accordion" },
    },
    defaultValue: {
      control: "select",
      options: ["", "install", "tokens", "a11y"],
      description: "Accordion: пункт, открытый при монтировании",
      table: { category: "Accordion" },
    },
    truncate: {
      control: "boolean",
      description: "Accordion / Table: обрезка одной строкой с многоточием",
      table: { category: "Accordion" },
    },
    disabledItem: {
      control: "boolean",
      description: "Accordion: показывать недоступный пункт",
      table: { category: "Accordion" },
    },
    placeholder: {
      control: "text",
      description: "SearchField: плейсхолдер",
      table: { category: "SearchField" },
    },
    clearLabel: {
      control: "text",
      description: "SearchField: подпись кнопки очистки",
      table: { category: "SearchField" },
    },
    labelledBy: {
      control: "text",
      description: "SegmentedButton: id видимой подписи вместо `label`",
      table: { category: "SegmentedButton" },
    },
    removeLabel: {
      control: "text",
      description: "Chip / Tag: подпись кнопки удаления",
      table: { category: "Chip" },
    },
    class: {
      control: false,
      description: "Дополнительные классы (`ClassNameValue`)",
      table: { category: "Структурные" },
    },
    style: {
      control: false,
      description: "Инлайн-стили (`StyleInput`)",
      table: { category: "Структурные" },
    },
    attrs: {
      control: false,
      description: "Произвольные HTML-атрибуты корня",
      table: { category: "Структурные" },
    },
    ref: {
      control: false,
      description: "Колбэк DOM-узла",
      table: { category: "Структурные", type: { summary: "(node: Element | null) => void" } },
    },
    onValueChange: {
      action: "valueChange",
      description: "Выбран другой сегмент / пункт аккордеона / значение поиска",
      table: { category: "События" },
    },
    onSearch: { action: "search", description: "SearchField: Enter", table: { category: "События" } },
    onClear: { action: "clear", description: "SearchField: очистка", table: { category: "События" } },
    columns: {
      control: false,
      description: "Table: `key/header/align/width/sortable/truncate/lines/renderCell`",
      table: { category: "Table", type: { summary: "readonly TableColumn<Row>[]" } },
    },
    rows: { control: false, description: "Table: строки данных", table: { category: "Table" } },
    rowKey: {
      control: false,
      description: "Table: стабильный ключ строки",
      table: { category: "Table" },
    },
    sortKey: {
      control: "select",
      options: ["", "title", "owner", "status"],
      description: "Table: управляемый отсортированный столбец",
      table: { category: "Table" },
    },
    sortDirection: {
      control: "inline-radio",
      options: ["ascending", "descending"],
      description: "Table: направление сортировки",
      table: { category: "Table" },
    },
    onSort: { action: "sort", description: "Table: запрос сортировки", table: { category: "Table" } },
    dense: { control: "boolean", description: "Table: плотные отступы", table: { category: "Table" } },
    stickyHeader: {
      control: "boolean",
      description: "Table: закрепить заголовок",
      table: { category: "Table" },
    },
    empty: { control: "boolean", description: "Table: пустое состояние", table: { category: "Table" } },
    emptyTitle: { control: "text", description: "Table: заголовок пустого состояния", table: { category: "Table" } },
    caption: { control: "text", description: "Table: подпись `<caption>`", table: { category: "Table" } },
    lines: {
      control: "inline-radio",
      options: [0, 1, 2, 3],
      description: "Table: обрезка по строкам (0 — без обрезки)",
      table: { category: "Table" },
    },
  },
  args: {
    label: "Создать",
    variant: "primary",
    size: "md",
    disabled: false,
    onClick: fn(),
    onRemove: fn(),
    extended: false,
    ariaLabel: "Создать",
    position: "none",
    selected: false,
    removable: false,
    leading: false,
    avatar: false,
    fullWidth: false,
    withIcons: false,
    title: "Пока ничего нет",
    description: "Создайте первый элемент — он появится в этом списке.",
    compact: false,
    withActions: true,
    withIllustration: false,
    titleLevel: 3,
    selectionMode: "single",
    defaultValue: "install",
    truncate: false,
    disabledItem: true,
    placeholder: "Название компонента",
    clearLabel: "Очистить",
    sortKey: "",
    sortDirection: "ascending",
    dense: false,
    stickyHeader: false,
    empty: false,
    lines: 2,
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<ExtrasArgs>;

function controls(names: readonly string[]): { controls: { include: string[] } } {
  return { controls: { include: [...names] } };
}

/* ------------------------------------------------------------------ */
/* Fab                                                                */
/* ------------------------------------------------------------------ */

interface FabStoryArgs {
  readonly variant: FabVariant;
  readonly size: FabSize;
  readonly extended: boolean;
  readonly label: string;
  readonly ariaLabel: string;
  readonly disabled: boolean;
  readonly position: FabPosition | "none";
  readonly onClick: (event: MouseEvent) => void;
}

export const FabPlayground: StoryObj<FabStoryArgs> = {
  name: "Fab / playground",
  parameters: controls(["variant", "size", "extended", "label", "ariaLabel", "disabled", "position", "onClick"]),
  argTypes: {
    variant: {
      control: "select",
      options: ["primary", "secondary", "tertiary", "surface"],
      description: "Цветовой вариант",
      table: { defaultValue: { summary: "primary" } },
    },
    size: { control: "inline-radio", options: ["sm", "md", "lg"], description: "Размер" },
    extended: { control: "boolean", description: "Иконка + видимая подпись" },
    label: { control: "text", description: "Подпись в extended-режиме" },
    ariaLabel: { control: "text", description: "Доступное имя icon-only кнопки" },
    disabled: { control: "boolean", description: "Недоступна" },
    position: {
      control: "select",
      options: ["none", "top-start", "top-end", "bottom-start", "bottom-end"],
      description: "Позиция внутри `position: relative` контейнера",
    },
    onClick: { action: "click", description: "Нажатие" },
  },
  args: {
    variant: "primary",
    size: "md",
    extended: false,
    label: "Создать",
    ariaLabel: "Создать",
    disabled: false,
    position: "none",
    onClick: fn(),
  },
  render: silentStory<FabStoryArgs>((args) => (
    <Box
      padding={4}
      style={{
        position: "relative",
        "block-size": "180px",
        "max-inline-size": "560px",
        border: "1px dashed var(--sui-color-outline-variant)",
        "border-radius": "var(--sui-radius-md)",
      }}
    >
      {args.extended ? (
        <Fab
          extended
          label={args.label}
          variant={args.variant}
          size={args.size}
          disabled={args.disabled}
          position={args.position === "none" ? undefined : args.position}
          icon={<AddIcon />}
          onClick={args.onClick}
        />
      ) : (
        <Fab
          ariaLabel={args.ariaLabel}
          variant={args.variant}
          size={args.size}
          disabled={args.disabled}
          position={args.position === "none" ? undefined : args.position}
          icon={<AddIcon />}
          onClick={args.onClick}
        />
      )}
    </Box>
  )),
};

export const FabVariants: Story = {
  name: "Fab / варианты",
  parameters: { controls: { disable: true } },
  render: () => (
    <Box padding={4}>
      <Stack gap={4}>
        <Inline gap={3} wrap align="center">
          <Fab ariaLabel="Primary" icon={<AddIcon />} />
          <Fab ariaLabel="Secondary" variant="secondary" icon={<AddIcon />} />
          <Fab ariaLabel="Tertiary" variant="tertiary" icon={<AddIcon />} />
          <Fab ariaLabel="Surface" variant="surface" icon={<AddIcon />} />
        </Inline>
        <Inline gap={3} wrap align="center">
          <Fab extended label="Создать" icon={<AddIcon />} />
          <Fab extended label="Загрузить" variant="secondary" icon={<AddIcon />} />
          <Fab extended label="Поделиться" variant="tertiary" icon={<AddIcon />} />
        </Inline>
      </Stack>
    </Box>
  ),
};

export const FabSizes: Story = {
  name: "Fab / размеры и позиции",
  parameters: { controls: { disable: true } },
  render: () => (
    <Stack gap={4}>
      <Inline gap={3} align="center" wrap>
        <Fab ariaLabel="Small" size="sm" icon={<AddIcon />} />
        <Fab ariaLabel="Medium" size="md" icon={<AddIcon />} />
        <Fab ariaLabel="Large" size="lg" icon={<AddIcon />} />
        <Fab ariaLabel="Disabled" disabled icon={<AddIcon />} />
        <Fab extended label="Extended lg" size="lg" icon={<AddIcon />} />
      </Inline>
      <Box
        padding={4}
        style={{
          position: "relative",
          "block-size": "200px",
          "max-inline-size": "560px",
          border: "1px dashed var(--sui-color-outline-variant)",
          "border-radius": "var(--sui-radius-md)",
        }}
      >
        <Fab ariaLabel="Top start" position="top-start" size="sm" icon={<AddIcon />} />
        <Fab ariaLabel="Top end" position="top-end" size="sm" variant="secondary" icon={<AddIcon />} />
        <Fab ariaLabel="Bottom start" position="bottom-start" size="sm" variant="tertiary" icon={<AddIcon />} />
        <Fab ariaLabel="Bottom end" position="bottom-end" icon={<AddIcon />} />
      </Box>
    </Stack>
  ),
};

/* ------------------------------------------------------------------ */
/* Chip                                                               */
/* ------------------------------------------------------------------ */

interface ChipStoryArgs {
  readonly variant: ChipVariant;
  readonly label: string;
  readonly selected: boolean;
  readonly removable: boolean;
  readonly disabled: boolean;
  readonly leading: boolean;
  readonly avatar: boolean;
  readonly onClick: (event: MouseEvent) => void;
  readonly onRemove: (event: MouseEvent) => void;
}

export const ChipPlayground: StoryObj<ChipStoryArgs> = {
  name: "Chip / playground",
  parameters: controls(["variant", "label", "selected", "removable", "disabled", "leading", "avatar", "onClick", "onRemove"]),
  argTypes: {
    variant: {
      control: "select",
      options: ["assist", "filter", "input", "suggestion"],
      description: "Тип чипа",
    },
    label: { control: "text", description: "Текст (children)" },
    selected: { control: "boolean", description: "Отмечен (`filter` → aria-pressed)" },
    removable: { control: "boolean", description: "Кнопка удаления" },
    disabled: { control: "boolean", description: "Недоступен" },
    leading: { control: "boolean", description: "Иконка слева" },
    avatar: { control: "boolean", description: "Аватар слева (приоритетнее иконки)" },
    onClick: { action: "click", description: "Нажатие на основную кнопку" },
    onRemove: { action: "remove", description: "Нажатие на удаление" },
  },
  args: {
    variant: "filter",
    label: "Документы",
    selected: true,
    removable: false,
    disabled: false,
    leading: false,
    avatar: false,
    onClick: fn(),
    onRemove: fn(),
  },
  render: silentStory<ChipStoryArgs>((args) => (
    <Box padding={4}>
      <Chip
        variant={args.variant}
        selected={args.variant === "filter" ? args.selected : undefined}
        removable={args.removable}
        disabled={args.disabled}
        leading={args.leading ? <CheckIcon /> : undefined}
        avatar={
          args.avatar ? <Avatar initials="АЛ" alt="Ада Ловлейс" size="sm" /> : undefined
        }
        onClick={args.onClick}
        onRemove={args.onRemove}
      >
        {args.label}
      </Chip>
    </Box>
  )),
};

export const ChipVariants: Story = {
  name: "Chip / варианты и состояния",
  parameters: { controls: { disable: true } },
  render: () => (
    <Box padding={4}>
      <Stack gap={4}>
        <Inline gap={2} wrap>
          <Chip variant="assist" leading={<InfoIcon />} onClick={() => undefined}>
            Справка
          </Chip>
          <Chip variant="filter" onClick={() => undefined}>
            Все
          </Chip>
          <Chip variant="filter" selected onClick={() => undefined}>
            Документы
          </Chip>
          <Chip variant="input" removable onRemove={() => undefined}>
            Тег
          </Chip>
          <Chip variant="suggestion" onClick={() => undefined}>
            Подсказка
          </Chip>
        </Inline>
        <Inline gap={2} wrap align="center">
          <Chip variant="assist" avatar={<Avatar initials="АЛ" alt="Ада Ловлейс" size="sm" />} onClick={() => undefined}>
            Ада Ловлейс
          </Chip>
          <Chip variant="filter" selected removable onRemove={() => undefined}>
            Выбран и удаляем
          </Chip>
          <Chip variant="input" removable disabled onRemove={() => undefined}>
            Недоступен
          </Chip>
        </Inline>
        <Text variant="body-small" tone="muted">
          У `filter` есть `aria-pressed`, у `input` — отдельная кнопка удаления с подписью
          «Удалить»; кнопка удаления не вкладывается в основную кнопку.
        </Text>
      </Stack>
    </Box>
  ),
};

/* ------------------------------------------------------------------ */
/* SegmentedButton                                                    */
/* ------------------------------------------------------------------ */

const SEGMENTED_OPTIONS = [
  { key: "day", label: "День" },
  { key: "week", label: "Неделя" },
  { key: "month", label: "Месяц" },
  { key: "year", label: "Год", disabled: true },
] as const;

interface SegmentedStoryArgs {
  readonly value: string;
  readonly size: SegmentedButtonSize;
  readonly fullWidth: boolean;
  readonly disabled: boolean;
  readonly withIcons: boolean;
  readonly onValueChange: (value: string) => void;
}

export const SegmentedPlayground: StoryObj<SegmentedStoryArgs> = {
  name: "SegmentedButton / playground",
  parameters: controls(["value", "size", "fullWidth", "disabled", "withIcons", "onValueChange"]),
  argTypes: {
    value: {
      control: "select",
      options: ["day", "week", "month", "year"],
      description: "Ключ выбранного сегмента",
    },
    size: { control: "inline-radio", options: ["sm", "md", "lg"], description: "Высота сегментов" },
    fullWidth: { control: "boolean", description: "Растянуть на всю ширину" },
    disabled: { control: "boolean", description: "Блокирует всю группу" },
    withIcons: { control: "boolean", description: "Иконки в сегментах" },
    onValueChange: { action: "valueChange", description: "Выбран другой сегмент" },
  },
  args: {
    value: "day",
    size: "md",
    fullWidth: false,
    disabled: false,
    withIcons: false,
    onValueChange: fn(),
  },
  render: silentStory<SegmentedStoryArgs>((args) => {
    const [value, setValue] = createSignal(args.value);
    return (
      <Box padding={4} style={{ "max-inline-size": "560px" }}>
        <SegmentedButton
          label="Период"
          value={value()}
          options={
            args.withIcons
              ? SEGMENTED_OPTIONS.map((option) => ({
                  ...option,
                  icon:
                    option.key === "day" ? (
                      <SearchIcon />
                    ) : option.key === "week" ? (
                      <StarIcon />
                    ) : (
                      <CheckIcon />
                    ),
                }))
              : SEGMENTED_OPTIONS
          }
          size={args.size}
          fullWidth={args.fullWidth}
          disabled={args.disabled}
          onValueChange={(next) => {
            setValue(next);
            args.onValueChange(next);
          }}
        />
      </Box>
    );
  }),
};

export const SegmentedStates: Story = {
  name: "SegmentedButton / размеры и состояния",
  parameters: { controls: { disable: true } },
  render: () => (
    <Box padding={4} style={{ "max-inline-size": "560px" }}>
      <Stack gap={4}>
        {(["sm", "md", "lg"] as const).map((size) => (
          <Inline key={size} gap={2} align="center" wrap>
            <Text variant="label-large">{size}</Text>
            <SegmentedDemo value="day" size={size} disabled={false} />
          </Inline>
        ))}
        <Inline gap={2} align="center" wrap>
          <Text variant="label-large">fullWidth</Text>
        </Inline>
        <SegmentedDemo value="week" size="md" fullWidth disabled={false} />
        <Inline gap={2} align="center" wrap>
          <Text variant="label-large">disabled</Text>
          <SegmentedDemo value="day" size="md" disabled />
        </Inline>
        <Inline gap={2} align="center" wrap>
          <Text variant="label-large">без подписи</Text>
          <SegmentedButton
            label="Масштаб"
            value="day"
            options={[
              { key: "day", icon: <SearchIcon />, ariaLabel: "День" },
              { key: "week", icon: <StarIcon />, ariaLabel: "Неделя" },
              { key: "month", icon: <CheckIcon />, ariaLabel: "Месяц" },
            ]}
            onValueChange={() => undefined}
          />
        </Inline>
      </Stack>
    </Box>
  ),
};

function SegmentedDemo(props: {
  readonly value: string;
  readonly size: SegmentedButtonSize;
  readonly fullWidth?: boolean;
  readonly disabled: boolean;
}): Node {
  return (
    <SegmentedButton
      label="Период"
      value={props.value}
      options={SEGMENTED_OPTIONS}
      size={props.size}
      fullWidth={props.fullWidth === true}
      disabled={props.disabled}
      onValueChange={() => undefined}
    />
  );
}

/* ------------------------------------------------------------------ */
/* EmptyState                                                         */
/* ------------------------------------------------------------------ */

interface EmptyStoryArgs {
  readonly title: string;
  readonly description: string;
  readonly compact: boolean;
  readonly withActions: boolean;
  readonly withIllustration: boolean;
  readonly titleLevel: HeadingLevel;
  readonly onClick: (event: MouseEvent) => void;
}

export const EmptyStatePlayground: StoryObj<EmptyStoryArgs> = {
  name: "EmptyState / playground",
  parameters: controls(["title", "description", "compact", "withActions", "withIllustration", "titleLevel", "onClick"]),
  argTypes: {
    title: { control: "text", description: "Заголовок" },
    description: { control: "text", description: "Описание" },
    compact: { control: "boolean", description: "Компактный вариант" },
    withActions: { control: "boolean", description: "Слот действий" },
    withIllustration: { control: "boolean", description: "Иллюстрация вместо иконки" },
    titleLevel: { control: "select", options: [1, 2, 3, 4, 5, 6], description: "Уровень заголовка" },
    onClick: { action: "click", description: "Нажатие на основное действие" },
  },
  args: {
    title: "Пока ничего нет",
    description: "Создайте первый элемент — он появится в этом списке.",
    compact: false,
    withActions: true,
    withIllustration: false,
    titleLevel: 3,
    onClick: fn(),
  },
  render: silentStory<EmptyStoryArgs>((args) => (
    <Box padding={4}>
      <EmptyState
        compact={args.compact}
        titleLevel={args.titleLevel}
        icon={args.withIllustration ? undefined : <InfoIcon />}
        illustration={
          args.withIllustration ? (
            <svg width="120" height="80" viewBox="0 0 120 80" role="img" aria-label="Пустая папка">
              <rect x="4" y="18" width="112" height="58" rx="8" fill="var(--sui-color-surface-container-high)" />
              <path d="M4 26a8 8 0 0 1 8-8h28l10 10h54" fill="var(--sui-color-primary-container)" />
            </svg>
          ) : undefined
        }
        title={args.title}
        description={args.description}
        actions={
          args.withActions ? (
            <Inline gap={2} wrap justify="center">
              <Button leading={<AddIcon />} onClick={args.onClick}>
                Создать
              </Button>
              <Button variant="text">Документация</Button>
            </Inline>
          ) : undefined
        }
      />
    </Box>
  )),
};

export const EmptyStateVariants: Story = {
  name: "EmptyState / варианты",
  parameters: { controls: { disable: true } },
  render: () => (
    <Stack gap={4}>
      <Box padding={4}>
        <EmptyState
          icon={<InfoIcon />}
          title="Ничего не найдено"
          description="Измените запрос или сбросьте фильтры."
          actions={<Button variant="tonal">Сбросить фильтры</Button>}
        />
      </Box>
      <Box padding={4} style={{ "max-inline-size": "560px" }}>
        <EmptyState
          compact
          icon={<InfoIcon />}
          title="Компактное состояние"
          description="Для встраивания в таблицу или панель."
        />
      </Box>
      <Box padding={4}>
        <EmptyState title="Без описания и действий" />
      </Box>
    </Stack>
  ),
};

/* ------------------------------------------------------------------ */
/* Tag                                                                */
/* ------------------------------------------------------------------ */

interface TagStoryArgs {
  readonly variant: TagVariant;
  readonly size: TagSize;
  readonly label: string;
  readonly removable: boolean;
  readonly leading: boolean;
  readonly onRemove: (event: MouseEvent) => void;
}

export const TagPlayground: StoryObj<TagStoryArgs> = {
  name: "Tag / playground",
  parameters: controls(["variant", "size", "label", "removable", "leading", "onRemove"]),
  argTypes: {
    variant: {
      control: "select",
      options: ["neutral", "primary", "secondary", "success", "warning", "error", "info"],
      description: "Тон тега",
    },
    size: { control: "inline-radio", options: ["sm", "md"], description: "Размер" },
    label: { control: "text", description: "Текст (children)" },
    removable: { control: "boolean", description: "Кнопка удаления" },
    leading: { control: "boolean", description: "Иконка слева" },
    onRemove: { action: "remove", description: "Нажатие на удаление" },
  },
  args: {
    variant: "primary",
    size: "md",
    label: "Дизайн-система",
    removable: true,
    leading: false,
    onRemove: fn(),
  },
  render: silentStory<TagStoryArgs>((args) => (
    <Box padding={4}>
      <Tag
        variant={args.variant}
        size={args.size}
        removable={args.removable}
        leading={args.leading ? <StarIcon /> : undefined}
        onRemove={args.onRemove}
      >
        {args.label}
      </Tag>
    </Box>
  )),
};

export const TagVariants: Story = {
  name: "Tag / варианты и размеры",
  parameters: { controls: { disable: true } },
  render: () => (
    <Box padding={4}>
      <Stack gap={3}>
        <Inline gap={2} wrap>
          <Tag>neutral</Tag>
          <Tag variant="primary">primary</Tag>
          <Tag variant="secondary">secondary</Tag>
          <Tag variant="success">success</Tag>
          <Tag variant="warning">warning</Tag>
          <Tag variant="error">error</Tag>
          <Tag variant="info">info</Tag>
        </Inline>
        <Inline gap={2} wrap align="center">
          <Tag size="sm">sm</Tag>
          <Tag size="sm" leading={<StarIcon />}>
            sm + icon
          </Tag>
          <Tag size="md" leading={<StarIcon />}>
            md + icon
          </Tag>
          <Tag removable onRemove={() => undefined}>
            removable
          </Tag>
          <Tag variant="success" removable onRemove={() => undefined} leading={<CheckIcon />}>
            готово
          </Tag>
        </Inline>
      </Stack>
    </Box>
  ),
};

/* ------------------------------------------------------------------ */
/* Accordion                                                          */
/* ------------------------------------------------------------------ */

const ACCORDION_ITEMS: readonly AccordionItemData[] = [
  {
    key: "install",
    title: "Установка",
    content: () => <p>Добавьте пакет и подключите styles.css.</p>,
  },
  {
    key: "tokens",
    title: "Токены",
    content: () => <p>Цвета, типографика и отступы живут в CSS-переменных.</p>,
  },
  {
    key: "a11y",
    title: "Доступность",
    content: () => <p>aria-expanded, aria-controls и клавиатурная навигация.</p>,
  },
  {
    key: "disabled",
    title: "Недоступный пункт",
    content: () => <p>Этот пункт нельзя открыть.</p>,
    disabled: true,
  },
];

const LONG_ACCORDION_ITEMS: readonly AccordionItemData[] = [
  {
    key: "long",
    title:
      "Очень длинный заголовок пункта аккордеона, который при truncate обрезается одной строкой с многоточием",
    content: () => (
      <p>
        Контент ограничен мерой строки и переносится по словам. Граница контейнера не
        расширяется из-за длинного заголовка.
      </p>
    ),
    truncate: true,
  },
  {
    key: "long-open",
    title: "Обычный перенос без truncate — заголовок занимает несколько строк",
    content: () => <p>Сравните поведение с первым пунктом.</p>,
  },
];

interface AccordionStoryArgs {
  readonly selectionMode: "single" | "multiple";
  readonly defaultValue: string;
  readonly headingLevel: HeadingLevel;
  readonly truncate: boolean;
  readonly disabledItem: boolean;
  readonly onValueChange: (value: AccordionValue) => void;
}

export const AccordionPlayground: StoryObj<AccordionStoryArgs> = {
  name: "Accordion / playground",
  parameters: controls(["selectionMode", "defaultValue", "headingLevel", "truncate", "disabledItem", "onValueChange"]),
  argTypes: {
    selectionMode: {
      control: "inline-radio",
      options: ["single", "multiple"],
      description: "Сколько пунктов открыто одновременно",
    },
    defaultValue: {
      control: "select",
      options: ["", "install", "tokens", "a11y"],
      description: "Пункт, открытый при монтировании",
    },
    headingLevel: {
      control: "select",
      options: [1, 2, 3, 4, 5, 6],
      description: "Уровень заголовка у триггера",
    },
    truncate: {
      control: "boolean",
      description: "Обрезать заголовки одной строкой (у длинных пунктов)",
    },
    disabledItem: { control: "boolean", description: "Показывать недоступный пункт" },
    onValueChange: { action: "valueChange", description: "Открыт/закрыт пункт" },
  },
  args: {
    selectionMode: "single",
    defaultValue: "install",
    headingLevel: 3,
    truncate: false,
    disabledItem: true,
    onValueChange: fn(),
  },
  render: silentStory<AccordionStoryArgs>((args) => {
    const [value, setValue] = createSignal<AccordionValue>(
      args.selectionMode === "multiple"
        ? args.defaultValue === ""
          ? []
          : [args.defaultValue]
        : args.defaultValue,
    );
    const items = args.disabledItem
      ? ACCORDION_ITEMS
      : ACCORDION_ITEMS.filter((item) => item.disabled !== true);
    return (
      <Box padding={4} style={{ "max-inline-size": "720px" }}>
        <Accordion
          items={args.truncate ? [...LONG_ACCORDION_ITEMS] : items}
          selectionMode={args.selectionMode}
          value={value()}
          headingLevel={args.headingLevel}
          onValueChange={(next) => {
            setValue(next);
            args.onValueChange(next);
          }}
        />
      </Box>
    );
  }),
};

export const AccordionSingle: Story = {
  name: "Accordion / single",
  parameters: { controls: { disable: true } },
  render: () => (
    <Box padding={4} style={{ "max-inline-size": "720px" }}>
      <AccordionDemo selectionMode="single" defaultValue="install" />
    </Box>
  ),
};

export const AccordionMultiple: Story = {
  name: "Accordion / multiple",
  parameters: { controls: { disable: true } },
  render: () => (
    <Box padding={4} style={{ "max-inline-size": "720px" }}>
      <AccordionDemo selectionMode="multiple" defaultValue={["install", "tokens"]} />
    </Box>
  ),
};

export const AccordionTruncate: Story = {
  name: "Accordion / длинные заголовки",
  parameters: { controls: { disable: true } },
  render: () => (
    <Box padding={4} style={{ "max-inline-size": "460px" }}>
      <Stack gap={4}>
        <Text variant="body-small" tone="muted">
          Узкая колонка: первый пункт обрезан одной строкой (`truncate`), второй переносится.
        </Text>
        <AccordionDemo selectionMode="single" defaultValue="long" long />
      </Stack>
    </Box>
  ),
};

function AccordionDemo(props: {
  readonly selectionMode: "single" | "multiple";
  readonly defaultValue: string | readonly string[];
  readonly long?: boolean;
}): Node {
  const [value, setValue] = createSignal<AccordionValue>(props.defaultValue);
  return (
    <Accordion
      items={props.long === true ? LONG_ACCORDION_ITEMS : ACCORDION_ITEMS}
      selectionMode={props.selectionMode}
      value={value()}
      headingLevel={3}
      onValueChange={setValue}
    />
  );
}

/* ------------------------------------------------------------------ */
/* SearchField                                                        */
/* ------------------------------------------------------------------ */

interface SearchStoryArgs {
  readonly label: string;
  readonly value: string;
  readonly placeholder: string;
  readonly hint: string;
  readonly error: string;
  readonly size: "sm" | "md" | "lg";
  readonly disabled: boolean;
  readonly readOnly: boolean;
  readonly clearLabel: string;
  readonly onInput: (event: InputEvent) => void;
  readonly onValueChange: (value: string) => void;
  readonly onSearch: (value: string) => void;
  readonly onClear: (event: MouseEvent) => void;
}

export const SearchFieldPlayground: StoryObj<SearchStoryArgs> = {
  name: "SearchField / очистка и поиск",
  parameters: controls(["label", "value", "placeholder", "hint", "error", "size", "disabled", "readOnly", "clearLabel", "onInput", "onValueChange", "onSearch", "onClear"]),
  argTypes: {
    label: { control: "text", description: "Видимая подпись" },
    value: { control: "text", description: "Начальный запрос" },
    placeholder: { control: "text", description: "Плейсхолдер" },
    hint: { control: "text", description: "Подсказка" },
    error: { control: "text", description: "Текст ошибки" },
    size: { control: "inline-radio", options: ["sm", "md", "lg"], description: "Размер" },
    disabled: { control: "boolean", description: "Недоступно" },
    readOnly: { control: "boolean", description: "Только чтение" },
    clearLabel: { control: "text", description: "Подпись кнопки очистки" },
    onInput: { action: "input", description: "Ввод символа" },
    onValueChange: { action: "valueChange", description: "Значение изменилось" },
    onSearch: { action: "search", description: "Enter отправляет запрос" },
    onClear: { action: "clear", description: "Нажата кнопка очистки" },
  },
  args: {
    label: "Поиск по документации",
    value: "accordion",
    placeholder: "Название компонента",
    hint: "Enter запускает поиск",
    error: "",
    size: "md",
    disabled: false,
    readOnly: false,
    clearLabel: "Очистить",
    onInput: fn(),
    onValueChange: fn(),
    onSearch: fn(),
    onClear: fn(),
  },
  render: silentStory<SearchStoryArgs>((args) => {
    const [query, setQuery] = createSignal(args.value);
    const [searched, setSearched] = createSignal("");
    return (
      <Box padding={4} style={{ "max-inline-size": "480px" }}>
        <Stack gap={2}>
          <SearchField
            label={args.label}
            hint={args.hint === "" ? undefined : args.hint}
            error={args.error === "" ? undefined : args.error}
            value={query()}
            placeholder={args.placeholder}
            size={args.size}
            disabled={args.disabled}
            readOnly={args.readOnly}
            clearLabel={args.clearLabel}
            onInput={(event) => {
              setQuery((event.currentTarget as HTMLInputElement | null)?.value ?? "");
              args.onInput(event);
            }}
            onValueChange={args.onValueChange}
            onSearch={(value) => {
              setSearched(value);
              args.onSearch(value);
            }}
            onClear={(event) => {
              setQuery("");
              args.onClear(event);
            }}
          />
          <Text variant="body-small" tone="muted">
            {searched() === "" ? "Запрос ещё не отправлен" : `Ищем: ${searched()}`}
          </Text>
        </Stack>
      </Box>
    );
  }),
};

/* ------------------------------------------------------------------ */
/* Table: truncate, lines, sticky, empty, narrow                      */
/* ------------------------------------------------------------------ */

interface Task {
  readonly id: number;
  readonly title: string;
  readonly owner: string;
  readonly note: string;
  readonly status: string;
}

const TASKS: readonly Task[] = [
  {
    id: 1,
    title:
      "Очень длинное название задачи, которое при truncate обрезается одной строкой с многоточием",
    owner: "Ада Ловлейс",
    note:
      "Длинная заметка: при lines=2 текст обрезается по двум строкам, а не растягивает строку таблицы на пол-экрана.",
    status: "В работе",
  },
  {
    id: 2,
    title: "Дизайн-система",
    owner: "Грейс Хоппер",
    note: "Короткая заметка.",
    status: "Ревью",
  },
  {
    id: 3,
    title: "SSR-пул",
    owner: "Алан Тьюринг",
    note: "Проверить гидрацию длинных списков.",
    status: "Готово",
  },
  {
    id: 4,
    title: "Документация",
    owner: "Барбара Лисков",
    note: "Обновить гайд по формам.",
    status: "В работе",
  },
];

interface TableStoryArgs {
  readonly dense: boolean;
  readonly stickyHeader: boolean;
  readonly empty: boolean;
  readonly truncate: boolean;
  readonly lines: 1 | 2 | 3 | 0;
  readonly sortKey: string;
  readonly sortDirection: TableSortDirection;
  readonly onSort: (key: string, direction: TableSortDirection) => void;
}

export const TableExtras: StoryObj<TableStoryArgs> = {
  name: "Table / truncate, lines, sticky, empty",
  parameters: controls(["dense", "stickyHeader", "empty", "truncate", "lines", "sortKey", "sortDirection", "onSort"]),
  argTypes: {
    dense: { control: "boolean", description: "Плотные отступы ячеек" },
    stickyHeader: { control: "boolean", description: "Закрепить заголовок в скроллящемся контейнере" },
    empty: { control: "boolean", description: "Показать пустое состояние" },
    truncate: { control: "boolean", description: "Колонка описания: одна строка с многоточием" },
    lines: {
      control: "inline-radio",
      options: [0, 1, 2, 3],
      description: "Обрезка описания по строкам; 0 — без обрезки",
      table: { defaultValue: { summary: "2" } },
    },
    sortKey: {
      control: "select",
      options: ["", "title", "owner", "status"],
      description: "Управляемый отсортированный столбец",
    },
    sortDirection: {
      control: "inline-radio",
      options: ["ascending", "descending"],
      description: "Направление сортировки",
    },
    onSort: { action: "sort", description: "Запрос сортировки `(key, direction)`" },
  },
  args: {
    dense: false,
    stickyHeader: false,
    empty: false,
    truncate: true,
    lines: 2,
    sortKey: "title",
    sortDirection: "ascending",
    onSort: fn(),
  },
  render: silentStory<TableStoryArgs>((args) => {
    const [sort, setSort] = createSignal<{ key: string; direction: TableSortDirection } | null>(
      args.sortKey === ""
        ? null
        : { key: args.sortKey, direction: args.sortDirection },
    );
    const columns: readonly TableColumn<Task>[] = [
      { key: "title", header: "Задача", sortable: true, truncate: args.truncate, width: "38%" },
      { key: "owner", header: "Владелец", sortable: true },
      {
        key: "note",
        header: "Заметка",
        truncate: args.truncate,
        ...(args.lines === 0 ? {} : { lines: args.lines }),
      },
      { key: "status", header: "Статус", align: "end", width: 120 },
    ];
    const rows = (): readonly Task[] => {
      const current = sort();
      if (current === null) return TASKS;
      const direction = current.direction === "ascending" ? 1 : -1;
      return [...TASKS].sort((left, right) =>
        String(left[current.key as keyof Task]).localeCompare(
          String(right[current.key as keyof Task]),
          "ru",
        ) * direction,
      );
    };
    return (
      <Box padding={4}>
        <div
          style={args.stickyHeader ? { "block-size": "220px", overflow: "auto" } : undefined}
        >
          <Table
            caption="Задачи команды"
            columns={columns}
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
            emptyTitle="Задач нет"
            empty="Когда появятся задачи, они окажутся здесь."
          />
        </div>
      </Box>
    );
  }),
};

export const TableNarrow: Story = {
  name: "Table / узкий экран",
  parameters: { controls: { disable: true }, viewport: { defaultViewport: "mobile360" } },
  render: () => (
    <Box padding={3} style={{ "inline-size": "360px", "max-inline-size": "100%" }}>
      <Stack gap={3}>
        <Text variant="body-small" tone="muted">
          Контейнер 360px: таблица сохраняет min-content колонок и скроллит по горизонтали,
          не расширяя страницу.
        </Text>
        <Table
          caption="Задачи команды на узком экране"
          columns={[
            { key: "title", header: "Задача", truncate: true, width: 220 },
            { key: "owner", header: "Владелец", width: 160 },
            { key: "note", header: "Заметка", truncate: true, lines: 2, width: 220 },
            { key: "status", header: "Статус", width: 120 },
          ]}
          rows={TASKS}
          rowKey={(row) => row.id}
          stickyHeader
        />
      </Stack>
    </Box>
  ),
};

/* ------------------------------------------------------------------ */
/* Композиции                                                         */
/* ------------------------------------------------------------------ */

export const Combo: Story = {
  name: "Combo / панель",
  parameters: { controls: { disable: true } },
  render: () => (
    <Box padding={4}>
      <Stack gap={4}>
        <Inline gap={2} wrap align="center">
          <SearchField label="Поиск" placeholder="Найти компонент" ariaLabel="Поиск компонентов" />
          <Chip variant="filter" selected onClick={() => undefined} leading={<CheckIcon />}>
            Готово
          </Chip>
          <Chip variant="input" removable onRemove={() => undefined}>
            v0.14
          </Chip>
          <Chip variant="suggestion" leading={<SearchIcon />} onClick={() => undefined}>
            Быстрый поиск
          </Chip>
        </Inline>
        <SegmentedDemo value="week" size="md" disabled={false} />
        <Inline gap={2} wrap>
          <Tag variant="success">готово</Tag>
          <Tag variant="warning">в ревью</Tag>
          <Tag variant="error">ошибка</Tag>
          <Tag removable onRemove={() => undefined}>
            удаляемый
          </Tag>
        </Inline>
        <EmptyState
          compact
          icon={<InfoIcon />}
          title="Ничего не найдено"
          description="Измените запрос или сбросьте фильтры."
        />
        <Fab ariaLabel="Добавить" icon={<AddIcon />} />
      </Stack>
    </Box>
  ),
};

export const Themes: Story = {
  name: "Extras / light и dark",
  parameters: { controls: { disable: true } },
  render: () => (
    <div class="extras-themes">
      <style>{`
        .extras-themes {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(min(100%, 20rem), 1fr));
          align-items: stretch;
          gap: var(--sui-space-5);
          inline-size: 100%;
          min-inline-size: 0;
        }

        .extras-themes__panel {
          display: flex;
          flex-direction: column;
          min-inline-size: 0;
          max-inline-size: 100%;
        }
      `}</style>
      {[
        { theme: "light", title: "Light" },
        { theme: "dark", title: "Dark" },
      ].map(({ theme, title }) => (
        <Surface
          key={theme}
          class="extras-themes__panel"
          tone="surface"
          padding={5}
          radius="lg"
          border="outline-variant"
          attrs={{ "data-theme": theme }}
        >
          <Stack gap={4}>
            <Heading level={3}>{title}</Heading>
            <Inline gap={2} wrap align="center">
              <Fab ariaLabel={`Создать (${title})`} size="sm" icon={<AddIcon />} />
              <Chip variant="filter" selected onClick={() => undefined}>
                Фильтр
              </Chip>
              <Tag variant="info" leading={<InfoIcon />}>
                тег
              </Tag>
            </Inline>
            <SegmentedDemo value="day" size="sm" disabled={false} />
            <EmptyState compact title="Пусто" description="Компактное состояние в теме." />
            <Table
              caption={`Таблица (${title})`}
              columns={[
                { key: "title", header: "Задача", truncate: true },
                { key: "status", header: "Статус", align: "end", width: 110 },
              ]}
              rows={TASKS}
              rowKey={(row) => row.id}
              dense
            />
          </Stack>
        </Surface>
      ))}
    </div>
  ),
};

export const Wide: Story = {
  name: "Extras / широкая витрина (4K-ready)",
  parameters: { controls: { disable: true }, viewport: { defaultViewport: "wide2560" } },
  render: () => (
    <Box padding={4} style={{ "inline-size": "100%", "max-inline-size": "2560px" }}>
      <Stack gap={4}>
        <Inline justify="between" align="center" wrap gap={3}>
          <Heading level={2}>Extras на широком экране</Heading>
          <Inline gap={2} wrap>
            <Tag variant="info">2560px</Tag>
            <Tag variant="success">dense table</Tag>
          </Inline>
        </Inline>
        <div
          style={{
            display: "grid",
            "grid-template-columns": "repeat(auto-fit, minmax(240px, 1fr))",
            gap: "1rem",
          }}
        >
          <Inline gap={2} wrap align="center">
            <Fab ariaLabel="Создать" icon={<AddIcon />} />
            <Chip variant="assist" leading={<InfoIcon />} onClick={() => undefined}>
              Справка
            </Chip>
            <Tag removable onRemove={() => undefined}>
              тег
            </Tag>
          </Inline>
          <SegmentedDemo value="week" size="md" disabled={false} />
          <EmptyState compact icon={<InfoIcon />} title="Пусто" description="Виджет 1/4 ширины." />
          <EmptyState compact icon={<InfoIcon />} title="Пусто" description="Виджет 2/4 ширины." />
        </div>
        <Table
          caption="Широкая таблица задач"
          columns={[
            { key: "title", header: "Задача", truncate: true, width: "40%" },
            { key: "owner", header: "Владелец" },
            { key: "note", header: "Заметка", truncate: true, lines: 2 },
            { key: "status", header: "Статус", align: "end", width: 140 },
          ]}
          rows={TASKS}
          rowKey={(row) => row.id}
          stickyHeader
        />
      </Stack>
    </Box>
  ),
};
