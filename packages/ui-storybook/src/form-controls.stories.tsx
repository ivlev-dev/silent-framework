import type { Meta, StoryObj } from "@storybook/html-vite";
import { fn } from "storybook/test";
import { createSignal, onCleanup } from "@ivlev-dev/silent-core";
import {
  Box,
  Button,
  Checkbox,
  Divider,
  Field,
  FieldArray,
  FieldGroup,
  FileField,
  FormActions,
  Heading,
  Inline,
  RadioGroup,
  SearchField,
  Select,
  Slider,
  Stack,
  Switch,
  Text,
  Textarea,
  TextField,
  type ControlSize,
  type FieldGroupLayout,
  type FormActionsAlign,
  type TextFieldType,
  type TextareaResize,
} from "@ivlev-dev/silent-ui";
import type { FieldProps, Form } from "../../form/dist/index.js";
import { OrderForm } from "./form-demo.models.js";
import { silentStory } from "./silent-story.js";

/*
 * Form Controls — витрина семейства форм: обёртки (`Field`, `FieldGroup`,
 * `FormActions`), контролы и повторяемая группа `FieldArray` поверх настоящего
 * `@ivlev-dev/silent-form`. Пакет формы импортируется собранным (`dist`):
 * именно этот модуль типизирует `field`/`FormArray` внутри
 * `@ivlev-dev/silent-ui/form`, поэтому подклассы `Form` в сторис структурно
 * совпадают с контрактом компонентов.
 *
 * Controls общие для файла: каждое поле ввода управляется args, а не
 * локальным сигналом; исключение — контролы, которым для интерактивности
 * нужен управляемый `value` (Slider, SearchField) — начальное значение всё
 * равно приходит из args.
 */

interface FormArgs {
  /* Общие подпись/состояние */
  readonly label: string;
  readonly hint: string;
  readonly error: string;
  readonly required: boolean;
  readonly disabled: boolean;
  readonly readOnly: boolean;
  readonly value: string;
  readonly placeholder: string;
  readonly size: ControlSize;
  readonly field: unknown;
  readonly describedBy?: string;
  readonly class?: unknown;
  readonly style?: unknown;
  readonly attrs?: unknown;
  readonly ref?: unknown;
  readonly keyOf?: unknown;
  /* TextField */
  readonly type: TextFieldType;
  readonly passwordToggle: boolean;
  readonly bare: boolean;
  readonly leadingIcon: boolean;
  readonly trailingText: string;
  /* Textarea */
  readonly rows: number;
  readonly resize: TextareaResize;
  readonly counter: boolean;
  readonly maxLength: number;
  /* Select / RadioGroup */
  readonly multiple: boolean;
  readonly withDescriptions: boolean;
  /* Checkbox / Switch */
  readonly checked: boolean;
  readonly indeterminate: boolean;
  readonly description: string;
  /* Slider */
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly unit: string;
  readonly sliderValue: number;
  readonly output: boolean;
  /* FileField */
  readonly accept: string;
  readonly fileValue: string;
  readonly progress: number;
  readonly chooseLabel: string;
  readonly clearLabel: string;
  /* Field / FieldGroup / FormActions */
  readonly invalid: boolean;
  readonly touched: boolean;
  readonly validating: boolean;
  readonly legend: string;
  readonly layout: FieldGroupLayout;
  readonly columns: 1 | 2 | 3 | "auto" | "none";
  readonly maxWidth: "none" | "narrow" | "default";
  readonly align: FormActionsAlign;
  readonly submit: boolean;
  readonly reset: boolean;
  readonly submitLabel: string;
  readonly resetLabel: string;
  readonly loading: boolean;
  readonly sticky: boolean;
  /* FieldArray */
  readonly allowMove: boolean;
  readonly minItems: number;
  readonly maxItems: number;
  readonly addLabel: string;
  readonly removeLabel: string;
  /* Действия */
  readonly onInput: (event: InputEvent) => void;
  readonly onChange: (event: Event) => void;
  readonly onBlur: (event: FocusEvent) => void;
  readonly onFocus: (event: FocusEvent) => void;
  readonly onFiles: (files: readonly File[]) => void;
  readonly onSubmit: (event: MouseEvent) => void;
  readonly onReset: (event: MouseEvent) => void;
  readonly onAdd: (item: Form) => void;
  readonly onRemove: (index: number) => void;
  readonly onMove: (from: number, to: number) => void;
  readonly onValueChange: (value: string) => void;
  readonly onSearch: (value: string) => void;
  readonly onClear: () => void;
}

/**
 * Двойник `FieldProps` из `@ivlev-dev/silent-form`: сторис не должны создавать
 * форму только ради `label`/`hint`. Структура совпадает с публичным
 * контрактом, поэтому `validating`/`touched` можно показывать без формы.
 */
function mockField<Value>(
  value: Value,
  options: {
    readonly label?: string;
    readonly hint?: string;
    readonly error?: string;
    readonly required?: boolean;
    readonly isValidating?: boolean;
    readonly touched?: boolean;
    readonly placeholder?: string;
  } = {},
): FieldProps<Value> {
  const error = options.error === undefined || options.error === "" ? undefined : options.error;
  const hint = options.hint === undefined || options.hint === "" ? undefined : options.hint;
  return {
    value,
    label: options.label ?? "",
    placeholder: options.placeholder,
    hint,
    error,
    errors: error === undefined ? [] : [error],
    isRequired: options.required === true,
    isReady: true,
    isValidating: options.isValidating === true,
    touched: options.touched === true,
    dirty: false,
    isValid: error === undefined,
    name: "demo",
    id: "demo",
    setValue() {
      // Значением управляют args сторис.
    },
    setReady() {
      // Не используется.
    },
    onChange() {
      // Не используется.
    },
    onInput() {
      // Не используется.
    },
    onFocus() {
      // Не используется.
    },
    onBlur() {
      // Не используется.
    },
    validate() {
      return Promise.resolve(error === undefined);
    },
  };
}

