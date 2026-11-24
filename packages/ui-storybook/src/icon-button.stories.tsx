import type { Meta, StoryObj } from "@storybook/html-vite";
import { fn } from "storybook/test";
import {
  Box,
  CheckIcon,
  CloseIcon,
  DownloadIcon,
  IconButton,
  Inline,
  MenuIcon,
  MoreVertIcon,
  RefreshIcon,
  SearchIcon,
  StarIcon,
  Stack,
  Text,
  type GlyphProps,
  type IconButtonSize,
  type IconButtonVariant,
} from "@ivlev-dev/silent-ui";
import { silentStory } from "./silent-story.js";

type Glyph = (props: GlyphProps) => Node;

const VARIANTS: readonly IconButtonVariant[] = [
  "standard",
  "filled",
  "accent",
  "tonal",
  "outlined",
];

const GLYPHS: ReadonlyArray<readonly [string, Glyph]> = [
  ["close", CloseIcon],
  ["menu", MenuIcon],
  ["search", SearchIcon],
  ["check", CheckIcon],
  ["more-vert", MoreVertIcon],
  ["refresh", RefreshIcon],
  ["download", DownloadIcon],
  ["star", StarIcon],
];

const GLYPH_MAP = new Map<string, Glyph>(GLYPHS);

interface IconButtonArgs {
  readonly icon: string;
  readonly label: string;
  readonly size: IconButtonSize;
  readonly variant: IconButtonVariant;
  readonly disabled: boolean;
  readonly loading: boolean;
  readonly onClick: (event: MouseEvent) => void;
}

const meta = {
  title: "Components/IconButton",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: [
          "Круглая кнопка-иконка. `label` обязателен и всегда уходит в `aria-label`:",
          "визуально текста нет, поэтому без имени кнопка недоступна скринридеру.",
          "`loading` блокирует нажатия и показывает спиннер вместо иконки.",
        ].join(" "),
      },
      canvas: { sourceState: "shown" },
    },
  },
  argTypes: {
    icon: {
      control: "select",
      options: GLYPHS.map(([name]) => name),
      description: "Иконка-демо (сам компонент принимает children)",
      table: { defaultValue: { summary: "close" } },
    },
    label: {
      control: "text",
      description: "Доступное имя (`aria-label`), обязательное",
    },
    size: {
      control: "inline-radio",
      options: ["sm", "md", "lg"],
      description: "Размер кнопки",
      table: { defaultValue: { summary: "md" } },
    },
    variant: {
      control: "select",
      options: VARIANTS,
      description: "Визуальный вариант",
      table: { defaultValue: { summary: "standard" } },
    },
    disabled: {
      control: "boolean",
      description: "Недоступна",
      table: { defaultValue: { summary: "false" } },
    },
    loading: {
      control: "boolean",
      description: "Спиннер + `aria-busy` + блокировка",
      table: { defaultValue: { summary: "false" } },
    },
    onClick: { action: "click", description: "Клик; блокируется при `disabled`/`loading`" },
  },
  args: {
    icon: "close",
    label: "Закрыть",
    size: "md",
    variant: "standard",
    disabled: false,
    loading: false,
    onClick: fn(),
  },
} satisfies Meta<IconButtonArgs>;

export default meta;

type Story = StoryObj<IconButtonArgs>;

const render = silentStory<IconButtonArgs>((args) => {
  const GlyphComponent = GLYPH_MAP.get(args.icon) ?? CloseIcon;
  return (
    <IconButton
      label={args.label}
      size={args.size}
      variant={args.variant}
      disabled={args.disabled}
      loading={args.loading}
      onClick={args.onClick}
    >
      <GlyphComponent />
    </IconButton>
  );
});

export const Playground: Story = { render };

export const Variants: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Stack gap={4}>
      <Inline gap={3} align="center" wrap>
        {VARIANTS.map((variant) => (
          <IconButton variant={variant} label={variant}>
            <CloseIcon />
          </IconButton>
        ))}
      </Inline>
      <Text tone="muted" variant="body-small">
        `standard` — прозрачный фон, `filled` — primary, `accent` — золотой CTA.
      </Text>
    </Stack>
  ),
};

export const Sizes: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Inline gap={3} align="center" wrap>
      <IconButton size="sm" label="Маленькая">
        <CloseIcon />
      </IconButton>
      <IconButton size="md" label="Средняя">
        <CloseIcon />
      </IconButton>
      <IconButton size="lg" label="Большая">
        <CloseIcon />
      </IconButton>
    </Inline>
  ),
};

export const States: Story = {
  name: "States",
  parameters: { controls: { disable: true } },
  render: () => (
    <Stack gap={4}>
      {VARIANTS.map((variant) => (
        <Inline gap={3} align="center" wrap>
          <Text variant="label-small" tone="muted" style={{ minWidth: "5rem" }}>
            {variant}
          </Text>
          <IconButton variant={variant} label={`${variant} обычная`}>
            <CloseIcon />
          </IconButton>
          <IconButton variant={variant} label={`${variant} загрузка`} loading>
            <CloseIcon />
          </IconButton>
          <IconButton variant={variant} label={`${variant} недоступна`} disabled>
            <CloseIcon />
          </IconButton>
        </Inline>
      ))}
    </Stack>
  ),
};

export const Toolbar: Story = {
  name: "Панель инструментов",
  parameters: { controls: { disable: true } },
  render: () => (
    <Box background="surface-container" padding={2} radius="full" style={{ display: "inline-flex" }}>
      <Inline gap={1} align="center">
        <IconButton label="Меню">
          <MenuIcon />
        </IconButton>
        <IconButton label="Поиск">
          <SearchIcon />
        </IconButton>
        <IconButton label="Обновить">
          <RefreshIcon />
        </IconButton>
        <IconButton label="Скачать">
          <DownloadIcon />
        </IconButton>
        <IconButton label="В избранное">
          <StarIcon />
        </IconButton>
        <IconButton label="Ещё" variant="tonal">
          <MoreVertIcon />
        </IconButton>
      </Inline>
    </Box>
  ),
};

export const ThemeContrast: Story = {
  name: "Light vs Dark",
  parameters: { controls: { disable: true } },
  render: () => (
    <Inline gap={4} wrap align="start">
      {(["light", "dark"] as const).map((theme) => (
        <Box
          background="surface"
          padding={4}
          radius="lg"
          border="outline-variant"
          attrs={{ "data-theme": theme }}
          style={{ flex: "1 1 14rem" }}
        >
          <Stack gap={3}>
            <Text variant="label-large">{theme}</Text>
            <Inline gap={2} align="center" wrap>
              {VARIANTS.map((variant) => (
                <IconButton variant={variant} label={`${theme} ${variant}`}>
                  <CloseIcon />
                </IconButton>
              ))}
            </Inline>
          </Stack>
        </Box>
      ))}
    </Inline>
  ),
};
