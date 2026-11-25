import { afterEach, describe, expect, it, vi } from "vitest";
import { flushSync } from "@ivlev-dev/silent-core";
import { Listbox, type ListboxOption } from "../src/form/listbox/index.js";
import { Combobox } from "../src/form/combobox/index.js";
import {
  NativeSelect,
  Select,
  type SelectItem,
  type SelectOption,
} from "../src/form/select/index.js";
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

const options = [
  { value: "a", label: "Альфа" },
  { value: "b", label: "Бета", disabled: true },
  { value: "c", label: "Гамма" },
  { value: "d", label: "Дельта" },
] as const;

const grouped: readonly SelectItem[] = [
  { value: "a", label: "Альфа" },
  {
    label: "Согласные",
    options: [
      { value: "b", label: "Бета" },
      { value: "c", label: "Гамма" },
    ],
  },
];

function optionRows(root: Element): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[role="option"]'));
}

// ────────────────────────────── Listbox ────────────────────────────────────

describe("Listbox", () => {
  it("роли, aria и активная опция", () => {
    const root = rootOf(
      mount(handles, Listbox, {
        id: "lb",
        label: "Буквы",
        options,
        value: "c",
      }),
    );
    const list = query<HTMLElement>(root, '[role="listbox"]');
    expect(list.id).toBe("lb-listbox");
    expect(list.getAttribute("aria-label")).toBe("Буквы");
    expect(list.getAttribute("aria-activedescendant")).toBe("lb-option-2");
    expect(list.getAttribute("aria-multiselectable")).toBeNull();
    const rows = optionRows(root);
    expect(rows).toHaveLength(4);
    expect(rows[2]?.id).toBe("lb-option-2");
    expect(rows[2]?.getAttribute("aria-selected")).toBe("true");
    expect(rows[1]?.getAttribute("aria-disabled")).toBe("true");
    expect(rows[0]?.hasAttribute("data-active")).toBe(false);
  });

  it("multiple: aria-multiselectable и переключение по клику", () => {
    const changes: unknown[] = [];
    const root = rootOf(
      mount(handles, Listbox, {
        id: "lb",
        options,
        multiple: true,
        defaultValue: ["a"],
        onValueChange: (value: unknown) => changes.push(value),
      }),
    );
    const list = query<HTMLElement>(root, '[role="listbox"]');
    expect(list.getAttribute("aria-multiselectable")).toBe("true");
    click(optionRows(root)[2]!);
    expect(changes.at(-1)).toEqual(["a", "c"]);
    expect(optionRows(root)[2]?.getAttribute("aria-selected")).toBe("true");
    click(optionRows(root)[0]!);
    expect(changes.at(-1)).toEqual(["c"]);
  });

  it("клавиатура: стрелки, Home/End, Page, Enter и disabled skip", () => {
    const changes: unknown[] = [];
    const root = rootOf(
      mount(handles, Listbox, {
        id: "lb",
        options,
        maxVisible: 2,
        onValueChange: (value: unknown) => changes.push(value),
      }),
    );
    const list = query<HTMLElement>(root, '[role="listbox"]');
    // Первый enabled — «Альфа» (b disabled).
    expect(list.getAttribute("aria-activedescendant")).toBe("lb-option-0");
    keydown(list, "ArrowDown");
    expect(list.getAttribute("aria-activedescendant")).toBe("lb-option-2");
    keydown(list, "End");
    expect(list.getAttribute("aria-activedescendant")).toBe("lb-option-3");
    keydown(list, "Home");
    expect(list.getAttribute("aria-activedescendant")).toBe("lb-option-0");
    keydown(list, "PageDown");
    expect(list.getAttribute("aria-activedescendant")).toBe("lb-option-3");
    keydown(list, "PageUp");
    expect(list.getAttribute("aria-activedescendant")).toBe("lb-option-0");
    keydown(list, "Enter");
    expect(changes.at(-1)).toBe("a");
  });

  it("typeahead по первой букве и повторный перебор", () => {
    const root = rootOf(mount(handles, Listbox, { id: "lb", options }));
    const list = query<HTMLElement>(root, '[role="listbox"]');
    keydown(list, "г");
    expect(list.getAttribute("aria-activedescendant")).toBe("lb-option-2");
    keydown(list, "д");
    expect(list.getAttribute("aria-activedescendant")).toBe("lb-option-3");
  });

  it("searchable фильтрует, Escape очищает запрос, empty/loading", () => {
    const root = rootOf(
      mount(handles, Listbox, {
        id: "lb",
        options,
        searchable: true,
        empty: "Ничего",
      }),
    );
    const search = query<HTMLInputElement>(root, ".sui-listbox__search");
    input(search, "гам");
    expect(optionRows(root)).toHaveLength(1);
    expect(optionRows(root)[0]?.textContent).toContain("Гамма");
    keydown(search, "Escape");
    expect(optionRows(root)).toHaveLength(4);

    input(search, "zzz");
    expect(optionRows(root)).toHaveLength(0);
    expect(root.querySelector(".sui-popup__empty")?.textContent).toBe("Ничего");
  });

  it("кастомный filter получает опцию и запрос", () => {
    const seen: string[] = [];
    const root = rootOf(
      mount(handles, Listbox, {
        id: "lb",
        options,
        searchable: true,
        filter: (option: ListboxOption, query: string) => {
          seen.push(`${String(option.value)}:${query}`);
          return String(option.value).startsWith(query);
        },
      }),
    );
    input(query<HTMLInputElement>(root, ".sui-listbox__search"), "c");
    expect(seen.at(-1)).toBe("d:c");
    expect(optionRows(root).map((row) => row.textContent)).toEqual(["Гамма"]);
  });

  it("loading вместо empty", () => {
    const root = rootOf(
      mount(handles, Listbox, {
        options: [],
        loading: true,
        loadingText: "Грузим",
      }),
    );
    expect(root.querySelector(".sui-popup__loading")?.textContent).toBe("Грузим");
  });

  it("renderOption получает обычный объект и группы подписаны", () => {
    const seen: unknown[] = [];
    const root = rootOf(
      mount(handles, Listbox, {
        id: "lb",
        options: grouped,
        renderOption: (option: SelectOption) => {
          seen.push(option);
          return `→ ${String(option.value)}`;
        },
      }),
    );
    expect(root.querySelector(".sui-popup__group-label")?.textContent).toBe("Согласные");
    expect(optionRows(root)[2]?.textContent).toContain("→ c");
    expect(typeof seen[0]).toBe("object");
  });

  it("controlled activeValue и readOnly", () => {
    const active: unknown[] = [];
    const changes: unknown[] = [];
    const root = rootOf(
      mount(handles, Listbox, {
        id: "lb",
        options,
        activeValue: "d",
        onActiveValueChange: (value: unknown) => active.push(value),
        readOnly: true,
        onValueChange: (value: unknown) => changes.push(value),
      }),
    );
    const list = query<HTMLElement>(root, '[role="listbox"]');
    expect(list.getAttribute("aria-activedescendant")).toBe("lb-option-3");
    keydown(list, "ArrowDown");
    expect(active.at(-1)).toBe("a");
    click(optionRows(root)[0]!);
    expect(changes).toHaveLength(0);
  });
});