const meta = {
  title: "Components/Form Controls",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: [
          "Семейство форм дизайн-системы: `Field`, `FieldGroup` и `FormActions`",
          "задают оболочку и подвал, контролы (`TextField`, `Textarea`, `Select`,",
          "`Checkbox`, `RadioGroup`, `Switch`, `Slider`, `FileField`,",
          "`SearchField`) читают `value`/`field`, а `FieldArray` строит",
          "повторяемую группу поверх настоящего `@ivlev-dev/silent-form`.",
          "Явные props контрола приоритетнее `field`: подпись, подсказку и",
          "ошибку можно показывать без формы. Все состояния — `data-*`-атрибуты",
          "(`data-invalid`, `data-validating`, `data-touched`), поэтому стили не",
          "зависят от структуры разметки.",
        ].join(" "),
      },
      canvas: { sourceState: "shown" },
    },
  },
  argTypes: {
    label: { control: "text", description: "Подпись поля", table: { category: "Общие" } },
    hint: { control: "text", description: "Подсказка под контролом", table: { category: "Общие" } },
    error: { control: "text", description: "Текст ошибки; пусто — ошибки нет", table: { category: "Общие" } },
    required: { control: "boolean", description: "Обязательное поле", table: { category: "Общие" } },
    disabled: { control: "boolean", description: "Недоступно", table: { category: "Общие" } },
    readOnly: { control: "boolean", description: "Только чтение", table: { category: "Общие" } },
    value: {
      control: "text",
      description: "Значение контрола (приоритетнее `field.value`)",
      table: { category: "Общие" },
    },
    placeholder: { control: "text", description: "Плейсхолдер", table: { category: "Общие" } },
    size: {
      control: "inline-radio",
      options: ["sm", "md", "lg"],
      description: "Размер контрола",
      table: { category: "Общие", defaultValue: { summary: "md" } },
    },
    field: {
      control: false,
      description: "Поле формы из `@ivlev-dev/silent-form` (`FieldProps`)",
      table: { category: "Общие", type: { summary: "FieldProps<Value>" } },
    },
    type: {
      control: "select",
      options: ["text", "email", "password", "number", "search", "tel", "url"],
      description: "Тип `input`",
      table: { category: "TextField", defaultValue: { summary: "text" } },
    },
    passwordToggle: {
      control: "boolean",
      description: "Кнопка «Показать/Скрыть пароль»",
      table: { category: "TextField", defaultValue: { summary: "true для password" } },
    },
    bare: {
      control: "boolean",
      description: "Без рамки и внешних отступов — для своей оболочки",
      table: { category: "Field" },
    },
    leadingIcon: { control: "boolean", description: "Иконка слева", table: { category: "TextField" } },
    trailingText: { control: "text", description: "Слот справа от ввода", table: { category: "TextField" } },
    rows: { control: "number", description: "Высота в строках", table: { category: "Textarea" } },
    resize: {
      control: "select",
      options: ["none", "vertical", "horizontal", "both"],
      description: "Направление изменения размера",
      table: { category: "Textarea" },
    },
    counter: { control: "boolean", description: "Счётчик символов", table: { category: "Textarea" } },
    maxLength: { control: "number", description: "Предел длины", table: { category: "Textarea" } },
    multiple: { control: "boolean", description: "Множественный выбор", table: { category: "Select" } },
    withDescriptions: {
      control: "boolean",
      description: "Описания у пунктов RadioGroup",
      table: { category: "RadioGroup" },
    },
    checked: { control: "boolean", description: "Отмечено", table: { category: "Checkbox / Switch" } },
    indeterminate: {
      control: "boolean",
      description: "Смешанное состояние (`indeterminate`)",
      table: { category: "Checkbox" },
    },
    description: {
      control: "text",
      description: "Описание рядом с подписью",
      table: { category: "Checkbox / Switch" },
    },
    min: { control: "number", description: "Минимум ползунка", table: { category: "Slider" } },
    max: { control: "number", description: "Максимум ползунка", table: { category: "Slider" } },
    step: { control: "number", description: "Шаг ползунка", table: { category: "Slider" } },
    unit: { control: "text", description: "Единица измерения в `<output>`", table: { category: "Slider" } },
    sliderValue: { control: "number", description: "Значение ползунка", table: { category: "Slider" } },
    output: {
      control: "boolean",
      description: "Показывать `<output>` со значением",
      table: { category: "Slider" },
    },
    accept: { control: "text", description: "Фильтр `accept`", table: { category: "FileField" } },
    fileValue: {
      control: "text",
      description: "Показать имя файла; пусто — выбранный вручную",
      table: { category: "FileField" },
    },
    progress: { control: "number", description: "Прогресс загрузки 0–100", table: { category: "FileField" } },
    chooseLabel: { control: "text", description: "Подпись кнопки выбора", table: { category: "FileField" } },
    clearLabel: { control: "text", description: "Подпись кнопки очистки поиска", table: { category: "SearchField" } },
    invalid: {
      control: "boolean",
      description: "Невалидно без текста ошибки",
      table: { category: "Field" },
    },
    touched: { control: "boolean", description: "Поле посещено", table: { category: "Field" } },
    validating: {
      control: "boolean",
      description: "Идёт асинхронная проверка",
      table: { category: "Field" },
    },
    legend: { control: "text", description: "Заголовок `fieldset`", table: { category: "FieldGroup" } },
    layout: {
      control: "inline-radio",
      options: ["stack", "inline"],
      description: "Направление группы",
      table: { category: "FieldGroup" },
    },
    columns: {
      control: "select",
      options: [1, 2, 3, "auto", "none"],
      description: "Сетка группы (1–3, auto); `none` — без сетки",
      table: { category: "FieldGroup" },
    },
    maxWidth: {
      control: "inline-radio",
      options: ["none", "narrow", "default"],
      description: "Ограничение ширины формы",
      table: { category: "FieldGroup" },
    },
    align: {
      control: "inline-radio",
      options: ["start", "end", "between"],
      description: "Выравнивание действий",
      table: { category: "FormActions" },
    },
    submit: { control: "boolean", description: "Показывать submit", table: { category: "FormActions" } },
    reset: { control: "boolean", description: "Показывать reset", table: { category: "FormActions" } },
    submitLabel: { control: "text", description: "Подпись submit", table: { category: "FormActions" } },
    resetLabel: { control: "text", description: "Подпись reset", table: { category: "FormActions" } },
    loading: {
      control: "boolean",
      description: "Отправка идёт: обе кнопки блокируются",
      table: { category: "FormActions" },
    },
    sticky: {
      control: "boolean",
      description: "Прижать подвал к нижней кромке скроллящегося контейнера",
      table: { category: "FormActions" },
    },
    allowMove: {
      control: "boolean",
      description: "Кнопки перемещения строк",
      table: { category: "FieldArray" },
    },
    minItems: { control: "number", description: "Минимум строк", table: { category: "FieldArray" } },
    maxItems: { control: "number", description: "Максимум строк", table: { category: "FieldArray" } },
    addLabel: { control: "text", description: "Подпись кнопки добавления", table: { category: "FieldArray" } },
    removeLabel: { control: "text", description: "Подпись кнопки удаления", table: { category: "FieldArray" } },
    describedBy: {
      control: "text",
      description: "Дополнительные id для `aria-describedby`",
      table: { category: "Доступность" },
    },
    class: {
      control: false,
      description: "Дополнительные классы (`ClassNameValue`)",
      table: { category: "Структурные" },
    },
    style: {
      control: false,
      description: "Инлайн-стили (`StyleInput`)",
      table: { category: "Структурные" },
    },
    attrs: {
      control: false,
      description: "Произвольные HTML-атрибуты корня",
      table: { category: "Структурные" },
    },
    ref: {
      control: false,
      description: "Колбэк DOM-узла",
      table: { category: "Структурные", type: { summary: "(node: Element | null) => void" } },
    },
    keyOf: {
      control: false,
      description: "FieldArray: ключ строки (по умолчанию — сам элемент формы)",
      table: { category: "FieldArray", type: { summary: "(item: T) => unknown" } },
    },
    onInput: { action: "input", description: "Ввод символа", table: { category: "События" } },
    onChange: { action: "change", description: "Изменение значения", table: { category: "События" } },
    onBlur: { action: "blur", description: "Потеря фокуса", table: { category: "События" } },
    onFocus: { action: "focus", description: "Получение фокуса", table: { category: "События" } },
    onFiles: { action: "files", description: "Выбраны файлы", table: { category: "События" } },
    onSubmit: { action: "submit", description: "Нажата submit-кнопка", table: { category: "События" } },
    onReset: { action: "reset", description: "Нажата reset-кнопка", table: { category: "События" } },
    onAdd: { action: "add", description: "Строка добавлена", table: { category: "События" } },
    onRemove: { action: "remove", description: "Строка удалена", table: { category: "События" } },
    onMove: { action: "move", description: "Строки переставлены", table: { category: "События" } },
    onValueChange: {
      action: "valueChange",
      description: "Поиск: значение изменилось",
      table: { category: "События" },
    },
    onSearch: { action: "search", description: "Поиск: Enter", table: { category: "События" } },
    onClear: { action: "clear", description: "Поиск: очистка", table: { category: "События" } },
  },
  args: {
    label: "Email",
    hint: "Рабочая почта",
    error: "",
    required: false,
    disabled: false,
    readOnly: false,
    value: "",
    placeholder: "name@example.com",
    size: "md",
    field: undefined,
    type: "text",
    passwordToggle: true,
    bare: false,
    leadingIcon: false,
    trailingText: "",
    rows: 4,
    resize: "vertical",
    counter: true,
    maxLength: 280,
    multiple: false,
    withDescriptions: true,
    checked: true,
    indeterminate: false,
    description: "Письма о новых заказах",
    min: 0,
    max: 100,
    step: 5,
    unit: "%",
    sliderValue: 40,
    output: true,
    accept: "application/pdf",
    fileValue: "",
    progress: 0,
    chooseLabel: "Выбрать файл",
    clearLabel: "Очистить",
    invalid: false,
    touched: false,
    validating: false,
    legend: "Профиль",
    layout: "stack",
    columns: 2,
    maxWidth: "default",
    align: "end",
    submit: true,
    reset: true,
    submitLabel: "Сохранить",
    resetLabel: "Сбросить",
    loading: false,
    sticky: false,
    allowMove: true,
    minItems: 1,
    maxItems: 5,
    addLabel: "Добавить",
    removeLabel: "Удалить",
    onInput: fn(),
    onChange: fn(),
    onBlur: fn(),
    onFocus: fn(),
    onFiles: fn(),
    onSubmit: fn(),
    onReset: fn(),
    onAdd: fn(),
    onRemove: fn(),
    onMove: fn(),
    onValueChange: fn(),
    onSearch: fn(),
    onClear: fn(),
  },
} satisfies Meta<FormArgs>;

