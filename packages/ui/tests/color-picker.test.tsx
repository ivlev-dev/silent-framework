import { afterEach, describe, expect, it } from "vitest";
import { createSignal, flushSync } from "@ivlev-dev/silent-core";
import {
  ColorPicker,
  formatColor,
  hslToRgb,
  hsvToRgb,
  isValidColor,
  parseColor,
  rgbToHsl,
  rgbToHsv,
} from "../src/components/color-picker/index.js";
import {
  mount,
  query,
  rootOf,
  type TestHandles,
} from "./form-test-utils.js";

const handles: TestHandles = { items: [] };

afterEach(() => {
  for (const handle of handles.items.splice(0)) handle.dispose();
  document.body.replaceChildren();
});

function flush(): void {
  flushSync();
  flushSync();
}

function click(element: Element): void {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  flush();
}

function keydown(element: Element, key: string): void {
  element.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
  );
  flush();
}

function open(root: Element): void {
  click(query(root, "button.sui-color-picker__control"));
  flush();
}

function panel(root: Element): HTMLElement {
  return query<HTMLElement>(root, ".sui-popover__panel");
}

function typeInto(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  flush();
  input.dispatchEvent(new Event("change", { bubbles: true }));
  flush();
}

describe("ColorPicker: преобразования", () => {
  it("разбирает HEX, RGB(a) и HSL(a)", () => {
    expect(parseColor("#f00")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseColor("#00ff0080")?.a).toBeCloseTo(0.502, 2);
    expect(parseColor("rgb(0, 128, 255)")).toEqual({ r: 0, g: 128, b: 255, a: 1 });
    expect(parseColor("rgba(0, 128, 255, 0.5)")).toEqual({ r: 0, g: 128, b: 255, a: 0.5 });
    expect(parseColor("hsl(210, 100%, 50%)")).toEqual({ r: 0, g: 128, b: 255, a: 1 });
    expect(parseColor("transparent")?.a).toBe(0);
    expect(parseColor("не цвет")).toBeNull();
    expect(parseColor("#12")).toBeNull();
    expect(parseColor("rgb(300, 0, 0)")?.r).toBe(255);
  });

  it("парсит HEX в любом регистре, с # и без, 3/4/6/8 цифр", () => {
    expect(parseColor("#1f6b45")).toEqual({ r: 31, g: 107, b: 69, a: 1 });
    expect(parseColor("#1F6B45")).toEqual({ r: 31, g: 107, b: 69, a: 1 });
    expect(parseColor("1f6b45")).toEqual({ r: 31, g: 107, b: 69, a: 1 });
    expect(parseColor("#F0A")).toEqual({ r: 255, g: 0, b: 170, a: 1 });
    expect(parseColor("#f0a8")?.a).toBeCloseTo(0.533, 2);
    expect(parseColor("#1f6b4580")?.a).toBeCloseTo(0.502, 2);
    expect(isValidColor("#1f6b45")).toBe(true);
    expect(isValidColor("#F0A")).toBe(true);
    expect(isValidColor("#1f6b4")).toBe(false);
    expect(isValidColor("#1f6b45ff00")).toBe(false);
  });

  it("форматирует в выбранный формат и учитывает alpha", () => {
    const color = { r: 255, g: 0, b: 0, a: 0.5 };
    expect(formatColor(color, "hex")).toBe("#ff0000");
    expect(formatColor(color, "hex", true)).toBe("#ff000080");
    expect(formatColor(color, "rgb")).toBe("rgb(255, 0, 0)");
    expect(formatColor(color, "rgb", true)).toBe("rgba(255, 0, 0, 0.5)");
    expect(formatColor(color, "hsl", true)).toBe("hsla(0, 100%, 50%, 0.5)");
  });

  it("корректно переводит RGB ↔ HSL/HSV", () => {
    const red = { r: 255, g: 0, b: 0, a: 1 };
    const hsl = rgbToHsl(red);
    expect(hsl).toEqual({ h: 0, s: 100, l: 50 });
    expect(hslToRgb(hsl)).toEqual(red);
    const hsv = rgbToHsv(red);
    expect(hsv).toEqual({ h: 0, s: 100, v: 100 });
    expect(hsvToRgb(hsv)).toEqual(red);
  });
});

