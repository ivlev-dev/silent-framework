import type { Meta, StoryObj } from "@storybook/html-vite";
import {
  Box,
  Grid,
  Inline,
  Stack,
  Text,
  type SpacingStep,
  type TextAlign,
  type TextTone,
  type TextVariant,
} from "@ivlev-dev/silent-ui";
import { silentStory } from "./silent-story.js";

const TEXT_VARIANTS: readonly TextVariant[] = [
  "body-large",
  "body-medium",
  "body-small",
  "title-medium",
  "title-small",
  "label-large",
  "label-medium",
  "label-small",
];

const TEXT_TONES: readonly TextTone[] = [
  "default",
  "muted",
  "primary",
  "secondary",
  "error",
  "success",
  "warning",
  "inherit",
];

const LONG_TEXT =
  "Silent UI строит интерфейс из одного корневого узла на компонент: тема, " +
  "плотность и состояния приходят через data-атрибуты, а не через условные " +
  "классы. Поэтому длинный текст одинаково читается в узкой карточке и на " +
  "широком 4K-экране, если задана мера строки.";

interface TextArgs {
  readonly text: string;
  readonly variant: TextVariant;
  readonly tone: TextTone;
  readonly align: TextAlign;
  readonly clamp: 0 | 1 | 2 | 3 | 4;
  readonly truncate: boolean;
  readonly measure: boolean;
  readonly width: SpacingStep | 0;
}

const meta = {
  title: "Foundations/Typography/Text",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: [
          "Текст — семантический `<span>` с типошкалой Material 3.",
          "`variant` задаёт размер и трекинг, `tone` — цветовую роль,",
          "`clamp`/`truncate` обрезают длинный текст, `measure` ограничивает",
          "меру строки 68ch для читаемости на широких экранах.",
        ].join(" "),
      },
      canvas: { sourceState: "shown" },
    },
  },
  argTypes: {
    text: { control: "text", description: "Содержимое (children)" },
    variant: {
      control: "select",
      options: TEXT_VARIANTS,
      description: "Вариант типошкалы",
      table: { defaultValue: { summary: "body-medium" } },
    },
    tone: {
      control: "select",
      options: TEXT_TONES,
      description: "Цветовая роль (`data-tone`)",
      table: { defaultValue: { summary: "default" } },
    },
    align: {
      control: "inline-radio",
      options: ["start", "center", "end"],
      description: "Выравнивание строки",
      table: { defaultValue: { summary: "start" } },
    },
    clamp: {
      control: "inline-radio",
      options: [0, 1, 2, 3, 4],
      description: "Обрезка по числу строк (`0` — без обрезки)",
      table: { defaultValue: { summary: "0" } },
    },
    truncate: {
      control: "boolean",
      description: "Одна строка с многоточием",
      table: { defaultValue: { summary: "false" } },
    },
    measure: {
      control: "boolean",
      description: "Мера строки 68ch",
      table: { defaultValue: { summary: "false" } },
    },
    width: {
      control: { type: "range", min: 0, max: 10, step: 1 },
      description: "Ширина контейнера-демо в шагах отступов (`0` — без ограничения)",
      table: { defaultValue: { summary: "0" } },
    },
  },
  args: {
    text: LONG_TEXT,
    variant: "body-medium",
    tone: "default",
    align: "start",
    clamp: 0,
    truncate: false,
    measure: false,
    width: 0,
  },
} satisfies Meta<TextArgs>;

export default meta;

type Story = StoryObj<TextArgs>;

const render = silentStory<TextArgs>((args) => (
  <Box
    background="surface-container-low"
    padding={3}
    radius="md"
    style={args.width === 0 ? undefined : { maxWidth: `calc(var(--sui-space-${args.width}) * 10)` }}
  >
    <Text
      variant={args.variant}
      tone={args.tone}
      align={args.align}
      clamp={args.clamp === 0 ? undefined : args.clamp}
      truncate={args.truncate}
      measure={args.measure}
    >
      {args.text}
    </Text>
  </Box>
));

export const Playground: Story = { render };

export const Variants: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Stack gap={2}>
      {TEXT_VARIANTS.map((variant) => (
        <Stack gap={1}>
          <Text variant="label-small" tone="muted">
            {variant}
          </Text>
          <Text variant={variant}>
            Плотность и ритм текста задаются токенами типошкалы
          </Text>
        </Stack>
      ))}
    </Stack>
  ),
};

export const Tones: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Stack gap={2}>
      <Text>default — основной текст</Text>
      <Text tone="muted">muted — вспомогательный текст</Text>
      <Text tone="primary">primary — ссылка/акцент</Text>
      <Text tone="secondary">secondary — второй акцент</Text>
      <Text tone="error">error — ошибка</Text>
      <Text tone="success">success — успех</Text>
      <Text tone="warning">warning — предупреждение</Text>
      <Box background="inverse-surface" padding={2} radius="sm">
        <Text tone="inherit">inherit — наследует цвет родителя (inverse-surface)</Text>
      </Box>
    </Stack>
  ),
};

export const Alignment: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Stack gap={4}>
      {(["start", "center", "end"] as TextAlign[]).map((align) => (
        <Box background="surface-container-low" padding={3} radius="md">
          <Text align={align} variant="body-small">
            {`align="${align}" — текст выровнен по ${align === "start" ? "началу" : align === "center" ? "центру" : "концу"} строки`}
          </Text>
        </Box>
      ))}
    </Stack>
  ),
};

export const TruncateAndClamp: Story = {
  name: "Truncate / clamp",
  parameters: { controls: { disable: true } },
  render: () => (
    <Stack gap={4} style={{ maxWidth: "22rem" }}>
      <Stack gap={1}>
        <Text variant="label-small" tone="muted">truncate</Text>
        <Text truncate>{LONG_TEXT}</Text>
      </Stack>
      <Stack gap={1}>
        <Text variant="label-small" tone="muted">clamp=2</Text>
        <Text clamp={2}>{LONG_TEXT}</Text>
      </Stack>
      <Stack gap={1}>
        <Text variant="label-small" tone="muted">clamp=3</Text>
        <Text clamp={3}>{LONG_TEXT}</Text>
      </Stack>
    </Stack>
  ),
};

export const Measure: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Stack gap={4}>
      <Text variant="label-small" tone="muted">Без measure</Text>
      <Text>{LONG_TEXT}</Text>
      <Text variant="label-small" tone="muted">С measure</Text>
      <Text measure>{LONG_TEXT}</Text>
    </Stack>
  ),
};

export const Responsive: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Grid columns={2} gap={4} min="lg">
      <Box background="surface-container-low" padding={3} radius="md" style={{ maxWidth: "360px" }}>
        <Stack gap={2}>
          <Text variant="label-small" tone="muted">360px</Text>
          <Text>{LONG_TEXT}</Text>
        </Stack>
      </Box>
      <Box background="surface-container-low" padding={3} radius="md">
        <Stack gap={2}>
          <Text variant="label-small" tone="muted">1600px</Text>
          <Text measure>{LONG_TEXT}</Text>
        </Stack>
      </Box>
    </Grid>
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
            <Text variant="label-large">{theme}</Text>
            <Text>Основной текст на поверхности</Text>
            <Text tone="muted">Вспомогательный текст</Text>
            <Text tone="primary">Акцентная ссылка</Text>
            <Text tone="error">Текст ошибки</Text>
          </Stack>
        </Box>
      ))}
    </Inline>
  ),
};
