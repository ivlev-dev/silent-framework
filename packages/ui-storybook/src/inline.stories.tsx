import type { Meta, StoryObj } from "@storybook/html-vite";
import {
  Box,
  Inline,
  Stack,
  Text,
  type SpacingStep,
} from "@ivlev-dev/silent-ui";
import { silentStory } from "./silent-story.js";

type AlignItems = "stretch" | "start" | "center" | "end" | "baseline";
type JustifyContent = "start" | "center" | "end" | "between" | "around" | "evenly";

const ALIGN: readonly AlignItems[] = ["stretch", "start", "center", "end", "baseline"];
const JUSTIFY: readonly JustifyContent[] = ["start", "center", "end", "between", "around", "evenly"];
const TAGS = [
  "Дизайн-система",
  "Токены",
  "Темы",
  "Доступность",
  "SSR",
  "Компилятор",
  "Storybook",
  "Тесты",
  "4K",
  "Плотность",
];

interface InlineArgs {
  readonly gap: SpacingStep;
  readonly align: AlignItems;
  readonly justify: JustifyContent;
  readonly wrap: boolean;
  readonly count: number;
}

const meta = {
  title: "Foundations/Layout/Inline",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: [
          "Горизонтальный поток на flex-row для кнопок, чипов и метаданных.",
          "`wrap` разрешает перенос строк, `align`/`justify` управляют осями.",
          "По умолчанию `align=\"center\"`: короткие контролы не «пляшут» по базовой линии.",
        ].join(" "),
      },
      canvas: { sourceState: "shown" },
    },
  },
  argTypes: {
    gap: {
      control: { type: "range", min: 0, max: 10, step: 1 },
      description: "Отступ между элементами",
      table: { defaultValue: { summary: "0" } },
    },
    align: {
      control: "select",
      options: ALIGN,
      description: "Выравнивание по поперечной оси",
      table: { defaultValue: { summary: "center" } },
    },
    justify: {
      control: "select",
      options: JUSTIFY,
      description: "Распределение по основной оси",
      table: { defaultValue: { summary: "start" } },
    },
    wrap: {
      control: "boolean",
      description: "Разрешить перенос строк",
      table: { defaultValue: { summary: "false" } },
    },
    count: {
      control: { type: "range", min: 1, max: 10, step: 1 },
      description: "Количество меток-демо",
      table: { defaultValue: { summary: "5" } },
    },
  },
  args: { gap: 2, align: "center", justify: "start", wrap: true, count: 5 },
} satisfies Meta<InlineArgs>;

export default meta;

type Story = StoryObj<InlineArgs>;

export const Playground: Story = {
  render: silentStory<InlineArgs>((args) => (
    <Box background="surface-container-low" padding={3} radius="md">
      <Inline gap={args.gap} align={args.align} justify={args.justify} wrap={args.wrap}>
        {TAGS.slice(0, args.count).map((tag) => (
          <Box padding={2} background="primary-container" radius="full">
            <Text variant="label-medium">{tag}</Text>
          </Box>
        ))}
      </Inline>
    </Box>
  )),
};

export const AlignmentMatrix: Story = {
  name: "align",
  parameters: { controls: { disable: true } },
  render: () => (
    <Stack gap={3}>
      {ALIGN.map((align) => (
        <Box padding={3} background="surface-container-low" radius="md">
          <Stack gap={2}>
            <Text variant="label-small" tone="muted">{`align="${align}"`}</Text>
            <Inline gap={2} align={align} style={{ minHeight: "4rem" }}>
              <Box padding={2} background="primary-container" radius="sm">
                <Text variant="label-small">Короткий</Text>
              </Box>
              <Box padding={4} background="secondary-container" radius="sm">
                <Text variant="label-small">Высокий блок</Text>
              </Box>
              <Box padding={2} background="tertiary-container" radius="sm">
                <Text variant="label-small">Ещё</Text>
              </Box>
            </Inline>
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
            <Inline gap={2} justify={justify}>
              <Box padding={2} background="primary-container" radius="sm">
                <Text variant="label-small">Раз</Text>
              </Box>
              <Box padding={2} background="primary-container" radius="sm">
                <Text variant="label-small">Два</Text>
              </Box>
              <Box padding={2} background="primary-container" radius="sm">
                <Text variant="label-small">Три</Text>
              </Box>
            </Inline>
          </Stack>
        </Box>
      ))}
    </Stack>
  ),
};

export const Wrapping: Story = {
  name: "Wrap vs nowrap",
  parameters: { controls: { disable: true } },
  render: () => (
    <Stack gap={4}>
      <Box padding={3} background="surface-container-low" radius="md" style={{ maxWidth: "22rem" }}>
        <Stack gap={2}>
          <Text variant="label-small" tone="muted">wrap</Text>
          <Inline gap={2} wrap>
            {TAGS.map((tag) => (
              <Box padding={2} background="primary-container" radius="full">
                <Text variant="label-small">{tag}</Text>
              </Box>
            ))}
          </Inline>
        </Stack>
      </Box>
      <Box
        padding={3}
        background="surface-container-low"
        radius="md"
        style={{ maxWidth: "22rem", overflow: "hidden" }}
      >
        <Stack gap={2}>
          <Text variant="label-small" tone="muted">nowrap</Text>
          <Inline gap={2} wrap={false}>
            {TAGS.slice(0, 5).map((tag) => (
              <Box padding={2} background="secondary-container" radius="full">
                <Text variant="label-small">{tag}</Text>
              </Box>
            ))}
          </Inline>
        </Stack>
      </Box>
    </Stack>
  ),
};

export const ResponsiveToolbar: Story = {
  name: "Responsive toolbar",
  parameters: { controls: { disable: true } },
  render: () => (
    <Stack gap={4}>
      {(["360px", "100%"] as const).map((width) => (
        <Box
          padding={3}
          background="surface-container-low"
          radius="md"
          style={width === "100%" ? undefined : { maxWidth: "360px" }}
        >
          <Stack gap={2}>
            <Text variant="label-small" tone="muted">{width}</Text>
            <Inline gap={2} justify="between" wrap>
              <Inline gap={2} align="center" wrap>
                <Text variant="label-large">Заголовок</Text>
                <Text tone="muted" variant="body-small">12 элементов</Text>
              </Inline>
              <Inline gap={2} wrap>
                <Box padding={2} background="primary-container" radius="full">
                  <Text variant="label-small">Фильтр</Text>
                </Box>
                <Box padding={2} background="secondary-container" radius="full">
                  <Text variant="label-small">Сортировка</Text>
                </Box>
              </Inline>
            </Inline>
          </Stack>
        </Box>
      ))}
    </Stack>
  ),
};
