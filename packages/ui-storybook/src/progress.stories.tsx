import type { Meta, StoryObj } from "@storybook/html-vite";
import {
  Inline,
  Progress,
  Stack,
  Text,
  type ProgressSize,
  type ProgressVariant,
} from "@ivlev-dev/silent-ui";
import { silentStory } from "./silent-story.js";

interface ProgressArgs {
  readonly variant: ProgressVariant;
  readonly size: ProgressSize;
  readonly value: number;
  readonly determinate: boolean;
  readonly label: string;
  readonly showValue: boolean;
}

const meta = {
  title: "Components/Progress",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: [
          "Индикатор выполнения: `value` вне `0..100` зажимается, отсутствие",
          "значения включает indeterminate-режим (без `aria-valuenow`).",
          "`label` — видимая и доступная подпись, `showValue` показывает процент",
          "только для определённого значения.",
        ].join(" "),
      },
      canvas: { sourceState: "shown" },
    },
  },
  argTypes: {
    variant: {
      control: "inline-radio",
      options: ["linear", "circular"],
      description: "Форма индикатора",
      table: { defaultValue: { summary: "linear" } },
    },
    size: {
      control: "inline-radio",
      options: ["sm", "md", "lg"],
      description: "Толщина/диаметр",
      table: { defaultValue: { summary: "md" } },
    },
    value: {
      control: { type: "range", min: 0, max: 100, step: 1 },
      description: "Процент выполнения",
      table: { defaultValue: { summary: "40" } },
    },
    determinate: {
      control: "boolean",
      description: "Выключить — indeterminate",
      table: { defaultValue: { summary: "true" } },
    },
    label: {
      control: "text",
      description: "Видимая и доступная подпись",
      table: { category: "Доступность" },
    },
    showValue: {
      control: "boolean",
      description: "Показывать процент рядом с подписью",
      table: { defaultValue: { summary: "true" } },
    },
  },
  args: {
    variant: "linear",
    size: "md",
    value: 40,
    determinate: true,
    label: "Загрузка файла",
    showValue: true,
  },
} satisfies Meta<ProgressArgs>;

export default meta;

type Story = StoryObj<ProgressArgs>;

export const Playground: Story = {
  render: silentStory<ProgressArgs>((args) => (
    <Progress
      variant={args.variant}
      size={args.size}
      value={args.determinate ? args.value : undefined}
      label={args.label}
      showValue={args.showValue}
    />
  )),
};

export const States: Story = {
  name: "States",
  parameters: { controls: { disable: true } },
  render: () => (
    <Stack gap={5}>
      <Progress value={25} label="25%" showValue />
      <Progress value={75} label="75%" showValue size="lg" />
      <Progress value={100} label="Готово" showValue />
      <Progress label="Ожидание ответа" />
      <Inline gap={5} align="center">
        <Progress variant="circular" value={30} label="30%" showValue />
        <Progress variant="circular" size="sm" value={60} label="60%" />
        <Progress variant="circular" size="lg" label="Круговой indeterminate" />
      </Inline>
      <Text tone="muted" variant="body-small">
        При `prefers-reduced-motion` анимация indeterminate-режима отключается.
      </Text>
    </Stack>
  ),
};

export const InCard: Story = {
  name: "В карточке",
  parameters: { controls: { disable: true } },
  render: () => (
    <Stack gap={3} style={{ maxWidth: "26rem" }}>
      <Inline gap={2} justify="between" align="center">
        <Text variant="label-large">Экспорт данных</Text>
        <Text tone="muted" variant="label-small">3 из 5</Text>
      </Inline>
      <Progress value={60} label="Экспорт данных" />
      <Progress value={60} label="Экспорт данных" variant="circular" size="sm" showValue />
    </Stack>
  ),
};
