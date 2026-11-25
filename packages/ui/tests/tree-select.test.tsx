import { afterEach, describe, expect, it } from "vitest";
import { flushSync } from "@ivlev-dev/silent-core";
import {
  TreeSelect,
  type TreeSelectNode,
  type TreeSelectValue,
} from "../src/form/tree-select/index.js";
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

function flush(): void {
  flushSync();
  flushSync();
}

function click(element: Element): void {
  element.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true }),
  );
  flush();
}

function keydown(
  target: EventTarget,
  key: string,
  init: KeyboardEventInit = {},
): void {
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

const nodes: readonly TreeSelectNode[] = [
  {
    value: "fruits",
    label: "Фрукты",
    children: [
      { value: "apple", label: "Яблоко" },
      {
        value: "banana",
        label: "Банан",
        children: [
          { value: "plantain", label: "Плантан", keywords: ["банан"] },
        ],
      },
    ],
  },
  {
    value: "veg",
    label: "Овощи",
    children: [
      { value: "carrot", label: "Морковь", disabled: true },
      { value: "potato", label: "Картофель" },
    ],
  },
];

function control(root: Element): HTMLElement {
  return query<HTMLElement>(root, ".sui-tree-select__control");
}

function rows(root: Element): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(".sui-tree-select__row"),
  );
}

function row(root: Element, text: string): HTMLElement {
  const found = rows(root).find((item) => item.textContent?.includes(text));
  if (found === undefined) {
    throw new Error(`нет строки «${text}»: ${rows(root).map((item) => item.textContent).join(" | ")}`);
  }
  return found;
}

function activeText(root: Element): string | null {
  const id = control(root).getAttribute("aria-activedescendant");
  if (id === null) return null;
  const element = root.ownerDocument.getElementById(id);
  return element?.textContent?.trim() ?? null;
}

function open(root: Element): void {
  if (control(root).getAttribute("aria-expanded") !== "true") click(control(root));
}

describe("TreeSelect: одиночный выбор", () => {
  it("SSR-подобное закрытое состояние: триггер и hidden input", () => {
    const root = rootOf(
      mount(handles, TreeSelect, {
        id: "tree",
        name: "food",
        label: "Еда",
        nodes,
        defaultValue: "apple",
      }),
    );
    expect(control(root).getAttribute("role")).toBe("combobox");
    expect(control(root).getAttribute("aria-expanded")).toBe("false");
    expect(control(root).getAttribute("aria-haspopup")).toBe("tree");
    expect(root.querySelector('[role="tree"]')).toBeNull();
    expect(root.querySelector(".sui-tree-select__checkbox")).toBeNull();
    expect(root.querySelector('input[type="hidden"]')?.getAttribute("value")).toBe(
      "apple",
    );
    expect(query<HTMLElement>(root, ".sui-tree-select__value").textContent).toBe(
      "Яблоко",
    );
  });

  it("selectableParents=false: родитель только раскрывается, лист выбирается", () => {
    const changes: TreeSelectValue[] = [];
    const root = rootOf(
      mount(handles, TreeSelect, {
        id: "tree",
        nodes,
        selectableParents: false,
        defaultValue: "apple",
        onValueChange: (value: TreeSelectValue) => changes.push(value),
      }),
    );
    open(root);
    expect(rows(root).map((item) => item.textContent?.trim())).toEqual([
      "Фрукты",
      "Овощи",
    ]);

    click(row(root, "Фрукты"));
    expect(changes).toEqual([]);
    expect(control(root).getAttribute("aria-expanded")).toBe("true");
    expect(rows(root).map((item) => item.dataset.value)).toEqual([
      "fruits",
      "apple",
      "banana",
      "veg",
    ]);
    expect(row(root, "Фрукты").getAttribute("aria-expanded")).toBe("true");

    click(row(root, "Яблоко"));
    expect(changes.at(-1)).toBe("apple");
    expect(control(root).getAttribute("aria-expanded")).toBe("false");
    expect(root.querySelector('input[type="hidden"]')?.getAttribute("value")).toBe(
      "apple",
    );
    expect(query<HTMLElement>(root, ".sui-tree-select__value").textContent).toBe(
      "Яблоко",
    );

    open(root);
    expect(row(root, "Яблоко").getAttribute("aria-selected")).toBe("true");
  });
});

