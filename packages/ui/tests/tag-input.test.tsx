import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { flushSync, hydrate } from "@ivlev-dev/silent-core";
import { renderToString } from "@ivlev-dev/silent-server";
import { TagInput } from "../src/form/tag-input/index.js";
import {
  addTagValues,
  removeTagAt,
  splitTagText,
  tagValues,
} from "../src/form/tag-input/tags.js";
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
  vi.restoreAllMocks();
});

function flush(): void {
  flushSync();
  flushSync();
}

function tagInput(root: Element): HTMLInputElement {
  return query<HTMLInputElement>(root, ".sui-tag-input__input");
}

function chips(root: Element): string[] {
  return Array.from(root.querySelectorAll(".sui-tag-input__chip-text")).map(
    (chip) => chip.textContent ?? "",
  );
}

function type(target: HTMLInputElement, value: string): void {
  target.value = value;
  target.dispatchEvent(new Event("input", { bubbles: true }));
  flush();
}

function press(target: EventTarget, key: string): void {
  target.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
  );
  flush();
}

function paste(target: HTMLInputElement, text: string): void {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { getData: () => text },
  });
  target.dispatchEvent(event);
  flush();
}

describe("TagInput: модель тегов", () => {
  it("split по символьным разделителям и переводам строк", () => {
    expect(splitTagText("a, b\nc", [",", "Enter"])).toEqual(["a", " b", "c"]);
    expect(splitTagText("a;b", [";"])).toEqual(["a", "b"]);
    expect(splitTagText("a,b", [])).toEqual(["a,b"]);
  });

  it("add учитывает unique, max, длину и validateTag", () => {
    expect(addTagValues(["a"], ["a", "b"], { unique: true })).toEqual(["a", "b"]);
    expect(addTagValues(["a"], ["b"], { max: 1 })).toEqual(["a"]);
    expect(
      addTagValues([], ["a", "long"], { minLength: 2 }),
    ).toEqual(["long"]);
    expect(
      addTagValues([], ["a", "b", "c"], { max: 2 }),
    ).toEqual(["a", "b"]);
    expect(
      addTagValues([], ["bad", "ok"], { validate: (value) => value !== "bad" }),
    ).toEqual(["ok"]);
    expect(addTagValues([], ["  x  "])).toEqual(["x"]);
  });

  it("удаление и нормализация значения поля", () => {
    expect(removeTagAt(["a", "b", "c"], 1)).toEqual(["a", "c"]);
    expect(removeTagAt(["a"], 5)).toEqual(["a"]);
    expect(tagValues("one")).toEqual(["one"]);
    expect(tagValues(undefined)).toEqual([]);
  });
});

