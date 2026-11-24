import type { Meta, StoryObj } from "@storybook/html-vite";
import {
  Box,
  Container,
  Grid,
  Surface,
  Text,
  type ContainerSize,
} from "@ivlev-dev/silent-ui";
import { silentStory } from "./silent-story.js";

interface ContainerArgs {
  readonly size: ContainerSize;
  readonly gutter: boolean;
  readonly text: string;
}

const meta = {
  title: "Foundations/Layout/Container",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: [
          "Ограничитель ширины контента: центр страницы и поля `--sui-gutter`.",
          "`content` — до 2400px, `wide` — до 2600px на 4K, `full` — без ограничения;",
          "`gutter={false}` убирает горизонтальные поля для полноэкранных полос.",
        ].join(" "),
      },
      canvas: { sourceState: "shown" },
    },
  },
  argTypes: {
    size: {
      control: "inline-radio",
      options: ["content", "wide", "full"],
      description: "Предел ширины",
      table: { defaultValue: { summary: "content" } },
    },
    gutter: {
      control: "boolean",
      description: "Горизонтальные поля `--sui-gutter`",
      table: { defaultValue: { summary: "true" } },
    },
    text: { control: "text", description: "Текст-демо" },
  },
  args: {
    size: "content",
    gutter: true,
    text:
      "Контейнер удерживает меру строки и выравнивает сетку по центру: на 4K он " +
      "расширяется до предела, но не превращается в бесконечную строку.",
  },
} satisfies Meta<ContainerArgs>;

export default meta;

type Story = StoryObj<ContainerArgs>;

export const Playground: Story = {
  render: silentStory<ContainerArgs>((args) => (
    <Box background="surface-container-low" style={{ inlineSize: "100%" }}>
      <Container size={args.size} gutter={args.gutter}>
        <Surface tone="surface" padding={4} radius="lg" border="outline-variant">
          <Text>{args.text}</Text>
        </Surface>
      </Container>
    </Box>
  )),
};

export const Sizes: Story = {
  name: "content / wide / full",
  parameters: { controls: { disable: true } },
  render: () => (
    <Box background="surface-container-low" style={{ inlineSize: "100%" }}>
      <Container size="content">
        <Surface tone="surface" padding={3} radius="md" border="outline-variant">
          <Text variant="label-small">content — до 75rem (2400px на 4K)</Text>
        </Surface>
      </Container>
      <Container size="wide">
        <Surface tone="primary-container" padding={3} radius="md">
          <Text variant="label-small">wide — до 90rem (2600px на 4K)</Text>
        </Surface>
      </Container>
      <Container size="full">
        <Surface tone="secondary-container" padding={3} radius="md">
          <Text variant="label-small">full — вся доступная ширина</Text>
        </Surface>
      </Container>
    </Box>
  ),
};

export const Gutters: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Box background="surface-container-low">
      <Container size="content" gutter>
        <Surface tone="surface" padding={3} radius="md" border="outline-variant">
          <Text variant="label-small">gutter=true — поля включены</Text>
        </Surface>
      </Container>
      <Container size="content" gutter={false}>
        <Surface tone="surface-container-high" padding={3} radius="md">
          <Text variant="label-small">gutter=false — контент прилипает к краям</Text>
        </Surface>
      </Container>
    </Box>
  ),
};

export const FourK: Story = {
  name: "4K / wide layout",
  parameters: { controls: { disable: true } },
  render: () => (
    <Box background="surface" style={{ inlineSize: "100%", minHeight: "24rem" }}>
      <Container size="wide">
        <Grid columns={4} gap={4} min="md">
          {["Обзор", "Метрики", "Экспорт", "Доступ"].map((title, index) => (
            <Surface tone="surface-container" padding={5} radius="lg" border="outline-variant">
              <Text variant="title-medium">{title}</Text>
              <Text tone="muted" variant="body-small">
                Блок {index + 1}: на 4K колонки растягиваются, текст остаётся
                ограниченным по мере.
              </Text>
            </Surface>
          ))}
        </Grid>
      </Container>
    </Box>
  ),
};

export const Narrow: Story = {
  name: "360px",
  parameters: { controls: { disable: true } },
  render: () => (
    <Box background="surface-container-low" style={{ inlineSize: "360px" }}>
      <Container size="content">
        <Surface tone="surface" padding={3} radius="md" border="outline-variant">
          <Text variant="body-small">
            На узком экране поля уменьшаются, а контент остаётся в одну колонку.
          </Text>
        </Surface>
      </Container>
    </Box>
  ),
};

export const Nested: Story = {
  name: "Вложенные контейнеры",
  parameters: { controls: { disable: true } },
  render: () => (
    <Box background="surface-container-low">
      <Container size="content">
        <Surface tone="surface" padding={4} radius="lg" border="outline-variant">
          <Container size="content">
            <Box background="primary-container" padding={3} radius="md">
              <Text variant="label-medium">Вложенный Container</Text>
            </Box>
          </Container>
        </Surface>
      </Container>
    </Box>
  ),
};
