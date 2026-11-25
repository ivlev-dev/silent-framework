import { afterEach, describe, expect, it } from "vitest";
import { flushSync, hydrate } from "@ivlev-dev/silent-core";
import { renderToString } from "@ivlev-dev/silent-server";
import { NumberField } from "../src/form/number-field/index.js";
import {
  clampNumber,
  formatGroupedNumber,
  formatNumberValue,
  numberValueText,
  parseNumberText,
  precisionOfStep,
  roundToPrecision,
} from "../src/form/number-field/number.js";
import {
  fakeField,
  mount,
  query,
  rootOf,
  type TestHandles,
} from "./form-test-utils.js";

const handles: TestHandles = { items: [] };
const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const handle of handles.items.splice(0)) handle.dispose();
  for (const cleanup of cleanups.splice(0)) cleanup();
  document.body.replaceChildren();
});

function flush(): void {
  flushSync();
  flushSync();
}

function numberInput(root: Element): HTMLInputElement {
  return query<HTMLInputElement>(root, "input.sui-number-field__input");
}

function press(
  target: EventTarget,
  key: string,
  init: KeyboardEventInit = {},
): void {
  target.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ...init,
    }),
  );
  flush();
}

function type(target: HTMLInputElement, value: string): void {
  target.value = value;
  target.dispatchEvent(new Event("input", { bubbles: true }));
  flush();
}

function blur(target: EventTarget, relatedTarget: EventTarget | null = null): void {
  target.dispatchEvent(
    new FocusEvent("blur", { bubbles: true, relatedTarget }),
  );
  flush();
}

describe("NumberField: числовая модель", () => {
  it("точность выводится из шага и округляет без артефактов", () => {
    expect(precisionOfStep(1)).toBe(0);
    expect(precisionOfStep(0.5)).toBe(1);
    expect(precisionOfStep(0.01)).toBe(2);
    expect(precisionOfStep(1.5e-7)).toBe(8);
    expect(roundToPrecision(0.1 + 0.2, 2)).toBe(0.3);
    expect(roundToPrecision(1.005, 2)).toBe(1.01);
  });

  it("clamp ограничивает значение только заданными границами", () => {
    expect(clampNumber(12, 0, 10)).toBe(10);
    expect(clampNumber(-3, 0, 10)).toBe(0);
    expect(clampNumber(5, undefined, 10)).toBe(5);
  });

  it("parse понимает пробелы, запятую и точку", () => {
    expect(parseNumberText("1 234,5")).toBe(1234.5);
    expect(parseNumberText("1\u00a0234,5")).toBe(1234.5);
    expect(parseNumberText("1.234,5")).toBe(1234.5);
    expect(parseNumberText("1,234")).toBe(1.234);
    expect(parseNumberText("-2,75")).toBe(-2.75);
    expect(parseNumberText("1.234.567")).toBe(1234567);
    expect(parseNumberText("abc")).toBeNull();
    expect(parseNumberText("")).toBeNull();
  });

  it("format grouped/plain/fn и valuetext с единицей", () => {
    expect(formatGroupedNumber(1234.5, "ru-RU", 1).replace(/\s/gu, " ")).toBe(
      "1 234,5",
    );
    expect(
      formatNumberValue(2.5, { format: "plain", locale: "ru-RU", precision: 1 }),
    ).toBe("2.5");
    expect(
      formatNumberValue(2.5, {
        format: (value) => `${value} кг`,
        locale: "ru-RU",
        precision: 1,
      }),
    ).toBe("2.5 кг");
    expect(
      numberValueText(5, {
        format: "grouped",
        locale: "ru-RU",
        precision: 0,
        unit: "шт",
      }),
    ).toBe("5 шт");
  });
});

