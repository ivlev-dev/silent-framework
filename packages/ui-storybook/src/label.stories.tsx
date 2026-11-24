import type { Meta, StoryObj } from "@storybook/html-vite";
import {
  Box,
  Inline,
  Label,
  Stack,
  Text,
  type LabelTone,
  type LabelVariant,
} from "@ivlev-dev/silent-ui";
import { silentStory } from "./silent-story.js";

const VARIANTS: readonly LabelVariant[] = ["label-large", "label-medium", "label-small"];

interface LabelArgs {
  readonly text: string;
  readonly for: string;
  readonly variant: LabelVariant;
  readonly tone: LabelTone;
  readonly disabled: boolean;
  readonly required: boolean;
  readonly uppercase: boolean;
}

const meta = {
  title: "Foundations/Typography/Label",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: [
          "Подпись поля формы на `<label>`: `for` связывает её с контролом,",
          "`variant` задаёт размер, `required` добавляет декоративную `*`,",
          "`disabled` приглушает подпись вместе с полем. Тон `error` включается",
          "только явно — по состоянию валидации.",
        ].join(" "),
      },
      canvas: { sourceState: "shown" },
    },
  },
  argTypes: {
    text: { control: "text", description: "Текст подписи (children)" },
    for: { control: "text", description: "`for` — id связанного контрола" },
    variant: {
      control: "inline-radio",
      options: VARIANTS,
      description: "Вариант типошкалы",
      table: { defaultValue: { summary: "label-large" } },
    },
    tone: {
      control: "select",
      options: ["default", "muted", "error", "primary", "inherit"],
      description: "Цветовая роль",
      table: { defaultValue: { summary: "default" } },
    },
    disabled: {
      control: "boolean",
      description: "Подпись недоступного поля",
      table: { defaultValue: { summary: "false" } },
    },
    required: {
      control: "boolean",
      description: "Маркер обязательности `*` (декоративный)",
      table: { defaultValue: { summary: "false" } },
    },
    uppercase: {
      control: "boolean",
      description: "Верхний регистр для секционных подписей",
      table: { defaultValue: { summary: "false" } },
    },
  },
  args: {
    text: "Рабочий email",
    for: "label-playground-input",
    variant: "label-large",
    tone: "default",
    disabled: false,
    required: false,
    uppercase: false,
  },
} satisfies Meta<LabelArgs>;

export default meta;

type Story = StoryObj<LabelArgs>;

const inputStyle = {
  blockSize: "2.5rem",
  paddingInline: "var(--sui-space-3)",
  border: "var(--sui-hairline) solid var(--sui-color-outline)",
  borderRadius: "var(--sui-radius-sm)",
  background: "var(--sui-color-surface)",
  color: "var(--sui-color-on-surface)",
  font: "inherit",
} as const;

export const Playground: Story = {
  render: silentStory<LabelArgs>((args) => (
    <Stack gap={2} style={{ maxWidth: "24rem" }}>
      <Label
        for={args.for}
        variant={args.variant}
        tone={args.tone}
        disabled={args.disabled}
        required={args.required}
        uppercase={args.uppercase}
      >
        {args.text}
      </Label>
      <input
        id={args.for}
        type="email"
        disabled={args.disabled}
        placeholder="name@company.com"
        style={inputStyle}
      />
    </Stack>
  )),
};

export const Variants: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Stack gap={3}>
      {VARIANTS.map((variant) => (
        <Stack gap={1}>
          <Label variant={variant}>{variant}</Label>
          <Text variant="body-small" tone="muted">
            Подпись связана с контролом через `for`, размер меняется токеном шкалы.
          </Text>
        </Stack>
      ))}
    </Stack>
  ),
};

export const Tones: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Stack gap={2}>
      <Label tone="default">default — обычная подпись</Label>
      <Label tone="muted">muted — второстепенная</Label>
      <Label tone="primary">primary — акцентная ссылка</Label>
      <Label tone="error">error — поле с ошибкой</Label>
      <Box background="inverse-surface" padding={2} radius="sm">
        <Label tone="inherit">inherit — наследует цвет</Label>
      </Box>
    </Stack>
  ),
};

export const States: Story = {
  name: "Required / disabled / uppercase",
  parameters: { controls: { disable: true } },
  render: () => (
    <Stack gap={4} style={{ maxWidth: "24rem" }}>
      <Stack gap={1}>
        <Label required>Обязательное поле</Label>
        <input aria-label="Обязательное поле" style={inputStyle} placeholder="Значение" />
      </Stack>
      <Stack gap={1}>
        <Label disabled>Недоступное поле</Label>
        <input aria-label="Недоступное поле" disabled style={inputStyle} placeholder="Значение" />
      </Stack>
      <Stack gap={1}>
        <Label uppercase variant="label-small" tone="muted">
          Секционная подпись
        </Label>
        <Text variant="body-small" tone="muted">
          `uppercase` — осознанное решение для заголовков секций, а не дефолт.
        </Text>
      </Stack>
    </Stack>
  ),
};

export const WithControl: Story = {
  name: "С контролом",
  parameters: { controls: { disable: true } },
  render: () => (
    <Stack gap={5} style={{ maxWidth: "24rem" }}>
      <Stack gap={1}>
        <Label for="story-name" required>
          Имя
        </Label>
        <input id="story-name" style={inputStyle} placeholder="Анна" />
        <Text variant="body-small" tone="muted">
          Так подпись будет выглядеть в форме профиля.
        </Text>
      </Stack>
      <Stack gap={1}>
        <Label for="story-error" tone="error" required>
          Email
        </Label>
        <input
          id="story-error"
          style={{ ...inputStyle, borderColor: "var(--sui-color-error)" }}
          value="invalid@"
        />
        <Text variant="body-small" tone="error">
          Проверьте формат адреса.
        </Text>
      </Stack>
    </Stack>
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
          style={{ flex: "1 1 16rem" }}
        >
          <Stack gap={2}>
            <Label>default</Label>
            <Label tone="muted">muted</Label>
            <Label tone="error">error</Label>
            <Label required>required</Label>
          </Stack>
        </Box>
      ))}
    </Inline>
  ),
};
