import type { Meta, StoryObj } from "@storybook/html-vite";
import {
  Box,
  Divider,
  Inline,
  Stack,
  Text,
  type DividerInset,
  type DividerOrientation,
} from "@ivlev-dev/silent-ui";
import { silentStory } from "./silent-story.js";

interface DividerArgs {
  readonly orientation: DividerOrientation;
  readonly inset: DividerInset;
}

const meta = {
  title: "Foundations/Layout/Divider",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: [
          "Разделитель на `<hr>` с hairline-цветом `outline-variant`.",
          "`orientation` переключает горизонтальную и вертикальную линию, `inset`",
          "добавляет отступ с начала или с обеих сторон. Всегда `aria-hidden`:",
          "это визуальный разделитель, а не смысловая граница.",
        ].join(" "),
      },
      canvas: { sourceState: "shown" },
    },
  },
  argTypes: {
    orientation: {
      control: "inline-radio",
      options: ["horizontal", "vertical"],
      description: "Ориентация линии",
      table: { defaultValue: { summary: "horizontal" } },
    },
    inset: {
      control: "inline-radio",
      options: ["none", "start", "both"],
      description: "Отступ линии от краёв",
      table: { defaultValue: { summary: "none" } },
    },
  },
  args: { orientation: "horizontal", inset: "none" },
} satisfies Meta<DividerArgs>;

export default meta;

type Story = StoryObj<DividerArgs>;

export const Playground: Story = {
  render: silentStory<DividerArgs>((args) => (
    <Box background="surface" padding={4} radius="md" border="outline-variant" style={{ maxWidth: "32rem" }}>
      <Stack gap={3}>
        <Text variant="label-large">Раздел выше</Text>
        <Divider orientation={args.orientation} inset={args.inset} />
        <Text tone="muted" variant="body-small">Раздел ниже</Text>
      </Stack>
    </Box>
  )),
};

export const Insets: Story = {
  name: "Inset",
  parameters: { controls: { disable: true } },
  render: () => (
    <Box background="surface" padding={4} radius="md" border="outline-variant" style={{ maxWidth: "32rem" }}>
      <Stack gap={3}>
        {(["none", "start", "both"] as DividerInset[]).map((inset) => (
          <Stack gap={1}>
            <Text variant="label-small" tone="muted">{`inset="${inset}"`}</Text>
            <Divider inset={inset} />
          </Stack>
        ))}
      </Stack>
    </Box>
  ),
};

export const Vertical: Story = {
  name: "Vertical",
  parameters: { controls: { disable: true } },
  render: () => (
    <Inline gap={4} align="stretch" style={{ minHeight: "5rem" }}>
      <Text>Слева</Text>
      <Divider orientation="vertical" />
      <Text>В центре</Text>
      <Divider orientation="vertical" inset="both" />
      <Text>Справа</Text>
    </Inline>
  ),
};

export const InList: Story = {
  name: "В списке",
  parameters: { controls: { disable: true } },
  render: () => (
    <Box background="surface" padding={3} radius="md" border="outline-variant" style={{ maxWidth: "28rem" }}>
      <Stack gap={3}>
        <Inline gap={3} align="center">
          <Box background="primary-container" padding={2} radius="full">
            <Text variant="label-small">АБ</Text>
          </Box>
          <Text>Анна Борисова</Text>
        </Inline>
        <Divider inset="start" />
        <Inline gap={3} align="center">
          <Box background="secondary-container" padding={2} radius="full">
            <Text variant="label-small">ИП</Text>
          </Box>
          <Text>Иван Петров</Text>
        </Inline>
        <Divider inset="start" />
        <Inline gap={3} align="center">
          <Box background="tertiary-container" padding={2} radius="full">
            <Text variant="label-small">СМ</Text>
          </Box>
          <Text>Сергей Максимов</Text>
        </Inline>
      </Stack>
    </Box>
  ),
};

export const LightDark: Story = {
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
          <Stack gap={3}>
            <Text variant="label-large">{theme}</Text>
            <Divider />
            <Text tone="muted" variant="body-small">Линия использует outline-variant</Text>
            <Divider inset="both" />
          </Stack>
        </Box>
      ))}
    </Inline>
  ),
};
