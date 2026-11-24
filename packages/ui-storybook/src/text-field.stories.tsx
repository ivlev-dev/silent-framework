import type { Meta, StoryObj } from "@storybook/html-vite";
import { fn } from "storybook/test";
import {
  Inline,
  Stack,
  Text,
  TextField,
  type ControlSize,
  type TextFieldType,
} from "@ivlev-dev/silent-ui";
import { silentStory } from "./silent-story.js";

interface TextFieldArgs {
  readonly type: TextFieldType;
  readonly label: string;
  readonly hint: string;
  readonly error: string;
  readonly placeholder: string;
  readonly value: string;
  readonly required: boolean;
  readonly disabled: boolean;
  readonly readOnly: boolean;
  readonly size: ControlSize;
  readonly passwordToggle: boolean;
  readonly onInput: (event: InputEvent) => void;
  readonly onChange: (event: Event) => void;
  readonly onFocus: (event: FocusEvent) => void;
  readonly onBlur: (event: FocusEvent) => void;
}

const meta = {
  title: "Components/TextField",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: [
          "Однострочное поле. Явные props приоритетнее `field` из",
          "`@ivlev-dev/silent-form`: `label`/`hint`/`error`/`required` можно",
          "задавать без формы. Ошибка переводит поле в `aria-invalid`, hint и",
          "error связываются через `aria-describedby`, для `type=password`",
          "включён переключатель видимости.",
        ].join(" "),
      },
      canvas: { sourceState: "shown" },
    },
  },
  argTypes: {
    type: {
      control: "select",
      options: ["text", "email", "password", "search", "tel", "url", "number"],
      description: "Нативный `type`",
      table: { defaultValue: { summary: "text" } },
    },
    label: { control: "text", description: "Подпись поля" },
    hint: { control: "text", description: "Подсказка под полем" },
    error: {
      control: "text",
      description: "Текст ошибки; непустое значение → `aria-invalid`",
    },
    placeholder: { control: "text", description: "Placeholder" },
    value: {
      control: "text",
      description: "Значение; пустая строка оставляет поле неконтролируемым",
    },
    required: { control: "boolean", description: "Обязательное поле" },
    disabled: { control: "boolean", description: "Недоступно" },
    readOnly: { control: "boolean", description: "Только чтение" },
    size: {
      control: "inline-radio",
      options: ["sm", "md", "lg"],
      description: "Размер контрола",
      table: { defaultValue: { summary: "md" } },
    },
    passwordToggle: {
      control: "boolean",
      description: "Кнопка «Показать/Скрыть пароль» для `type=password`",
      table: { defaultValue: { summary: "true" } },
    },
    onInput: { action: "input", description: "Нативный `input`" },
    onChange: { action: "change", description: "Нативный `change`" },
    onFocus: { action: "focus" },
    onBlur: { action: "blur" },
  },
  args: {
    type: "text",
    label: "Email",
    hint: "Рабочая почта",
    error: "",
    placeholder: "you@example.com",
    value: "",
    required: true,
    disabled: false,
    readOnly: false,
    size: "md",
    passwordToggle: true,
    onInput: fn(),
    onChange: fn(),
    onFocus: fn(),
    onBlur: fn(),
  },
} satisfies Meta<TextFieldArgs>;

export default meta;

type Story = StoryObj<TextFieldArgs>;

export const Playground: Story = {
  render: silentStory<TextFieldArgs>((args) => (
    <TextField
      type={args.type}
      label={args.label}
      hint={args.hint === "" ? undefined : args.hint}
      error={args.error === "" ? undefined : args.error}
      placeholder={args.placeholder}
      value={args.value === "" ? undefined : args.value}
      required={args.required}
      disabled={args.disabled}
      readOnly={args.readOnly}
      size={args.size}
      passwordToggle={args.passwordToggle}
      onInput={args.onInput}
      onChange={args.onChange}
      onFocus={args.onFocus}
      onBlur={args.onBlur}
    />
  )),
};

export const Types: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Stack gap={4}>
      {(["text", "email", "password", "search", "tel", "url", "number"] as const).map(
        (type) => (
          <TextField
            key={type}
            type={type}
            label={type}
            placeholder={`type=${type}`}
            hint={type === "password" ? "Переключатель видимости включён" : undefined}
          />
        ),
      )}
    </Stack>
  ),
};

export const Sizes: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Stack gap={4}>
      <TextField label="sm" size="sm" placeholder="Маленькое" />
      <TextField label="md" placeholder="Среднее" />
      <TextField label="lg" size="lg" placeholder="Большое" />
    </Stack>
  ),
};

export const States: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Stack gap={4}>
      <TextField label="Обычное" placeholder="Введите значение" />
      <TextField
        label="Обязательное"
        required
        placeholder="Обязательное поле"
        hint="Подсказка остаётся видимой"
      />
      <TextField
        label="С ошибкой"
        value="неверный адрес"
        error="Укажите почту в формате name@example.com"
        required
      />
      <TextField label="Только чтение" value="read-only" readOnly />
      <TextField label="Недоступно" placeholder="disabled" disabled />
      <TextField label="Пароль" type="password" value="secret-value" />
    </Stack>
  ),
};

export const WithSlots: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Stack gap={3}>
      <Inline gap={3} align="start">
        <TextField label="С ведущей иконкой" leading={<Text aria-hidden="true">@</Text>} placeholder="username" />
        <TextField label="С хвостом" trailing={<Text tone="muted">RU</Text>} placeholder="Телефон" />
      </Inline>
      <Text variant="body-small" tone="muted">
        Слоты декоративные: доступное имя даёт label, а не иконка.
      </Text>
    </Stack>
  ),
};
