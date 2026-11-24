import type { Meta, StoryObj } from "@storybook/html-vite";
import {
  Box,
  Heading,
  Inline,
  Stack,
  Text,
  type HeadingLevel,
  type HeadingTone,
  type HeadingVariant,
} from "@ivlev-dev/silent-ui";
import { silentStory } from "./silent-story.js";

const VARIANTS: readonly HeadingVariant[] = [
  "display-large",
  "display-medium",
  "display-small",
  "headline-large",
  "headline-medium",
  "headline-small",
  "title-large",
  "title-medium",
  "title-small",
];

const TONES: readonly HeadingTone[] = ["default", "muted", "primary", "inherit"];

interface HeadingArgs {
  readonly level: HeadingLevel;
  readonly variant: HeadingVariant | "auto";
  readonly tone: HeadingTone;
  readonly text: string;
}

const meta = {
  title: "Foundations/Typography/Heading",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: [
          "Заголовок: уровень задаёт и HTML-тег (`h1`–`h6`), и вариант по умолчанию.",
          "Визуальный вариант можно переопределить, не ломая структуру документа.",
          "`tone` ограничен ролями, допустимыми для текста заголовков.",
        ].join(" "),
      },
      canvas: { sourceState: "shown" },
    },
  },
  argTypes: {
    level: {
      control: "inline-radio",
      options: [1, 2, 3, 4, 5, 6],
      description: "Уровень: выбирает тег и вариант по умолчанию",
      table: { defaultValue: { summary: "2" } },
    },
    variant: {
      control: "select",
      options: ["auto", ...VARIANTS],
      description: "Визуальный вариант; `auto` — из уровня",
      table: { defaultValue: { summary: "auto" } },
    },
    tone: {
      control: "select",
      options: TONES,
      description: "Цветовая роль",
      table: { defaultValue: { summary: "default" } },
    },
    text: { control: "text", description: "Текст заголовка (children)" },
  },
  args: {
    level: 2,
    variant: "auto",
    tone: "default",
    text: "Заголовок раздела",
  },
} satisfies Meta<HeadingArgs>;

export default meta;

type Story = StoryObj<HeadingArgs>;

export const Playground: Story = {
  render: silentStory<HeadingArgs>((args) => (
    <Heading
      level={args.level}
      variant={args.variant === "auto" ? undefined : args.variant}
      tone={args.tone}
    >
      {args.text}
    </Heading>
  )),
};

export const Levels: Story = {
  name: "Levels h1–h6",
  parameters: { controls: { disable: true } },
  render: () => (
    <Stack gap={3}>
      {([1, 2, 3, 4, 5, 6] as HeadingLevel[]).map((level) => (
        <Stack gap={1}>
          <Text variant="label-small" tone="muted">{`<h${level}>`}</Text>
          <Heading level={level}>Уровень {level}</Heading>
        </Stack>
      ))}
    </Stack>
  ),
};

export const Variants: Story = {
  name: "Variants",
  parameters: { controls: { disable: true } },
  render: () => (
    <Stack gap={2}>
      {VARIANTS.map((variant) => (
        <Stack gap={1}>
          <Text variant="label-small" tone="muted">{variant}</Text>
          <Heading level={2} variant={variant}>
            Плотность и ритм заголовка
          </Heading>
        </Stack>
      ))}
    </Stack>
  ),
};

export const Tones: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Stack gap={2}>
      <Heading level={3}>default — основной заголовок</Heading>
      <Heading level={3} tone="muted">muted — второстепенный</Heading>
      <Heading level={3} tone="primary">primary — акцентный</Heading>
      <Box background="inverse-surface" padding={3} radius="md">
        <Heading level={3} tone="inherit">inherit — наследует цвет родителя</Heading>
      </Box>
    </Stack>
  ),
};

export const LongText: Story = {
  name: "Long text",
  parameters: { controls: { disable: true } },
  render: () => (
    <Stack gap={4}>
      <Heading level={1}>
        Дизайн-система, которая одинаково работает в браузере, SSR и на широком
        экране витрины
      </Heading>
      <Heading level={2} style={{ maxWidth: "32rem" }}>
        Ограниченная мера строки для длинного подзаголовка
      </Heading>
    </Stack>
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
          style={{ flex: "1 1 18rem" }}
        >
          <Stack gap={2}>
            <Text variant="label-small" tone="muted">{theme}</Text>
            <Heading level={3}>Заголовок</Heading>
            <Heading level={4} tone="muted">Приглушённый</Heading>
            <Heading level={5} tone="primary">Акцентный</Heading>
          </Stack>
        </Box>
      ))}
    </Inline>
  ),
};
