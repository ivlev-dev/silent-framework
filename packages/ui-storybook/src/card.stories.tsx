import type { Meta, StoryObj } from "@storybook/html-vite";
import { fn } from "storybook/test";
import {
  Avatar,
  Badge,
  Button,
  Card,
  Grid,
  Inline,
  List,
  ListItem,
  Stack,
  Text,
  type CardMediaAspect,
  type CardVariant,
  type SpacingStep,
} from "@ivlev-dev/silent-ui";
import { silentStory } from "./silent-story.js";

const PORTRAIT =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='96' height='96'%3E%3Crect width='96' height='96' fill='%23cbd5f5'/%3E%3Ccircle cx='48' cy='38' r='16' fill='%23647ad6'/%3E%3Cpath d='M16 96c0-18 14-30 32-30s32 12 32 30z' fill='%23647ad6'/%3E%3C/svg%3E";

interface CardArgs {
  readonly variant: CardVariant;
  readonly padding: SpacingStep;
  readonly interactive: boolean;
  readonly disabled: boolean;
  readonly header: string;
  readonly footer: string;
  readonly body: string;
  readonly mediaAspect: CardMediaAspect;
  readonly headerLines: 0 | 1 | 2 | 3;
  readonly showMedia: boolean;
  readonly onClick: (event: MouseEvent | KeyboardEvent) => void;
}

const meta = {
  title: "Components/Card",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: [
          "Карточка-контейнер: `variant` — поверхность и тень, `padding` — отступы.",
          "Интерактивность — ARIA-семантика кнопки на `div` (Enter/Space), поэтому",
          "внутрь можно класть ссылки и кнопки без вложенной интерактивности.",
        ].join(" "),
      },
      canvas: { sourceState: "shown" },
    },
  },
  argTypes: {
    variant: {
      control: "inline-radio",
      options: ["elevated", "filled", "outlined"],
      description: "Визуальный вариант",
      table: { defaultValue: { summary: "elevated" } },
    },
    padding: {
      control: { type: "range", min: 0, max: 8, step: 1 },
      description: "Внутренние отступы (медиа выходит к краям)",
      table: { defaultValue: { summary: "5" } },
    },
    interactive: {
      control: "boolean",
      description: "role=button + Enter/Space + состояние hover/pressed",
      table: { defaultValue: { summary: "false" } },
    },
    disabled: {
      control: "boolean",
      description: "Интерактивная карточка недоступна (`aria-disabled`)",
      table: { defaultValue: { summary: "false" } },
    },
    header: { control: "text", description: "Заголовок над телом" },
    footer: { control: "text", description: "Подвал карточки (метаданные, ссылки)" },
    body: { control: "text", description: "Тело карточки (children)" },
    mediaAspect: {
      control: "select",
      options: ["auto", "square", "video", "wide", "portrait"],
      description: "Пропорции медиа",
      table: { defaultValue: { summary: "auto" }, category: "Медиа" },
    },
    headerLines: {
      control: "inline-radio",
      options: [0, 1, 2, 3],
      description: "Обрезка заголовка по строкам (`0` — без обрезки)",
      table: { defaultValue: { summary: "0" }, category: "Медиа" },
    },
    showMedia: {
      control: "boolean",
      description: "Показать слот медиа",
      table: { defaultValue: { summary: "false" }, category: "Медиа" },
    },
    onClick: { action: "click", description: "Активация интерактивной карточки" },
  },
  args: {
    variant: "elevated",
    padding: 4,
    interactive: true,
    disabled: false,
    header: "Карточка",
    footer: "",
    body: "Кликабельная карточка использует ARIA-семантику кнопки, а не ссылку.",
    mediaAspect: "auto",
    headerLines: 0,
    showMedia: false,
    onClick: fn(),
  },
} satisfies Meta<CardArgs>;

export default meta;

type Story = StoryObj<CardArgs>;

export const Playground: Story = {
  render: silentStory<CardArgs>((args) => (
    <Card
      variant={args.variant}
      padding={args.padding}
      interactive={args.interactive}
      disabled={args.disabled}
      header={args.header}
      headerLines={args.headerLines === 0 ? undefined : args.headerLines}
      mediaAspect={args.mediaAspect}
      media={args.showMedia ? <img src={PORTRAIT} alt="Абстрактный портрет" /> : undefined}
      actions={<Text variant="label-small" tone="muted">Enter / Space</Text>}
      footer={args.footer === "" ? undefined : <Text variant="label-medium" tone="muted">{args.footer}</Text>}
      onClick={args.onClick}
    >
      {args.body}
    </Card>
  )),
};

