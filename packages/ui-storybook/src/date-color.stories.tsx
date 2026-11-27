import type { Meta, StoryObj } from "@storybook/html-vite";
import { expect, fn } from "storybook/test";
import { createSignal, type Children } from "@ivlev-dev/silent-core";
import { ColorPicker } from "@ivlev-dev/silent-ui/color-picker";
import { DatePicker, parseDateValue } from "@ivlev-dev/silent-ui/date-picker";
import {
  DateRangePicker,
  type DateRangeValue,
} from "@ivlev-dev/silent-ui/date-range-picker";

type ControlSize = "sm" | "md" | "lg";

interface DateColorArgs {
  readonly value: string;
  readonly start: string;
  readonly end: string;
  readonly min: string;
  readonly max: string;
  readonly format: string;
  readonly locale: string;
  readonly size: ControlSize;
  readonly label: string;
  readonly hint: string;
  readonly error: string;
  readonly disabled: boolean;
  readonly readOnly: boolean;
  readonly required: boolean;
  readonly clearable: boolean;
  readonly showPresets: boolean;
  readonly color: string;
  readonly colorFormat: "hex" | "rgb" | "hsl";
  readonly showAlpha: boolean;
  readonly ariaLabel: string;
  readonly onValueChange: (value: Date | null) => void;
  readonly onRangeChange: (value: DateRangeValue) => void;
  readonly onColorChange: (value: string) => void;
}

function dateOf(value: string, format: string, locale: string): Date | null {
  return parseDateValue(value, { format: format === "" ? undefined : format, locale });
}

function stage(children: Children): Node {
  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: "var(--sui-space-5)",
        "align-items": "stretch",
        "max-inline-size": "28rem",
        padding: "var(--sui-space-5)",
      }}
    >
      {children}
    </div>
  );
}

const meta = {
  title: "Components/Date & Color",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "`DatePicker`, `DateRangePicker` и `ColorPicker` на токенах дизайн-системы: " +
          "календарь с выбором месяца/года, диапазон с пресетами и цветовая палитра " +
          "с HEX/RGB/HSL-вводом. Все контролы поддерживают controlled/uncontrolled " +
          "значение, клавиатуру и доступные имена.",
      },
      canvas: { sourceState: "shown" },
    },
  },
  argTypes: {
    value: { control: "text" },
    start: { control: "text" },
    end: { control: "text" },
    min: { control: "text" },
    max: { control: "text" },
    format: { control: "text" },
    locale: { control: "text" },
    size: { control: "inline-radio", options: ["sm", "md", "lg"] },
    label: { control: "text" },
    hint: { control: "text" },
    error: { control: "text" },
    disabled: { control: "boolean" },
    readOnly: { control: "boolean" },
    required: { control: "boolean" },
    clearable: { control: "boolean" },
    showPresets: { control: "boolean" },
    color: { control: "color" },
    colorFormat: { control: "inline-radio", options: ["hex", "rgb", "hsl"] },
    showAlpha: { control: "boolean" },
    ariaLabel: { control: "text" },
    onValueChange: { action: "valueChange" },
    onRangeChange: { action: "rangeChange" },
    onColorChange: { action: "colorChange" },
  },
  args: {
    value: "2026-11-15",
    start: "2026-11-01",
    end: "2026-11-15",
    min: "2026-01-01",
    max: "2027-12-31",
    format: "dd.MM.yyyy",
    locale: "ru-RU",
    size: "md",
    label: "Дата",
    hint: "Формат: дд.мм.гггг",
    error: "",
    disabled: false,
    readOnly: false,
    required: false,
    clearable: true,
    showPresets: true,
    color: "#1F4E6B",
    colorFormat: "hex",
    showAlpha: false,
    ariaLabel: "",
    onValueChange: fn(),
    onRangeChange: fn(),
    onColorChange: fn(),
  },
} satisfies Meta<DateColorArgs>;

export default meta;
type Story = StoryObj<DateColorArgs>;