describe("ColorPicker: ввод и alpha", () => {
  it("показывает значение, swatch и скрытый input", () => {
    const root = rootOf(
      mount(handles, ColorPicker, {
        id: "color",
        label: "Цвет",
        defaultValue: "#ff0000",
      }),
    );
    flush();
    const trigger = query(root, "button.sui-color-picker__control");
    expect(trigger.textContent).toContain("#ff0000");
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
    const swatch = query<HTMLElement>(root, ".sui-color-picker__swatch");
    expect(swatch.style.getPropertyValue("--sui-color-picker-swatch")).toContain("255");
    expect(swatch.hasAttribute("data-empty")).toBe(false);
    expect(query<HTMLInputElement>(root, 'input[type="hidden"]').value).toBe("#ff0000");
  });

  it("заполняет swatch для HEX в нижнем регистре", () => {
    const root = rootOf(
      mount(handles, ColorPicker, {
        label: "Цвет",
        defaultValue: "#1f6b45",
      }),
    );
    flush();
    const swatch = query<HTMLElement>(root, ".sui-color-picker__swatch");
    expect(swatch.style.getPropertyValue("--sui-color-picker-swatch")).toBe(
      "rgba(31, 107, 69, 1)",
    );
    expect(swatch.hasAttribute("data-empty")).toBe(false);
    expect(query(root, "button.sui-color-picker__control").textContent).toContain("#1f6b45");
  });

  it("принимает HEX/RGB/HSL из текстового поля", () => {
    const calls: string[] = [];
    const root = rootOf(
      mount(handles, ColorPicker, {
        label: "Цвет",
        defaultValue: "#ff0000",
        onValueChange: (next: string) => {
          calls.push(next);
        },
      }),
    );
    flush();
    open(root);
    expect(panel(root).getAttribute("role")).toBe("dialog");
    expect(panel(root).getAttribute("aria-label")).toBe("Выбор цвета");
    const input = query<HTMLInputElement>(root, "input.sui-text-field__input");
    expect(input.closest(".sui-field")?.textContent).toContain("HEX");

    typeInto(input, "#00ff00");
    expect(calls.at(-1)).toBe("#00ff00");
    expect(query(root, "button.sui-color-picker__control").textContent).toContain("#00ff00");
    expect(query<HTMLInputElement>(root, 'input[type="hidden"]').value).toBe("#00ff00");

    typeInto(input, "rgb(0, 0, 255)");
    expect(calls.at(-1)).toBe("#0000ff");
  });

  it("форматирует вывод по format", () => {
    const calls: string[] = [];
    const root = rootOf(
      mount(handles, ColorPicker, {
        label: "Цвет",
        defaultValue: "rgb(255, 0, 0)",
        format: "rgb",
        onValueChange: (next: string) => {
          calls.push(next);
        },
      }),
    );
    flush();
    expect(query(root, "button.sui-color-picker__control").textContent).toContain("rgb(255, 0, 0)");
    open(root);
    const input = query<HTMLInputElement>(root, "input.sui-text-field__input");
    typeInto(input, "#00ff00");
    expect(calls.at(-1)).toBe("rgb(0, 255, 0)");
  });

  it("включает alpha только при showAlpha", () => {
    const calls: string[] = [];
    const root = rootOf(
      mount(handles, ColorPicker, {
        label: "Цвет",
        defaultValue: "rgba(255, 0, 0, 0.5)",
        format: "rgb",
        showAlpha: true,
        onValueChange: (next: string) => {
          calls.push(next);
        },
      }),
    );
    flush();
    expect(query(root, "button.sui-color-picker__control").textContent).toContain("rgba(255, 0, 0, 0.5)");
    open(root);
    const alpha = query<HTMLInputElement>(root, "input.sui-color-picker__range--alpha");
    expect(alpha.value).toBe("50");
    expect(alpha.getAttribute("aria-label")).toBe("Прозрачность");
    alpha.value = "100";
    alpha.dispatchEvent(new Event("input", { bubbles: true }));
    flush();
    expect(calls.at(-1)).toBe("rgba(255, 0, 0, 1)");

    const noAlpha = rootOf(
      mount(handles, ColorPicker, {
        label: "Цвет",
        value: "#ff0000",
        showAlpha: false,
      }),
    );
    flush();
    open(noAlpha);
    expect(noAlpha.querySelector(".sui-color-picker__range--alpha")).toBeNull();
  });

  it("выбирает пресет и поддерживает управляемое значение", () => {
    const [value, setValue] = createSignal("#ff0000");
    const calls: string[] = [];
    const root = rootOf(
      mount(handles, ColorPicker, {
        label: "Цвет",
        get value() {
          return value();
        },
        onValueChange: (next: string) => {
          calls.push(next);
        },
      }),
    );
    flush();
    open(root);
    const presets = Array.from(root.querySelectorAll<HTMLButtonElement>(".sui-color-picker__preset"));
    expect(presets.length).toBeGreaterThan(3);
    expect(presets[0]?.getAttribute("aria-label")).toContain("Выбрать цвет");
    click(presets[1] as HTMLElement);
    expect(calls).toHaveLength(1);
    expect(query(root, "button.sui-color-picker__control").textContent).toContain("#ff0000");

    setValue(calls[0] ?? "#000000");
    flush();
    expect(query(root, "button.sui-color-picker__control").textContent).toContain(calls[0] ?? "#000000");
  });

  it("очищает значение", () => {
    const calls: string[] = [];
    const root = rootOf(
      mount(handles, ColorPicker, {
        label: "Цвет",
        defaultValue: "#ff0000",
        onValueChange: (next: string) => {
          calls.push(next);
        },
      }),
    );
    flush();
    click(query(root, ".sui-color-picker__clear"));
    expect(calls.at(-1)).toBe("");
    expect(query(root, "button.sui-color-picker__control").textContent).toContain("Выбор цвета");
    expect(root.querySelector(".sui-color-picker__clear")).toBeNull();
  });
});