// ────────────────────────────── Select ─────────────────────────────────────

describe("Select custom", () => {
  it("закрыт по умолчанию: combobox + aria-expanded, панели нет", () => {
    const root = rootOf(
      mount(handles, Select, { id: "role", options, value: "a" }),
    );
    const control = query<HTMLElement>(root, ".sui-select__control");
    expect(control.getAttribute("role")).toBe("combobox");
    expect(control.getAttribute("aria-expanded")).toBe("false");
    expect(control.getAttribute("aria-controls")).toBe("role-listbox");
    expect(root.querySelector(".sui-popup")).toBeNull();
    expect(root.querySelector(".sui-select__value")?.textContent).toBe("Альфа");
  });

  it("клик открывает, опция выбирается и панель закрывается", () => {
    const changes: unknown[] = [];
    const root = rootOf(
      mount(handles, Select, {
        id: "role",
        options,
        value: "a",
        onValueChange: (value: unknown) => changes.push(value),
      }),
    );
    const control = query<HTMLElement>(root, ".sui-select__control");
    click(control);
    expect(control.getAttribute("aria-expanded")).toBe("true");
    const list = query<HTMLElement>(root, '[role="listbox"]');
    expect(list.id).toBe("role-listbox");
    expect(optionRows(root)).toHaveLength(4);
    expect(control.getAttribute("aria-activedescendant")).toBe("role-option-0");

    click(optionRows(root)[2]!);
    expect(changes.at(-1)).toBe("c");
    expect(root.querySelector(".sui-popup")).toBeNull();
    expect(control.getAttribute("aria-expanded")).toBe("false");
  });

  it("клавиатура: открытие, навигация, Enter, Escape", () => {
    const changes: unknown[] = [];
    const root = rootOf(
      mount(handles, Select, {
        id: "role",
        options,
        value: "a",
        onValueChange: (value: unknown) => changes.push(value),
      }),
    );
    const control = query<HTMLElement>(root, ".sui-select__control");
    keydown(control, "ArrowDown");
    expect(control.getAttribute("aria-expanded")).toBe("true");
    keydown(control, "ArrowDown");
    expect(control.getAttribute("aria-activedescendant")).toBe("role-option-2");
    keydown(control, "ArrowDown");
    expect(control.getAttribute("aria-activedescendant")).toBe("role-option-3");
    keydown(control, "Enter");
    expect(changes.at(-1)).toBe("d");
    expect(root.querySelector(".sui-popup")).toBeNull();

    keydown(control, "ArrowDown");
    keydown(control, "Escape");
    expect(root.querySelector(".sui-popup")).toBeNull();
  });

  it("Tab закрывает без выбора", () => {
    const changes: unknown[] = [];
    const root = rootOf(
      mount(handles, Select, {
        id: "role",
        options,
        onValueChange: (value: unknown) => changes.push(value),
      }),
    );
    const control = query<HTMLElement>(root, ".sui-select__control");
    click(control);
    keydown(control, "Tab");
    expect(root.querySelector(".sui-popup")).toBeNull();
    expect(changes).toHaveLength(0);
  });

  it("typeahead выбирает по букве", () => {
    const changes: unknown[] = [];
    const root = rootOf(
      mount(handles, Select, {
        id: "role",
        options,
        onValueChange: (value: unknown) => changes.push(value),
      }),
    );
    const control = query<HTMLElement>(root, ".sui-select__control");
    keydown(control, "г");
    keydown(control, "Enter");
    expect(changes.at(-1)).toBe("c");
  });

  it("disabled и readOnly не меняют значение", () => {
    const disabledField = fakeField("a");
    const disabledRoot = rootOf(
      mount(handles, Select, {
        id: "role-disabled",
        options,
        field: disabledField.field,
        disabled: true,
      }),
    );
    click(query(disabledRoot, ".sui-select__control"));
    expect(disabledRoot.querySelector(".sui-popup")).toBeNull();

    const readOnlyField = fakeField("a");
    const readOnlyRoot = rootOf(
      mount(handles, Select, {
        id: "role-readonly",
        options,
        field: readOnlyField.field,
        readOnly: true,
      }),
    );
    click(query(readOnlyRoot, ".sui-select__control"));
    click(optionRows(readOnlyRoot)[2]!);
    expect(readOnlyField.field.value).toBe("a");
  });

  it("disabled-опцию нельзя выбрать мышью", () => {
    const changes: unknown[] = [];
    const root = rootOf(
      mount(handles, Select, {
        id: "role",
        options,
        onValueChange: (value: unknown) => changes.push(value),
      }),
    );
    click(query(root, ".sui-select__control"));
    click(optionRows(root)[1]!);
    expect(changes).toHaveLength(0);
    expect(root.querySelector(".sui-popup")).not.toBeNull();
  });

  it("multi: chips, удаление, повторяющиеся hidden inputs", () => {
    const fake = fakeField<readonly string[]>(["a", "c"]);
    const root = rootOf(
      mount(handles, Select, {
        id: "roles",
        name: "roles",
        options,
        multiple: true,
        field: fake.field,
      }),
    );
    const chips = Array.from(root.querySelectorAll<HTMLElement>(".sui-select__chip"));
    expect(chips.map((chip) => chip.textContent?.trim())).toEqual(["Альфа", "Гамма"]);
    const hidden = Array.from(root.querySelectorAll<HTMLInputElement>('input[type="hidden"]'));
    expect(hidden.map((item) => item.name)).toEqual(["roles", "roles"]);
    expect(hidden.map((item) => item.value)).toEqual(["a", "c"]);

    click(chips[0]!.querySelector("button")!);
    expect(fake.field.value).toEqual(["c"]);
    expect(root.querySelectorAll(".sui-select__chip")).toHaveLength(1);

    click(query(root, ".sui-select__control"));
    click(optionRows(root)[0]!);
    expect(fake.field.value).toEqual(["c", "a"]);
  });

  it("searchable: ввод фильтрует, выбор и пустой результат", () => {
    const changes: unknown[] = [];
    const root = rootOf(
      mount(handles, Select, {
        id: "role",
        options,
        searchable: true,
        empty: "Нет совпадений",
        onValueChange: (value: unknown) => changes.push(value),
      }),
    );
    const search = query<HTMLInputElement>(root, ".sui-select__search");
    keydown(search, "ArrowDown");
    input(search, "гам");
    expect(optionRows(root)).toHaveLength(1);
    click(optionRows(root)[0]!);
    expect(changes.at(-1)).toBe("c");
    expect(root.querySelector(".sui-popup")).toBeNull();

    click(search);
    input(search, "zzz");
    expect(root.querySelector(".sui-popup__empty")?.textContent).toBe("Нет совпадений");
  });

  it("searchable=auto включает поиск только на большом списке", () => {
    const small = rootOf(
      mount(handles, Select, { id: "small", options, searchable: "auto" }),
    );
    expect(small.querySelector(".sui-select__search")).toBeNull();

    const many = Array.from({ length: 9 }, (_, index) => ({
      value: String(index),
      label: `Опция ${index}`,
    }));
    const big = rootOf(
      mount(handles, Select, { id: "big", options: many, searchable: "auto" }),
    );
    expect(big.querySelector(".sui-select__search")).not.toBeNull();
  });

  it("clearable очищает значение и hidden input", () => {
    const changes: unknown[] = [];
    const root = rootOf(
      mount(handles, Select, {
        id: "role",
        options,
        defaultValue: "b",
        clearable: true,
        onValueChange: (value: unknown) => changes.push(value),
      }),
    );
    expect(root.querySelector(".sui-popup")).toBeNull();
    click(query(root, ".sui-select__clear"));
    expect(changes.at(-1)).toBe("");
    expect(query<HTMLInputElement>(root, 'input[type="hidden"]').value).toBe("");
    expect(root.querySelector(".sui-select__placeholder")).not.toBeNull();
  });

  it("группы: подпись и опции", () => {
    const root = rootOf(
      mount(handles, Select, { id: "role", options: grouped }),
    );
    click(query(root, ".sui-select__control"));
    expect(root.querySelector(".sui-popup__group-label")?.textContent).toBe("Согласные");
    expect(optionRows(root)).toHaveLength(3);
  });

  it("field: synthetic onChange, multi selectedOptions и touched при выходе из корня", () => {
    const single = fakeField("a");
    const root = rootOf(
      mount(handles, Select, { id: "role", options, field: single.field }),
    );
    click(query(root, ".sui-select__control"));
    click(optionRows(root)[2]!);
    expect(single.field.value).toBe("c");

    const control = query<HTMLElement>(root, ".sui-select__control");
    control.dispatchEvent(
      new FocusEvent("blur", { bubbles: true, relatedTarget: control }),
    );
    flush();
    expect(single.field.touched).toBe(false);
    control.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
    flush();
    expect(single.field.touched).toBe(true);

    const multi = fakeField<readonly string[]>(["a"]);
    const multiRoot = rootOf(
      mount(handles, Select, {
        id: "roles",
        options,
        multiple: true,
        field: multi.field,
      }),
    );
    click(query(multiRoot, ".sui-select__control"));
    click(optionRows(multiRoot)[2]!);
    expect(multi.field.value).toEqual(["a", "c"]);
  });

  it("reset формы и внешнее изменение значения обновляют hidden inputs", () => {
    const fake = fakeField("b");
    const root = rootOf(
      mount(handles, Select, { id: "role", options, field: fake.field }),
    );
    const hidden = (): HTMLInputElement =>
      query<HTMLInputElement>(root, 'input[type="hidden"]');
    expect(hidden().value).toBe("b");
    fake.set("");
    flush();
    expect(hidden().value).toBe("");

    const multiple = fakeField<readonly string[]>(["a"]);
    const multiRoot = rootOf(
      mount(handles, Select, {
        id: "roles",
        options,
        multiple: true,
        field: multiple.field,
      }),
    );
    multiple.set(["c", "d"]);
    flush();
    expect(
      Array.from(multiRoot.querySelectorAll<HTMLInputElement>('input[type="hidden"]')).map(
        (item) => item.value,
      ),
    ).toEqual(["c", "d"]);
  });

  it("иконки, описания, renderOption и renderValue", () => {
    const valueRoot = rootOf(
      mount(handles, Select, {
        id: "role",
        options: [
          { value: "a", label: "Альфа", description: "Первая", leading: "A" },
        ],
        defaultValue: "a",
        renderValue: (selected: readonly SelectOption[]) => `Выбрано: ${selected.length}`,
      }),
    );
    expect(valueRoot.querySelector(".sui-select__value")?.textContent).toBe("Выбрано: 1");
    click(query(valueRoot, ".sui-select__control"));
    expect(optionRows(valueRoot)[0]?.textContent).toContain("Первая");
    expect(optionRows(valueRoot)[0]?.querySelector(".sui-popup__option-leading")?.textContent).toBe("A");

    const optionRoot = rootOf(
      mount(handles, Select, {
        id: "role-render",
        options: [{ value: "a", label: "Альфа" }],
        renderOption: (option: SelectOption) => `вариант:${String(option.value)}`,
      }),
    );
    click(query(optionRoot, ".sui-select__control"));
    expect(optionRows(optionRoot)[0]?.textContent).toContain("вариант:a");
  });

  it("loading показывает индикатор вместо пустого списка", () => {
    const root = rootOf(
      mount(handles, Select, {
        id: "role",
        options: [],
        loading: true,
        loadingText: "Загружаем",
      }),
    );
    click(query(root, ".sui-select__control"));
    expect(root.querySelector(".sui-popup__loading")?.textContent).toBe("Загружаем");
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
      mount(handles, Select, {
        id: "role",
        options: [],
        searchable: true,
        loadOptions,
      }),
    );
    const search = query<HTMLInputElement>(root, ".sui-select__search");
    keydown(search, "ArrowDown");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.query).toBe("");
    input(search, "бе");
    expect(calls).toHaveLength(2);
    expect(calls[0]?.signal.aborted).toBe(true);

    calls[1]!.resolve([{ value: "b", label: "Бета" }]);
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(optionRows(root).map((row) => row.textContent)).toEqual(["Бета"]);

    calls[0]!.resolve([{ value: "old", label: "Старое" }]);
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(optionRows(root).map((row) => row.textContent)).toEqual(["Бета"]);
  });
});

