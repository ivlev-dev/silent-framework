import type { Meta, StoryObj } from "@storybook/html-vite";
import {
  Box,
  Inline,
  Skeleton,
  Stack,
  Text,
  type SkeletonAnimation,
  type SkeletonVariant,
} from "@ivlev-dev/silent-ui";
import { silentStory } from "./silent-story.js";

type SkeletonSize = "sm" | "md" | "lg";

interface SkeletonArgs {
  readonly variant: SkeletonVariant;
  readonly animation: SkeletonAnimation;
  readonly size: SkeletonSize;
  readonly lines: number;
  readonly width: number;
  readonly height: number;
}

const meta = {
  title: "Components/Skeleton",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: [
          "Плейсхолдер загрузки: `text` умеет несколько строк, `circle` и `rect` —",
          "фигуры. Всегда `aria-hidden`: смысл озвучивает соседний `aria-busy`-контейнер,",
          "а не «серый прямоугольник». Анимация отключается при reduced-motion.",
        ].join(" "),
      },
      canvas: { sourceState: "shown" },
    },
  },
  argTypes: {
    variant: {
      control: "inline-radio",
      options: ["text", "circle", "rect"],
      description: "Форма плейсхолдера",
      table: { defaultValue: { summary: "text" } },
    },
    animation: {
      control: "select",
      options: ["pulse", "wave", "none"],
      description: "Анимация; отключается при reduced-motion",
      table: { defaultValue: { summary: "pulse" } },
    },
    size: {
      control: "inline-radio",
      options: ["sm", "md", "lg"],
      description: "Высота строки текста",
      table: { defaultValue: { summary: "md" } },
    },
    lines: {
      control: { type: "range", min: 1, max: 6, step: 1 },
      description: "Число строк для variant=\"text\"",
      table: { defaultValue: { summary: "1" } },
    },
    width: {
      control: { type: "range", min: 40, max: 480, step: 8 },
      description: "Ширина в px (или CSS-длина)",
    },
    height: {
      control: { type: "range", min: 8, max: 240, step: 8 },
      description: "Высота в px (или CSS-длина)",
    },
  },
  args: { variant: "text", animation: "pulse", size: "md", lines: 3, width: 320, height: 16 },
} satisfies Meta<SkeletonArgs>;

export default meta;

type Story = StoryObj<SkeletonArgs>;

export const Playground: Story = {
  render: silentStory<SkeletonArgs>((args) => (
    <Skeleton
      variant={args.variant}
      animation={args.animation}
      size={args.size}
      lines={args.lines}
      width={args.width}
      height={args.height}
    />
  )),
};

export const States: Story = {
  name: "States",
  parameters: { controls: { disable: true } },
  render: () => (
    <Stack gap={4}>
      <Skeleton lines={3} />
      <Inline gap={3} align="center">
        <Skeleton variant="circle" width={48} height={48} />
        <Stack gap={2}>
          <Skeleton width={220} height={14} />
          <Skeleton width={160} height={14} animation="wave" />
          <Skeleton width={140} height={14} animation="none" size="sm" />
        </Stack>
      </Inline>
      <Skeleton variant="rect" height={140} animation="wave" />
      <Text variant="body-small" tone="muted">
        При prefers-reduced-motion анимация отключается на уровне CSS.
      </Text>
    </Stack>
  ),
};

export const LoadingCard: Story = {
  name: "Скелетон карточки",
  parameters: { controls: { disable: true } },
  render: () => (
    <Inline gap={4} wrap align="start">
      <Stack gap={3} style={{ flex: "1 1 18rem", maxWidth: "24rem" }}>
        <Text variant="label-small" tone="muted">Загрузка</Text>
        <Skeleton variant="rect" height={120} animation="wave" />
        <Skeleton width="70%" height={18} />
        <Skeleton lines={3} />
      </Stack>
      <Stack gap={3} style={{ flex: "1 1 18rem", maxWidth: "24rem" }}>
        <Text variant="label-small" tone="muted">Готово</Text>
        <Box background="surface-container" padding={4} radius="md">
          <Stack gap={2}>
            <Text variant="title-medium">Заголовок карточки</Text>
            <Text variant="body-small" tone="muted">
              Готовый контент занимает то же место, что и плейсхолдер.
            </Text>
          </Stack>
        </Box>
      </Stack>
    </Inline>
  ),
};
