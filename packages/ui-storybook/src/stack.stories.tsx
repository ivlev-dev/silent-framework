import type { Meta, StoryObj } from "@storybook/html-vite";
import {
  Box,
  Stack,
  Text,
  type SpacingStep,
} from "@ivlev-dev/silent-ui";
import { silentStory } from "./silent-story.js";

type AlignItems = "stretch" | "start" | "center" | "end" | "baseline";
type JustifyContent = "start" | "center" | "end" | "between" | "around" | "evenly";

const ALIGN: readonly AlignItems[] = ["stretch", "start", "center", "end", "baseline"];
const JUSTIFY: readonly JustifyContent[] = ["start", "center", "end", "between", "around", "evenly"];

interface StackArgs {
  readonly gap: SpacingStep;
  readonly align: AlignItems;
  readonly justify: JustifyContent;
  readonly count: number;
  readonly filled: boolean;
}

const meta = {
  title: "Foundations/Layout/Stack",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: [
          "Вертикальный поток на flex-column. `gap` — шаг шкалы отступов,",
          "`align`/`justify` — выравнивание поперечной и основной оси.",
          "Стек не задаёт размеры детей: высоту определяет содержимое.",
        ].join(" "),
      },
      canvas: { sourceState: "shown" },
    },
  },
  argTypes: {
    gap: {
      control: { type: "range", min: 0, max: 10, step: 1 },
      description: "Отступ между детьми",
      table: { defaultValue: { summary: "0" } },
    },
    align: {
      control: "select",
      options: ALIGN,
      description: "Выравнивание по поперечной оси",
      table: { defaultValue: { summary: "stretch" } },
    },
    justify: {
      control: "select",
      options: JUSTIFY,
      description: "Распределение по основной оси",
      table: { defaultValue: { summary: "start" } },
    },
    count: {
      control: { type: "range", min: 1, max: 6, step: 1 },
      description: "Количество блоков-демо",
      table: { defaultValue: { summary: "3" } },
    },
    filled: {
      control: "boolean",
      description: "Растянуть блоки на всю ширину (stretch)",
      table: { defaultValue: { summary: "false" } },
    },
  },
  args: { gap: 3, align: "stretch", justify: "start", count: 3, filled: false },
} satisfies Meta<StackArgs>;

export default meta;

type Story = StoryObj<StackArgs>;

const BLOCKS = ["Заголовок", "Основной текст", "Подпись", "Действия", "Метаданные", "Подвал"];

export const Playground: Story = {
  render: silentStory<StackArgs>((args) => (
    <Box background="surface-container-low" padding={3} radius="md" style={{ minHeight: "18rem" }}>
      <Stack gap={args.gap} align={args.align} justify={args.justify} style={{ minHeight: "16rem" }}>
        {BLOCKS.slice(0, args.count).map((label, index) => (
          <Box
            background={index % 2 === 0 ? "primary-container" : "secondary-container"}
            padding={2}
            radius="sm"
            style={args.filled ? { inlineSize: "100%" } : undefined}
          >
            <Text variant="label-large">{label}</Text>
          </Box>
        ))}
      </Stack>
    </Box>
  )),
};

export const AlignmentMatrix: Story = {
  name: "align × justify",
  parameters: { controls: { disable: true } },
  render: () => (
    <Stack gap={4}>
      {ALIGN.map((align) => (
        <Box padding={3} background="surface-container-low" radius="md">
          <Stack gap={2}>
            <Text variant="label-small" tone="muted">{`align="${align}"`}</Text>
            <Stack gap={2} align={align} style={{ minHeight: "5rem" }}>
              <Box padding={2} background="primary-container" radius="sm">
                <Text variant="label-small">Один</Text>
              </Box>
              <Box padding={2} background="secondary-container" radius="sm">
                <Text variant="label-small">Два (выше)</Text>
              </Box>
            </Stack>
          </Stack>
        </Box>
      ))}
    </Stack>
  ),
};

export const JustifyMatrix: Story = {
  name: "justify",
  parameters: { controls: { disable: true } },
  render: () => (
    <Stack gap={3}>
      {JUSTIFY.map((justify) => (
        <Box padding={3} background="surface-container" radius="md">
          <Stack gap={2}>
            <Text variant="label-small" tone="muted">{`justify="${justify}"`}</Text>
            <Stack gap={2} justify={justify} style={{ minHeight: "8rem" }}>
              <Box padding={2} background="primary-container" radius="sm">
                <Text variant="label-small">Первый</Text>
              </Box>
              <Box padding={2} background="tertiary-container" radius="sm">
                <Text variant="label-small">Второй</Text>
              </Box>
            </Stack>
          </Stack>
        </Box>
      ))}
    </Stack>
  ),
};

export const PageShell: Story = {
  name: "Композиция страницы",
  parameters: { controls: { disable: true } },
  render: () => (
    <Box background="surface" padding={4} radius="lg" border="outline-variant" style={{ maxWidth: "40rem" }}>
      <Stack gap={4}>
        <Stack gap={1}>
          <Text variant="title-medium">Настройки уведомлений</Text>
          <Text tone="muted" variant="body-small">
            Изменения применяются сразу.
          </Text>
        </Stack>
        <Stack gap={2}>
          <Box padding={3} background="surface-container-low" radius="md">
            <Text>Email</Text>
          </Box>
          <Box padding={3} background="surface-container-low" radius="md">
            <Text>Push</Text>
          </Box>
          <Box padding={3} background="surface-container-low" radius="md">
            <Text>SMS</Text>
          </Box>
        </Stack>
      </Stack>
    </Box>
  ),
};