export default meta;

type Story = StoryObj<FormArgs>;

/** Показывает только контролы конкретной истории, не сужая общий argTypes. */
function controls(names: readonly string[]): { controls: { include: string[] } } {
  return { controls: { include: [...names] } };
}

const OPTIONS = [
  { value: "user", label: "Пользователь" },
  { value: "admin", label: "Администратор" },
  { value: "guest", label: "Гость", disabled: true },
] as const;

const RADIO_OPTIONS = [
  { value: "user", label: "Пользователь", description: "Читает и комментирует" },
  { value: "admin", label: "Администратор", description: "Управляет доступом" },
  { value: "guest", label: "Гость", description: "Только просмотр", disabled: true },
] as const;

const TEXT_TYPES: readonly TextFieldType[] = [
  "text",
  "email",
  "password",
  "number",
  "search",
  "tel",
  "url",
];

function textFieldArgs(args: FormArgs) {
  return {
    label: args.label,
    hint: args.hint === "" ? undefined : args.hint,
    error: args.error === "" ? undefined : args.error,
    required: args.required,
    disabled: args.disabled,
    readOnly: args.readOnly,
    value: args.value,
    placeholder: args.placeholder,
    size: args.size,
    field: mockField(args.value, {
      label: args.label,
      hint: args.hint,
      error: args.error,
      required: args.required,
      isValidating: args.validating,
      touched: args.touched,
      placeholder: args.placeholder,
    }),
  };
}

/* ------------------------------------------------------------------ */
/* TextField                                                          */
/* ------------------------------------------------------------------ */

export const TextFieldPlayground: Story = {
  name: "TextField / playground",
  parameters: controls([
    "label",
    "hint",
    "error",
    "required",
    "disabled",
    "readOnly",
    "value",
    "placeholder",
    "size",
    "type",
    "passwordToggle",
    "bare",
    "leadingIcon",
    "trailingText",
    "validating",
    "touched",
    "onInput",
    "onChange",
    "onBlur",
    "onFocus",
  ]),
  render: silentStory<FormArgs>((args) => (
    <Box padding={4} style={{ "max-inline-size": "480px" }}>
      <TextField
        {...textFieldArgs(args)}
        type={args.type}
        passwordToggle={args.passwordToggle}
        bare={args.bare}
        leading={args.leadingIcon ? <span aria-hidden="true">@</span> : undefined}
        trailing={
          args.trailingText === "" ? undefined : <Text variant="body-small" tone="muted">{args.trailingText}</Text>
        }
        onInput={args.onInput}
        onChange={args.onChange}
        onBlur={args.onBlur}
        onFocus={args.onFocus}
      />
    </Box>
  )),
};

