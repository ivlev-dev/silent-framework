import type { Meta, StoryObj } from "@storybook/html-vite";
import { fn } from "storybook/test";
import {
  ArrowForwardIcon,
  Button,
  CheckIcon,
  CloseIcon,
  Heading,
  IconButton,
  Inline,
  Stack,
  Text,
  type ButtonSize,
  type ButtonType,
  type ButtonVariant,
} from "@ivlev-dev/silent-ui";
import { silentStory } from "./silent-story.js";

const VARIANTS: readonly ButtonVariant[] = [
  "filled",
  "accent",
  "tonal",
  "outlined",
  "text",
  "elevated",
];

interface ButtonArgs {
  readonly variant: ButtonVariant;
  readonly size: ButtonSize;
  readonly label: string;
  readonly type: ButtonType;
  readonly loading: boolean;
  readonly disabled: boolean;
  readonly fullWidth: boolean;
  readonly showLeading: boolean;
  readonly showTrailing: boolean;
  readonly onClick: (event: MouseEvent) => void;
}

const meta = {
  title: "Components/Button",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: [
          "Кнопка дизайн-системы: один корневой `<button>`, вариант и размер —",
          "`data-*`-атрибуты, состояние — нативные `disabled`/`:focus-visible`.",
          "`loading` блокирует нажатия, ставит `aria-busy` и подменяет `leading`",
          "спиннером, сохраняя ширину слота. `accent` — mist-CTA бренда.",
        ].join(" "),
      },
      canvas: { sourceState: "shown" },
    },
  },
  argTypes: {
    variant: {
      control: "select",
      options: VARIANTS,
      description: "Визуальный вариант: filled/accent/tonal/outlined/text/elevated",
      table: { defaultValue: { summary: "filled" } },
    },
    size: {
      control: "inline-radio",
      options: ["sm", "md", "lg"],
      description: "Размер: высота контрола и типографика подписи",
      table: { defaultValue: { summary: "md" } },
    },
    label: {
      control: "text",
      description: "Текст кнопки (слот children), при переполнении — ellipsis",
    },
    type: {
      control: "select",
      options: ["button", "submit", "reset"],
      description: "Нативный `type`",
      table: { defaultValue: { summary: "button" } },
    },
    loading: {
      control: "boolean",
      description: "Спиннер + `aria-busy` + блокировка нажатий",
      table: { defaultValue: { summary: "false" } },
    },
    disabled: {
      control: "boolean",
      description: "Недоступна (нативный `disabled`)",
      table: { defaultValue: { summary: "false" } },
    },
    fullWidth: {
      control: "boolean",
      description: "На всю ширину контейнера",
      table: { defaultValue: { summary: "false" } },
    },
    showLeading: {
      control: "boolean",
      description: "Слот `leading` (иконка перед подписью)",
      table: { defaultValue: { summary: "false" }, category: "Слоты" },
    },
    showTrailing: {
      control: "boolean",
      description: "Слот `trailing` (иконка после подписи)",
      table: { defaultValue: { summary: "false" }, category: "Слоты" },
    },
    onClick: {
      action: "click",
      description: "Клик; не вызывается при `disabled`/`loading`",
    },
  },
  args: {
    variant: "filled",
    size: "md",
    label: "Сохранить",
    type: "button",
    loading: false,
    disabled: false,
    fullWidth: false,
    showLeading: false,
    showTrailing: false,
    onClick: fn(),
  },
} satisfies Meta<ButtonArgs>;

export default meta;

type Story = StoryObj<ButtonArgs>;

const render = silentStory<ButtonArgs>((args) => (
  <Button
    variant={args.variant}
    size={args.size}
    type={args.type}
    loading={args.loading}
    disabled={args.disabled}
    fullWidth={args.fullWidth}
    leading={args.showLeading ? <CheckIcon /> : undefined}
    trailing={args.showTrailing ? <ArrowForwardIcon /> : undefined}
    onClick={args.onClick}
  >
    {args.label}
  </Button>
));

export const Playground: Story = { render };

export const Variants: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Stack gap={4}>
      <Inline gap={3} wrap align="center">
        {VARIANTS.map((variant) => (
          <Button variant={variant}>{variant}</Button>
        ))}
      </Inline>
      <Text tone="muted" variant="body-small">
        Все варианты используют один корневой элемент и data-атрибуты, поэтому
        переключаются без перерисовки структуры.
      </Text>
    </Stack>
  ),
};

