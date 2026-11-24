import type { Meta, StoryObj } from "@storybook/html-vite";
import {
  Box,
  Grid,
  Inline,
  Stack,
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

const PADDING_STEPS: readonly SpacingStep[] = [0, 1, 2, 3, 4, 5, 6, 8, 10];
const BACKGROUND_TONES: readonly BackgroundTone[] = [
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
const RADII: readonly RadiusStep[] = ["none", "xs", "sm", "md", "lg", "xl", "full"];
const ELEVATIONS: readonly ElevationStep[] = [0, 1, 2, 3, 4, 5];

interface BoxArgs {
  readonly padding: SpacingStep;
  readonly background: BackgroundTone;
  readonly border: BorderTone;
  readonly radius: RadiusStep;
  readonly elevation: ElevationStep;
  readonly text: string;
}

const meta = {
  title: "Foundations/Layout/Box",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: [
          "Базовый контейнер раскладки: только отступы, фон, граница, радиус и тень.",
          "Все параметры кодируются `data-*`-атрибутами поверх токенов темы, поэтому",
          "`Box` — строительный блок для остальных примитивов и не несёт семантики.",
        ].join(" "),
      },
      canvas: { sourceState: "shown" },
    },
  },
  argTypes: {
    padding: {
      control: { type: "range", min: 0, max: 10, step: 1 },
      description: "Внутренние отступы по шкале `--sui-space-N`",
      table: { defaultValue: { summary: "none" } },
    },
    background: {
      control: "select",
      options: ["transparent", ...BACKGROUND_TONES],
      description: "Цветовая роль фона",
      table: { defaultValue: { summary: "transparent" } },
    },
    border: {
      control: "select",
      options: ["none", "outline", "outline-variant"],
      description: "Цвет границы (hairline)",
      table: { defaultValue: { summary: "none" } },
    },
    radius: {
      control: "select",
      options: RADII,
      description: "Скругление углов",
      table: { defaultValue: { summary: "none" } },
    },
    elevation: {
      control: "inline-radio",
      options: ELEVATIONS,
      description: "Тень по шкале elevation",
      table: { defaultValue: { summary: "0" } },
    },
    text: { control: "text", description: "Содержимое-демо (children)" },
  },
  args: {
    padding: 3,
    background: "surface-container",
    border: "outline-variant",
    radius: "md",
    elevation: 0,
    text: "Box: раскладка без семантики",
  },
} satisfies Meta<BoxArgs>;

export default meta;

type Story = StoryObj<BoxArgs>;

export const Playground: Story = {
  render: silentStory<BoxArgs>((args) => (
    <Box
      padding={args.padding}
      background={args.background}
      border={args.border}
      radius={args.radius}
      elevation={args.elevation}
    >
      <Text>{args.text}</Text>
    </Box>
  )),
};

export const PaddingScale: Story = {
  name: "Padding scale",
  parameters: { controls: { disable: true } },
  render: () => (
    <Stack gap={2}>
      {PADDING_STEPS.map((step) => (
        <Box padding={step} background="primary-container" radius="xs">
          <Text variant="label-small">{`padding=${step}`}</Text>
        </Box>
      ))}
    </Stack>
  ),
};

export const Backgrounds: Story = {
  name: "Background tones",
  parameters: { controls: { disable: true } },
  render: () => (
    <Grid columns={3} gap={2} min="sm">
      {BACKGROUND_TONES.map((tone) => (
        <Box padding={3} background={tone} radius="md">
          <Text tone={tone === "inverse-surface" ? "inherit" : "default"} variant="label-small">
            {tone}
          </Text>
        </Box>
      ))}
    </Grid>
  ),
};

export const BordersAndRadius: Story = {
  name: "Borders & radius",
  parameters: { controls: { disable: true } },
  render: () => (
    <Stack gap={4}>
      <Inline gap={2} wrap>
        <Box padding={3} border="outline" radius="sm">
          <Text variant="label-small">outline</Text>
        </Box>
        <Box padding={3} border="outline-variant" radius="sm">
          <Text variant="label-small">outline-variant</Text>
        </Box>
        <Box padding={3} border="none" background="surface-container" radius="sm">
          <Text variant="label-small">none</Text>
        </Box>
      </Inline>
      <Inline gap={2} wrap>
        {RADII.map((radius) => (
          <Box padding={3} background="surface-container-high" radius={radius}>
            <Text variant="label-small">{radius}</Text>
          </Box>
        ))}
      </Inline>
    </Stack>
  ),
};

export const Elevations: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Inline gap={4} wrap align="center">
      {ELEVATIONS.map((elevation) => (
        <Box padding={4} background="surface" radius="md" elevation={elevation}>
          <Text variant="label-small">elevation={elevation}</Text>
        </Box>
      ))}
    </Inline>
  ),
};

export const LightDark: Story = {
  name: "Light vs Dark",
  parameters: { controls: { disable: true } },
  render: () => (
    <Inline gap={4} wrap align="start">
      {(["light", "dark"] as const).map((theme) => (
        <Box
          padding={4}
          background="surface"
          radius="lg"
          border="outline-variant"
          attrs={{ "data-theme": theme }}
          style={{ flex: "1 1 18rem" }}
        >
          <Stack gap={2}>
            <Text variant="label-large">{theme}</Text>
            <Box padding={3} background="primary-container" radius="sm">
              <Text>primary-container</Text>
            </Box>
            <Box padding={3} background="surface-container-high" radius="sm">
              <Text>surface-container-high</Text>
            </Box>
            <Box padding={3} background="surface" radius="sm" elevation={2}>
              <Text>elevation=2</Text>
            </Box>
          </Stack>
        </Box>
      ))}
    </Inline>
  ),
};