export const TextFieldTypes: Story = {
  name: "TextField / типы",
  parameters: { controls: { disable: true } },
  render: silentStory<FormArgs>(() => (
    <Box padding={4} style={{ "max-inline-size": "480px" }}>
      <Stack gap={4}>
        {TEXT_TYPES.map((type) => (
          <TextField key={type} id={`type-${type}`} type={type} label={type} placeholder={type} />
        ))}
      </Stack>
    </Box>
  )),
};

export const TextFieldStates: Story = {
  name: "TextField / размеры и состояния",
  parameters: { controls: { disable: true } },
  render: silentStory<FormArgs>(() => (
    <Box padding={4} style={{ "max-inline-size": "480px" }}>
      <Stack gap={4}>
        <TextField id="tf-sm" size="sm" label="sm" placeholder="Маленькое" />
        <TextField id="tf-md" label="md" placeholder="Среднее" />
        <TextField id="tf-lg" size="lg" label="lg" placeholder="Большое" />
        <TextField id="tf-readonly" label="readOnly" readOnly value="Только чтение" />
        <TextField id="tf-disabled" label="disabled" disabled placeholder="Недоступно" />
        <TextField id="tf-loading" label="loading" field={mockField("", { isValidating: true })} />
        <TextField
          id="tf-error"
          label="Ошибка"
          value="plain@example"
          error="Почта должна быть в формате name@example.com"
        />
        <TextField
          id="tf-long-hint"
          label="Длинная подсказка"
          hint="Подсказка переносится по словам и не выталкивает контрол из сетки формы"
          value="ada@example.com"
        />
      </Stack>
    </Box>
  )),
};

/* ------------------------------------------------------------------ */
/* Textarea                                                           */
/* ------------------------------------------------------------------ */

export const TextareaPlayground: Story = {
  name: "Textarea / playground",
  parameters: controls([
    "label",
    "hint",
    "error",
    "required",
    "disabled",
    "readOnly",
    "value",
    "placeholder",
    "rows",
    "resize",
    "counter",
    "maxLength",
    "validating",
    "onInput",
    "onChange",
  ]),
  render: silentStory<FormArgs>((args) => (
    <Box padding={4} style={{ "max-inline-size": "560px" }}>
      <Textarea
        label={args.label}
        hint={args.hint === "" ? undefined : args.hint}
        error={args.error === "" ? undefined : args.error}
        required={args.required}
        disabled={args.disabled}
        readOnly={args.readOnly}
        value={args.value}
        placeholder={args.placeholder}
        rows={args.rows}
        resize={args.resize}
        counter={args.counter}
        maxLength={args.maxLength}
        field={mockField(args.value, {
          label: args.label,
          isValidating: args.validating,
          touched: args.touched,
        })}
        onInput={args.onInput}
        onChange={args.onChange}
      />
    </Box>
  )),
};

export const TextareaStates: Story = {
  name: "Textarea / состояния",
  parameters: { controls: { disable: true } },
  render: silentStory<FormArgs>(() => (
    <Box padding={4} style={{ "max-inline-size": "560px" }}>
      <Stack gap={4}>
        <Textarea id="ta-rows-2" label="rows=2" rows={2} placeholder="Короткое поле" />
        <Textarea id="ta-rows-6" label="rows=6" rows={6} resize="none" placeholder="Без resize" />
        <Textarea
          id="ta-counter"
          label="Счётчик"
          counter
          maxLength={40}
          value="Почти достигли предела"
          hint="Счётчик показывает остаток"
        />
        <Textarea id="ta-error" label="Ошибка" error="Опишите проблему минимум в 20 символах" />
        <Textarea id="ta-disabled" label="disabled" disabled value="Недоступно" />
        <Textarea id="ta-readonly" label="readOnly" readOnly value="Только чтение" />
      </Stack>
    </Box>
  )),
};

/* ------------------------------------------------------------------ */
/* Select                                                             */
/* ------------------------------------------------------------------ */

export const SelectPlayground: Story = {
  name: "Select / playground",
  parameters: controls([
    "label",
    "hint",
    "error",
    "required",
    "disabled",
    "value",
    "placeholder",
    "size",
    "multiple",
    "onChange",
    "onBlur",
    "onFocus",
  ]),
  argTypes: {
    value: {
      control: "select",
      options: ["", "user", "admin", "guest"],
      description: "Выбранное значение",
      table: { category: "Общие" },
    },
  },
  render: silentStory<FormArgs>((args) => (
    <Box padding={4} style={{ "max-inline-size": "420px" }}>
      <Select
        options={OPTIONS}
        label={args.label}
        hint={args.hint === "" ? undefined : args.hint}
        error={args.error === "" ? undefined : args.error}
        required={args.required}
        disabled={args.disabled}
        value={args.value}
        placeholder={args.placeholder}
        size={args.size}
        multiple={args.multiple}
        onChange={args.onChange}
        onBlur={args.onBlur}
        onFocus={args.onFocus}
      />
    </Box>
  )),
};

export const SelectStates: Story = {
  name: "Select / размеры и состояния",
  parameters: { controls: { disable: true } },
  render: silentStory<FormArgs>(() => (
    <Box padding={4} style={{ "max-inline-size": "420px" }}>
      <Stack gap={4}>
        <Select id="select-sm" size="sm" options={OPTIONS} label="sm" placeholder="Размер sm" />
        <Select id="select-md" options={OPTIONS} label="md" placeholder="Размер md" />
        <Select id="select-lg" size="lg" options={OPTIONS} label="lg" placeholder="Размер lg" />
        <Select id="select-value" options={OPTIONS} label="Значение" value="admin" />
        <Select id="select-multiple" options={OPTIONS} label="Несколько" multiple value={["user", "admin"]} clearable />
        <Select id="select-search" options={OPTIONS} label="С поиском" searchable placeholder="Найдите роль" />
        <Select id="select-error" options={OPTIONS} label="Ошибка" error="Выберите роль" />
        <Select id="select-disabled" options={OPTIONS} label="disabled" disabled placeholder="Недоступно" />
      </Stack>
    </Box>
  )),
};

const ASYNC_CITIES = [
  "Москва",
  "Санкт-Петербург",
  "Новосибирск",
  "Екатеринбург",
  "Казань",
  "Нижний Новгород",
  "Челябинск",
  "Самара",
  "Омск",
  "Ростов-на-Дону",
  "Уфа",
  "Красноярск",
  "Воронеж",
  "Пермь",
  "Волгоград",
] as const;

