import { afterEach, describe, expect, it, vi } from "vitest";
import { flushSync } from "@ivlev-dev/silent-core";
import { Combobox } from "../src/form/combobox/index.js";
import type { SelectItem } from "../src/form/select/index.js";
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
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function flush(): void {
  flushSync();
  flushSync();
}

function click(element: Element): void {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  flush();
}

function keydown(target: EventTarget, key: string, init: KeyboardEventInit = {}): void {
  target.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }),
  );
  flush();
}

function input(target: HTMLInputElement, value: string): void {
  target.value = value;
  target.dispatchEvent(new Event("input", { bubbles: true }));
  flush();
}

const options: readonly SelectItem[] = [
  { value: "a", label: "Альфа" },
  { value: "b", label: "Бета" },
  { value: "c", label: "Гамма", disabled: true },
  { value: "d", label: "Дельта" },
];

function rows(root: Element): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[role="option"]'));
}

function open(root: Element): HTMLInputElement {
  const inputElement = query<HTMLInputElement>(root, ".sui-combobox__input");
  click(inputElement);
  return inputElement;
}

describe("Combobox", () => {
  it("role=combobox, открытие по клику и фильтрация ввода", () => {
    const root = rootOf(mount(handles, Combobox, { id: "city", options }));
    const field = query<HTMLInputElement>(root, ".sui-combobox__input");
    expect(field.getAttribute("role")).toBe("combobox");
    expect(field.getAttribute("aria-expanded")).toBe("false");
    expect(field.getAttribute("aria-controls")).toBe("city-listbox");
    expect(root.querySelector(".sui-popup")).toBeNull();

    click(field);
    expect(field.getAttribute("aria-expanded")).toBe("true");
    expect(rows(root)).toHaveLength(4);
    expect(field.getAttribute("aria-activedescendant")).toBe("city-option-0");

    input(field, "гам");
    expect(rows(root)).toHaveLength(1);
    expect(rows(root)[0]?.textContent).toContain("Гамма");
  });

  it("выбор опции мышью и через Enter закрывает список", () => {
    const changes: unknown[] = [];
    const root = rootOf(
      mount(handles, Combobox, {
        id: "city",
        options,
        onValueChange: (value: unknown) => changes.push(value),
      }),
    );
    const field = open(root);
    click(rows(root)[1]!);
    expect(changes.at(-1)).toBe("b");
    expect(root.querySelector(".sui-popup")).toBeNull();
    expect(field.value).toBe("Бета");

    click(field);
    keydown(field, "ArrowDown");
    keydown(field, "Enter");
    expect(changes).toHaveLength(2);
    expect(root.querySelector(".sui-popup")).toBeNull();
  });

  it("disabled-опцию нельзя выбрать", () => {
    const changes: unknown[] = [];
    const root = rootOf(
      mount(handles, Combobox, {
        id: "city",
        options,
        onValueChange: (value: unknown) => changes.push(value),
      }),
    );
    open(root);
    click(rows(root)[2]!);
    expect(changes).toHaveLength(0);
    expect(rows(root)[2]?.getAttribute("aria-disabled")).toBe("true");
  });

  it("allowCustomValue: Enter фиксирует введённое значение", () => {
    const changes: unknown[] = [];
    const root = rootOf(
      mount(handles, Combobox, {
        id: "city",
        options,
        allowCustomValue: true,
        onValueChange: (value: unknown) => changes.push(value),
      }),
    );
    const field = open(root);
    input(field, "Новый город");
    keydown(field, "Enter");
    expect(changes.at(-1)).toBe("Новый город");
    expect(root.querySelector(".sui-popup")).toBeNull();
    expect(field.value).toBe("Новый город");
  });

  it("creatable/createOption добавляет строку создания", () => {
    const changes: unknown[] = [];
    const root = rootOf(
      mount(handles, Combobox, {
        id: "city",
        options,
        creatable: true,
        createOption: (text: string) => ({ value: `new:${text}`, label: `Создать «${text}»` }),
        onValueChange: (value: unknown) => changes.push(value),
      }),
    );
    const field = open(root);
    input(field, "Казань");
    expect(rows(root)[0]?.textContent).toContain("Создать «Казань»");
    click(rows(root)[0]!);
    expect(changes.at(-1)).toBe("new:Казань");
  });

  it("field: synthetic onChange и touched только при выходе из корня", () => {
    const fake = fakeField<string>("");
    const root = rootOf(
      mount(handles, Combobox, { id: "city", options, field: fake.field }),
    );
    const field = open(root);
    click(rows(root)[0]!);
    expect(fake.field.value).toBe("a");

    field.dispatchEvent(new FocusEvent("blur", { bubbles: true, relatedTarget: field }));
    flush();
    expect(fake.field.touched).toBe(false);
    field.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
    flush();
    expect(fake.field.touched).toBe(true);
  });

  it("Escape дважды: закрыть и очистить query", () => {
    const root = rootOf(
      mount(handles, Combobox, { id: "city", options, value: "a" }),
    );
    const field = open(root);
    input(field, "zzz");
    keydown(field, "Escape");
    expect(root.querySelector(".sui-popup")).toBeNull();
    expect(field.value).toBe("Альфа");
    keydown(field, "Escape");
    expect(field.value).toBe("");
  });

  it("selectOnTab=false закрывает без выбора, true — выбирает", () => {
    const off: unknown[] = [];
    const offRoot = rootOf(
      mount(handles, Combobox, {
        id: "city-off",
        options,
        onValueChange: (value: unknown) => off.push(value),
      }),
    );
    open(offRoot);
    keydown(query(offRoot, ".sui-combobox__input"), "Tab");
    expect(off).toHaveLength(0);
    expect(offRoot.querySelector(".sui-popup")).toBeNull();

    const on: unknown[] = [];
    const onRoot = rootOf(
      mount(handles, Combobox, {
        id: "city-on",
        options,
        selectOnTab: true,
        onValueChange: (value: unknown) => on.push(value),
      }),
    );
    const onField = open(onRoot);
    keydown(onField, "Tab");
    expect(on.at(-1)).toBe("a");
    expect(onRoot.querySelector(".sui-popup")).toBeNull();
  });

  it("clearable очищает значение", () => {
    const fake = fakeField("b");
    const root = rootOf(
      mount(handles, Combobox, {
        id: "city",
        options,
        clearable: true,
        field: fake.field,
      }),
    );
    click(query(root, ".sui-combobox__clear"));
    expect(fake.field.value).toBe("");
    const hidden = query<HTMLInputElement>(root, 'input[type="hidden"]');
    expect(hidden.value).toBe("");
  });

  it("openOnFocus открывает и показывает полный список", () => {
    const root = rootOf(
      mount(handles, Combobox, { id: "city", options, openOnFocus: true }),
    );
    const field = query<HTMLInputElement>(root, ".sui-combobox__input");
    field.focus();
    flush();
    expect(root.querySelector(".sui-popup")).not.toBeNull();
    expect(rows(root)).toHaveLength(4);
    expect(field.value).toBe("");
  });

  it("openOnInput=false не открывает список вводом", () => {
    const root = rootOf(
      mount(handles, Combobox, { id: "city", options, openOnInput: false }),
    );
    const field = query<HTMLInputElement>(root, ".sui-combobox__input");
    input(field, "га");
    expect(root.querySelector(".sui-popup")).toBeNull();
  });

  it("minQueryLength задерживает loadOptions", async () => {
    const calls: string[] = [];
    const loadOptions = async (
      text: string,
    ): Promise<readonly SelectItem[]> => {
      calls.push(text);
      return options;
    };
    const root = rootOf(
      mount(handles, Combobox, {
        id: "city",
        options: [],
        minQueryLength: 2,
        loadOptions,
      }),
    );
    const field = open(root);
    await Promise.resolve();
    expect(calls).toHaveLength(0);
    input(field, "б");
    expect(calls).toHaveLength(0);
    input(field, "бе");
    await Promise.resolve();
    expect(calls).toEqual(["бе"]);
  });

  it("loadOptions: отменяет устаревший ответ", async () => {
    const calls: Array<{
      query: string;
      signal: AbortSignal;
      resolve: (items: readonly SelectItem[]) => void;
    }> = [];
    const loadOptions = (
      text: string,
      signal: AbortSignal,
    ): Promise<readonly SelectItem[]> =>
      new Promise((resolve) => {
        calls.push({ query: text, signal, resolve });
      });
    const root = rootOf(
      mount(handles, Combobox, { id: "city", options: [], loadOptions }),
    );
    const field = open(root);
    expect(calls).toHaveLength(1);
    input(field, "бе");
    expect(calls).toHaveLength(2);
    expect(calls[0]?.signal.aborted).toBe(true);

    calls[1]!.resolve([{ value: "b", label: "Бета" }]);
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(rows(root).map((row) => row.textContent)).toEqual(["Бета"]);

    calls[0]!.resolve([{ value: "old", label: "Старое" }]);
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(rows(root).map((row) => row.textContent)).toEqual(["Бета"]);
  });

  it("debounce откладывает loadOptions", () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const loadOptions = async (
      text: string,
    ): Promise<readonly SelectItem[]> => {
      calls.push(text);
      return options;
    };
    const root = rootOf(
      mount(handles, Combobox, {
        id: "city",
        options: [],
        debounce: 120,
        loadOptions,
      }),
    );
    open(root);
    expect(calls).toHaveLength(0);
    vi.advanceTimersByTime(120);
    flush();
    expect(calls).toEqual([""]);
  });
});
