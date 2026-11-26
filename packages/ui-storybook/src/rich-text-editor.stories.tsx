import type { Meta, StoryObj } from "@storybook/html-vite";
import { fn } from "storybook/test";
import { RichTextEditor } from "@ivlev-dev/silent-ui";
import { silentStory } from "./silent-story.js";

interface RichTextEditorArgs {
  readonly value: string;
  readonly defaultValue: string;
  readonly label: string;
  readonly hint: string;
  readonly error: string;
  readonly placeholder: string;
  readonly name: string;
  readonly required: boolean;
  readonly readOnly: boolean;
  readonly disabled: boolean;
  readonly invalid: boolean;
  readonly toolbar: boolean;
  readonly minHeight: number;
  readonly maxHeight: number;
  readonly onValueChange: (html: string) => void;
  readonly onChange: (event: Event) => void;
  readonly onBlur: (event: FocusEvent) => void;
}

const INITIAL_HTML = [
  "<h2>О проекте</h2>",
  "<p>Silent — это <strong>реактивный</strong> фреймворк с SSR и гидрацией.</p>",
  "<ul><li>Токены и темы</li><li>Компоненты и формы</li></ul>",
  '<p><a href="https://example.com">Документация</a></p>',
].join("");

const meta = {
  title: "Components/RichTextEditor",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: [
          "WYSIWYG-редактор без сторонних библиотек: `Range`/DOM вместо",
          "`document.execCommand`. `value` — controlled-HTML, `defaultValue` —",
          "uncontrolled, `toolbar` принимает `false` или массив команд с",
          "разделителями `|`. SSR отдаёт пустую контентную область (значение",
          "живёт в скрытом input и подставляется после монтирования), поэтому",
          "гидрация проходит без mismatch. Вход и результат проходят",
          "allowlist-санитайзер, ссылки и вставка проверяются отдельно.",
        ].join(" "),
      },
      canvas: { sourceState: "shown" },
    },
  },
  argTypes: {
    value: {
      control: "text",
      description: "Controlled HTML; пустая строка оставляет редактор неконтролируемым",
    },
    defaultValue: {
      control: "text",
      description: "Начальный HTML для uncontrolled-режима",
    },
    label: { control: "text", description: "Подпись поля" },
    hint: { control: "text", description: "Подсказка под редактором" },
    error: {
      control: "text",
      description: "Текст ошибки; непустое значение → `aria-invalid`",
    },
    placeholder: { control: "text", description: "Placeholder пустого редактора" },
    name: {
      control: "text",
      description: "Имя скрытого input; по умолчанию `id` или имя поля",
    },
    required: { control: "boolean", description: "Обязательное поле" },
    readOnly: {
      control: "boolean",
      description: "Только чтение: правки запрещены, значение отправляется",
    },
    disabled: { control: "boolean", description: "Недоступно, вне tab-порядка" },
    invalid: {
      control: "boolean",
      description: "Принудительный `aria-invalid`; ошибка включает его сама",
    },
    toolbar: {
      control: "boolean",
      description: "Панель команд; `false` скрывает её",
      table: { defaultValue: { summary: "true" } },
    },
    minHeight: {
      control: "number",
      description: "Минимальная высота контентной области, px",
    },
    maxHeight: {
      control: "number",
      description: "Максимальная высота контентной области, px; `0` — без ограничения",
    },
    onValueChange: {
      action: "valueChange",
      description: "Санитизированный HTML после ввода или команды",
    },
    onChange: { action: "change", description: "Синтетический `change` с HTML" },
    onBlur: { action: "blur", description: "Выход фокуса из редактора" },
  },
  args: {
    value: "",
    defaultValue: INITIAL_HTML,
    label: "Описание",
    hint: "Поддерживаются заголовки, списки, цитаты и ссылки",
    error: "",
    placeholder: "Начните печатать…",
    name: "content",
    required: false,
    readOnly: false,
    disabled: false,
    invalid: false,
    toolbar: true,
    minHeight: 180,
    maxHeight: 0,
    onValueChange: fn(),
    onChange: fn(),
    onBlur: fn(),
  },
} satisfies Meta<RichTextEditorArgs>;

export default meta;

type Story = StoryObj<RichTextEditorArgs>;

export const Playground: Story = {
  render: silentStory<RichTextEditorArgs>((args) => (
    <RichTextEditor
      value={args.value === "" ? undefined : args.value}
      defaultValue={args.defaultValue === "" ? undefined : args.defaultValue}
      label={args.label === "" ? undefined : args.label}
      hint={args.hint === "" ? undefined : args.hint}
      error={args.error === "" ? undefined : args.error}
      placeholder={args.placeholder === "" ? undefined : args.placeholder}
      name={args.name === "" ? undefined : args.name}
      required={args.required}
      readOnly={args.readOnly}
      disabled={args.disabled}
      invalid={args.invalid}
      toolbar={args.toolbar}
      minHeight={args.minHeight}
      maxHeight={args.maxHeight > 0 ? args.maxHeight : undefined}
      onValueChange={args.onValueChange}
      onChange={args.onChange}
      onBlur={args.onBlur}
    />
  )),
};

export const ToolbarOff: Story = {
  parameters: { controls: { disable: true } },
  args: { toolbar: false },
  render: silentStory<RichTextEditorArgs>((args) => (
    <RichTextEditor
      defaultValue={args.defaultValue}
      label={args.label}
      hint={args.hint}
      toolbar={args.toolbar}
      minHeight={args.minHeight}
      onValueChange={args.onValueChange}
      onChange={args.onChange}
    />
  )),
};

export const ReadOnly: Story = {
  parameters: { controls: { disable: true } },
  args: {
    readOnly: true,
    label: "Договор",
    hint: "Текст доступен для чтения и копирования",
  },
  render: silentStory<RichTextEditorArgs>((args) => (
    <RichTextEditor
      defaultValue={args.defaultValue}
      label={args.label}
      hint={args.hint}
      readOnly={args.readOnly}
      minHeight={args.minHeight}
    />
  )),
};

export const WithError: Story = {
  parameters: { controls: { disable: true } },
  args: {
    label: "Биография",
    hint: "",
    error: "Сократите текст до 500 символов",
    defaultValue:
      "<p>Слишком длинный текст, который не проходит проверку формы и показывает сообщение об ошибке.</p>",
  },
  render: silentStory<RichTextEditorArgs>((args) => (
    <RichTextEditor
      defaultValue={args.defaultValue}
      label={args.label}
      error={args.error}
      invalid={args.invalid}
      minHeight={args.minHeight}
      onBlur={args.onBlur}
    />
  )),
};

export const Empty: Story = {
  parameters: { controls: { disable: true } },
  args: {
    label: "Заметка",
    defaultValue: "",
    hint: "",
    placeholder: "Начните печатать или вставьте текст…",
  },
  render: silentStory<RichTextEditorArgs>((args) => (
    <RichTextEditor
      defaultValue={args.defaultValue}
      label={args.label}
      placeholder={args.placeholder}
      hint={args.hint === "" ? undefined : args.hint}
      minHeight={args.minHeight}
      onValueChange={args.onValueChange}
      onChange={args.onChange}
    />
  )),
};