export const SelectAsync: Story = {
  name: "Select / асинхронный поиск",
  parameters: { controls: { disable: true } },
  render: silentStory<FormArgs>(() => {
    const loadOptions = (
      query: string,
      signal: AbortSignal,
    ): Promise<readonly { value: string; label: string }[]> =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const needle = query.trim().toLowerCase();
          resolve(
            ASYNC_CITIES
              .filter((city) => city.toLowerCase().includes(needle))
              .map((city) => ({ value: city, label: city })),
          );
        }, 350);
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(new DOMException("Загрузка отменена", "AbortError"));
          },
          { once: true },
        );
      });
    return (
      <Box padding={4} style={{ "max-inline-size": "420px" }}>
        <Select
          id="select-async"
          options={[]}
          label="Город"
          placeholder="Начните вводить"
          searchable
          searchDelay={250}
          loadOptions={loadOptions}
          clearable
        />
      </Box>
    );
  }),
};

export const SelectVirtual: Story = {
  name: "Select / виртуальный список",
  parameters: { controls: { disable: true } },
  render: silentStory<FormArgs>(() => {
    const options = Array.from({ length: 600 }, (_, index) => ({
      value: `item-${index}`,
      label: `Опция ${index + 1}`,
      description: index % 7 === 0 ? "Описание для строки" : undefined,
    }));
    return (
      <Box padding={4} style={{ "max-inline-size": "420px" }}>
        <Select
          id="select-virtual"
          options={options}
          label="600 опций"
          placeholder="Откройте список"
          searchable
        />
      </Box>
    );
  }),
};

/* ------------------------------------------------------------------ */
/* Checkbox                                                           */
/* ------------------------------------------------------------------ */

export const CheckboxPlayground: Story = {
  name: "Checkbox / playground",
  parameters: controls([
    "label",
    "description",
    "hint",
    "error",
    "checked",
    "indeterminate",
    "required",
    "disabled",
    "readOnly",
    "onChange",
  ]),
  render: silentStory<FormArgs>((args) => (
    <Box padding={4} style={{ "max-inline-size": "460px" }}>
      <Checkbox
        label={args.label}
        description={args.description === "" ? undefined : args.description}
        hint={args.hint === "" ? undefined : args.hint}
        error={args.error === "" ? undefined : args.error}
        checked={args.checked}
        indeterminate={args.indeterminate}
        required={args.required}
        disabled={args.disabled}
        readOnly={args.readOnly}
        onChange={args.onChange}
      />
    </Box>
  )),
};

export const CheckboxStates: Story = {
  name: "Checkbox / состояния",
  parameters: { controls: { disable: true } },
  render: silentStory<FormArgs>(() => (
    <Box padding={4} style={{ "max-inline-size": "460px" }}>
      <Stack gap={3}>
        <Checkbox id="cb-unchecked" label="Не отмечен" />
        <Checkbox id="cb-checked" label="Отмечен" checked />
        <Checkbox id="cb-mixed" label="Смешанное состояние" indeterminate />
        <Checkbox id="cb-description" label="С описанием" description="Подпись и описание связаны через aria-describedby" />
        <Checkbox id="cb-error" label="Ошибка" error="Нужно согласие" />
        <Checkbox id="cb-disabled" label="disabled" disabled />
        <Checkbox id="cb-readonly" label="readOnly" readOnly checked />
      </Stack>
    </Box>
  )),
};

/* ------------------------------------------------------------------ */
/* RadioGroup                                                         */
/* ------------------------------------------------------------------ */

export const RadioGroupPlayground: Story = {
  name: "RadioGroup / playground",
  parameters: controls([
    "label",
    "hint",
    "error",
    "value",
    "required",
    "disabled",
    "readOnly",
    "withDescriptions",
    "onChange",
  ]),
  argTypes: {
    value: {
      control: "select",
      options: ["", "user", "admin", "guest"],
      description: "Выбранный пункт",
      table: { category: "Общие" },
    },
  },
  render: silentStory<FormArgs>((args) => (
    <Box padding={4} style={{ "max-inline-size": "460px" }}>
      <RadioGroup
        name="story-role"
        options={args.withDescriptions ? RADIO_OPTIONS : OPTIONS}
        label={args.label}
        hint={args.hint === "" ? undefined : args.hint}
        error={args.error === "" ? undefined : args.error}
        value={args.value}
        required={args.required}
        disabled={args.disabled}
        readOnly={args.readOnly}
        onChange={args.onChange}
      />
    </Box>
  )),
};

export const RadioGroupStates: Story = {
  name: "RadioGroup / состояния",
  parameters: { controls: { disable: true } },
  render: silentStory<FormArgs>(() => (
    <Box padding={4} style={{ "max-inline-size": "460px" }}>
      <Stack gap={4}>
        <RadioGroup name="story-role-a" options={RADIO_OPTIONS} label="Роль" value="user" />
        <RadioGroup name="story-role-b" options={OPTIONS} label="Без выбора" />
        <RadioGroup name="story-role-c" options={OPTIONS} label="Ошибка" error="Выберите роль" />
        <RadioGroup name="story-role-d" options={OPTIONS} label="disabled" disabled value="user" />
      </Stack>
    </Box>
  )),
};

/* ------------------------------------------------------------------ */
/* Switch                                                             */
/* ------------------------------------------------------------------ */

export const SwitchPlayground: Story = {
  name: "Switch / playground",
  parameters: controls([
    "label",
    "description",
    "hint",
    "error",
    "checked",
    "size",
    "required",
    "disabled",
    "readOnly",
    "onChange",
  ]),
  render: silentStory<FormArgs>((args) => (
    <Box padding={4} style={{ "max-inline-size": "460px" }}>
      <Switch
        label={args.label}
        description={args.description === "" ? undefined : args.description}
        hint={args.hint === "" ? undefined : args.hint}
        error={args.error === "" ? undefined : args.error}
        checked={args.checked}
        size={args.size}
        required={args.required}
        disabled={args.disabled}
        readOnly={args.readOnly}
        onChange={args.onChange}
      />
    </Box>
  )),
};