describe("NumberField: разметка и клавиатура", () => {
  it("role=spinbutton, aria-значения и stepper-кнопки из strings", () => {
    const root = rootOf(
      mount(handles, NumberField, {
        id: "qty",
        label: "Количество",
        value: 5,
        min: 0,
        max: 10,
        unit: "шт",
      }),
    );
    const input = numberInput(root);
    expect(input.type).toBe("text");
    expect(input.getAttribute("role")).toBe("spinbutton");
    expect(input.getAttribute("aria-valuenow")).toBe("5");
    expect(input.getAttribute("aria-valuemin")).toBe("0");
    expect(input.getAttribute("aria-valuemax")).toBe("10");
    expect(input.getAttribute("aria-valuetext")).toBe("5 шт");
    expect(root.querySelector(".sui-number-field__unit")?.textContent).toBe("шт");

    const buttons = Array.from(root.querySelectorAll("button"));
    expect(buttons).toHaveLength(2);
    expect(buttons[0]?.getAttribute("aria-label")).toBe("Увеличить");
    expect(buttons[1]?.getAttribute("aria-label")).toBe("Уменьшить");
    expect(buttons[0]?.getAttribute("tabindex")).toBe("-1");
    expect(buttons[1]?.getAttribute("tabindex")).toBe("-1");
  });

  it("ArrowUp/Down, Shift ×10, PageUp/Down, Home/End", () => {
    const changes: Array<number | null> = [];
    const root = rootOf(
      mount(handles, NumberField, {
        defaultValue: 10,
        min: 0,
        max: 100,
        onValueChange: (value: number | null) => changes.push(value),
      }),
    );
    const input = numberInput(root);

    press(input, "ArrowUp");
    expect(changes.at(-1)).toBe(11);
    press(input, "ArrowDown");
    expect(changes.at(-1)).toBe(10);
    press(input, "ArrowUp", { shiftKey: true });
    expect(changes.at(-1)).toBe(20);
    press(input, "PageDown");
    expect(changes.at(-1)).toBe(10);
    press(input, "Home");
    expect(changes.at(-1)).toBe(0);
    press(input, "End");
    expect(changes.at(-1)).toBe(100);
    expect(input.value).toBe("100");
  });

  it("Alt уменьшает шаг в 10 раз", () => {
    const changes: Array<number | null> = [];
    const root = rootOf(
      mount(handles, NumberField, {
        defaultValue: 50,
        step: 10,
        onValueChange: (value: number | null) => changes.push(value),
      }),
    );
    press(numberInput(root), "ArrowDown", { altKey: true });
    expect(changes.at(-1)).toBe(49);
  });

  it("precision из step не накапливает плавающую ошибку", () => {
    const changes: Array<number | null> = [];
    const root = rootOf(
      mount(handles, NumberField, {
        defaultValue: 0.2,
        step: 0.1,
        onValueChange: (value: number | null) => changes.push(value),
      }),
    );
    press(numberInput(root), "ArrowUp");
    expect(changes.at(-1)).toBe(0.3);
    expect(numberInput(root).value).toBe("0.3");
  });

  it("stepper-кнопки меняют значение и уважают границы", () => {
    const changes: Array<number | null> = [];
    const root = rootOf(
      mount(handles, NumberField, {
        defaultValue: 5,
        min: 0,
        max: 6,
        onValueChange: (value: number | null) => changes.push(value),
      }),
    );
    const [up, down] = Array.from(root.querySelectorAll<HTMLButtonElement>("button"));
    up?.click();
    flush();
    expect(changes.at(-1)).toBe(6);
    expect(up?.disabled).toBe(true);
    down?.click();
    flush();
    expect(changes.at(-1)).toBe(5);
    expect(down?.disabled).toBe(false);
  });

  it("readOnly не пишет и не показывает steppers", () => {
    const changes: Array<number | null> = [];
    const root = rootOf(
      mount(handles, NumberField, {
        value: 5,
        readOnly: true,
        onValueChange: (value: number | null) => changes.push(value),
      }),
    );
    const input = numberInput(root);
    expect(input.readOnly).toBe(true);
    expect(root.querySelectorAll("button")).toHaveLength(0);
    press(input, "ArrowUp");
    expect(changes).toHaveLength(0);
  });
});

