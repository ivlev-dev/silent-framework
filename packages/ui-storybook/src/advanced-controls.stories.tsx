import type { Meta, StoryObj } from "@storybook/html-vite";
import { fn } from "storybook/test";
import { Box, Heading, Inline, Stack, Text } from "@ivlev-dev/silent-ui";
import { NumberField } from "@ivlev-dev/silent-ui/form/number-field";
import { OtpInput } from "@ivlev-dev/silent-ui/form/otp-input";
import { Combobox } from "@ivlev-dev/silent-ui/form/combobox";
import { TagInput } from "@ivlev-dev/silent-ui/form/tag-input";
import { silentStory } from "./silent-story.js";

type Size = "sm" | "md" | "lg";

interface AdvancedArgs {
  readonly label: string;
  readonly hint: string;
  readonly error: string;
  readonly size: Size;
  readonly disabled: boolean;
  readonly readOnly: boolean;
  readonly required: boolean;
  readonly placeholder: string;
  readonly value: string;
  readonly numberValue: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly unit: string;
  readonly steppers: boolean;
  readonly length: number;
  readonly mask: boolean;
  readonly groups: string;
  readonly separator: string;
  readonly allowCustom: boolean;
  readonly clearable: boolean;
  readonly maxTags: number;
  readonly suggestions: string;
  readonly onValueChange: (value: unknown) => void;
  readonly onComplete: (value: string) => void;
  readonly onInput: (event: InputEvent) => void;
  readonly onChange: (event: Event) => void;
}

function controls(names: readonly string[]): { controls: { include: string[] } } {
  return { controls: { include: [...names] } };
}

const meta = {
  title: "Components/Advanced Controls",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: [
          "Продвинутые контролы форм: `NumberField` со сте́пперами и единицей,",
          "`OtpInput` с группами и маской, `Combobox` с фильтрацией и свободным",
          "вводом и `TagInput` с подсказками, ограничениями и валидацией.",
          "Все контролы используют общий `Field`: одинаковая высота `sm/md/lg`,",
          "стабильный слот подсказки/ошибки, `focus-visible` и disabled-тон.",
        ].join(" "),
      },
      canvas: { sourceState: "shown" },
    },
  },
  argTypes: {
    label: { control: "text", description: "Подпись поля", table: { category: "Общие" } },
    hint: { control: "text", description: "Подсказка под контролом", table: { category: "Общие" } },
    error: { control: "text", description: "Текст ошибки", table: { category: "Общие" } },
    size: {
      control: "inline-radio",
      options: ["sm", "md", "lg"],
      description: "Размер контрола",
      table: { category: "Общие", defaultValue: { summary: "md" } },
    },
    disabled: { control: "boolean", description: "Недоступно", table: { category: "Общие" } },
    readOnly: { control: "boolean", description: "Только чтение", table: { category: "Общие" } },
    required: { control: "boolean", description: "Обязательное поле", table: { category: "Общие" } },
    placeholder: { control: "text", description: "Плейсхолдер", table: { category: "Общие" } },
    value: { control: "text", description: "Текстовое значение", table: { category: "Общие" } },
    numberValue: { control: "number", description: "Значение NumberField", table: { category: "NumberField" } },
    min: { control: "number", description: "Минимум", table: { category: "NumberField" } },
    max: { control: "number", description: "Максимум", table: { category: "NumberField" } },
    step: { control: "number", description: "Шаг", table: { category: "NumberField" } },
    unit: { control: "text", description: "Единица измерения", table: { category: "NumberField" } },
    steppers: { control: "boolean", description: "Кнопки «больше/меньше»", table: { category: "NumberField" } },
    length: { control: "number", description: "Число разрядов OTP", table: { category: "OtpInput" } },
    mask: { control: "boolean", description: "Скрывать символы", table: { category: "OtpInput" } },
    groups: { control: "text", description: "Группы через запятую", table: { category: "OtpInput" } },
    separator: { control: "text", description: "Разделитель групп", table: { category: "OtpInput" } },
    allowCustom: { control: "boolean", description: "Разрешать свои теги", table: { category: "TagInput" } },
    clearable: { control: "boolean", description: "Кнопка очистки", table: { category: "TagInput" } },
    maxTags: { control: "number", description: "Максимум тегов", table: { category: "TagInput" } },
    suggestions: { control: "text", description: "Подсказки через запятую", table: { category: "TagInput" } },
    onValueChange: {
      action: "valueChange",
      description: "Значение изменилось",
      table: { category: "События" },
    },
    onComplete: { action: "complete", description: "OTP заполнен", table: { category: "События" } },
    onInput: { action: "input", description: "Ввод", table: { category: "События" } },
    onChange: { action: "change", description: "Изменение", table: { category: "События" } },
  },
  args: {
    label: "Количество",
    hint: "От 1 до 99",
    error: "",
    size: "md",
    disabled: false,
    readOnly: false,
    required: false,
    placeholder: "",
    value: "",
    numberValue: 12,
    min: 1,
    max: 99,
    step: 1,
    unit: "шт.",
    steppers: true,
    length: 6,
    mask: false,
    groups: "3, 3",
    separator: "—",
    allowCustom: true,
    clearable: true,
    maxTags: 6,
    suggestions: "React, Vue, Svelte, Solid, Angular",
    onValueChange: fn(),
    onComplete: fn(),
    onInput: fn(),
    onChange: fn(),
  },
} satisfies Meta<AdvancedArgs>;