function renderDatePicker(args: DateColorArgs): Node {
  return stage(
    <DatePicker
      id="story-date"
      label={args.label}
      hint={args.hint}
      error={args.error === "" ? undefined : args.error}
      size={args.size}
      locale={args.locale}
      format={args.format === "" ? undefined : args.format}
      disabled={args.disabled}
      readOnly={args.readOnly}
      required={args.required}
      clearable={args.clearable}
      ariaLabel={args.ariaLabel === "" ? undefined : args.ariaLabel}
      defaultValue={dateOf(args.value, args.format, args.locale)}
      min={dateOf(args.min, args.format, args.locale) ?? undefined}
      max={dateOf(args.max, args.format, args.locale) ?? undefined}
      onValueChange={args.onValueChange}
    />,
  );
}

export const DatePickerPlayground: Story = {
  render: (args) => renderDatePicker(args),
  play: async ({ canvasElement }) => {
    const trigger = canvasElement.querySelector<HTMLButtonElement>(
      "button.sui-date-picker__control",
    );
    trigger?.click();
    await Promise.resolve();
  },
};

function renderRangePicker(args: DateColorArgs): Node {
  return stage(
    <DateRangePicker
      id="story-range"
      label="Период"
      hint={args.hint}
      error={args.error === "" ? undefined : args.error}
      size={args.size}
      locale={args.locale}
      format={args.format === "" ? undefined : args.format}
      disabled={args.disabled}
      readOnly={args.readOnly}
      required={args.required}
      clearable={args.clearable}
      ariaLabel={args.ariaLabel === "" ? undefined : args.ariaLabel}
      defaultValue={{
        start: dateOf(args.start, args.format, args.locale),
        end: dateOf(args.end, args.format, args.locale),
      }}
      min={dateOf(args.min, args.format, args.locale) ?? undefined}
      max={dateOf(args.max, args.format, args.locale) ?? undefined}
      presets={args.showPresets ? undefined : false}
      onValueChange={args.onRangeChange}
    />,
  );
}

export const DateRangePickerPlayground: Story = {
  render: (args) => renderRangePicker(args),
  play: async ({ canvasElement }) => {
    const trigger = canvasElement.querySelector<HTMLButtonElement>(
      "button.sui-date-picker__control",
    );
    trigger?.click();
    await Promise.resolve();
    const preset = canvasElement.querySelector<HTMLButtonElement>(
      ".sui-date-range-picker__preset",
    );
    preset?.click();
  },
};

function renderColorPicker(args: DateColorArgs): Node {
  const [value, setValue] = createSignal(args.color);
  const handle = (next: string): void => {
    setValue(next);
    args.onColorChange(next);
  };
  return stage(
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: "var(--sui-space-3)",
      }}
    >
      <ColorPicker
        id="story-color"
        label="Цвет"
        hint="HEX, RGB или HSL"
        error={args.error === "" ? undefined : args.error}
        size={args.size}
        locale={args.locale}
        format={args.colorFormat}
        showAlpha={args.showAlpha}
        disabled={args.disabled}
        readOnly={args.readOnly}
        required={args.required}
        clearable={args.clearable}
        ariaLabel={args.ariaLabel === "" ? undefined : args.ariaLabel}
        value={value()}
        onValueChange={handle}
      />
      <span style={{ color: "var(--sui-color-on-surface-variant)" }}>{value()}</span>
    </div>,
  );
}

export const ColorPickerPlayground: Story = {
  render: (args) => renderColorPicker(args),
  play: async ({ canvasElement }) => {
    const trigger = canvasElement.querySelector<HTMLButtonElement>(
      "button.sui-color-picker__control",
    );
    trigger?.click();
    await Promise.resolve();
    const area = canvasElement.querySelector<HTMLElement>(
      ".sui-color-picker__saturation",
    );
    area?.focus();
    area?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
  },
};

