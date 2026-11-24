import type { Meta, StoryObj } from "@storybook/html-vite";
import { fn } from "storybook/test";
import {
  Alert,
  Button,
  CheckIcon,
  Inline,
  Progress,
  Skeleton,
  Stack,
  Surface,
  Text,
  type AlertRole,
  type AlertVariant,
} from "@ivlev-dev/silent-ui";
import { silentStory } from "./silent-story.js";

/*
 * Autodocs строится вокруг `Alert`. Отдельные компоненты обратной связи живут
 * в собственных story-файлах (`progress.stories.tsx`, `skeleton.stories.tsx`);
 * здесь остаются только ре-экспорты для тестов — `excludeStories` не даёт
 * Storybook проиндексировать их повторно.
 */

interface AlertArgs {
  readonly variant: AlertVariant;
  readonly title: string;
  readonly message: string;
  readonly dismissible: boolean;
  readonly closeLabel: string;
  readonly role: AlertRole | "";
  readonly showActions: boolean;
  readonly customIcon: boolean;
  readonly onClose: (event: MouseEvent) => void;
}

const meta = {
  title: "Components/Alert",
  tags: ["autodocs"],
  excludeStories: ["ProgressPlayground", "SkeletonPlayground"],
  parameters: {
    docs: {
      description: {
        component: [
          "Уведомление с одним корнем: `variant` — `data-variant`, роль объявления",
          "выводится из варианта (`status` у info/success, `alert` у warning/error).",
          "Иконка декоративная, `dismissible` добавляет кнопку с RU-подписью из",
          "`UiConfigProvider` или `closeLabel`.",
        ].join(" "),
      },
      canvas: { sourceState: "shown" },
    },
  },
  argTypes: {
    variant: {
      control: "select",
      options: ["info", "success", "warning", "error"],
      description: "Тон и роль объявления (status/alert)",
      table: { defaultValue: { summary: "info" } },
    },
    title: { control: "text", description: "Заголовок" },
    message: { control: "text", description: "Текст сообщения (слот children)" },
    dismissible: {
      control: "boolean",
      description: "Кнопка «Закрыть»",
      table: { defaultValue: { summary: "false" } },
    },
    closeLabel: {
      control: "text",
      description: "Доступное имя кнопки закрытия",
      table: { category: "Доступность" },
    },
    role: {
      control: "select",
      options: ["", "status", "alert"],
      description: "Переопределение роли; по умолчанию выводится из variant",
      table: { category: "Доступность" },
    },
    showActions: {
      control: "boolean",
      description: "Слот действий под сообщением",
      table: { defaultValue: { summary: "false" }, category: "Слоты" },
    },
    customIcon: {
      control: "boolean",
      description: "Своя иконка вместо иконки варианта",
      table: { defaultValue: { summary: "false" }, category: "Слоты" },
    },
    onClose: { action: "close", description: "Закрытие по кнопке" },
  },
  args: {
    variant: "info",
    title: "Черновик сохранён",
    message: "Изменения можно опубликовать позже.",
    dismissible: true,
    closeLabel: "Закрыть",
    role: "",
    showActions: false,
    customIcon: false,
    onClose: fn(),
  },
} satisfies Meta<AlertArgs>;

export default meta;

type Story = StoryObj<AlertArgs>;

const renderAlert = silentStory<AlertArgs>((args) => (
  <Alert
    variant={args.variant}
    title={args.title}
    dismissible={args.dismissible}
    closeLabel={args.closeLabel === "" ? undefined : args.closeLabel}
    role={args.role === "" ? undefined : args.role}
    icon={args.customIcon ? <CheckIcon /> : undefined}
    actions={
      args.showActions ? (
        <Inline gap={2} wrap>
          <Button size="sm" variant="tonal">
            Продлить
          </Button>
          <Button size="sm" variant="text">
            Выйти
          </Button>
        </Inline>
      ) : undefined
    }
    onClose={args.onClose}
  >
    {args.message}
  </Alert>
));

export const Playground: Story = { render: renderAlert };