export const SwitchStates: Story = {
  name: "Switch / размеры и состояния",
  parameters: { controls: { disable: true } },
  render: silentStory<FormArgs>(() => (
    <Box padding={4} style={{ "max-inline-size": "460px" }}>
      <Stack gap={3}>
        <Switch id="switch-sm" size="sm" label="sm" checked />
        <Switch id="switch-md" label="md" checked />
        <Switch id="switch-lg" size="lg" label="lg" checked />
        <Switch id="switch-off" label="Выключен" />
        <Switch id="switch-description" label="С описанием" description="Push только для упоминаний" checked />
        <Switch id="switch-error" label="Ошибка" error="Недоступно в вашем тарифе" />
        <Switch id="switch-disabled" label="disabled" disabled checked />
        <Switch id="switch-readonly" label="readOnly" readOnly checked />
      </Stack>
    </Box>
  )),
};

/* ------------------------------------------------------------------ */
/* Slider                                                             */
/* ------------------------------------------------------------------ */

export const SliderPlayground: Story = {
  name: "Slider / playground",
  parameters: controls([
    "label",
    "hint",
    "error",
    "sliderValue",
    "min",
    "max",
    "step",
    "unit",
    "output",
    "disabled",
    "required",
    "onInput",
    "onChange",
  ]),
  render: silentStory<FormArgs>((args) => {
    const [value, setValue] = createSignal(args.sliderValue);
    return (
      <Box padding={4} style={{ "max-inline-size": "460px" }}>
        <Slider
          label={args.label}
          hint={args.hint === "" ? undefined : args.hint}
          error={args.error === "" ? undefined : args.error}
          value={value()}
          min={args.min}
          max={args.max}
          step={args.step}
          unit={args.unit}
          output={args.output}
          required={args.required}
          disabled={args.disabled}
          onInput={(event) => {
            const next = Number((event.currentTarget as HTMLInputElement | null)?.value);
            if (Number.isFinite(next)) setValue(next);
            args.onInput(event);
          }}
          onChange={args.onChange}
        />
      </Box>
    );
  }),
};

export const SliderStates: Story = {
  name: "Slider / состояния",
  parameters: { controls: { disable: true } },
  render: silentStory<FormArgs>(() => (
    <Box padding={4} style={{ "max-inline-size": "460px" }}>
      <Stack gap={5}>
        <Slider id="slider-volume" label="Громкость" min={0} max={100} step={5} unit="%" value={40} />
        <Slider id="slider-no-output" label="Без output" min={0} max={10} value={3} output={false} />
        <Slider
          id="slider-format"
          label="Формат значения"
          min={0}
          max={8}
          value={4}
          formatValue={(current) => `${current} из 8 задач`}
        />
        <Slider id="slider-error" label="Ошибка" min={0} max={100} value={10} error="Слишком тихо" />
        <Slider id="slider-disabled" label="disabled" min={0} max={100} value={60} disabled />
      </Stack>
    </Box>
  )),
};

/* ------------------------------------------------------------------ */
/* FileField                                                          */
/* ------------------------------------------------------------------ */

export const FileFieldPlayground: Story = {
  name: "FileField / playground",
  parameters: controls([
    "label",
    "hint",
    "error",
    "accept",
    "fileValue",
    "progress",
    "chooseLabel",
    "required",
    "disabled",
    "onFiles",
  ]),
  render: silentStory<FormArgs>((args) => (
    <Box padding={4} style={{ "max-inline-size": "460px" }}>
      <FileField
        label={args.label}
        hint={args.hint === "" ? undefined : args.hint}
        error={args.error === "" ? undefined : args.error}
        accept={args.accept === "" ? undefined : args.accept}
        value={args.fileValue === "" ? undefined : args.fileValue}
        progress={args.progress === 0 ? undefined : args.progress}
        chooseLabel={args.chooseLabel}
        required={args.required}
        disabled={args.disabled}
        onFiles={(files) => {
          args.onFiles(files);
        }}
      />
    </Box>
  )),
};

export const FileFieldStates: Story = {
  name: "FileField / состояния",
  parameters: { controls: { disable: true } },
  render: silentStory<FormArgs>(() => (
    <Box padding={4} style={{ "max-inline-size": "460px" }}>
      <Stack gap={5}>
        <FileField id="file-doc" label="Документ" hint="PDF до 5 МБ" accept="application/pdf" chooseLabel="Выбрать PDF" />
        <FileField id="file-progress" label="Загрузка" value="contract.pdf" progress={64} />
        <FileField id="file-multiple" label="Несколько файлов" multiple value="scan-1.pdf, scan-2.pdf" />
        <FileField id="file-error" label="Ошибка" error="Файл больше 5 МБ" />
        <FileField id="file-disabled" label="disabled" disabled />
      </Stack>
    </Box>
  )),
};

/* ------------------------------------------------------------------ */
/* Field                                                              */
/* ------------------------------------------------------------------ */

export const FieldPlayground: Story = {
  name: "Field / playground",
  parameters: controls([
    "label",
    "hint",
    "error",
    "required",
    "disabled",
    "invalid",
    "touched",
    "validating",
    "bare",
  ]),
  render: silentStory<FormArgs>((args) => (
    <Box padding={4} style={{ "max-inline-size": "460px" }}>
      <Field
        id="story-field"
        htmlFor="story-field"
        label={args.label}
        hint={args.hint === "" ? undefined : args.hint}
        error={args.error === "" ? undefined : args.error}
        required={args.required}
        disabled={args.disabled}
        invalid={args.invalid}
        touched={args.touched}
        validating={args.validating}
        bare={args.bare}
      >
        <TextField bare id="story-field" placeholder={args.placeholder} />
      </Field>
    </Box>
  )),
};

export const FieldStates: Story = {
  name: "Field / состояния",
  parameters: { controls: { disable: true } },
  render: silentStory<FormArgs>(() => (
    <Box padding={4} style={{ "max-inline-size": "620px" }}>
      <Stack gap={4}>
        <Field id="field-1" label="Подпись" hint="Подсказка под контролом">
          <TextField bare id="field-1" placeholder="Контрол без своей обёртки" />
        </Field>
        <Field id="field-2" label="Ошибка" error="Сообщение об ошибке">
          <TextField bare id="field-2" value="неверно" />
        </Field>
        <Field id="field-3" label="Проверка" validating>
          <TextField bare id="field-3" value="ada@example.com" />
        </Field>
        <Field id="field-4" label="Посещено" touched>
          <TextField bare id="field-4" placeholder="data-touched" />
        </Field>
        <Field id="field-5" label="Невалидно без текста" invalid>
          <TextField bare id="field-5" />
        </Field>
        <Field id="field-6" label="disabled" disabled>
          <TextField bare id="field-6" disabled />
        </Field>
      </Stack>
    </Box>
  )),
};