describe("TagInput: добавление и удаление", () => {
  it("role=combobox, чипы и подписи кнопок удаления", () => {
    const root = rootOf(
      mount(handles, TagInput, {
        id: "tags",
        name: "tags",
        label: "Теги",
        value: ["alpha", "beta"],
      }),
    );
    const control = query<HTMLElement>(root, ".sui-tag-input");
    expect(control.getAttribute("role")).toBe("combobox");
    expect(control.getAttribute("aria-label")).toBe("Теги");
    expect(control.getAttribute("aria-expanded")).toBe("false");
    expect(chips(root)).toEqual(["alpha", "beta"]);
    const remove = Array.from(root.querySelectorAll(".sui-tag-input__remove"));
    expect(remove).toHaveLength(2);
    expect(remove[0]?.getAttribute("aria-label")).toBe("Удалить тег: alpha");
    expect(root.querySelectorAll('input[type="hidden"]')).toHaveLength(2);
  });

  it("Enter и символьный разделитель добавляют тег", () => {
    const changes: Array<readonly string[]> = [];
    const root = rootOf(
      mount(handles, TagInput, {
        id: "tags",
        defaultValue: ["one"],
        onValueChange: (value: readonly string[]) => changes.push(value),
      }),
    );
    const input = tagInput(root);
    input.focus();
    flush();
    type(input, "two");
    press(input, "Enter");
    expect(changes.at(-1)).toEqual(["one", "two"]);
    expect(chips(root)).toEqual(["one", "two"]);
    expect(input.value).toBe("");

    type(input, "three");
    press(input, ",");
    expect(changes.at(-1)).toEqual(["one", "two", "three"]);
    expect(chips(root)).toEqual(["one", "two", "three"]);
  });

  it("дубликаты и max не меняют значение", () => {
    const changes: Array<readonly string[]> = [];
    const root = rootOf(
      mount(handles, TagInput, {
        id: "tags",
        defaultValue: ["a"],
        max: 2,
        unique: true,
        onValueChange: (value: readonly string[]) => changes.push(value),
      }),
    );
    const input = tagInput(root);
    input.focus();
    flush();
    type(input, "a");
    press(input, "Enter");
    expect(changes).toHaveLength(0);
    type(input, "b");
    press(input, "Enter");
    expect(changes.at(-1)).toEqual(["a", "b"]);
    type(input, "c");
    press(input, "Enter");
    expect(changes).toHaveLength(1);
    expect(chips(root)).toEqual(["a", "b"]);
    expect(query(root, ".sui-tag-input").getAttribute("data-limit")).toBe("max");
  });

  it("minLength/maxLength и validateTag отбрасывают теги", () => {
    const changes: Array<readonly string[]> = [];
    const root = rootOf(
      mount(handles, TagInput, {
        id: "tags",
        defaultValue: [],
        minLength: 2,
        maxLength: 4,
        validateTag: (value: string) => value !== "bad",
        onValueChange: (value: readonly string[]) => changes.push(value),
      }),
    );
    const input = tagInput(root);
    input.focus();
    flush();
    type(input, "x");
    press(input, "Enter");
    type(input, "bad");
    press(input, "Enter");
    type(input, "okay");
    press(input, "Enter");
    expect(changes).toEqual([["okay"]]);
  });

  it("Backspace на пустом вводе удаляет последний тег", () => {
    const changes: Array<readonly string[]> = [];
    const root = rootOf(
      mount(handles, TagInput, {
        id: "tags",
        defaultValue: ["a", "b"],
        onValueChange: (value: readonly string[]) => changes.push(value),
      }),
    );
    const input = tagInput(root);
    input.focus();
    flush();
    press(input, "Backspace");
    expect(changes.at(-1)).toEqual(["a"]);
    expect(chips(root)).toEqual(["a"]);
  });

  it("кнопка удаления и clearable", () => {
    const changes: Array<readonly string[]> = [];
    const root = rootOf(
      mount(handles, TagInput, {
        id: "tags",
        defaultValue: ["a", "b"],
        clearable: true,
        onValueChange: (value: readonly string[]) => changes.push(value),
      }),
    );
    const remove = Array.from(root.querySelectorAll<HTMLButtonElement>(".sui-tag-input__remove"));
    remove[0]?.click();
    flush();
    expect(changes.at(-1)).toEqual(["b"]);
    const clear = query<HTMLButtonElement>(root, ".sui-tag-input__clear");
    clear.click();
    flush();
    expect(changes.at(-1)).toEqual([]);
    expect(chips(root)).toEqual([]);
  });
});