describe("ColorPicker: клавиатура и доступность", () => {
  it("меняет насыщенность стрелками", () => {
    const calls: string[] = [];
    const root = rootOf(
      mount(handles, ColorPicker, {
        label: "Цвет",
        defaultValue: "#808080",
        onValueChange: (next: string) => {
          calls.push(next);
        },
      }),
    );
    flush();
    open(root);
    const area = query<HTMLElement>(root, ".sui-color-picker__saturation");
    expect(area.getAttribute("role")).toBe("slider");
    expect(area.getAttribute("aria-valuetext")).toContain("Насыщенность");
    area.focus();
    keydown(area, "ArrowRight");
    expect(calls).toHaveLength(1);
    expect(area.getAttribute("aria-valuetext")).not.toBe("Насыщенность 0%, яркость 50%");
    keydown(area, "End");
    expect(calls).toHaveLength(2);
  });

  it("объявляет названия диапазонов и пресетов", () => {
    const root = rootOf(
      mount(handles, ColorPicker, {
        label: "Цвет",
        defaultValue: "#0E2A47",
        showAlpha: true,
        hint: "Подсказка",
        error: "Ошибка",
        required: true,
      }),
    );
    flush();
    const trigger = query(root, "button.sui-color-picker__control");
    expect(trigger.getAttribute("aria-required")).toBe("true");
    expect(trigger.getAttribute("aria-invalid")).toBe("true");
    expect(trigger.getAttribute("aria-describedby")).toContain("-hint");
    open(root);
    expect(query(root, "input.sui-color-picker__range--hue").getAttribute("aria-label")).toBe("Оттенок");
    expect(query(root, "input.sui-color-picker__range--alpha").getAttribute("aria-label")).toBe("Прозрачность");
    expect(root.querySelector('[role="group"][aria-label="Пресеты"]')).not.toBeNull();
    expect(query(root, ".sui-color-picker__preset").getAttribute("aria-pressed")).toBe("true");
  });
});
