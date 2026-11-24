import type { Meta, StoryObj } from "@storybook/html-vite";
import {
  Box,
  Button,
  Inline,
  Spinner,
  Stack,
  Text,
  type SpinnerSize,
} from "@ivlev-dev/silent-ui";
import { silentStory } from "./silent-story.js";

interface SpinnerArgs {
  readonly size: SpinnerSize;
  readonly label: string;
}

const meta = {
  title: "Components/Spinner",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: [
          "Индикатор неопределённой загрузки: `role=\"progressbar\"` и доступное имя",
          "из `label` или строки `loading` в `UiConfigProvider`. Анимация кольца",
          "останавливается при `prefers-reduced-motion`; размер — `sm`/`md`/`lg`.",
        ].join(" "),
      },
      canvas: { sourceState: "shown" },
    },
  },
  argTypes: {
    size: {
      control: "inline-radio",
      options: ["sm", "md", "lg"],
      description: "Размер кольца",
      table: { defaultValue: { summary: "md" } },
    },
    label: {
      control: "text",
      description: "Доступное имя; пусто — берётся строка `loading` из конфига",
    },
  },
  args: { size: "md", label: "Загрузка" },
} satisfies Meta<SpinnerArgs>;

export default meta;

type Story = StoryObj<SpinnerArgs>;

export const Playground: Story = {
  render: silentStory<SpinnerArgs>((args) => (
    <Inline gap={3} align="center">
      <Spinner size={args.size} label={args.label === "" ? undefined : args.label} />
      <Text tone="muted" variant="body-small">
        {args.label === "" ? "Подпись из UiConfigProvider" : args.label}
      </Text>
    </Inline>
  )),
};

export const Sizes: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Inline gap={5} align="center">
      <Inline gap={2} align="center">
        <Spinner size="sm" />
        <Text variant="label-small" tone="muted">sm</Text>
      </Inline>
      <Inline gap={2} align="center">
        <Spinner size="md" />
        <Text variant="label-small" tone="muted">md</Text>
      </Inline>
      <Inline gap={2} align="center">
        <Spinner size="lg" />
        <Text variant="label-small" tone="muted">lg</Text>
      </Inline>
    </Inline>
  ),
};

export const InButton: Story = {
  name: "В кнопке",
  parameters: { controls: { disable: true } },
  render: () => (
    <Inline gap={3} wrap align="center">
      <Button loading>Сохранить</Button>
      <Button variant="outlined" loading>
        Отправить
      </Button>
      <Button variant="tonal" loading={false}>
        <Inline gap={2} align="center">
          <Spinner size="sm" label="Синхронизация" />
          <Text variant="label-large">Синхронизация</Text>
        </Inline>
      </Button>
    </Inline>
  ),
};

export const LoadingRegion: Story = {
  name: "Область загрузки",
  parameters: { controls: { disable: true } },
  render: () => (
    <Box
      background="surface-container-low"
      padding={5}
      radius="lg"
      attrs={{ "aria-busy": "true" }}
      style={{ maxWidth: "24rem" }}
    >
      <Stack gap={3} align="center">
        <Spinner size="lg" label="Загружаем профиль" />
        <Text variant="label-large">Загружаем профиль…</Text>
        <Text tone="muted" variant="body-small" align="center">
          Контейнер помечен `aria-busy="true"` до окончания запроса.
        </Text>
      </Stack>
    </Box>
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
          style={{ flex: "1 1 14rem" }}
        >
          <Stack gap={3} align="center">
            <Text variant="label-large">{theme}</Text>
            <Inline gap={3} align="center">
              <Spinner size="sm" />
              <Spinner size="md" />
              <Spinner size="lg" />
            </Inline>
            <Text tone="muted" variant="body-small" align="center">
              Кольцо использует primary-роль темы.
            </Text>
          </Stack>
        </Box>
      ))}
    </Inline>
  ),
};