describe("NumberField: ввод, формат и clamp", () => {
  it("группировка на blur и редактируемый текст в фокусе", () => {
    const root = rootOf(
      mount(handles, NumberField, {
        value: 1234.5,
        step: 0.1,
        precision: 1,
        format: "grouped",
        locale: "ru-RU",
      }),
    );
    const input = numberInput(root);
    expect(input.value.replace(/\s/gu, " ")).toBe("1 234,5");

    input.focus();
    flush();
    expect(input.value).toBe("1234,5");
    blur(input);
    expect(input.value.replace(/\s/gu, " ")).toBe("1 234,5");
  });

  it("clampOnBlur по умолчанию ограничивает введённое значение", () => {
    const changes: Array<number | null> = [];
    const root = rootOf(
      mount(handles, NumberField, {
        defaultValue: 5,
        min: 0,
        max: 10,
        onValueChange: (value: number | null) => changes.push(value),
      }),
    );
    const input = numberInput(root);
    input.focus();
    flush();
    type(input, "99");
    expect(changes.at(-1)).toBe(99);
    blur(input);
    expect(changes.at(-1)).toBe(10);
    expect(input.value).toBe("10");
    expect(input.getAttribute("aria-valuenow")).toBe("10");
  });

  it("clampOnBlur=false оставляет введённое значение", () => {
    const root = rootOf(
      mount(handles, NumberField, {
        defaultValue: 5,
        min: 0,
        max: 10,
        clampOnBlur: false,
      }),
    );
    const input = numberInput(root);
    input.focus();
    flush();
    type(input, "99");
    blur(input);
    expect(input.value).toBe("99");
  });

  it("некорректный текст возвращает прежнее значение", () => {
    const root = rootOf(
      mount(handles, NumberField, { value: 7, allowWheel: false }),
    );
    const input = numberInput(root);
    input.focus();
    flush();
    type(input, "abc");
    blur(input);
    expect(input.value).toBe("7");
  });

  it("колесо работает только при allowWheel и фокусе", () => {
    const without: Array<number | null> = [];
    const off = rootOf(
      mount(handles, NumberField, {
        defaultValue: 1,
        onValueChange: (value: number | null) => without.push(value),
      }),
    );
    const offInput = numberInput(off);
    offInput.focus();
    flush();
    offInput.dispatchEvent(
      new WheelEvent("wheel", { deltaY: -1, bubbles: true, cancelable: true }),
    );
    flush();
    expect(without).toHaveLength(0);

    const withWheel: Array<number | null> = [];
    const on = rootOf(
      mount(handles, NumberField, {
        defaultValue: 1,
        allowWheel: true,
        onValueChange: (value: number | null) => withWheel.push(value),
      }),
    );
    const onInput = numberInput(on);
    onInput.focus();
    flush();
    onInput.dispatchEvent(
      new WheelEvent("wheel", { deltaY: -1, bubbles: true, cancelable: true }),
    );
    flush();
    expect(withWheel.at(-1)).toBe(2);
  });
});

describe("NumberField: форма и SSR", () => {
  it("field получает число через синтетический change", () => {
    const fake = fakeField<number | null>(2);
    const root = rootOf(mount(handles, NumberField, { field: fake.field }));
    press(numberInput(root), "ArrowUp");
    expect(fake.field.value).toBe(3);
  });

  it("SSR рендерит value/aria и гидрация не даёт mismatch", async () => {
    function Ssr(): Node {
      return (
        <NumberField
          id="qty"
          name="qty"
          label="Количество"
          value={1234.5}
          step={0.1}
          precision={1}
          min={0}
          max={2000}
          format="grouped"
          locale="ru-RU"
          unit="шт"
        />
      );
    }
    const { html } = await renderToString(Ssr);
    expect(html).toContain('role="spinbutton"');
    expect(html).toContain('aria-valuenow="1234.5"');
    expect(html).toContain('aria-valuemin="0"');
    expect(html).toContain('aria-valuemax="2000"');
    expect(html).toContain('aria-valuetext="1');
    expect(html).toContain('value="1');

    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    const mismatches: string[] = [];
    const handle = await hydrate(container, Ssr, {
      onMismatch: (error) => mismatches.push(error.message),
    });
    cleanups.push(() => handle.dispose());
    expect(mismatches).toEqual([]);
    const input = container.querySelector<HTMLInputElement>(".sui-number-field__input");
    expect(input?.value.replace(/\s/gu, " ")).toBe("1 234,5");
    expect(input?.getAttribute("aria-valuenow")).toBe("1234.5");
  });
});