export const Variants: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Stack gap={3}>
      <Alert variant="info" title="Информация">
        Нейтральное сообщение о состоянии интерфейса.
      </Alert>
      <Alert variant="success" title="Готово">
        Данные успешно сохранены.
      </Alert>
      <Alert variant="warning" title="Проверьте данные">
        Некоторые поля заполнены не полностью.
      </Alert>
      <Alert variant="error" title="Ошибка">
        Не удалось отправить форму. Повторите попытку.
      </Alert>
      <Text variant="body-small" tone="muted">
        role="status" у info/success, role="alert" у warning/error.
      </Text>
    </Stack>
  ),
};

export const WithActions: Story = {
  name: "Actions",
  parameters: { controls: { disable: true } },
  render: () => (
    <Alert
      variant="warning"
      title="Сессия истекает"
      dismissible
      actions={
        <Inline gap={2} wrap>
          <Button size="sm" variant="tonal">
            Продлить
          </Button>
          <Button size="sm" variant="text">
            Выйти
          </Button>
        </Inline>
      }
    >
      Через 5 минут потребуется повторный вход.
    </Alert>
  ),
};

export const LongContent: Story = {
  name: "Длинный текст",
  parameters: { controls: { disable: true } },
  render: () => (
    <Stack gap={4}>
      {(["22rem", "100%"] as const).map((width) => (
        <Stack gap={2} style={width === "100%" ? undefined : { maxWidth: width }}>
          <Text variant="label-small" tone="muted">{width}</Text>
          <Alert variant="error" title="Не удалось синхронизировать документ" dismissible>
            Сервер вернул ошибку 503 при сохранении версии. Локальная копия осталась
            в браузере и будет отправлена повторно, как только соединение
            восстановится.
          </Alert>
        </Stack>
      ))}
    </Stack>
  ),
};

export const CustomIcon: Story = {
  name: "Своя иконка",
  parameters: { controls: { disable: true } },
  render: () => (
    <Stack gap={3}>
      <Alert variant="success" title="Проверено" icon={<CheckIcon />}>
        Иконка переопределена, роль объявления осталась от варианта.
      </Alert>
      <Alert variant="info" title="Подсказка" icon={<CheckIcon label="Совет" />}>
        Иконка может быть интерактивной по смыслу — тогда ей нужен label.
      </Alert>
    </Stack>
  ),
};

export const Themes: StoryObj<Record<string, never>> = {
  name: "Light vs Dark",
  parameters: { controls: { disable: true } },
  render: silentStory(() => {
    const panels = [
      {
        theme: "light",
        title: "light",
        variant: "success" as AlertVariant,
        heading: "Светлая тема",
        note: "Контейнерные роли сохраняют контраст.",
      },
      {
        theme: "dark",
        title: "dark",
        variant: "error" as AlertVariant,
        heading: "Тёмная тема",
        note: "Те же токены, другая палитра.",
      },
    ];

    return (
      <div class="alert-themes">
        <style>{`
          .alert-themes {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(min(100%, 20rem), 1fr));
            align-items: stretch;
            gap: var(--sui-space-5);
            inline-size: 100%;
            min-inline-size: 0;
          }

          .alert-themes__panel {
            display: flex;
            flex-direction: column;
            min-inline-size: 0;
            max-inline-size: 100%;
          }
        `}</style>
        {panels.map((panel) => (
          <Surface
            key={panel.theme}
            class="alert-themes__panel"
            tone="surface"
            padding={5}
            radius="lg"
            border="outline-variant"
            attrs={{ "data-theme": panel.theme }}
          >
            <Stack gap={4}>
              <Text variant="label-large">{panel.title}</Text>
              <Alert variant={panel.variant} title={panel.heading} dismissible>
                {panel.note}
              </Alert>
              <Progress value={60} label={panel.heading} showValue />
              <Skeleton lines={2} />
            </Stack>
          </Surface>
        ))}
      </div>
    );
  }),
};

export { Playground as ProgressPlayground } from "./progress.stories.js";
export { Playground as SkeletonPlayground } from "./skeleton.stories.js";
