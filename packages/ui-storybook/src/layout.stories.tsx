import type { Meta, StoryObj } from "@storybook/html-vite";
import {
  Box,
  Container,
  Grid,
  Stack,
  Surface,
  Text,
  type GridColumns,
  type SpacingStep,
} from "@ivlev-dev/silent-ui";
import { silentStory } from "./silent-story.js";

interface GridArgs {
  readonly columns: GridColumns;
  readonly gap: SpacingStep;
  readonly min: "sm" | "md" | "lg";
  readonly count: number;
}

const meta = {
  title: "Foundations/Layout/Grid",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: [
          "Сетка на CSS Grid: `columns` задаёт число колонок, `auto` включает",
          "auto-fit по минимальной ширине `min`. `gap` берётся из шкалы отступов,",
          "поэтому сетка не зависит от брейкпоинтов в разметке.",
        ].join(" "),
      },
      canvas: { sourceState: "shown" },
    },
  },
  argTypes: {
    columns: {
      control: "select",
      options: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, "auto"],
      description: "Число колонок или auto-fit",
      table: { defaultValue: { summary: "auto" } },
    },
    gap: {
      control: { type: "range", min: 0, max: 10, step: 1 },
      description: "Отступ между ячейками",
      table: { defaultValue: { summary: "4" } },
    },
    min: {
      control: "inline-radio",
      options: ["sm", "md", "lg"],
      description: "Минимальная ширина колонки для `columns=\"auto\"`",
      table: { defaultValue: { summary: "md" } },
    },
    count: {
      control: { type: "range", min: 1, max: 12, step: 1 },
      description: "Количество ячеек в демонстрации",
      table: { defaultValue: { summary: "6" } },
    },
  },
  args: { columns: "auto", gap: 4, min: "md", count: 6 },
} satisfies Meta<GridArgs>;

export default meta;

type Story = StoryObj<GridArgs>;

const CELLS = Array.from({ length: 12 }, (_, index) => index + 1);

export const Grid_: Story = {
  name: "Playground",
  render: silentStory<GridArgs>((args) => (
    <Container>
      <Grid columns={args.columns} gap={args.gap} min={args.min}>
        {CELLS.slice(0, args.count).map((index) => (
          <Surface
            tone="surface-container"
            padding={4}
            radius="md"
            border="outline-variant"
          >
            <Text variant="title-small">Ячейка {index}</Text>
            <Text tone="muted" variant="body-small">
              auto-fit и фиксированные колонки живут в одном примитиве.
            </Text>
          </Surface>
        ))}
      </Grid>
    </Container>
  )),
};

export const FixedColumns: Story = {
  name: "Fixed columns",
  parameters: { controls: { disable: true } },
  render: () => (
    <Container>
      <Stack gap={4}>
        <Surface tone="surface" padding={4} radius="lg">
          <Grid columns={2} gap={2}>
            {CELLS.slice(0, 2).map((index) => (
              <Box background="primary-container" padding={3} radius="sm">
                <Text>2 · {index}</Text>
              </Box>
            ))}
          </Grid>
        </Surface>
        <Grid columns={3} gap={2}>
          {CELLS.slice(0, 3).map((index) => (
            <Box background="secondary-container" padding={3} radius="sm">
              <Text>3 · {index}</Text>
            </Box>
          ))}
        </Grid>
        <Grid columns={4} gap={2}>
          {CELLS.slice(0, 4).map((index) => (
            <Box background="tertiary-container" padding={3} radius="sm">
              <Text>4 · {index}</Text>
            </Box>
          ))}
        </Grid>
        <Grid columns={6} gap={2}>
          {CELLS.slice(0, 6).map((index) => (
            <Box background="surface-container-high" padding={2} radius="sm">
              <Text variant="label-small">6 · {index}</Text>
            </Box>
          ))}
        </Grid>
      </Stack>
    </Container>
  ),
};

export const Responsive: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Grid columns={2} gap={4} min="lg">
      <Surface tone="surface-container-low" padding={3} radius="md" style={{ maxWidth: "360px" }}>
        <Text variant="label-small" tone="muted">360px</Text>
        <Grid columns="auto" gap={2} min="sm">
          {CELLS.slice(0, 4).map((index) => (
            <Box background="surface-container-high" padding={2} radius="sm">
              <Text variant="label-small">{index}</Text>
            </Box>
          ))}
        </Grid>
      </Surface>
      <Surface tone="surface-container-low" padding={3} radius="md">
        <Text variant="label-small" tone="muted">Широкий контейнер</Text>
        <Grid columns="auto" gap={2} min="md">
          {CELLS.slice(0, 8).map((index) => (
            <Box background="surface-container-high" padding={2} radius="sm">
              <Text variant="label-small">{index}</Text>
            </Box>
          ))}
        </Grid>
      </Surface>
    </Grid>
  ),
};