export default meta;

type Story = StoryObj<AdvancedArgs>;

interface ComboOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
}

const FRUITS: readonly ComboOption[] = [
  { value: "apple", label: "Яблоко" },
  { value: "apricot", label: "Абрикос" },
  { value: "avocado", label: "Авокадо" },
  { value: "banana", label: "Банан" },
  { value: "blueberry", label: "Голубика" },
  { value: "cherry", label: "Вишня", disabled: true },
];

function groupsFrom(value: string): readonly number[] | undefined {
  const parts = value
    .split(",")
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((part) => Number.isFinite(part) && part > 0);
  return parts.length === 0 ? undefined : parts;
}

function listFrom(value: string): readonly string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

function common(args: AdvancedArgs) {
  return {
    label: args.label,
    hint: args.hint === "" ? undefined : args.hint,
    error: args.error === "" ? undefined : args.error,
    size: args.size,
    disabled: args.disabled,
    readOnly: args.readOnly,
    required: args.required,
  };
}

export const NumberFieldPlayground: Story = {
  name: "NumberField / playground",
  parameters: controls([
    "label",
    "hint",
    "error",
    "size",
    "disabled",
    "readOnly",
    "required",
    "numberValue",
    "min",
    "max",
    "step",
    "unit",
    "steppers",
    "placeholder",
    "onValueChange",
  ]),
  render: silentStory<AdvancedArgs>((args) => (
    <Box padding={4} style={{ "max-inline-size": "420px" }}>
      <NumberField
        {...common(args)}
        value={args.numberValue}
        min={args.min}
        max={args.max}
        step={args.step}
        unit={args.unit === "" ? undefined : args.unit}
        steppers={args.steppers}
        placeholder={args.placeholder === "" ? undefined : args.placeholder}
        onValueChange={args.onValueChange}
      />
    </Box>
  )),
};

export const NumberFieldStates: Story = {
  name: "NumberField / размеры и состояния",
  parameters: { controls: { disable: true } },
  render: silentStory<AdvancedArgs>(() => (
    <Box padding={4} style={{ "max-inline-size": "420px" }}>
      <Stack gap={4}>
        <NumberField id="nf-sm" size="sm" label="sm" defaultValue={1} unit="шт." />
        <NumberField id="nf-md" label="md" defaultValue={12} unit="шт." />
        <NumberField id="nf-lg" size="lg" label="lg" defaultValue={120} unit="шт." />
        <NumberField id="nf-precision" label="Дробное" step={0.25} defaultValue={1.5} unit="кг" />
        <NumberField id="nf-readonly" label="readOnly" readOnly defaultValue={7} />
        <NumberField id="nf-disabled" label="disabled" disabled defaultValue={7} hint="Недоступно" />
        <NumberField id="nf-error" label="Ошибка" defaultValue={0} min={1} error="Минимум — 1" />
      </Stack>
    </Box>
  )),
};