describe("TagInput: подсказки и клавиатура", () => {
  it("фокус показывает список, фильтрация и Enter выбирают опцию", () => {
    const changes: Array<readonly string[]> = [];
    const root = rootOf(
      mount(handles, TagInput, {
        id: "tags",
        value: [],
        suggestions: ["Alpha", "Beta", "Gamma"],
        onValueChange: (value: readonly string[]) => changes.push(value),
      }),
    );
    const input = tagInput(root);
    input.focus();
    flush();
    expect(query(root, ".sui-tag-input").getAttribute("aria-expanded")).toBe("true");
    expect(root.querySelectorAll('[role="option"]')).toHaveLength(3);

    type(input, "be");
    expect(
      Array.from(root.querySelectorAll('[role="option"]')).map(
        (option) => option.textContent,
      ),
    ).toEqual(["Beta"]);

    press(input, "ArrowDown");
    press(input, "Enter");
    expect(changes.at(-1)).toEqual(["Beta"]);
    expect(query(root, ".sui-tag-input").getAttribute("aria-expanded")).toBe("false");
  });

  it("loadSuggestions отменяет устаревший запрос", async () => {
    const calls: Array<{
      query: string;
      signal: AbortSignal;
      resolve: (items: readonly string[]) => void;
    }> = [];
    const loadSuggestions = (
      text: string,
      signal: AbortSignal,
    ): Promise<readonly string[]> =>
      new Promise((resolve) => {
        calls.push({ query: text, signal, resolve });
      });
    const root = rootOf(
      mount(handles, TagInput, {
        id: "tags",
        value: [],
        suggestions: [],
        loadSuggestions,
      }),
    );
    const input = tagInput(root);
    input.focus();
    flush();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.query).toBe("");

    type(input, "al");
    expect(calls).toHaveLength(2);
    expect(calls[0]?.signal.aborted).toBe(true);

    calls[1]!.resolve(["Alpha"]);
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(
      Array.from(root.querySelectorAll('[role="option"]')).map(
        (option) => option.textContent,
      ),
    ).toEqual(["Alpha"]);

    calls[0]!.resolve(["Old"]);
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(
      Array.from(root.querySelectorAll('[role="option"]')).map(
        (option) => option.textContent,
      ),
    ).toEqual(["Alpha"]);
  });

  it("вставка делится по разделителям, splitOnPaste=false — один тег", () => {
    const changes: Array<readonly string[]> = [];
    const root = rootOf(
      mount(handles, TagInput, {
        id: "tags",
        value: [],
        onValueChange: (value: readonly string[]) => changes.push(value),
      }),
    );
    const input = tagInput(root);
    input.focus();
    flush();
    paste(input, "one, two\nthree");
    expect(changes.at(-1)).toEqual(["one", "two", "three"]);

    const singleChanges: Array<readonly string[]> = [];
    const singleRoot = rootOf(
      mount(handles, TagInput, {
        id: "tags-single",
        value: [],
        splitOnPaste: false,
        onValueChange: (value: readonly string[]) => singleChanges.push(value),
      }),
    );
    const singleInput = tagInput(singleRoot);
    singleInput.focus();
    flush();
    paste(singleInput, "one, two");
    expect(singleChanges.at(-1)).toEqual(["one, two"]);
  });
  it("1000 подсказок: окно, активная строка и выбор", () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "clientHeight",
    );
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get(this: HTMLElement) {
        return this.getAttribute("role") === "listbox" ? 320 : 0;
      },
    });
    try {
      const changes: Array<readonly string[]> = [];
      const suggestions = Array.from(
        { length: 1000 },
        (_, index) => `Suggestion ${index}`,
      );
      const root = rootOf(
        mount(handles, TagInput, {
          id: "tags",
          value: [],
          suggestions,
          onValueChange: (value: readonly string[]) => changes.push(value),
        }),
      );
      const input = tagInput(root);
      input.focus();
      flush();

      const list = query<HTMLElement>(root, '[role="listbox"]');
      const optionList = Array.from(
        root.querySelectorAll<HTMLElement>('[role="option"]'),
      );
      expect(optionList.length).toBeGreaterThan(0);
      expect(optionList.length).toBeLessThanOrEqual(31);
      expect(query<HTMLElement>(root, ".sui-popup__virtual-spacer").style.height)
        .toBe("40000px");
      expect(optionList[0]?.getAttribute("aria-setsize")).toBe("1000");

      press(input, "ArrowUp");
      const activeId = input.getAttribute("aria-activedescendant");
      expect(activeId).toBe("tags-option-999");
      expect(list.querySelector(`#${activeId}`)).not.toBeNull();

      press(input, "Enter");
      expect(changes.at(-1)).toEqual(["Suggestion 999"]);
    } finally {
      if (descriptor === undefined) {
        delete (HTMLElement.prototype as unknown as Record<string, unknown>)
          .clientHeight;
      } else {
        Object.defineProperty(HTMLElement.prototype, "clientHeight", descriptor);
      }
    }
  });

});