export const Sizes: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Stack gap={4}>
      <Inline gap={3} align="center" wrap>
        <Button size="sm">Small</Button>
        <Button size="md">Medium</Button>
        <Button size="lg">Large</Button>
      </Inline>
      <Inline gap={3} align="center" wrap>
        <Button size="sm" leading={<CheckIcon />}>
          Small
        </Button>
        <Button size="md" leading={<CheckIcon />}>
          Medium
        </Button>
        <Button size="lg" leading={<CheckIcon />}>
          Large
        </Button>
      </Inline>
    </Stack>
  ),
};

export const WithIcons: Story = {
  parameters: {
    controls: { disable: true },
    docs: {
      description: {
        story: "Слоты `leading`/`trailing` принимают любой узел.",
      },
    },
  },
  render: () => (
    <Inline gap={3} wrap>
      <Button leading={<CheckIcon />}>Подтвердить</Button>
      <Button variant="tonal" trailing={<CloseIcon />}>
        Отклонить
      </Button>
      <Button variant="accent" leading={<ArrowForwardIcon />} trailing={<ArrowForwardIcon />}>
        Дальше
      </Button>
      <IconButton label="Закрыть">
        <CloseIcon />
      </IconButton>
    </Inline>
  ),
};

export const States: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Stack gap={4}>
      <Inline gap={3} wrap>
        <Button>Обычная</Button>
        <Button loading>Загрузка</Button>
        <Button disabled>Недоступна</Button>
      </Inline>
      <Inline gap={3} wrap>
        <Button variant="outlined" loading>
          Загрузка
        </Button>
        <Button variant="outlined" disabled>
          Недоступна
        </Button>
        <Button variant="text" disabled>
          Text disabled
        </Button>
      </Inline>
      <Inline gap={3} wrap>
        <Button variant="accent" loading>
          Оплата
        </Button>
        <Button variant="accent" disabled>
          Оплата
        </Button>
      </Inline>
      <Text tone="muted" variant="body-small">
        В состоянии loading кнопка получает `aria-busy="true"` и `disabled`; ширина
        не прыгает — спиннер занимает слот leading.
      </Text>
    </Stack>
  ),
};

export const FocusRing: Story = {
  name: "Focus ring",
  parameters: { controls: { disable: true } },
  render: silentStory(() => (
    <Inline gap={3} wrap>
      <Button
        ref={(node) => {
          if (node instanceof HTMLElement) node.focus();
        }}
      >
        В фокусе
      </Button>
      <Button variant="outlined">Соседняя</Button>
    </Inline>
  )),
};

export const LongLabel: Story = {
  name: "Long label / ellipsis",
  parameters: { controls: { disable: true } },
  render: () => (
    <Stack gap={4}>
      <Button>Опубликовать изменения и уведомить всех участников проекта</Button>
      <Button variant="tonal" fullWidth>
        Опубликовать изменения и уведомить всех участников проекта
      </Button>
      <Inline gap={3}>
        <Button size="sm">Очень длинная подпись маленькой кнопки</Button>
        <Button size="lg">Крупная кнопка с длинной подписью</Button>
      </Inline>
    </Stack>
  ),
};

export const FullWidth: Story = {
  args: { variant: "tonal", fullWidth: true, label: "На всю ширину" },
  render,
};

export const ThemeContrast: Story = {
  name: "Light vs Dark",
  parameters: { controls: { disable: true } },
  render: () => (
    <Stack gap={4}>
      <Stack gap={3} attrs={{ "data-theme": "light" }}>
        <Text variant="label-large">light</Text>
        <Inline gap={3} wrap>
          {VARIANTS.map((variant) => (
            <Button variant={variant}>{variant}</Button>
          ))}
        </Inline>
      </Stack>
      <Stack gap={3} attrs={{ "data-theme": "dark" }}>
        <Text variant="label-large">dark</Text>
        <Inline gap={3} wrap>
          {VARIANTS.map((variant) => (
            <Button variant={variant}>{variant}</Button>
          ))}
        </Inline>
      </Stack>
    </Stack>
  ),
};

export const InContext: Story = {
  name: "В форме",
  parameters: { controls: { disable: true } },
  render: () => (
    <Stack gap={4} style={{ maxWidth: "32rem" }}>
      <Heading level={3}>Опубликовать статью</Heading>
      <Text tone="muted" variant="body-small">
        Черновик сохранён 5 минут назад.
      </Text>
      <Inline gap={3} justify="end" wrap>
        <Button variant="text">Отмена</Button>
        <Button variant="outlined">Сохранить черновик</Button>
        <Button variant="accent">Опубликовать</Button>
      </Inline>
    </Stack>
  ),
};
