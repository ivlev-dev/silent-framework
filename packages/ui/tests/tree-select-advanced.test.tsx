import { afterEach, describe, expect, it, vi } from "vitest";
import { flushSync } from "@ivlev-dev/silent-core";
import {
  TreeSelect,
  type TreeSelectNode,
  type TreeSelectValue,
} from "../src/form/tree-select/index.js";
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
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function flush(): void {
  flushSync();
  flushSync();
}

async function settle(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
  flush();
}

function click(element: Element): void {
  element.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true }),
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
      { value: "banana", label: "Банан" },
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
  return Array.from(root.querySelectorAll<HTMLElement>(".sui-tree-select__row"));
}

function open(root: Element): void {
  if (control(root).getAttribute("aria-expanded") !== "true") {
    click(control(root));
  }
}

describe("TreeSelect: расширенный API", () => {
  it("expandedKeys и checkable принимаются как алиасы", () => {
    const root = rootOf(
      mount(handles, TreeSelect, {
        id: "tree",
        nodes,
        multiple: true,
        expandedKeys: ["fruits"],
        checkable: true,
      }),
    );
    open(root);
    expect(rows(root).map((row) => row.dataset.value)).toEqual([
      "fruits",
      "apple",
      "banana",
      "veg",
    ]);
    expect(root.querySelectorAll(".sui-tree-select__checkbox").length).toBeGreaterThan(0);
  });

  it("checkable=false скрывает чекбоксы при multiple", () => {
    const root = rootOf(
      mount(handles, TreeSelect, {
        id: "tree",
        nodes,
        multiple: true,
        checkable: false,
      }),
    );
    open(root);
    expect(root.querySelector(".sui-tree-select__checkbox")).toBeNull();
  });

  it("«Выбрать все» отмечает доступные листья и очищает выбор", () => {
    const changes: TreeSelectValue[] = [];
    const root = rootOf(
      mount(handles, TreeSelect, {
        id: "tree",
        nodes,
        multiple: true,
        onValueChange: (value: TreeSelectValue) => changes.push(value),
      }),
    );
    open(root);
    click(query<HTMLElement>(root, ".sui-tree-select__tool"));
    expect(changes.at(-1)).toEqual(["apple", "banana", "potato"]);
    expect(rows(root).find((row) => row.dataset.value === "fruits")?.getAttribute("aria-checked")).toBe("true");
    expect(query<HTMLElement>(root, ".sui-tree-select__tool").textContent).toBe(
      "Снять выбор",
    );

    click(query<HTMLElement>(root, ".sui-tree-select__tool"));
    expect(changes.at(-1)).toEqual([]);
    expect(root.querySelectorAll(".sui-tree-select__chip")).toHaveLength(0);
  });

  it("clearable очищает значение из триггера", () => {
    const changes: TreeSelectValue[] = [];
    const root = rootOf(
      mount(handles, TreeSelect, {
        id: "tree",
        nodes,
        multiple: true,
        defaultValue: ["apple"],
        onValueChange: (value: TreeSelectValue) => changes.push(value),
      }),
    );
    click(query<HTMLElement>(root, ".sui-tree-select__clear"));
    expect(changes.at(-1)).toEqual([]);
    expect(root.querySelector(".sui-tree-select__placeholder")).not.toBeNull();
  });
});

describe("TreeSelect: поиск с подсветкой", () => {
  it("совпадение в подписи оборачивается в mark", () => {
    const root = rootOf(
      mount(handles, TreeSelect, { id: "tree", nodes, multiple: true }),
    );
    open(root);
    input(query<HTMLInputElement>(root, ".sui-popup__search"), "банан");
    const mark = query<HTMLElement>(root, ".sui-tree-select__match");
    expect(mark.textContent).toBe("Банан");
    expect(mark.tagName).toBe("MARK");
  });
});

describe("TreeSelect: асинхронные узлы", () => {
  it("load(query) наполняет результаты поиска и получает parent=undefined", async () => {
    const calls: Array<{ query: string; parent: TreeSelectNode | undefined }> = [];
    const load = async (
      text: string,
      parent?: TreeSelectNode,
    ): Promise<readonly TreeSelectNode[]> => {
      calls.push({ query: text, parent });
      if (text === "") return [];
      return [{ value: `remote-${text}`, label: `Результат ${text}` }];
    };
    const root = rootOf(
      mount(handles, TreeSelect, {
        id: "tree",
        nodes: [],
        load,
        searchDelay: 0,
        multiple: true,
      }),
    );
    open(root);
    await settle();
    expect(calls[0]).toEqual({ query: "", parent: undefined });

    input(query<HTMLInputElement>(root, ".sui-popup__search"), "яго");
    await settle();
    expect(calls.at(-1)?.query).toBe("яго");
    expect(rows(root).map((row) => row.textContent?.trim())).toEqual([
      "Результат яго",
    ]);
  });

  it("ленивые дети загружаются при раскрытии узла", async () => {
    const parents: string[] = [];
    const load = async (
      text: string,
      parent?: TreeSelectNode,
    ): Promise<readonly TreeSelectNode[]> => {
      parents.push(`${text}:${parent?.value === undefined ? "-" : String(parent.value)}`);
      return [{ value: "child", label: "Дочерний узел" }];
    };
    const root = rootOf(
      mount(handles, TreeSelect, {
        id: "tree",
        nodes: [{ value: "root", label: "Корень", hasChildren: true }],
        load,
        searchDelay: 0,
      }),
    );
    open(root);
    expect(rows(root)).toHaveLength(1);
    click(query<HTMLElement>(root, ".sui-tree-select__expander"));
    await settle();
    expect(parents).toContain(":root");
    expect(rows(root).map((row) => row.dataset.value)).toEqual([
      "root",
      "child",
    ]);
  });

  it("ошибка загрузки показывается в панели и отдаётся в onLoadError", async () => {
    const errors: unknown[] = [];
    const root = rootOf(
      mount(handles, TreeSelect, {
        id: "tree",
        nodes: [],
        load: async () => {
          throw new Error("Сервер недоступен");
        },
        searchDelay: 0,
        onLoadError: (error: unknown) => errors.push(error),
      }),
    );
    open(root);
    await settle();
    expect(root.querySelector(".sui-popup__error")?.textContent).toBe(
      "Сервер недоступен",
    );
    expect(errors).toHaveLength(1);
  });
});
