import type { Meta, StoryObj } from "@storybook/html-vite";
import {
  Avatar,
  Badge,
  Box,
  Card,
  Inline,
  List,
  ListItem,
  Stack,
  Text,
  type BadgePosition,
  type BadgeVariant,
} from "@ivlev-dev/silent-ui";
import { silentStory } from "./silent-story.js";

/*
 * Autodocs строится вокруг `Badge`. Card/List/Avatar живут в собственных
 * story-файлах; здесь остаются ре-экспорты для тестов, а `excludeStories`
 * не даёт Storybook проиндексировать их повторно.
 */

const PORTRAIT =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='96' height='96'%3E%3Crect width='96' height='96' fill='%23cbd5f5'/%3E%3Ccircle cx='48' cy='38' r='16' fill='%23647ad6'/%3E%3Cpath d='M16 96c0-18 14-30 32-30s32 12 32 30z' fill='%23647ad6'/%3E%3C/svg%3E";

const BADGE_VARIANTS: readonly BadgeVariant[] = [
  "neutral",
  "primary",
  "accent",
  "success",
  "warning",
  "error",
  "info",
];

const POSITIONS: readonly BadgePosition[] = ["top-end", "top-start", "bottom-end", "bottom-start"];

interface BadgeArgs {
  readonly count: number;
  readonly max: number;
  readonly dot: boolean;
  readonly variant: BadgeVariant;
  readonly position: BadgePosition | "";
  readonly label: string;
  readonly decorative: boolean;
}

const meta = {
  title: "Components/Badge",
  tags: ["autodocs"],
  excludeStories: ["CardPlayground", "ListPlayground", "AvatarPlayground"],
  parameters: {
    docs: {
      description: {
        component: [
          "Бейдж-счётчик или точка. Значения больше `max` сворачиваются в `max+`.",
          "Без `label` точка и пустой бейдж декоративны (`aria-hidden`), чтобы не",
          "плодить «немые» узлы в дереве доступности. `position` размещает бейдж",
          "по углу ближайшего `position: relative` родителя.",
        ].join(" "),
      },
      canvas: { sourceState: "shown" },
    },
  },
  argTypes: {
    count: {
      control: { type: "range", min: 0, max: 150, step: 1 },
      description: "Число в бейдже",
      table: { defaultValue: { summary: "—" } },
    },
    max: {
      control: { type: "range", min: 1, max: 99, step: 1 },
      description: "Порог свёртки в `max+`",
      table: { defaultValue: { summary: "99" } },
    },
    dot: {
      control: "boolean",
      description: "Точка вместо счётчика",
      table: { defaultValue: { summary: "false" } },
    },
    variant: {
      control: "select",
      options: BADGE_VARIANTS,
      description: "Цветовая роль",
      table: { defaultValue: { summary: "neutral" } },
    },
    position: {
      control: "select",
      options: ["", ...POSITIONS],
      description: "Угол у relative-родителя; пусто — inline",
      table: { defaultValue: { summary: "—" } },
    },
    label: {
      control: "text",
      description: "Доступное имя (для точки обязательно)",
    },
    decorative: {
      control: "boolean",
      description: "Принудительно скрыть от скринридера",
      table: { defaultValue: { summary: "false" }, category: "Доступность" },
    },
  },
  args: {
    count: 12,
    max: 99,
    dot: false,
    variant: "primary",
    position: "",
    label: "Непрочитанные",
    decorative: false,
  },
} satisfies Meta<BadgeArgs>;

export default meta;

type Story = StoryObj<BadgeArgs>;

export const Playground: Story = {
  render: silentStory<BadgeArgs>((args) => (
    <Badge
      count={args.dot ? undefined : args.count}
      max={args.max}
      dot={args.dot}
      variant={args.variant}
      position={args.position === "" ? undefined : args.position}
      label={args.label === "" ? undefined : args.label}
      decorative={args.decorative}
    />
  )),
};

export const Counts: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Stack gap={4}>
      <Inline gap={6} align="center" wrap>
        <Inline gap={2} align="center">
          <Text>3</Text>
          <Badge count={3} />
        </Inline>
        <Inline gap={2} align="center">
          <Text>99</Text>
          <Badge count={99} variant="primary" />
        </Inline>
        <Inline gap={2} align="center">
          <Text>120 → 99+</Text>
          <Badge count={120} variant="error" />
        </Inline>
        <Inline gap={2} align="center">
          <Text>max=9</Text>
          <Badge count={42} max={9} variant="success" />
        </Inline>
      </Inline>
      <Inline gap={3} align="center" wrap>
        <Badge dot label="Новое" />
        <Badge dot variant="success" label="Онлайн" />
        <Badge dot variant="warning" label="Ожидает" />
        <Badge dot variant="error" label="Ошибка" />
        <Badge dot variant="info" label="Информация" />
        <Badge dot />
      </Inline>
      <Text variant="body-small" tone="muted">
        Точка без label декоративна: aria-hidden="true", без «немого» узла в дереве.
      </Text>
    </Stack>
  ),
};

export const Positions: Story = {
  name: "Positions",
  parameters: { controls: { disable: true } },
  render: () => (
    <Inline gap={6} wrap align="center">
      {POSITIONS.map((position) => (
        <Box
          background="surface-container"
          padding={4}
          radius="md"
          style={{ position: "relative", inlineSize: "6rem", textAlign: "center" }}
        >
          <Text variant="label-small">{position}</Text>
          <Badge count={5} variant="error" position={position} label={`${position}: 5`} />
        </Box>
      ))}
    </Inline>
  ),
};

export const Themes: Story = {
  name: "Light vs Dark",
  parameters: { controls: { disable: true } },
  render: silentStory(() => (
    <Stack gap={4} attrs={{ "data-theme": "light" }}>
      <Text variant="label-large">light</Text>
      <Inline gap={3} align="center">
        <Badge count={8} variant="primary" />
        <Badge count={120} variant="error" />
        <Avatar src={PORTRAIT} alt="Профиль" status="online" statusLabel="Онлайн" />
      </Inline>
      <Card variant="elevated" header="Светлая карточка" interactive>
        Поверхности и границы — на цветовых ролях.
      </Card>
      <List selectable divider attrs={{ "aria-label": "Строки списка, светлая тема" }}>
        <ListItem selected>Выбранная строка</ListItem>
        <ListItem selected={false}>Вторая строка</ListItem>
      </List>
      <Stack gap={4} attrs={{ "data-theme": "dark" }}>
        <Text variant="label-large">dark</Text>
        <Inline gap={3} align="center">
          <Badge count={8} variant="primary" />
          <Badge count={120} variant="error" />
          <Avatar src={PORTRAIT} alt="Профиль" status="busy" statusLabel="Занят" />
        </Inline>
        <Card variant="outlined" header="Тёмная карточка" interactive>
          Те же токены, другая палитра.
        </Card>
        <List selectable divider attrs={{ "aria-label": "Строки списка, тёмная тема" }}>
          <ListItem selected>Выбранная строка</ListItem>
          <ListItem selected={false}>Вторая строка</ListItem>
        </List>
      </Stack>
    </Stack>
  )),
};

export { Playground as CardPlayground } from "./card.stories.js";
export { Playground as ListPlayground } from "./list.stories.js";
export { Playground as AvatarPlayground } from "./avatar.stories.js";
