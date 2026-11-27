import type { Meta, StoryObj } from "@storybook/html-vite";
import {
  Box,
  Button,
  Grid,
  Heading,
  Inline,
  Stack,
  Surface,
  Text,
  ThemeScript,
  applyTheme,
  darkColors,
  lightColors,
  palette,
  themeScriptSource,
  type ThemeMode,
} from "@ivlev-dev/silent-ui";
import { silentStory } from "./silent-story.js";

interface ThemeArgs {
  readonly theme: ThemeMode;
  readonly headline: string;
}

const meta = {
  title: "Foundations/Color & Theme",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: [
          "Токены бренда и семантические роли темы. Палитра ink-900, ink-800,",
          "teal-700, mist-300 и ivory-50 компилируется в CSS-переменные `--sui-color-*`;",
          "`data-theme` переключает light/dark без перерисовки, `applyTheme()` ставит",
          "тему на документ, `themeScriptSource()` отдаёт inline-скрипт для SSR.",
          "Display/headline и UI используют один современный sans, контролы 32/40/48px,",
          "радиусы 4/6/10/14/20 — без serif и визуального раздувания.",
        ].join(" "),
      },
      canvas: { sourceState: "shown" },
    },
  },
  argTypes: {
    theme: {
      control: "inline-radio",
      options: ["light", "dark", "auto"],
      description: "Тема демонстрационной поверхности",
      table: { defaultValue: { summary: "light" } },
    },
    headline: {
      control: "text",
      description: "Заголовок витрины палитры",
    },
  },
  args: { theme: "light", headline: "Ink, teal и туман" },
} satisfies Meta<ThemeArgs>;

export default meta;

type Story = StoryObj<ThemeArgs>;

const brandKeys = [
  "ink-900",
  "ink-800",
  "teal-700",
  "mist-300",
  "ivory-50",
] as const;

const semanticKeys = [
  "surface",
  "surface-container",
  "surface-container-high",
  "on-surface",
  "on-surface-variant",
  "primary",
  "primary-container",
  "secondary",
  "secondary-container",
  "tertiary",
  "accent",
  "outline",
  "error",
  "success",
  "warning",
  "inverse-surface",
] as const;

function Swatch(props: {
  readonly color: string;
  readonly label: string;
}): Node {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--sui-space-2)",
        padding: "var(--sui-space-2)",
        border: "var(--sui-hairline) solid var(--sui-color-outline-variant)",
        borderRadius: "var(--sui-radius-md)",
        backgroundColor: "var(--sui-color-surface)",
      }}
    >
      <div
        style={{
          height: "2.5rem",
          border: "var(--sui-hairline) solid var(--sui-color-outline-variant)",
          borderRadius: "var(--sui-radius-sm)",
          backgroundColor: props.color,
        }}
      />
      <Text variant="label-medium">{props.label}</Text>
      <Text variant="label-small" tone="muted">{props.color}</Text>
    </div>
  );
}

function paletteSwatches(): Node {
  return (
    <Grid columns={5} gap={2} min="sm">
      {brandKeys.map((key) => (
        <Swatch color={palette[key]} label={key} />
      ))}
    </Grid>
  );
}

function semanticSwatches(theme: "light" | "dark"): Node {
  const colors = theme === "light" ? lightColors : darkColors;
  return (
    <Grid columns={4} gap={2} min="sm">
      {semanticKeys.map((key) => (
        <Swatch color={colors[key]} label={`${theme}/${key}`} />
      ))}
    </Grid>
  );
}

function sample(): Node {
  return (
    <Surface tone="surface-container" padding={4} radius="lg" border="outline-variant">
      <Stack gap={3}>
        <Stack gap={1}>
          <Text variant="label-small" tone="muted">display / headline / title / body / label — sans</Text>
          <Heading level={2} variant="display-small">Строгая типографика</Heading>
          <Heading level={3} variant="headline-small">Заголовок без serif</Heading>
          <Text variant="title-small">Компактный title</Text>
          <Text variant="body-medium" class="sui-measure">
            Основной текст на бумажной поверхности. Мера строки — 68ch, поэтому
            абзац остаётся читаемым и на широком 4K-экране.
          </Text>
          <Text variant="label-medium" tone="muted">LABEL · 12–13PX</Text>
        </Stack>
        <Text tone="muted">Вспомогательный текст — приглушённый neutral.</Text>
        <Box padding={3} background="primary-container" radius="md">
          <Text tone="primary">primary-container</Text>
        </Box>
        <Box
          padding={3}
          radius="md"
          style={{
            backgroundColor: "var(--sui-color-accent)",
            color: "var(--sui-color-on-accent)",
          }}
        >
          <Text tone="inherit" variant="label-large">accent / on-accent — mist CTA</Text>
        </Box>
        <Grid columns={2} gap={2}>
          <Surface tone="secondary-container" padding={3} radius="sm">
            <Text>secondary-container</Text>
          </Surface>
          <Surface tone="tertiary-container" padding={3} radius="sm">
            <Text>tertiary-container</Text>
          </Surface>
        </Grid>
        <Inline gap={2} wrap align="center">
          <Button size="sm">sm 32</Button>
          <Button>filled 40</Button>
          <Button variant="tonal">tonal</Button>
          <Button variant="outlined">outlined</Button>
          <Button variant="accent" size="lg">lg 48</Button>
        </Inline>
      </Stack>
    </Surface>
  );
}