/* ------------------------------------------------------------------ */
/* FieldGroup + FormActions                                           */
/* ------------------------------------------------------------------ */

export const FieldGroupPlayground: Story = {
  name: "FieldGroup / playground",
  parameters: controls(["legend", "hint", "layout", "columns", "maxWidth", "disabled"]),
  render: silentStory<FormArgs>((args) => (
    <Box padding={4}>
      <FieldGroup
        legend={args.legend}
        hint={args.hint === "" ? undefined : args.hint}
        layout={args.layout}
        columns={args.columns === "none" ? undefined : args.columns}
        maxWidth={args.maxWidth}
        disabled={args.disabled}
      >
        <Field id="group-name" label="Имя">
          <TextField bare id="group-name" placeholder="Ада" />
        </Field>
        <Field id="group-email" label="Почта">
          <TextField bare id="group-email" type="email" placeholder="ada@example.com" />
        </Field>
        <Field id="group-city" label="Город">
          <TextField bare id="group-city" placeholder="Лондон" />
        </Field>
      </FieldGroup>
    </Box>
  )),
};

export const FormActionsPlayground: Story = {
  name: "FormActions / playground",
  parameters: controls([
    "align",
    "submit",
    "reset",
    "submitLabel",
    "resetLabel",
    "loading",
    "disabled",
    "sticky",
    "onSubmit",
    "onReset",
  ]),
  render: silentStory<FormArgs>((args) => (
    <Box padding={4} style={{ "max-inline-size": "640px" }}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <FormActions
          align={args.align}
          submit={args.submit}
          reset={args.reset}
          submitLabel={args.submitLabel}
          resetLabel={args.resetLabel}
          loading={args.loading}
          disabled={args.disabled}
          sticky={args.sticky}
          onSubmit={args.onSubmit}
          onReset={args.onReset}
        >
          <Button variant="text" type="button">
            Черновик
          </Button>
        </FormActions>
      </form>
    </Box>
  )),
};

export const FormActionsSticky: Story = {
  name: "FormActions / sticky в скролле",
  parameters: { controls: { disable: true } },
  render: silentStory<FormArgs>(() => (
    <Box padding={4} style={{ "max-inline-size": "640px" }}>
      <Text variant="body-small" tone="muted">
        Контейнер ограничен по высоте: подвал остаётся у нижней кромки при прокрутке.
      </Text>
      <form
        style={{
          "block-size": "260px",
          overflow: "auto",
          "border": "1px solid var(--sui-color-outline-variant)",
          "border-radius": "var(--sui-radius-md)",
          "margin-block-start": "var(--sui-space-3)",
        }}
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <Stack gap={4} style={{ padding: "var(--sui-space-4)" }}>
          {["Имя", "Почта", "Телефон", "Город", "Адрес"].map((label, index) => (
            <TextField key={label} id={`sticky-field-${index}`} label={label} placeholder={`Поле ${index + 1}`} />
          ))}
        </Stack>
        <FormActions sticky align="end" submitLabel="Сохранить">
          <Button variant="text" type="button">
            Отмена
          </Button>
        </FormActions>
      </form>
    </Box>
  )),
};

/* ------------------------------------------------------------------ */
/* FieldArray + настоящая Form                                        */
/* ------------------------------------------------------------------ */

function FieldArrayDemo(args: FormArgs): Node {
  const form = new OrderForm({ formId: "story-order" });
  onCleanup(() => form.dispose());
  const array = form.getFieldArray("items");
  if (array.length === 0) {
    array.add();
    array.add();
  }
  const [revision, setRevision] = createSignal(0);
  const bump = (): void => {
    setRevision((value) => value + 1);
  };

  return (
    <Box padding={4} style={{ "max-inline-size": "640px" }}>
      <Stack gap={4}>
        <Text variant="body-small" tone="muted">
          Строк: {(() => {
            revision();
            return array.length;
          })()}{" "}
          из {args.maxItems}
        </Text>
        <FieldArray
          array={array}
          label="Позиции заказа"
          hint="Порядок строк меняется кнопками ↑ и ↓"
          disabled={args.disabled}
          min={args.minItems}
          max={args.maxItems}
          allowMove={args.allowMove}
          addLabel={args.addLabel}
          removeLabel={args.removeLabel}
          moveUpLabel="Переместить выше"
          moveDownLabel="Переместить ниже"
          onAdd={(item) => {
            bump();
            args.onAdd(item);
          }}
          onRemove={(index) => {
            bump();
            args.onRemove(index);
          }}
          onMove={(from, to) => {
            bump();
            args.onMove(from, to);
          }}
        >
          {(item, index) => (
            <Stack gap={3}>
              <Text variant="label-medium" tone="muted">
                Позиция {index + 1}
              </Text>
              <TextField field={item.getFieldProps("name")} required />
              <TextField
                field={item.getFieldProps("quantity")}
                type="number"
                hint="Целое число"
              />
            </Stack>
          )}
        </FieldArray>
      </Stack>
    </Box>
  );
}

export const FieldArrayPlayground: Story = {
  name: "FieldArray / playground",
  parameters: controls([
    "disabled",
    "allowMove",
    "minItems",
    "maxItems",
    "addLabel",
    "removeLabel",
    "onAdd",
    "onRemove",
    "onMove",
  ]),
  render: silentStory<FormArgs>((args) => FieldArrayDemo(args)),
};

/* ------------------------------------------------------------------ */
/* SearchField                                                        */
/* ------------------------------------------------------------------ */

export const SearchFieldPlayground: Story = {
  name: "SearchField / playground",
  parameters: controls([
    "label",
    "hint",
    "error",
    "value",
    "placeholder",
    "size",
    "required",
    "disabled",
    "readOnly",
    "bare",
    "clearLabel",
    "onInput",
    "onValueChange",
    "onSearch",
    "onClear",
  ]),
  render: silentStory<FormArgs>((args) => {
    const [query, setQuery] = createSignal(args.value);
    return (
      <Box padding={4} style={{ "max-inline-size": "480px" }}>
        <SearchField
          label={args.label}
          hint={args.hint === "" ? undefined : args.hint}
          error={args.error === "" ? undefined : args.error}
          value={query()}
          placeholder={args.placeholder}
          size={args.size}
          required={args.required}
          disabled={args.disabled}
          readOnly={args.readOnly}
          bare={args.bare}
          clearLabel={args.clearLabel}
          onInput={(event) => {
            setQuery((event.currentTarget as HTMLInputElement | null)?.value ?? "");
            args.onInput(event);
          }}
          onValueChange={args.onValueChange}
          onSearch={args.onSearch}
          onClear={() => {
            setQuery("");
            args.onClear();
          }}
        />
      </Box>
    );
  }),
};