export const OtpPlayground: Story = {
  name: "OtpInput / playground",
  args: {
    label: "Код подтверждения",
    hint: "Шесть цифр из письма",
    groups: "3, 3",
  },
  parameters: controls([
    "label",
    "hint",
    "error",
    "size",
    "disabled",
    "required",
    "value",
    "length",
    "mask",
    "groups",
    "separator",
    "onComplete",
    "onValueChange",
  ]),
  render: silentStory<AdvancedArgs>((args) => (
    <Box padding={4} style={{ "max-inline-size": "480px" }}>
      <OtpInput
        {...common(args)}
        value={args.value === "" ? undefined : args.value}
        length={args.length}
        mask={args.mask}
        groups={groupsFrom(args.groups)}
        separator={args.separator === "" ? undefined : args.separator}
        onComplete={args.onComplete}
        onValueChange={args.onValueChange}
      />
    </Box>
  )),
};

export const OtpStates: Story = {
  name: "OtpInput / размеры и состояния",
  parameters: { controls: { disable: true } },
  render: silentStory<AdvancedArgs>(() => (
    <Box padding={4} style={{ "max-inline-size": "480px" }}>
      <Stack gap={4}>
        <OtpInput id="otp-sm" size="sm" label="sm" defaultValue="123" />
        <OtpInput id="otp-md" label="md" defaultValue="123" />
        <OtpInput id="otp-lg" size="lg" label="lg" defaultValue="123456" />
        <OtpInput id="otp-groups" label="Группы 4/4" length={8} groups={[4, 4]} separator="—" />
        <OtpInput id="otp-mask" label="Маска" mask defaultValue="1234" hint="Код из письма" />
        <OtpInput id="otp-disabled" label="disabled" disabled defaultValue="123456" />
        <OtpInput id="otp-error" label="Ошибка" defaultValue="12" error="Введите все 6 цифр" />
      </Stack>
    </Box>
  )),
};

export const ComboboxPlayground: Story = {
  name: "Combobox / playground",
  args: {
    label: "Любимый фрукт",
    hint: "",
    placeholder: "Начните вводить фрукт",
  },
  parameters: controls([
    "label",
    "hint",
    "error",
    "size",
    "disabled",
    "readOnly",
    "required",
    "placeholder",
    "clearable",
    "value",
    "onValueChange",
  ]),
  render: silentStory<AdvancedArgs>((args) => (
    <Box padding={4} style={{ "max-inline-size": "420px" }}>
      <Combobox
        {...common(args)}
        options={FRUITS}
        value={args.value === "" ? undefined : args.value}
        placeholder={args.placeholder === "" ? "Начните вводить фрукт" : args.placeholder}
        clearable={args.clearable}
        onValueChange={args.onValueChange}
      />
    </Box>
  )),
};

export const ComboboxStates: Story = {
  name: "Combobox / состояния и свободный ввод",
  parameters: { controls: { disable: true } },
  render: silentStory<AdvancedArgs>(() => (
    <Box padding={4} style={{ "max-inline-size": "420px" }}>
      <Stack gap={4}>
        <Combobox id="cb-md" label="md" options={FRUITS} placeholder="Выберите фрукт" clearable />
        <Combobox id="cb-sm" size="sm" label="sm" options={FRUITS} placeholder="sm" />
        <Combobox id="cb-lg" size="lg" label="lg" options={FRUITS} placeholder="lg" />
        <Combobox
          id="cb-custom"
          label="Свободный ввод"
          options={FRUITS}
          allowCustomValue
          creatable
          hint="Можно ввести свой вариант и нажать Enter"
        />
        <Combobox id="cb-disabled" label="disabled" options={FRUITS} disabled placeholder="Недоступно" />
        <Combobox id="cb-error" label="Ошибка" options={FRUITS} error="Обязательное поле" />
        <Combobox id="cb-loading" label="Загрузка" options={[]} loading placeholder="Ищем варианты…" />
      </Stack>
    </Box>
  )),
};

