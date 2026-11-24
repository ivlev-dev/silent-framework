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
          "Токены бренда и семантические роли темы. Палитра ivory/almond/mist/",
          "navy/noir/gold компилируется в CSS-переменные `--sui-color-*`;",
          "`data-theme` переключает light/dark без перерисовки, `applyTheme()` ставит",
          "тему на документ, `themeScriptSource()` отдаёт inline-скрипт для SSR.",
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
  args: { theme: "light", headline: "Ivory, navy и золото" },
} satisfies Meta<ThemeArgs>;

export default meta;

type Story = StoryObj<ThemeArgs>;

const brandKeys = [
  "ivory",
  "almond",
  "mist",
  "navy",
  "noir",
  "gold",
  "navy-mid",
  "navy-deep",
  "navy-dark",
  "white",
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
    <Surface tone="surface-container" padding={5} radius="lg" border="outline-variant">
      <Stack gap={3}>
        <Heading level={3}>Поверхность и текст</Heading>
        <Text variant="body-large" class="sui-measure">
          Основной текст на бумажной поверхности. Мера строки — 68ch, поэтому
          абзац остаётся читаемым и на широком 4K-экране.
        </Text>
        <Text tone="muted">Вспомогательный текст — приглушённый navy.</Text>
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
          <Text tone="inherit" variant="label-large">accent / on-accent — золотой CTA</Text>
        </Box>
        <Grid columns={2} gap={2}>
          <Surface tone="secondary-container" padding={3} radius="sm">
            <Text>secondary-container</Text>
          </Surface>
          <Surface tone="tertiary-container" padding={3} radius="sm">
            <Text>tertiary-container</Text>
          </Surface>
        </Grid>
        <Stack gap={2} justify="start">
          <Button>filled</Button>
          <Button variant="tonal">tonal</Button>
          <Button variant="outlined">outlined</Button>
        </Stack>
      </Stack>
    </Surface>
  );
}

export const Palette: Story = {
  render: silentStory<ThemeArgs>((args) => (
    <Surface tone="surface" padding={5} radius="xl" attrs={{ "data-theme": args.theme }}>
      <Stack gap={4}>
        <Heading level={2} class="sui-font-display">{args.headline}</Heading>
        <Text tone="muted">
          Палитра ivory / almond / mist / navy / noir / gold. Ниже — семантические
          роли текущей темы.
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
  name: "Accent / gold",
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