describe("TagInput: форма и SSR", () => {
  it("field получает массив через синтетический change", () => {
    const fake = fakeField<readonly string[]>([]);
    const root = rootOf(mount(handles, TagInput, { field: fake.field }));
    const input = tagInput(root);
    input.focus();
    flush();
    type(input, "alpha");
    press(input, "Enter");
    expect(fake.field.value).toEqual(["alpha"]);
    const remove = query<HTMLButtonElement>(root, ".sui-tag-input__remove");
    remove.click();
    flush();
    expect(fake.field.value).toEqual([]);
  });

  it("blur ставится только при выходе из корня", () => {
    const fake = fakeField<readonly string[]>(["a"]);
    const root = rootOf(
      mount(handles, TagInput, {
        field: fake.field,
        clearable: true,
        suggestions: ["Beta"],
      }),
    );
    const input = tagInput(root);
    input.focus();
    flush();
    const control = query<HTMLElement>(root, ".sui-tag-input");
    const remove = query<HTMLButtonElement>(root, ".sui-tag-input__remove");
    control.dispatchEvent(
      new FocusEvent("focusout", {
        bubbles: true,
        relatedTarget: remove,
      }),
    );
    flush();
    expect(fake.field.touched).toBe(false);
    control.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    flush();
    expect(fake.field.touched).toBe(true);
  });

  it("SSR: чипы и скрытые input(s), без popup, гидрация без mismatch", async () => {
    function Ssr(): Node {
      return (
        <TagInput
          id="tags"
          name="tags"
          label="Теги"
          value={["alpha", "beta"]}
          suggestions={["Alpha", "Beta"]}
        />
      );
    }
    const { html } = await renderToString(Ssr);
    expect(html).toContain("alpha");
    expect(html).toContain("beta");
    expect(html).toContain('name="tags"');
    expect(html).not.toContain("sui-popup");
    expect(html).not.toContain('role="listbox"');

    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    const mismatches: string[] = [];
    const handle = await hydrate(container, Ssr, {
      onMismatch: (error) => mismatches.push(error.message),
    });
    cleanups.push(() => handle.dispose());
    expect(mismatches).toEqual([]);
    expect(chips(container)).toEqual(["alpha", "beta"]);
    const hidden = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="hidden"]'),
    );
    expect(hidden.map((input) => input.value)).toEqual(["alpha", "beta"]);
  });
});

describe("TagInput: ARIA и disabled-контраст", () => {
  it("aria-expanded живёт на combobox, а не на input", () => {
    const root = rootOf(mount(handles, TagInput, { label: "Теги", defaultValue: ["React"] }));
    const input = tagInput(root);
    expect(input.hasAttribute("aria-expanded")).toBe(false);
    const combobox = query(root, ".sui-tag-input");
    expect(combobox.getAttribute("role")).toBe("combobox");
    expect(combobox.getAttribute("aria-expanded")).toBe("false");
  });

  it("disabled-чипы не гасят текст общей прозрачностью", () => {
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "src", "form", "tag-input", "tag-input.css"),
      "utf8",
    );
    expect(css).toContain("[data-disabled] .sui-tag-input__chip");
    expect(css).not.toMatch(/\.sui-tag-input\[data-disabled\]\s*\{[^}]*opacity:/u);
  });
});