export const TagInputPlayground: Story = {
  name: "TagInput / playground",
  args: {
    label: "Технологии",
    hint: "Enter или запятая добавляет тег",
    value: "React, Vue",
    placeholder: "Добавьте тег",
  },
  parameters: controls([
    "label",
    "hint",
    "error",
    "size",
    "disabled",
    "readOnly",
    "required",
    "placeholder",
    "value",
    "allowCustom",
    "clearable",
    "maxTags",
    "suggestions",
    "onValueChange",
  ]),
  render: silentStory<AdvancedArgs>((args) => (
    <Box padding={4} style={{ "max-inline-size": "480px" }}>
      <TagInput
        {...common(args)}
        defaultValue={listFrom(args.value)}
        suggestions={listFrom(args.suggestions)}
        allowCustom={args.allowCustom}
        clearable={args.clearable}
        max={args.maxTags}
        placeholder={args.placeholder === "" ? "Добавьте тег" : args.placeholder}
        onValueChange={args.onValueChange}
      />
    </Box>
  )),
};

export const TagInputStates: Story = {
  name: "TagInput / состояния",
  parameters: { controls: { disable: true } },
  render: silentStory<AdvancedArgs>(() => (
    <Box padding={4} style={{ "max-inline-size": "480px" }}>
      <Stack gap={4}>
        <TagInput id="ti-md" label="md" defaultValue={["React", "Vue"]} suggestions={["Svelte", "Solid"]} />
        <TagInput id="ti-sm" size="sm" label="sm" defaultValue={["sm"]} />
        <TagInput id="ti-lg" size="lg" label="lg" defaultValue={["lg"]} />
        <TagInput
          id="ti-limit"
          label="Лимит и без своих тегов"
          defaultValue={["React"]}
          suggestions={["Vue", "Svelte"]}
          allowCustom={false}
          max={3}
          hint="До трёх тегов из списка"
        />
        <TagInput id="ti-readonly" label="readOnly" readOnly defaultValue={["React"]} />
        <TagInput id="ti-disabled" label="disabled" disabled defaultValue={["React"]} />
        <TagInput id="ti-error" label="Ошибка" defaultValue={[]} error="Добавьте хотя бы один тег" />
      </Stack>
    </Box>
  )),
};

export const Themes: Story = {
  name: "Advanced Controls / light и dark",
  parameters: { controls: { disable: true } },
  render: silentStory<AdvancedArgs>(() => (
    <Inline gap={4} align="start" wrap>
      {(["light", "dark"] as const).map((theme) => (
        <Box
          key={theme}
          attrs={{ "data-theme": theme }}
          padding={4}
          style={{ "flex": "1 1 320px", "max-inline-size": "420px" }}
        >
          <Stack gap={4}>
            <Heading level={3} variant="title-small">Тема {theme}</Heading>
            <NumberField id={`theme-${theme}-number`} label="Количество" defaultValue={12} unit="шт." />
            <OtpInput id={`theme-${theme}-otp`} label="Код" defaultValue="123" />
            <Combobox id={`theme-${theme}-combo`} label="Фрукт" options={FRUITS} placeholder="Выберите" />
            <TagInput id={`theme-${theme}-tags`} label="Теги" defaultValue={["React", "Vue"]} />
          </Stack>
        </Box>
      ))}
    </Inline>
  )),
};

export const Narrow: Story = {
  name: "Advanced Controls / 360px",
  parameters: { controls: { disable: true }, viewport: { defaultViewport: "mobile360" } },
  render: silentStory<AdvancedArgs>(() => (
    <Box padding={3} style={{ "max-inline-size": "360px" }}>
      <Stack gap={4}>
        <Text variant="body-small" tone="muted">
          Контролы не выходят за 360px и сохраняют touch-цели.
        </Text>
        <NumberField id="narrow-number" label="Количество" defaultValue={12} unit="шт." hint="Со сте́пперами" />
        <OtpInput id="narrow-otp" label="Код из SMS" defaultValue="123456" />
        <Combobox id="narrow-combo" label="Фрукт" options={FRUITS} placeholder="Выберите" clearable />
        <TagInput
          id="narrow-tags"
          label="Теги"
          defaultValue={["Очень длинный тег", "React"]}
          max={4}
          allowCustom
        />
      </Stack>
    </Box>
  )),
};
