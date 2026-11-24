import type { Meta, StoryObj } from "@storybook/html-vite";
import {
  Box,
  Grid,
  Inline,
  Stack,
  Surface,
  Text,
  type SpacingStep,
} from "@ivlev-dev/silent-ui";
import { silentStory } from "./silent-story.js";

type BackgroundTone =
  | "transparent"
  | "surface"
  | "surface-container"
  | "surface-container-low"
  | "surface-container-high"
  | "surface-container-highest"
  | "primary-container"
  | "secondary-container"
  | "tertiary-container"
  | "inverse-surface";

type BorderTone = "none" | "outline" | "outline-variant";
type RadiusStep = "none" | "xs" | "sm" | "md" | "lg" | "xl" | "full";
type ElevationStep = 0 | 1 | 2 | 3 | 4 | 5;

const TONES: readonly BackgroundTone[] = [
  "surface",
  "surface-container",
  "surface-container-low",
  "surface-container-high",
  "surface-container-highest",
  "primary-container",
  "secondary-container",
  "tertiary-container",
  "inverse-surface",
];

interface SurfaceArgs {
  readonly tone: BackgroundTone;
  readonly padding: SpacingStep;
  readonly border: BorderTone;
  readonly radius: RadiusStep;
  readonly elevation: ElevationStep;
  readonly title: string;
  readonly text: string;
}

const meta = {
  title: "Foundations/Layout/Surface",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: [
          "Поверхность с ролью тона, отступами, радиусом, границей и тенью.",
          "В отличие от `Box`, по умолчанию использует `surface-container` и радиус `md`,",
          "поэтому подходит для карточек, панелей и секций контента.",
        ].join(" "),
      },
      canvas: { sourceState: "shown" },
    },
  },
  argTypes: {
    tone: {
      control: "select",
      options: TONES,
      description: "Цветовая роль поверхности",
      table: { defaultValue: { summary: "surface-container" } },
    },
    padding: {
      control: { type: "range", min: 0, max: 10, step: 1 },
      description: "Внутренние отступы",
      table: { defaultValue: { summary: "0" } },
    },
    border: {
      control: "select",
      options: ["none", "outline", "outline-variant"],
      description: "Граница",
      table: { defaultValue: { summary: "none" } },
    },
    radius: {
      control: "select",
      options: ["none", "xs", "sm", "md", "lg", "xl", "full"],
      description: "Скругление",
      table: { defaultValue: { summary: "md" } },
    },
    elevation: {
      control: "inline-radio",
      options: [0, 1, 2, 3, 4, 5],
      description: "Тень",
      table: { defaultValue: { summary: "0" } },
    },
    title: { control: "text", description: "Заголовок-демо" },
    text: { control: "text", description: "Текст-демо" },
  },
  args: {
    tone: "surface-container",
    padding: 4,
    border: "outline-variant",
    radius: "md",
    elevation: 1,
    title: "Surface",
    text: "Поверхность отделяет содержимое по тону и тени, не добавляя семантики.",
  },
} satisfies Meta<SurfaceArgs>;

export default meta;

type Story = StoryObj<SurfaceArgs>;

export const Playground: Story = {
  render: silentStory<SurfaceArgs>((args) => (
    <Surface
      tone={args.tone}
      padding={args.padding}
      border={args.border}
      radius={args.radius}
      elevation={args.elevation}
    >
      <Stack gap={2}>
        <Text variant="title-medium">{args.title}</Text>
        <Text tone="muted" variant="body-small">{args.text}</Text>
      </Stack>
    </Surface>
  )),
};

export const Tones: Story = {
  name: "Tones",
  parameters: { controls: { disable: true } },
  render: () => (
    <Grid columns={3} gap={3} min="sm">
      {TONES.map((tone) => (
        <Surface tone={tone} padding={4} radius="md" border="outline-variant">
          <Text tone={tone === "inverse-surface" ? "inherit" : "default"} variant="label-medium">
            {tone}
          </Text>
        </Surface>
      ))}
    </Grid>
  ),
};

export const Elevation: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Inline gap={4} wrap align="center">
      {([0, 1, 2, 3, 4, 5] as const).map((elevation) => (
        <Surface tone="surface" padding={4} radius="md" elevation={elevation}>
          <Text variant="label-small">elevation={elevation}</Text>
        </Surface>
      ))}
    </Inline>
  ),
};

export const RadiusAndBorder: Story = {
  name: "Radius & border",
  parameters: { controls: { disable: true } },
  render: () => (
    <Stack gap={4}>
      <Inline gap={3} wrap>
        {(["none", "xs", "sm", "md", "lg", "xl", "full"] as const).map((radius) => (
          <Surface tone="surface-container" padding={3} radius={radius} border="outline-variant">
            <Text variant="label-small">{radius}</Text>
          </Surface>
        ))}
      </Inline>
      <Inline gap={3} wrap>
        {(["none", "outline", "outline-variant"] as BorderTone[]).map((border) => (
          <Surface tone="surface" padding={3} radius="md" border={border}>
            <Text variant="label-small">{`border="${border}"`}</Text>
          </Surface>
        ))}
      </Inline>
    </Stack>
  ),
};

export const Nested: Story = {
  name: "Вложенные поверхности",
  parameters: { controls: { disable: true } },
  render: () => (
    <Surface tone="surface-container-low" padding={5} radius="xl">
      <Stack gap={4}>
        <Text variant="title-medium">Внешняя поверхность</Text>
        <Grid columns={2} gap={3} min="sm">
          <Surface tone="surface" padding={4} radius="lg" elevation={1}>
            <Stack gap={2}>
              <Text variant="label-large">Карточка</Text>
              <Surface tone="surface-container-high" padding={3} radius="md">
                <Text variant="body-small">Вложенный блок</Text>
              </Surface>
            </Stack>
          </Surface>
          <Surface tone="primary-container" padding={4} radius="lg">
            <Stack gap={2}>
              <Text variant="label-large">Акцентная карточка</Text>
              <Surface tone="secondary-container" padding={3} radius="md">
                <Text variant="body-small">Вложенный блок</Text>
              </Surface>
            </Stack>
          </Surface>
        </Grid>
      </Stack>
    </Surface>
  ),
};

export const LightDark: Story = {
  name: "Light vs Dark",
  parameters: { controls: { disable: true } },
  render: () => (
    <Inline gap={4} wrap align="start">
      {(["light", "dark"] as const).map((theme) => (
        <Surface
          tone="surface"
          padding={4}
          radius="lg"
          border="outline-variant"
          attrs={{ "data-theme": theme }}
          style={{ flex: "1 1 18rem" }}
        >
          <Stack gap={3}>
            <Text variant="label-large">{theme}</Text>
            <Surface tone="surface-container" padding={3} radius="md">
              <Text>surface-container</Text>
            </Surface>
            <Surface tone="primary-container" padding={3} radius="md">
              <Text>primary-container</Text>
            </Surface>
            <Box background="surface" padding={3} radius="md" elevation={2}>
              <Text>elevation=2</Text>
            </Box>
          </Stack>
        </Surface>
      ))}
    </Inline>
  ),
};
