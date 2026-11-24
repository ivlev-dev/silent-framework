import { afterEach, describe, expect, it } from "vitest";
import { flushSync } from "@ivlev-dev/silent-core";
import {
  Checkbox,
  Field,
  FieldGroup,
  FileField,
  FormActions,
  RadioGroup,
  Select,
  Slider,
  Switch,
  Textarea,
  TextField,
} from "../src/form/index.js";
import {
  fakeField,
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

describe("Field", () => {
  it("рендерит подпись, подсказку и ошибку с предсказуемыми id", () => {
    const root = rootOf(
      mount(handles, Field, {
        id: "email",
        label: "Email",
        hint: "Рабочая почта",
        error: "Некорректный адрес",
        required: true,
        touched: true,
        children: "контрол",
      }),
    );
    expect(root.classList.contains("sui-field")).toBe(true);
    expect(root.hasAttribute("data-invalid")).toBe(true);
    expect(root.hasAttribute("data-touched")).toBe(true);
    const label = query<HTMLLabelElement>(root, "label.sui-field__label");
    expect(label.getAttribute("for")).toBe("email");
    expect(label.textContent).toContain("Email");
    expect(label.textContent).toContain("*");
    expect(label.textContent).toContain("Обязательное поле");
    expect(root.querySelector("#email-hint")?.textContent).toBe("Рабочая почта");
    expect(root.querySelector("#email-error")?.textContent).toBe("Некорректный адрес");
    expect(root.querySelector('[role="alert"]')).toBeNull();
  });

  it("hint/error не рендерятся пустыми", () => {
    const root = rootOf(
      mount(handles, Field, { id: "x", hint: "", error: "", children: "c" }),
    );
    expect(root.querySelector(".sui-field__hint")).toBeNull();
    expect(root.querySelector(".sui-field__error")).toBeNull();
    expect(root.hasAttribute("data-invalid")).toBe(false);
  });

  it("invalid без текста ошибки и bare-режим", () => {
    const root = rootOf(
      mount(handles, Field, { id: "x", invalid: true, bare: true, disabled: true, children: "c" }),
    );
    expect(root.hasAttribute("data-invalid")).toBe(true);
    expect(root.hasAttribute("data-bare")).toBe(true);
    expect(root.hasAttribute("data-disabled")).toBe(true);
  });
});

describe("FieldGroup и FormActions", () => {
  it("fieldset/legend/disabled", () => {
    const root = rootOf(
      mount(handles, FieldGroup, {
        legend: "Контакты",
        hint: "Заполните все поля",
        disabled: true,
        children: "поля",
      }),
    );
    expect(root.tagName).toBe("FIELDSET");
    expect(root.hasAttribute("disabled")).toBe(true);
    expect(query(root, "legend").textContent).toBe("Контакты");
    expect(root.textContent).toContain("Заполните все поля");
  });

  it("submit/reset по умолчанию и loading", () => {
    const root = rootOf(mount(handles, FormActions, { loading: true }));
    const buttons = Array.from(root.querySelectorAll("button"));
    expect(buttons).toHaveLength(2);
    expect(buttons[0]?.getAttribute("type")).toBe("reset");
    expect(buttons[0]?.textContent).toBe("Сбросить");
    expect(buttons[1]?.getAttribute("type")).toBe("submit");
    expect(buttons[1]?.textContent).toBe("Сохранить");
    expect(buttons[1]?.hasAttribute("disabled")).toBe(true);
    expect(buttons[1]?.getAttribute("aria-busy")).toBe("true");
    expect(buttons[0]?.hasAttribute("disabled")).toBe(true);
  });

  it("свой actions-слот заменяет кнопки", () => {
    const root = rootOf(
      mount(handles, FormActions, {
        actions: "свои действия",
        children: "доп",
      }),
    );
    expect(root.querySelectorAll("button")).toHaveLength(0);
    expect(root.textContent).toContain("свои действия");
    expect(root.textContent).toContain("доп");
  });
});

describe("TextField", () => {
  it.each([
    "text",
    "email",
    "password",
    "number",
    "search",
    "tel",
    "url",
  ] as const)("type=%s рендерится в input", (type) => {
    const root = rootOf(mount(handles, TextField, { type, label: "Поле" }));
    expect(query<HTMLInputElement>(root, "input").type).toBe(type);
  });

  it("размеры, disabled, readOnly, required и aria-связи", () => {
    const root = rootOf(
      mount(handles, TextField, {
        id: "email",
        label: "Email",
        hint: "Подсказка",
        error: "Ошибка",
        size: "lg",
        disabled: true,
        readOnly: true,
        required: true,
      }),
    );
    const input = query<HTMLInputElement>(root, "input");
    expect(root.querySelector(".sui-text-field")?.getAttribute("data-size")).toBe("lg");
    expect(input.disabled).toBe(true);
    expect(input.readOnly).toBe(true);
    expect(input.required).toBe(true);
    expect(input.getAttribute("aria-required")).toBe("true");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe("email-hint email-error");
  });

  it("leading/trailing и password-toggle с RU-строками", () => {
    const root = rootOf(
      mount(handles, TextField, {
        type: "password",
        label: "Пароль",
        leading: "L",
        trailing: "T",
      }),
    );
    expect(root.querySelector(".sui-text-field__leading")?.textContent).toBe("L");
    const trailing = root.querySelector(".sui-text-field__trailing");
    expect(trailing?.textContent).toContain("T");
    const toggle = query<HTMLButtonElement>(root, ".sui-text-field__password-toggle");
    expect(toggle.getAttribute("aria-label")).toBe("Показать пароль");
    const input = query<HTMLInputElement>(root, "input");
    expect(input.type).toBe("password");
    toggle.click();
    flushSync();
    expect(input.type).toBe("text");
    expect(toggle.getAttribute("aria-label")).toBe("Скрыть пароль");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
  });

  it("field — источник, явные пропсы — overrides", () => {
    const fake = fakeField("из поля", {
      label: "Из поля",
      hint: "hint из поля",
      error: "ошибка из поля",
    });
    const root = rootOf(
      mount(handles, TextField, {
        field: fake.field,
        label: "Своя подпись",
        error: "Своя ошибка",
      }),
    );
    expect(query<HTMLInputElement>(root, "input").value).toBe("из поля");
    expect(root.textContent).toContain("Своя подпись");
    expect(root.textContent).not.toContain("Из поля");
    expect(root.textContent).toContain("Своя ошибка");
    expect(root.textContent).toContain("hint из поля");
  });

  it("изменение field обновляет DOM без перерендера (bindValue)", () => {
    const fake = fakeField("a", { id: "name" });
    const root = rootOf(mount(handles, TextField, { field: fake.field }));
    const input = query<HTMLInputElement>(root, "input");
    expect(input.value).toBe("a");
    fake.set("программно");
    flushSync();
    expect(query<HTMLInputElement>(root, "input")).toBe(input);
    expect(input.value).toBe("программно");
  });

  it("ввод вызывает field.onInput и переводит data-touched", () => {
    const fake = fakeField("", { name: "q" });
    const root = rootOf(mount(handles, TextField, { field: fake.field }));
    const input = query<HTMLInputElement>(root, "input");
    input.value = "текст";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    expect(fake.field.value).toBe("текст");
    input.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
    flushSync();
    expect(root.hasAttribute("data-touched")).toBe(true);
  });

  it("isValidating даёт aria-busy, но не disabled", () => {
    const fake = fakeField("x", { validating: true });
    const root = rootOf(mount(handles, TextField, { field: fake.field }));
    const input = query<HTMLInputElement>(root, "input");
    expect(input.getAttribute("aria-busy")).toBe("true");
    expect(input.disabled).toBe(false);
  });
});

describe("Textarea", () => {
  it("rows, resize, counter", () => {
    const fake = fakeField("");
    const root = rootOf(
      mount(handles, Textarea, {
        label: "О себе",
        rows: 5,
        resize: "none",
        counter: true,
        maxLength: 20,
        field: fake.field,
      }),
    );
    const textarea = query<HTMLTextAreaElement>(root, "textarea");
    expect(textarea.rows).toBe(5);
    expect(root.querySelector(".sui-textarea")?.getAttribute("data-resize")).toBe("none");
    expect(root.querySelector(".sui-textarea__counter")?.textContent).toBe("0/20");
    textarea.value = "привет!";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    expect(root.querySelector(".sui-textarea__counter")?.textContent).toBe("7/20");
  });

  it("disabled/readOnly/required", () => {
    const root = rootOf(
      mount(handles, Textarea, { disabled: true, readOnly: true, required: true }),
    );
    const textarea = query<HTMLTextAreaElement>(root, "textarea");
    expect(textarea.disabled).toBe(true);
    expect(textarea.readOnly).toBe(true);
    expect(textarea.getAttribute("aria-required")).toBe("true");
  });
});

describe("Select", () => {
  const options = [
    { value: "a", label: "A" },
    { value: "b", label: "B" },
    { value: "c", label: "C", disabled: true },
  ] as const;

  it("placeholder и selected на option", () => {
    const root = rootOf(
      mount(handles, Select, {
        label: "Буква",
        placeholder: "Выберите",
        options,
        value: "b",
      }),
    );
    const select = query<HTMLSelectElement>(root, "select");
    const optionElements = Array.from(select.options);
    expect(optionElements).toHaveLength(4);
    expect(optionElements[0]?.textContent).toBe("Выберите");
    expect(select.value).toBe("b");
    expect(optionElements[2]?.selected).toBe(true);
    expect(optionElements[3]?.disabled).toBe(true);
  });

  it("multiple и поле-массив значений", () => {
    const fake = fakeField<readonly string[]>(["a", "b"]);
    const root = rootOf(
      mount(handles, Select, { options, multiple: true, field: fake.field }),
    );
    const select = query<HTMLSelectElement>(root, "select");
    expect(select.multiple).toBe(true);
    expect(Array.from(select.selectedOptions).map((option) => option.value)).toEqual(["a", "b"]);
    select.options[0]!.selected = false;
    select.options[2]!.selected = true;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    flushSync();
    expect(fake.field.value).toEqual(["b", "c"]);
  });
});

describe("Checkbox", () => {
  it("label/description, checked и aria-checked", () => {
    const fake = fakeField(true, { label: "Согласие" });
    const root = rootOf(
      mount(handles, Checkbox, {
        field: fake.field,
        description: "Условия",
      }),
    );
    const input = query<HTMLInputElement>(root, "input");
    expect(input.checked).toBe(true);
    expect(input.type).toBe("checkbox");
    expect(input.getAttribute("aria-checked")).toBe("true");
    expect(root.textContent).toContain("Согласие");
    expect(root.textContent).toContain("Условия");
    expect(input.getAttribute("aria-describedby")).toBe("form-field-description");
  });

  it("indeterminate: mixed, aria-checked=mixed", () => {
    const root = rootOf(mount(handles, Checkbox, { indeterminate: true }));
    const input = query<HTMLInputElement>(root, "input");
    flushSync();
    expect(input.indeterminate).toBe(true);
    expect(input.getAttribute("aria-checked")).toBe("mixed");
  });

  it("клик обновляет field, readOnly не меняет", () => {
    const fake = fakeField(false);
    const root = rootOf(mount(handles, Checkbox, { field: fake.field }));
    const input = query<HTMLInputElement>(root, "input");
    input.click();
    flushSync();
    expect(fake.field.value).toBe(true);

    const readOnly = fakeField(false);
    const readonlyRoot = rootOf(
      mount(handles, Checkbox, { field: readOnly.field, readOnly: true }),
    );
    const readonlyInput = query<HTMLInputElement>(readonlyRoot, "input");
    readonlyInput.click();
    flushSync();
    expect(readOnly.field.value).toBe(false);
    expect(readonlyInput.getAttribute("aria-readonly")).toBe("true");
  });

  it("disabled", () => {
    const root = rootOf(mount(handles, Checkbox, { disabled: true }));
    expect(query<HTMLInputElement>(root, "input").disabled).toBe(true);
    expect(root.hasAttribute("data-disabled")).toBe(true);
  });
});

describe("RadioGroup", () => {
  const options = [
    { value: "a", label: "A" },
    { value: "b", label: "B" },
    { value: "c", label: "C", disabled: true },
    { value: "d", label: "D" },
  ] as const;

  it("fieldset/legend, name, roving tabindex", () => {
    const fake = fakeField("b", { name: "letter" });
    const root = rootOf(
      mount(handles, RadioGroup, { field: fake.field, options, label: "Буква" }),
    );
    expect(root.tagName).toBe("FIELDSET");
    expect(query(root, "legend").textContent).toBe("Буква");
    const radios = Array.from(root.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    expect(radios).toHaveLength(4);
    expect(radios.every((radio) => radio.name === "letter")).toBe(true);
    expect(root.hasAttribute("aria-required")).toBe(false);
    expect(radios[0]?.tabIndex).toBe(-1);
    expect(radios[1]?.tabIndex).toBe(0);
    expect(radios[1]?.checked).toBe(true);
  });

  it("стрелки двигают фокус и выбор, пропуская disabled", () => {
    const fake = fakeField("b", { name: "letter" });
    const root = rootOf(mount(handles, RadioGroup, { field: fake.field, options }));
    const radios = Array.from(root.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    radios[1]?.focus();
    radios[1]?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    flushSync();
    expect(fake.field.value).toBe("d");
    expect(radios[3]?.checked).toBe(true);
    expect(document.activeElement).toBe(radios[3]);

    radios[3]?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
    );
    flushSync();
    expect(fake.field.value).toBe("a");
  });

  it("disabled и error-связи", () => {
    const fake = fakeField("a", { error: "Выберите букву", required: true });
    const root = rootOf(mount(handles, RadioGroup, { field: fake.field, options }));
    const radios = Array.from(root.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    expect(radios[0]?.hasAttribute("required")).toBe(true); expect(radios[0]?.hasAttribute("required")).toBe(true);
    expect(radios[0]?.getAttribute("aria-required")).toBe("true");
    expect(root.hasAttribute("aria-required")).toBe(false);
    expect(radios.every((radio) => radio.getAttribute("aria-invalid") === "true")).toBe(true);
    expect(radios[0]?.getAttribute("aria-describedby")).toBe("form-field-error");
    expect(root.querySelector(".sui-radio-group__error")?.textContent).toBe("Выберите букву");
  });
});

describe("Switch", () => {
  it("role=switch, click и aria-checked", () => {
    const fake = fakeField(false, { label: "Уведомления" });
    const root = rootOf(mount(handles, Switch, { field: fake.field }));
    const input = query<HTMLInputElement>(root, "input");
    expect(input.getAttribute("role")).toBe("switch");
    expect(input.getAttribute("aria-checked")).toBe("false");
    expect(root.textContent).toContain("Уведомления");
    input.click();
    flushSync();
    expect(fake.field.value).toBe(true);
    expect(input.checked).toBe(true);
    expect(input.getAttribute("aria-checked")).toBe("true");
  });

  it("disabled/required/description", () => {
    const root = rootOf(
      mount(handles, Switch, {
        disabled: true,
        required: true,
        description: "Описание",
      }),
    );
    const input = query<HTMLInputElement>(root, "input");
    expect(input.disabled).toBe(true);
    expect(input.required).toBe(true);
    expect(input.getAttribute("aria-describedby")).toBe("sui-switch-description");
    expect(root.textContent).toContain("Описание");
  });
});

describe("Slider", () => {
  it("min/max/step, output и aria-valuetext", () => {
    const fake = fakeField(30, { label: "Громкость" });
    const root = rootOf(
      mount(handles, Slider, {
        field: fake.field,
        min: 0,
        max: 50,
        step: 5,
        unit: "%",
      }),
    );
    const input = query<HTMLInputElement>(root, "input");
    expect(input.type).toBe("range");
    expect(input.min).toBe("0");
    expect(input.max).toBe("50");
    expect(input.step).toBe("5");
    expect(input.getAttribute("aria-valuetext")).toBe("30%");
    expect(root.querySelector("output")?.textContent).toBe("30%");
    expect(input.value).toBe("30");
  });

  it("formatValue и программное изменение", () => {
    const fake = fakeField(3);
    const root = rootOf(
      mount(handles, Slider, {
        field: fake.field,
        min: 1,
        max: 5,
        formatValue: (value: number) => `${value} из 5`,
      }),
    );
    const input = query<HTMLInputElement>(root, "input");
    expect(input.getAttribute("aria-valuetext")).toBe("3 из 5");
    fake.set(5);
    flushSync();
    expect(input.value).toBe("5");
    expect(root.querySelector("output")?.textContent).toBe("5 из 5");
  });

  it("output можно скрыть", () => {
    const root = rootOf(mount(handles, Slider, { value: 10, output: false }));
    expect(root.querySelector("output")).toBeNull();
  });
});

describe("FileField", () => {
  function selectFile(input: HTMLInputElement, files: File[]): void {
    Object.defineProperty(input, "files", {
      configurable: true,
      value: files,
    });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  it("принимает файл, отдаёт onFiles и сбрасывает input.value", () => {
    const seen: string[] = [];
    let signal: AbortSignal | undefined;
    const root = rootOf(
      mount(handles, FileField, {
        id: "avatar",
        label: "Аватар",
        accept: "image/*",
        onFiles: (files: readonly File[], context: { signal: AbortSignal }) => {
          seen.push(...files.map((file) => file.name));
          signal = context.signal;
        },
      }),
    );
    const input = query<HTMLInputElement>(root, "input");
    expect(input.type).toBe("file");
    expect(input.accept).toBe("image/*");
    selectFile(input, [new File(["x"], "avatar.png", { type: "image/png" })]);
    flushSync();
    expect(seen).toEqual(["avatar.png"]);
    expect(input.value).toBe("");
    expect(root.textContent).toContain("avatar.png");
    expect(signal?.aborted).toBe(false);
  });

  it("abort при размонтировании", () => {
    let signal: AbortSignal | undefined;
    const root = rootOf(
      mount(handles, FileField, {
        onFiles: (_files: readonly File[], context: { signal: AbortSignal }) => {
          signal = context.signal;
        },
      }),
    );
    const input = query<HTMLInputElement>(root, "input");
    selectFile(input, [new File(["x"], "a.txt")]);
    expect(signal?.aborted).toBe(false);
    const handle = handles.items.at(-1)!;
    handle.dispose();
    handles.items.pop();
    expect(signal?.aborted).toBe(true);
  });

  it("progress и multiple", () => {
    const root = rootOf(
      mount(handles, FileField, { multiple: true, progress: 42, value: "a.png" }),
    );
    const input = query<HTMLInputElement>(root, "input");
    expect(input.multiple).toBe(true);
    const progress = query<HTMLProgressElement>(root, "progress");
    expect(progress.value).toBe(42);
    expect(progress.max).toBe(100);
    expect(root.querySelector(".sui-file-field__percent")?.textContent).toBe("42%");
    expect(root.textContent).toContain("a.png");
    expect(root.textContent).toContain("Выбрать файл");
  });

  it("error связывается через aria-describedby", () => {
    const root = rootOf(
      mount(handles, FileField, { id: "doc", error: "Файл слишком большой" }),
    );
    const input = query<HTMLInputElement>(root, "input");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe("doc-error");
  });
});