describe("TreeSelect: multiple, каскад и indeterminate", () => {
  it("выбор листа не отмечает родителя, частичный родитель — mixed", () => {
    const changes: TreeSelectValue[] = [];
    const root = rootOf(
      mount(handles, TreeSelect, {
        id: "tree",
        nodes,
        multiple: true,
        defaultExpanded: ["fruits"],
        onValueChange: (value: TreeSelectValue) => changes.push(value),
      }),
    );
    expect(root.querySelector(".sui-tree-select")?.getAttribute("data-multiple")).toBe(
      "",
    );
    open(root);
    expect(rows(root).map((item) => item.dataset.value)).toEqual([
      "fruits",
      "apple",
      "banana",
      "veg",
    ]);

    click(row(root, "Яблоко"));
    expect(changes.at(-1)).toEqual(["apple"]);
    expect(row(root, "Яблоко").getAttribute("aria-checked")).toBe("true");
    expect(row(root, "Фрукты").getAttribute("aria-checked")).toBe("mixed");
    expect(row(root, "Фрукты").hasAttribute("data-indeterminate")).toBe(true);
    expect(row(root, "Яблоко").querySelector(".sui-tree-select__checkbox")?.hasAttribute(
      "data-checked",
    )).toBe(true);
  });

  it("каскад both сворачивает полный родитель в один чип", () => {
    const changes: TreeSelectValue[] = [];
    const root = rootOf(
      mount(handles, TreeSelect, {
        id: "tree",
        nodes,
        multiple: true,
        defaultExpanded: ["fruits"],
        onValueChange: (value: TreeSelectValue) => changes.push(value),
      }),
    );
    open(root);
    click(row(root, "Яблоко"));
    click(row(root, "Банан"));

    expect(changes.at(-1)).toEqual(["apple", "plantain"]);
    expect(row(root, "Фрукты").getAttribute("aria-checked")).toBe("true");
    expect(row(root, "Банан").getAttribute("aria-checked")).toBe("true");
    expect(root.querySelector(".sui-tree-select__chip-label")?.textContent).toBe(
      "Фрукты",
    );

    click(row(root, "Яблоко"));
    expect(changes.at(-1)).toEqual(["plantain"]);
    expect(row(root, "Фрукты").getAttribute("aria-checked")).toBe("mixed");
    expect(root.querySelector(".sui-tree-select__chip-label")?.textContent).toBe(
      "Банан",
    );
  });

  it("emit=checked включает родителей, selectableParents отсекает их", () => {
    const changes: TreeSelectValue[] = [];
    const root = rootOf(
      mount(handles, TreeSelect, {
        id: "tree",
        nodes,
        multiple: true,
        emit: "checked",
        onValueChange: (value: TreeSelectValue) => changes.push(value),
      }),
    );
    open(root);
    click(row(root, "Фрукты"));
    expect(changes.at(-1)).toEqual([
      "fruits",
      "apple",
      "banana",
      "plantain",
    ]);
  });

  it("expandOnClick=icon: строка выбирает, шеврон раскрывает", () => {
    const changes: TreeSelectValue[] = [];
    const expandedChanges: Array<readonly TreeSelectValue[]> = [];
    const root = rootOf(
      mount(handles, TreeSelect, {
        id: "tree",
        nodes,
        multiple: true,
        expandOnClick: "icon",
        onValueChange: (value: TreeSelectValue) => changes.push(value),
        onExpandedChange: (expanded: readonly TreeSelectValue[]) =>
          expandedChanges.push(expanded),
      }),
    );
    open(root);
    click(row(root, "Фрукты"));
    expect(changes.at(-1)).toEqual(["apple", "plantain"]);
    expect(row(root, "Фрукты").getAttribute("aria-expanded")).toBe("false");

    const expander = query<HTMLElement>(
      row(root, "Фрукты"),
      ".sui-tree-select__expander",
    );
    click(expander);
    expect(row(root, "Фрукты").getAttribute("aria-expanded")).toBe("true");
    expect(expandedChanges.at(-1)).toEqual(["fruits"]);
  });

  it("удаление чипа снимает выбор", () => {
    const changes: TreeSelectValue[] = [];
    const root = rootOf(
      mount(handles, TreeSelect, {
        id: "tree",
        nodes,
        multiple: true,
        defaultValue: ["apple", "potato"],
        onValueChange: (value: TreeSelectValue) => changes.push(value),
      }),
    );
    const remove = query<HTMLButtonElement>(
      root,
      ".sui-tree-select__chip-remove",
    );
    click(remove);
    expect(changes.at(-1)).toEqual(["potato"]);
    expect(root.querySelectorAll(".sui-tree-select__chip")).toHaveLength(1);
  });
});

