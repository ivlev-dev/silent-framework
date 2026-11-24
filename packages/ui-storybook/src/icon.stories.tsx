import type { Meta, StoryObj } from "@storybook/html-vite";
import {
  AddIcon,
  ArrowBackIcon,
  ArrowForwardIcon,
  Box,
  CheckIcon,
  ChevronDownIcon,
  ChevronEndIcon,
  ChevronStartIcon,
  ChevronUpIcon,
  CloseIcon,
  DownloadIcon,
  ErrorIcon,
  ExpandLessIcon,
  ExpandMoreIcon,
  Grid,
  Icon,
  InfoIcon,
  Inline,
  LoadingIcon,
  MenuIcon,
  MoreHorizIcon,
  MoreVertIcon,
  RefreshIcon,
  RemoveIcon,
  SearchIcon,
  Stack,
  StarFilledIcon,
  StarIcon,
  SuccessIcon,
  Text,
  UploadIcon,
  VisibilityIcon,
  VisibilityOffIcon,
  WarningIcon,
  type GlyphProps,
  type IconSize,
} from "@ivlev-dev/silent-ui";
import { silentStory } from "./silent-story.js";

type Glyph = (props: GlyphProps) => Node;

/** Полный набор иконок, экспортируемых `@ivlev-dev/silent-ui`. */
const ICONS: ReadonlyArray<readonly [string, Glyph]> = [
  ["add", AddIcon],
  ["arrow-back", ArrowBackIcon],
  ["arrow-forward", ArrowForwardIcon],
  ["check", CheckIcon],
  ["chevron-down", ChevronDownIcon],
  ["chevron-up", ChevronUpIcon],
  ["chevron-start", ChevronStartIcon],
  ["chevron-end", ChevronEndIcon],
  ["close", CloseIcon],
  ["expand-less", ExpandLessIcon],
  ["expand-more", ExpandMoreIcon],
  ["download", DownloadIcon],
  ["upload", UploadIcon],
  ["refresh", RefreshIcon],
  ["menu", MenuIcon],
  ["more-vert", MoreVertIcon],
  ["more-horiz", MoreHorizIcon],
  ["remove", RemoveIcon],
  ["search", SearchIcon],
  ["visibility", VisibilityIcon],
  ["visibility-off", VisibilityOffIcon],
  ["loading", LoadingIcon],
  ["info", InfoIcon],
  ["success", SuccessIcon],
  ["warning", WarningIcon],
  ["error", ErrorIcon],
  ["star", StarIcon],
  ["star-filled", StarFilledIcon],
];

const ICON_NAMES = ICONS.map(([name]) => name);
const ICON_MAP = new Map<string, Glyph>(ICONS);

interface IconArgs {
  readonly name: string;
  readonly size: IconSize;
  readonly label: string;
}

const meta = {
  title: "Foundations/Typography/Icon",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: [
          "`Icon` — обёртка над inline-SVG: размер берётся из шкалы иконок,",
          "цвет — `currentColor`. С `label` иконка получает `role=\"img\"` и доступное имя,",
          "без него — декоративна (`aria-hidden`). Готовые глифы Material Symbols",
          "лежат в `@ivlev-dev/silent-ui`.",
        ].join(" "),
      },
      canvas: { sourceState: "shown" },
    },
  },
  argTypes: {
    name: {
      control: "select",
      options: ICON_NAMES,
      description: "Имя готового глифа из набора",
      table: { defaultValue: { summary: "check" } },
    },
    size: {
      control: "inline-radio",
      options: ["sm", "md", "lg", "xl"],
      description: "Размер по токену шкалы иконок",
      table: { defaultValue: { summary: "md" } },
    },
    label: {
      control: "text",
      description: "Доступное имя; пусто — иконка декоративна",
    },
  },
  args: { name: "check", size: "md", label: "" },
} satisfies Meta<IconArgs>;

export default meta;

type Story = StoryObj<IconArgs>;

export const Playground: Story = {
  render: silentStory<IconArgs>((args) => {
    const GlyphComponent = ICON_MAP.get(args.name) ?? CheckIcon;
    return (
      <Inline gap={3} align="center">
        <GlyphComponent size={args.size} label={args.label === "" ? undefined : args.label} />
        <Text tone="muted" variant="body-small">
          {args.label === "" ? "декоративная (aria-hidden)" : `role="img", aria-label="${args.label}"`}
        </Text>
      </Inline>
    );
  }),
};

export const Gallery: Story = {
  name: "Галерея иконок",
  parameters: { controls: { disable: true } },
  render: () => (
    <Stack gap={4}>
      <Grid columns={3} gap={3} min="lg">
        {ICONS.map(([name, GlyphComponent]) => (
          <Box background="surface-container-low" padding={3} radius="md" border="outline-variant">
            <Stack gap={2}>
              <Text variant="label-medium">{name}</Text>
              <Inline gap={3} align="center">
                <GlyphComponent size="sm" />
                <GlyphComponent size="md" />
                <GlyphComponent size="lg" />
                <GlyphComponent size="xl" />
              </Inline>
            </Stack>
          </Box>
        ))}
      </Grid>
    </Stack>
  ),
};

export const Sizes: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Inline gap={5} align="center">
      <Inline gap={2} align="center">
        <CheckIcon size="sm" />
        <Text variant="label-small" tone="muted">sm</Text>
      </Inline>
      <Inline gap={2} align="center">
        <CheckIcon size="md" />
        <Text variant="label-small" tone="muted">md</Text>
      </Inline>
      <Inline gap={2} align="center">
        <CheckIcon size="lg" />
        <Text variant="label-small" tone="muted">lg</Text>
      </Inline>
      <Inline gap={2} align="center">
        <CheckIcon size="xl" />
        <Text variant="label-small" tone="muted">xl</Text>
      </Inline>
    </Inline>
  ),
};

export const Accessibility: Story = {
  name: "Доступность",
  parameters: { controls: { disable: true } },
  render: () => (
    <Stack gap={3}>
      <Inline gap={3} align="center">
        <CheckIcon label="Готово" />
        <Text>Слева — иконка с `role="img"` и именем «Готово»</Text>
      </Inline>
      <Inline gap={3} align="center">
        <CheckIcon />
        <Text>Слева — декоративная иконка, текст несёт смысл</Text>
      </Inline>
    </Stack>
  ),
};

export const BigSvg: Story = {
  name: "Сырой Icon",
  parameters: { controls: { disable: true } },
  render: () => (
    <Inline gap={4} align="center">
      <Icon size="xl">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" />
        <path d="M8 12.5 11 15l5-6" fill="none" stroke="currentColor" stroke-width="2" />
      </Icon>
      <Icon size="lg" label="Пользователь">
        <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-3.31 0-8 1.66-8 4.96V21h16v-2.04C20 15.66 15.31 14 12 14Z" />
      </Icon>
    </Inline>
  ),
};

export const ColorInheritance: Story = {
  name: "Light vs Dark / currentColor",
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
          style={{ flex: "1 1 16rem" }}
        >
          <Stack gap={3}>
            <Text variant="label-large">{theme}</Text>
            <Inline gap={3} align="center">
              <CheckIcon size="lg" />
              <InfoIcon size="lg" />
              <WarningIcon size="lg" />
              <StarFilledIcon size="lg" />
            </Inline>
            <Box background="primary-container" padding={2} radius="sm">
              <Inline gap={2} align="center">
                <CheckIcon />
                <Text>Цвет — currentColor родителя</Text>
              </Inline>
            </Box>
          </Stack>
        </Box>
      ))}
    </Inline>
  ),
};