export const SearchFieldStates: Story = {
  name: "SearchField / состояния",
  parameters: { controls: { disable: true } },
  render: silentStory<FormArgs>(() => (
    <Box padding={4} style={{ "max-inline-size": "480px" }}>
      <Stack gap={4}>
        <SearchField id="search-empty" label="Пустой" placeholder="Название компонента" />
        <SearchField id="search-query" label="С запросом" value="accordion" hint="Enter запускает поиск" />
        <SearchField id="search-lg" size="lg" label="lg" value="table" />
        <SearchField id="search-error" label="Ошибка" error="Запрос слишком короткий" />
        <SearchField id="search-disabled" label="disabled" disabled placeholder="Недоступно" />
        <SearchField id="search-readonly" label="readOnly" readOnly value="зафиксировано" />
        <SearchField id="search-arialabel" ariaLabel="Поиск без видимой подписи" placeholder="aria-label из placeholder" />
        <SearchField
          id="search-long"
          label="Длинный запрос"
          value="очень длинный поисковый запрос, который не должен раздувать строку"
        />
      </Stack>
    </Box>
  )),
};

/* ------------------------------------------------------------------ */
/* Темы, узкий экран, длинный текст                                   */
/* ------------------------------------------------------------------ */

export const Themes: Story = {
  name: "Темы",
  parameters: { controls: { disable: true } },
  render: silentStory<FormArgs>(() => (
    <div style={{ display: "flex", gap: "1.5rem", "align-items": "flex-start", "flex-wrap": "wrap" }}>
      {[
        { theme: "light", title: "Light" },
        { theme: "dark", title: "Dark" },
      ].map(({ theme, title }) => (
        <div
          key={theme}
          data-theme={theme}
          style={{
            flex: "1 1 320px",
            padding: "1rem",
            background: "var(--sui-color-surface)",
            color: "var(--sui-color-on-surface)",
          }}
        >
          <Stack gap={4}>
            <Heading level={3}>{title}</Heading>
            <TextField id={`theme-${theme}-name`} label="Имя" hint="Светлая и тёмная темы используют одни токены" />
            <Select id={`theme-${theme}-role`} options={OPTIONS} label="Роль" value="user" />
            <Checkbox id={`theme-${theme}-consent`} label="Согласие" description="Обязательное условие" checked />
            <Switch id={`theme-${theme}-notify`} label="Уведомления" checked />
            <Slider id={`theme-${theme}-volume`} label="Громкость" value={40} unit="%" />
            <FormActions submitLabel="Сохранить" />
          </Stack>
        </div>
      ))}
    </div>
  )),
};

export const NarrowScreen: Story = {
  name: "Узкий экран (360px)",
  parameters: { controls: { disable: true }, viewport: { defaultViewport: "mobile360" } },
  render: silentStory<FormArgs>(() => (
    <Box padding={3} style={{ "inline-size": "360px", "max-inline-size": "100%" }}>
      <Stack gap={4}>
        <Text variant="body-small" tone="muted">
          На узком экране контролы занимают всю ширину, а `FieldGroup columns` схлопывается в одну колонку.
        </Text>
        <FieldGroup legend="Профиль" columns={2} maxWidth="default">
          <Field id="narrow-name" label="Имя">
            <TextField bare id="narrow-name" placeholder="Ада" />
          </Field>
          <Field id="narrow-email" label="Почта">
            <TextField bare id="narrow-email" type="email" placeholder="ada@example.com" />
          </Field>
        </FieldGroup>
        <TextField id="narrow-long" label="Длинная подпись поля, которая переносится" hint="И подсказка тоже" />
        <Select id="narrow-role-select" options={OPTIONS} label="Роль" value="guest" />
        <RadioGroup name="narrow-role" options={RADIO_OPTIONS} label="Роль с описаниями" value="user" />
        <Checkbox id="narrow-consent" label="Длинное описание" description="Текст описания переносится по словам и не вылезает за контейнер" />
        <FormActions align="between" submitLabel="Отправить" />
      </Stack>
    </Box>
  )),
};

export const LongText: Story = {
  name: "Длинный текст и ошибки",
  parameters: { controls: { disable: true } },
  render: silentStory<FormArgs>(() => (
    <Box padding={4} style={{ "max-inline-size": "420px" }}>
      <Stack gap={5}>
        <TextField
          id="long-label"
          label="Очень длинная подпись поля, которая должна переноситься по словам, а не обрезаться"
          hint="Подсказка тоже может быть длинной и занимать несколько строк под контролом"
          value="ada@example.com"
        />
        <TextField
          id="long-error"
          label="Ошибка"
          value="plain"
          error="Почта должна быть в формате name@example.com — проверьте домен и повторите попытку"
        />
        <Textarea
          id="long-textarea"
          label="Комментарий"
          counter
          maxLength={120}
          value="Длинный текст в textarea не расширяет контейнер: поле сохраняет ширину формы"
        />
        <FileField
          id="long-file"
          label="Файл"
          value="очень-длинное-имя-документа-с-версией-и-датой-2026-11-24.pdf"
          progress={100}
        />
      </Stack>
    </Box>
  )),
};

export const FormComposition: Story = {
  name: "Композиция формы",
  parameters: { controls: { disable: true } },
  render: silentStory<FormArgs>(() => (
    <Box padding={4} style={{ "max-inline-size": "720px" }}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <Stack gap={5}>
          <FieldGroup legend="Аккаунт" hint="Данные сохраняются после отправки" columns={2}>
            <TextField id="compose-name" label="Имя" required placeholder="Ада" />
            <TextField id="compose-email" label="Почта" type="email" required placeholder="ada@example.com" />
            <Select id="compose-role" options={OPTIONS} label="Роль" required placeholder="Выберите роль" />
            <TextField id="compose-phone" label="Телефон" type="tel" placeholder="+7 900 000-00-00" />
          </FieldGroup>
          <Divider />
          <FieldGroup legend="Предпочтения">
            <Switch id="compose-digest" label="Дайджест" description="Раз в неделю" checked />
            <Checkbox id="compose-consent" label="Согласие" description="Я принимаю условия" required />
          </FieldGroup>
          <FormActions align="end" submitLabel="Сохранить" />
        </Stack>
      </form>
    </Box>
  )),
};