describe("TreeSelect: клавиатура", () => {
  it("открывает, раскрывает, ходит по дереву и выбирает", () => {
    const changes: TreeSelectValue[] = [];
    const root = rootOf(
      mount(handles, TreeSelect, {
        id: "tree",
        name: "food",
        nodes,
        searchable: false,
        onValueChange: (value: TreeSelectValue) => changes.push(value),
      }),
    );
    keydown(control(root), "ArrowDown");
    expect(control(root).getAttribute("aria-expanded")).toBe("true");
    expect(activeText(root)).toBe("Фрукты");

    keydown(control(root), "ArrowRight");
    expect(row(root, "Фрукты").getAttribute("aria-expanded")).toBe("true");
    keydown(control(root), "ArrowDown");
    expect(activeText(root)).toBe("Яблоко");
    keydown(control(root), "ArrowLeft");
    expect(activeText(root)).toBe("Фрукты");
    keydown(control(root), "ArrowLeft");
    expect(row(root, "Фрукты").getAttribute("aria-expanded")).toBe("false");

    keydown(control(root), "End");
    expect(activeText(root)).toBe("Овощи");
    keydown(control(root), "Home");
    expect(activeText(root)).toBe("Фрукты");
    keydown(control(root), "о");
    expect(activeText(root)).toBe("Овощи");

    keydown(control(root), "Enter");
    expect(changes.at(-1)).toBe("veg");
    expect(control(root).getAttribute("aria-expanded")).toBe("false");
    expect(root.querySelector('input[type="hidden"]')?.getAttribute("value")).toBe(
      "veg",
    );
  });

  it("typeahead пропускает disabled-узлы", () => {
    const root = rootOf(
      mount(handles, TreeSelect, {
        id: "tree",
        nodes,
        multiple: true,
        defaultExpanded: ["veg"],
        searchable: false,
      }),
    );
    keydown(control(root), "ArrowDown");
    keydown(control(root), "к");
    // «Морковь» disabled — typeahead доходит до «Картофель».
    expect(activeText(root)).toBe("Картофель");
  });

  it("disabled-узел не переключается", () => {
    const changes: TreeSelectValue[] = [];
    const root = rootOf(
      mount(handles, TreeSelect, {
        id: "tree",
        nodes,
        multiple: true,
        defaultExpanded: ["veg"],
        onValueChange: (value: TreeSelectValue) => changes.push(value),
      }),
    );
    open(root);
    expect(row(root, "Морковь").getAttribute("aria-disabled")).toBe("true");
    click(row(root, "Морковь"));
    expect(changes).toEqual([]);
    expect(row(root, "Морковь").getAttribute("aria-checked")).toBe("false");
  });

  it("disabled-компонент не открывается", () => {
    const root = rootOf(
      mount(handles, TreeSelect, { id: "tree", nodes, disabled: true }),
    );
    click(control(root));
    expect(control(root).getAttribute("aria-expanded")).toBe("false");
    expect(root.querySelector('[role="tree"]')).toBeNull();
    expect(control(root).getAttribute("aria-disabled")).toBe("true");
    expect(control(root).hasAttribute("tabindex")).toBe(false);
  });
});