export const CalendarRange: Story = {
  name: "Календарь: диапазон",
  render: () => stage(
    <DateRangePicker
      id="story-calendar-range"
      label="Период отчёта"
      locale="ru-RU"
      defaultOpen
      defaultValue={{
        start: new Date(2026, 10, 3),
        end: new Date(2026, 10, 18),
      }}
    />,
  ),
  play: async ({ canvasElement }) => {
    const start = canvasElement.querySelector<HTMLElement>(
      ".sui-date-picker__cell[data-range-start] .sui-date-picker__day",
    );
    const end = canvasElement.querySelector<HTMLElement>(
      ".sui-date-picker__cell[data-range-end] .sui-date-picker__day",
    );
    const inner = canvasElement.querySelector<HTMLElement>(
      ".sui-date-picker__cell[data-in-range]:not([data-range-start]):not([data-range-end]) .sui-date-picker__day",
    );
    if (start === null || end === null || inner === null) {
      throw new Error("не найдены дни диапазона");
    }
    await expect(start.hasAttribute("data-selected")).toBe(true);
    await expect(end.hasAttribute("data-selected")).toBe(true);
    await expect(start.textContent).toBe("3");
    await expect(end.textContent).toBe("18");
    await expect(getComputedStyle(start).borderRadius).toBe("999px");
    await expect(getComputedStyle(inner).backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    const startColor = getComputedStyle(start).color;
    const startBack = getComputedStyle(start).backgroundColor;
    await expect(startColor).not.toBe("rgba(0, 0, 0, 0)");
    await expect(startColor).not.toBe(startBack);
  },
};

export const ColorSwatches: Story = {
  name: "Цвет: swatch и lowercase hex",
  render: () => stage(
    <div style={{ display: "flex", "flex-direction": "column", gap: "var(--sui-space-4)" }}>
      <ColorPicker label="Верхний регистр" defaultValue="#1F4E6B" />
      <ColorPicker label="Нижний регистр" defaultValue="#1f6b45" />
      <ColorPicker label="Короткий hex" defaultValue="#F0A" />
      <ColorPicker label="Пустое значение" defaultValue="" placeholder="Не выбран" />
    </div>,
  ),
  play: async ({ canvasElement }) => {
    const controls = canvasElement.querySelectorAll<HTMLElement>(".sui-color-picker__control");
    await expect(controls.length).toBe(4);
    const first = controls[0];
    const second = controls[1];
    if (first === undefined || second === undefined) throw new Error("нет контролов цвета");
    await expect(first.textContent).toContain("#1f4e6b");
    await expect(second.textContent).toContain("#1f6b45");
    const swatch = first.querySelector<HTMLElement>(".sui-color-picker__swatch");
    await expect(swatch?.style.getPropertyValue("--sui-color-picker-swatch")).toBe(
      "rgba(31, 78, 107, 1)",
    );
    await expect(swatch?.hasAttribute("data-empty")).toBe(false);
    const empty = controls[3]?.querySelector<HTMLElement>(".sui-color-picker__swatch");
    await expect(empty?.hasAttribute("data-empty")).toBe(true);
  },
};

export const States: Story = {
  render: (args) => stage(
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: "var(--sui-space-5)",
      }}
    >
      <DatePicker
        label="Заблокировано"
        defaultValue={new Date(2026, 10, 15)}
        disabled
      />
      <DatePicker
        label="Только чтение"
        defaultValue={new Date(2026, 10, 15)}
        readOnly
      />
      <DatePicker
        label="С ошибкой"
        defaultValue={new Date(2026, 10, 15)}
        error="Дата вне доступного периода"
      />
      <DateRangePicker
        label="Период с ошибкой"
        defaultValue={{ start: new Date(2026, 10, 1), end: new Date(2026, 10, 15) }}
        error="Период пересекается с закрытым"
      />
      <ColorPicker
        label="Цвет с ошибкой"
        defaultValue={args.color}
        format={args.colorFormat}
        showAlpha={args.showAlpha}
        error="Недостаточный контраст"
      />
    </div>,
  ),
};

export const Sizes: Story = {
  render: () => stage(
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: "var(--sui-space-4)",
      }}
    >
      <DatePicker label="Small" size="sm" defaultValue={new Date(2026, 10, 15)} />
      <DatePicker label="Medium" size="md" defaultValue={new Date(2026, 10, 15)} />
      <DatePicker label="Large" size="lg" defaultValue={new Date(2026, 10, 15)} />
      <ColorPicker label="Small" size="sm" defaultValue="#1F4E6B" />
      <ColorPicker label="Large" size="lg" defaultValue="#1F4E6B" />
    </div>,
  ),
};