export const Palette: Story = {
  render: silentStory<ThemeArgs>((args) => (
    <Surface tone="surface" padding={5} radius="xl" attrs={{ "data-theme": args.theme }}>
      <Stack gap={4}>
        <Heading level={2}>{args.headline}</Heading>
        <Text tone="muted">
          Палитра ink-900 / ink-800 / teal-700 / mist-300 / ivory-50. Ниже —
          семантические роли текущей темы.
        </Text>
        <Heading level={4}>Brand palette</Heading>
        {paletteSwatches()}
        <Heading level={4}>Semantic roles — light</Heading>
        {semanticSwatches("light")}
        <Heading level={4}>Semantic roles — dark</Heading>
        {semanticSwatches("dark")}
        {sample()}
      </Stack>
    </Surface>
  )),
};

export const SideBySide: Story = {
  name: "Light vs Dark",
  parameters: { controls: { disable: true } },
  render: silentStory(() => (
    <Grid columns="auto" gap={4} min="lg">
      <Surface tone="surface" padding={4} radius="xl" attrs={{ "data-theme": "light" }}>
        <Stack gap={3}>
          <Heading level={4}>light</Heading>
          {sample()}
        </Stack>
      </Surface>
      <Surface tone="surface" padding={4} radius="xl" attrs={{ "data-theme": "dark" }}>
        <Stack gap={3}>
          <Heading level={4}>dark</Heading>
          {sample()}
        </Stack>
      </Surface>
    </Grid>
  )),
};

export const Accent: Story = {
  name: "Accent / mist",
  parameters: { controls: { disable: true } },
  render: silentStory(() => (
    <Grid columns="auto" gap={4} min="lg">
      <Surface tone="surface" padding={4} radius="xl" attrs={{ "data-theme": "light" }}>
        <Stack gap={3}>
          <Heading level={4}>light accent</Heading>
          <Swatch color={lightColors.accent} label="light accent" />
          <Inline gap={2} wrap>
            <Box padding={3} radius="md" style={{ backgroundColor: "var(--sui-color-accent)", color: "var(--sui-color-on-accent)" }}>
              <Text tone="inherit" variant="label-large">Primary action</Text>
            </Box>
            <Box padding={3} radius="md" style={{ border: "var(--sui-hairline) solid var(--sui-color-accent)", color: "var(--sui-color-on-surface)" }}>
              <Text tone="inherit" variant="label-large">Highlight</Text>
            </Box>
          </Inline>
        </Stack>
      </Surface>
      <Surface tone="surface" padding={4} radius="xl" attrs={{ "data-theme": "dark" }}>
        <Stack gap={3}>
          <Heading level={4}>dark accent</Heading>
          <Swatch color={darkColors.accent} label="dark accent" />
          <Inline gap={2} wrap>
            <Box padding={3} radius="md" style={{ backgroundColor: "var(--sui-color-accent)", color: "var(--sui-color-on-accent)" }}>
              <Text tone="inherit" variant="label-large">Primary action</Text>
            </Box>
            <Box padding={3} radius="md" style={{ border: "var(--sui-hairline) solid var(--sui-color-accent)", color: "var(--sui-color-on-surface)" }}>
              <Text tone="inherit" variant="label-large">Highlight</Text>
            </Box>
          </Inline>
        </Stack>
      </Surface>
    </Grid>
  )),
};

export const Applied: Story = {
  name: "applyTheme() на документе",
  parameters: { controls: { disable: true } },
  render: silentStory(() => (
    <Stack gap={3}>
      <Text>
        Кнопки ниже ставят тему на documentElement через applyTheme(). Тема хоста
        Storybook при этом меняется — это ожидаемая демонстрация.
      </Text>
      <Button
        variant="tonal"
        onClick={() => {
          applyTheme({ theme: "light" });
        }}
      >
        applyTheme(light)
      </Button>
      <Button
        variant="tonal"
        onClick={() => {
          applyTheme({ theme: "dark" });
        }}
      >
        applyTheme(dark)
      </Button>
      <Text variant="body-small" tone="muted">
        Инлайн-скрипт для SSR: <code>themeScriptSource()</code> — {themeScriptSource().length} символов.
      </Text>
      <ThemeScript defaultTheme="light" />
    </Stack>
  )),
};