describe("NativeSelect", () => {
  it("сохраняет нативный select и реконсиляцию options", () => {
    const root = rootOf(
      mount(handles, NativeSelect, {
        id: "role",
        options,
        placeholder: "Выберите",
        value: "a",
      }),
    );
    const select = query<HTMLSelectElement>(root, "select");
    expect(select.value).toBe("a");
    expect(select.options).toHaveLength(5);
    expect(select.title).toBe("Альфа");
  });

  it("Select variant=native даёт тот же нативный контрол", () => {
    const root = rootOf(
      mount(handles, Select, {
        id: "role",
        variant: "native",
        options,
        value: "c",
      }),
    );
    expect(root.querySelector("select")).not.toBeNull();
    expect(root.querySelector(".sui-popup")).toBeNull();
  });
});

// ───────────────────── Native/custom parity ────────────────────────────────

describe.each(["native", "custom"] as const)("поведение %s", (variant) => {
  function render(fake = fakeField("a")) {
    const root = rootOf(
      mount(handles, Select, {
        id: `parity-${variant}`,
        variant,
        options,
        field: fake.field,
      }),
    );
    return { root, fake };
  }

  it("показывает все опции, включая disabled", () => {
    const { root } = render();
    if (variant === "native") {
      const select = query<HTMLSelectElement>(root, "select");
      expect(Array.from(select.options).map((option) => option.value)).toEqual([
        "a",
        "b",
        "c",
        "d",
      ]);
      expect(select.options[1]?.disabled).toBe(true);
      expect(select.value).toBe("a");
    } else {
      const control = query<HTMLElement>(root, ".sui-select__control");
      expect(control.textContent).toContain("Альфа");
      click(control);
      expect(optionRows(root)).toHaveLength(4);
      expect(optionRows(root)[1]?.getAttribute("aria-disabled")).toBe("true");
      expect(optionRows(root)[0]?.getAttribute("aria-selected")).toBe("true");
    }
  });

  it("записывает выбранное значение в field", () => {
    const { root, fake } = render();
    if (variant === "native") {
      const select = query<HTMLSelectElement>(root, "select");
      select.value = "c";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      flush();
    } else {
      click(query(root, ".sui-select__control"));
      click(optionRows(root)[2]!);
    }
    expect(fake.field.value).toBe("c");
  });

  it("disabled-контрол не открывается и не меняет значение", () => {
    const fake = fakeField("a");
    const root = rootOf(
      mount(handles, Select, {
        id: `parity-disabled-${variant}`,
        variant,
        options,
        field: fake.field,
        disabled: true,
      }),
    );
    if (variant === "native") {
      expect(query<HTMLSelectElement>(root, "select").disabled).toBe(true);
    } else {
      click(query(root, ".sui-select__control"));
      expect(root.querySelector(".sui-popup")).toBeNull();
    }
    expect(fake.field.value).toBe("a");
  });
});
