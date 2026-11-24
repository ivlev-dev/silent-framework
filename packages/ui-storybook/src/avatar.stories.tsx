import type { Meta, StoryObj } from "@storybook/html-vite";
import {
  Avatar,
  Inline,
  Stack,
  Text,
  type AvatarShape,
  type AvatarSize,
  type AvatarStatus,
} from "@ivlev-dev/silent-ui";
import { silentStory } from "./silent-story.js";

const PORTRAIT =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='96' height='96'%3E%3Crect width='96' height='96' fill='%23cbd5f5'/%3E%3Ccircle cx='48' cy='38' r='16' fill='%23647ad6'/%3E%3Cpath d='M16 96c0-18 14-30 32-30s32 12 32 30z' fill='%23647ad6'/%3E%3C/svg%3E";

interface AvatarArgs {
  readonly kind: "image" | "initials" | "icon";
  readonly size: AvatarSize;
  readonly shape: AvatarShape;
  readonly status: "none" | AvatarStatus;
  readonly statusLabel: string;
  readonly initials: string;
}

const meta = {
  title: "Components/Avatar",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: [
          "Аватар с fallback-цепочкой: изображение → инициалы → иконка. Размер,",
          "форма и точка статуса — `data-*`. Без `statusLabel` точка декоративна;",
          "для fallback-вариантов `alt` становится доступным именем.",
        ].join(" "),
      },
      canvas: { sourceState: "shown" },
    },
  },
  argTypes: {
    kind: {
      control: "inline-radio",
      options: ["image", "initials", "icon"],
      description: "Источник аватара",
      table: { defaultValue: { summary: "image" } },
    },
    size: {
      control: "inline-radio",
      options: ["sm", "md", "lg", "xl"],
      description: "Размер",
      table: { defaultValue: { summary: "md" } },
    },
    shape: {
      control: "inline-radio",
      options: ["circle", "square"],
      description: "Форма",
      table: { defaultValue: { summary: "circle" } },
    },
    status: {
      control: "select",
      options: ["none", "online", "offline", "away", "busy"],
      description: "Точка статуса",
      table: { defaultValue: { summary: "none" } },
    },
    statusLabel: {
      control: "text",
      description: "Подпись статуса для скринридера",
      table: { category: "Доступность" },
    },
    initials: { control: "text", description: "Инициалы для fallback" },
  },
  args: {
    kind: "image",
    size: "lg",
    shape: "circle",
    status: "online",
    statusLabel: "Онлайн",
    initials: "АБ",
  },
} satisfies Meta<AvatarArgs>;

export default meta;

type Story = StoryObj<AvatarArgs>;

export const Playground: Story = {
  render: silentStory<AvatarArgs>((args) => (
    <Avatar
      src={args.kind === "image" ? PORTRAIT : undefined}
      alt={args.kind === "image" ? "Портрет" : "Профиль"}
      initials={args.kind === "initials" ? args.initials : undefined}
      size={args.size}
      shape={args.shape}
      status={args.status === "none" ? undefined : args.status}
      statusLabel={
        args.status === "none" || args.statusLabel === "" ? undefined : args.statusLabel
      }
    />
  )),
};

export const Sizes: Story = {
  name: "Sizes & fallbacks",
  parameters: { controls: { disable: true } },
  render: () => (
    <Stack gap={5}>
      <Inline gap={3} align="center">
        <Avatar src={PORTRAIT} alt="Портрет" size="sm" />
        <Avatar src={PORTRAIT} alt="Портрет" size="md" />
        <Avatar src={PORTRAIT} alt="Портрет" size="lg" />
        <Avatar src={PORTRAIT} alt="Портрет" size="xl" status="online" statusLabel="Онлайн" />
      </Inline>
      <Inline gap={3} align="center">
        <Avatar initials="АБ" size="sm" />
        <Avatar initials="ИП" size="md" shape="square" />
        <Avatar size="lg" status="away" statusLabel="Отошёл" />
        <Avatar size="xl" shape="square" status="busy" statusLabel="Занят" />
        <Avatar size="lg" status="offline" statusLabel="Не в сети" />
      </Inline>
      <Text variant="body-small" tone="muted">
        Порядок fallback: изображение → инициалы → иконка. Точка статуса без
        statusLabel декоративна.
      </Text>
    </Stack>
  ),
};