describe("TreeSelect: поиск", () => {
  it("keep-ancestors оставляет путь до совпадения", () => {
    const root = rootOf(
      mount(handles, TreeSelect, { id: "tree", nodes, multiple: true }),
    );
    open(root);
    const search = query<HTMLInputElement>(root, ".sui-popup__search");
    input(search, "план");
    expect(rows(root).map((item) => item.dataset.value)).toEqual([
      "fruits",
      "banana",
      "plantain",
    ]);
    expect(rows(root).map((item) => item.getAttribute("aria-level"))).toEqual([
      "1",
      "2",
      "3",
    ]);
    input(search, "zzz");
    expect(rows(root)).toHaveLength(0);
    expect(root.querySelector(".sui-popup__empty")?.textContent).toBe(
      "Нет данных",
    );
    input(search, "");
    expect(rows(root).map((item) => item.dataset.value)).toEqual([
      "fruits",
      "veg",
    ]);
  });

  it("flattenOnSearch показывает результаты одним уровнем", () => {
    const root = rootOf(
      mount(handles, TreeSelect, {
        id: "tree",
        nodes,
        multiple: true,
        flattenOnSearch: true,
      }),
    );
    open(root);
    input(query<HTMLInputElement>(root, ".sui-popup__search"), "план");
    expect(rows(root).map((item) => item.dataset.value)).toEqual([
      "fruits",
      "banana",
      "plantain",
    ]);
    expect(rows(root).map((item) => item.getAttribute("aria-level"))).toEqual([
      "1",
      "1",
      "1",
    ]);
    expect(rows(root).every((item) => !item.hasAttribute("aria-expanded"))).toBe(
      true,
    );
  });
});

describe("TreeSelect: форма", () => {
  it("single: field.onChange, value, touched и ошибка", () => {
    const fake = fakeField<string>("", { name: "food", required: true });
    const root = rootOf(
      mount(handles, TreeSelect, {
        id: "tree",
        nodes,
        defaultExpanded: ["fruits"],
        field: fake.field,
      }),
    );
    open(root);
    click(row(root, "Яблоко"));
    expect(fake.field.value).toBe("apple");

    const controlElement = control(root);
    controlElement.focus();
    flush();
    controlElement.dispatchEvent(
      new FocusEvent("blur", { bubbles: false, relatedTarget: document.body }),
    );
    flush();
    expect(fake.field.touched).toBe(true);
    expect(root.getAttribute("data-touched")).toBe("");

    fake.fail("Нужен лист");
    flush();
    expect(root.getAttribute("data-invalid")).toBe("");
    expect(root.textContent).toContain("Нужен лист");
  });

  it("multiple: field получает selectedOptions и рендерит hidden inputs", () => {
    const fake = fakeField<readonly string[]>([], { name: "fruits" });
    const root = rootOf(
      mount(handles, TreeSelect, {
        id: "tree",
        nodes,
        multiple: true,
        defaultExpanded: ["fruits"],
        field: fake.field,
      }),
    );
    open(root);
    click(row(root, "Яблоко"));
    click(row(root, "Банан"));
    expect(fake.field.value).toEqual(["apple", "plantain"]);
    const hidden = Array.from(
      root.querySelectorAll<HTMLInputElement>('input[type="hidden"]'),
    );
    expect(hidden.map((item) => item.value)).toEqual(["apple", "plantain"]);
    expect(hidden.every((item) => item.name === "fruits")).toBe(true);
  });

  it("readOnly блокирует изменение, но оставляет значение", () => {
    const changes: TreeSelectValue[] = [];
    const root = rootOf(
      mount(handles, TreeSelect, {
        id: "tree",
        nodes,
        defaultValue: "apple",
        readOnly: true,
        onValueChange: (value: TreeSelectValue) => changes.push(value),
      }),
    );
    expect(control(root).getAttribute("aria-readonly")).toBe("true");
    open(root);
    click(row(root, "Фрукты"));
    click(row(root, "Банан"));
    click(row(root, "Плантан"));
    expect(changes).toEqual([]);
    expect(root.querySelector('input[type="hidden"]')?.getAttribute("value")).toBe(
      "apple",
    );
  });
});