export const Variants: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Grid columns={3} gap={4} min="md">
      <Card variant="elevated" header="Elevated" actions={<Button size="sm">Открыть</Button>}>
        Тень elevation-1, поверхность surface-container-low.
      </Card>
      <Card variant="filled" header="Filled">
        Плотный фон surface-container-highest без тени.
      </Card>
      <Card variant="outlined" header="Outlined">
        Граница outline-variant на поверхности surface.
      </Card>
    </Grid>
  ),
};

export const Media: Story = {
  name: "Media",
  parameters: { controls: { disable: true } },
  render: () => (
    <Grid columns={3} gap={4} min="lg">
      <Card
        variant="elevated"
        padding={0}
        media={<img src={PORTRAIT} alt="Абстрактный портрет" />}
        mediaAspect="wide"
        header="Широкое медиа"
        actions={
          <Inline gap={2}>
            <Button size="sm" variant="outlined">
              Отмена
            </Button>
            <Button size="sm">Сохранить</Button>
          </Inline>
        }
      >
        Медиа занимает всю ширину карточки.
      </Card>
      <Card
        variant="outlined"
        media={<img src={PORTRAIT} alt="Квадратное медиа" />}
        mediaAspect="square"
        header="Квадрат"
      >
        `mediaAspect="square"` держит пропорции 1:1.
      </Card>
      <Card variant="filled" header="Интерактивная" interactive>
        Нажмите Enter или Space, чтобы активировать. Внутренние кнопки не ломают
        семантику, потому что корень — div с role="button".
      </Card>
    </Grid>
  ),
};

export const Composition: Story = {
  name: "Card + List + Avatar",
  parameters: { controls: { disable: true } },
  render: () => (
    <Grid columns={2} gap={4} min="lg">
      <Card
        variant="elevated"
        header="Команда проекта"
        actions={
          <Inline gap={2} justify="end">
            <Button size="sm" variant="text">
              Пригласить
            </Button>
            <Button size="sm">Открыть</Button>
          </Inline>
        }
      >
        <List selectable divider attrs={{ "aria-label": "Участники проекта" }}>
          <ListItem
            selected
            leading={<Avatar size="sm" initials="АБ" status="online" statusLabel="Онлайн" />}
            trailing={<Badge count={4} />}
          >
            Анна Борисова
          </ListItem>
          <ListItem
            selected={false}
            leading={<Avatar size="sm" initials="ИП" status="away" statusLabel="Отошёл" />}
          >
            Иван Петров
          </ListItem>
          <ListItem
            selected={false}
            leading={<Avatar size="sm" initials="СМ" status="busy" statusLabel="Занят" />}
            trailing={<Badge dot variant="warning" label="Есть вопросы" />}
          >
            Сергей Максимов
          </ListItem>
        </List>
      </Card>
      <Card variant="outlined" header="Профиль">
        <Stack gap={3}>
          <Inline gap={3} align="center">
            <Avatar src={PORTRAIT} alt="Портрет Анны" size="xl" status="online" statusLabel="Онлайн" />
            <Stack gap={1}>
              <Text variant="title-medium">Анна Борисова</Text>
              <Text tone="muted" variant="body-small">Руководитель дизайн-системы</Text>
            </Stack>
          </Inline>
          <List dense divider>
            <ListItem trailing={<Badge count={12} variant="primary" />}>Задачи</ListItem>
            <ListItem trailing={<Badge count={3} variant="warning" />}>Ревью</ListItem>
            <ListItem trailing={<Badge dot variant="success" label="Онлайн" />}>Доступность</ListItem>
          </List>
        </Stack>
      </Card>
    </Grid>
  ),
};

export const WithFooter: Story = {
  name: "С подвалом",
  args: {
    header: "Отчёт за ноябрь",
    body: "Сводка по команде: 24 задачи закрыты, 3 в работе.",
    footer: "Обновлено сегодня в 12:40",
    interactive: false,
  },
  render: silentStory<CardArgs>((args) => (
    <Card
      variant={args.variant}
      padding={args.padding}
      header={args.header}
      footer={<Text variant="label-medium" tone="muted">{args.footer}</Text>}
      actions={<Button size="sm">Открыть</Button>}
    >
      {args.body}
    </Card>
  )),
};
