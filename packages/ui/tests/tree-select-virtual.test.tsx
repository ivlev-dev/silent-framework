import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync, hydrate } from "@ivlev-dev/silent-core";
import { renderToString } from "@ivlev-dev/silent-server";
import {
  TreeSelect,
  type TreeSelectNode,
} from "../src/form/tree-select/index.js";
import {
  mount,
  query,
  rootOf,
  type TestHandles,
} from "./form-test-utils.js";

const handles: TestHandles = { items: [] };
const cleanups: Array<() => void> = [];
const descriptors: Array<{
  readonly name: string;
  readonly descriptor: PropertyDescriptor | undefined;
}> = [];

function stubHeight(
  name: string,
  get: (this: HTMLElement) => number,
): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, name);
  descriptors.push({ name, descriptor });
  Object.defineProperty(HTMLElement.prototype, name, {
    configurable: true,
    get,
  });
}

function flush(): void {
  flushSync();
  flushSync();
}

function reset(): void {
  for (const cleanup of cleanups.splice(0)) cleanup();
  for (const handle of handles.items.splice(0)) handle.dispose();
  document.body.replaceChildren();
  flush();
}

function click(element: Element): void {
  element.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true }),
  );
  flush();
}

function keydown(target: EventTarget, key: string): void {
  target.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
  );
  flush();
}

function input(target: HTMLInputElement, value: string): void {
  target.value = value;
  target.dispatchEvent(new Event("input", { bubbles: true }));
  flush();
}

beforeEach(() => {
  reset();
  vi.stubGlobal("requestAnimationFrame", undefined);
  vi.stubGlobal("cancelAnimationFrame", undefined);
  // jsdom не считает layout: даём панели вьюпорт и строкам высоту, как это
  // сделал бы браузер (32..48px из `--sui-popup-option-block`, здесь 40px).
  stubHeight("clientHeight", function clientHeight(): number {
    return this.getAttribute("role") === "tree" ? 320 : 0;
  });
  stubHeight("offsetHeight", function offsetHeight(): number {
    return this.getAttribute("data-index") === null ? 0 : 40;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const entry of descriptors.splice(0).reverse()) {
    if (entry.descriptor === undefined) {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>)[
        entry.name
      ];
    } else {
      Object.defineProperty(HTMLElement.prototype, entry.name, entry.descriptor);
    }
  }
  reset();
});

// 500 видимых строк: каждый корень — лист. У первого есть ребёнок, чтобы
// проверить раскрытие на границе окна.
const bigNodes: readonly TreeSelectNode[] = Array.from(
  { length: 500 },
  (_, index): TreeSelectNode =>
    index === 0
      ? {
          value: "n0",
          label: "Узел 0",
          children: [{ value: "n0-child", label: "Узел 0 ребёнок" }],
        }
      : {
          value: `n${index}`,
          label: index === 300 ? "Зебра" : `Узел ${index}`,
        },
);

const smallNodes: readonly TreeSelectNode[] = Array.from(
  { length: 29 },
  (_, index) => ({ value: `s${index}`, label: `Строка ${index}` }),
);

function treeRows(root: Element): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(".sui-tree-select__row"),
  );
}

function virtualRows(root: Element): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>('[role="treeitem"][data-index]'),
  );
}

function windowRows(root: Element): HTMLElement[] {
  return virtualRows(root).filter((row) => !row.hasAttribute("data-pinned"));
}

function controlOf(root: Element): HTMLElement {
  return query<HTMLElement>(root, ".sui-tree-select__control");
}

function activeText(root: Element): string | null {
  const id = controlOf(root).getAttribute("aria-activedescendant");
  if (id === null) return null;
  const element = root.ownerDocument.getElementById(id);
  return element?.textContent?.trim() ?? null;
}

function openTree(
  nodes: readonly TreeSelectNode[] = bigNodes,
  props: Record<string, unknown> = {},
): { root: Element; list: HTMLElement } {
  const root = rootOf(
    mount(handles, TreeSelect, { id: "tree", nodes, ...props }),
  );
  click(controlOf(root));
  return { root, list: query<HTMLElement>(root, '[role="tree"]') };
}

describe("TreeSelect: виртуализация больших деревьев", () => {
  it("500 узлов: окно, глобальные индексы, aria-setsize/posinset", () => {
    const { root, list } = openTree();
    const rows = windowRows(root);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(30);

    const spacer = query<HTMLElement>(root, ".sui-popup__virtual-spacer");
    // 500 строк по 40px — оценка из `--sui-popup-option-block`.
    expect(spacer.style.height).toBe("20000px");

    for (const row of rows) {
      const index = Number(row.getAttribute("data-index"));
      expect(row.id).toBe(`tree-option-${index}`);
      expect(row.getAttribute("role")).toBe("treeitem");
      expect(row.getAttribute("data-option-index")).toBe(String(index));
      expect(row.getAttribute("aria-posinset")).toBe(String(index + 1));
      expect(row.getAttribute("aria-setsize")).toBe("500");
      expect(row.style.transform).toBe(`translateY(${index * 40}px)`);
    }

    expect(controlOf(root).getAttribute("aria-activedescendant")).toBe(
      "tree-option-0",
    );
    expect(list.querySelector("#tree-option-0")).not.toBeNull();
    expect(treeRows(root)).toHaveLength(virtualRows(root).length);
  });

  it("End/PageDown/Home: активная строка всегда в DOM", () => {
    const { root, list } = openTree();

    keydown(controlOf(root), "End");
    expect(controlOf(root).getAttribute("aria-activedescendant")).toBe(
      "tree-option-499",
    );
    expect(list.querySelector("#tree-option-499")).not.toBeNull();
    expect(activeText(root)).toBe("Узел 499");
    expect(virtualRows(root).length).toBeLessThanOrEqual(31);

    keydown(controlOf(root), "Home");
    expect(controlOf(root).getAttribute("aria-activedescendant")).toBe(
      "tree-option-0",
    );
    keydown(controlOf(root), "PageDown");
    expect(controlOf(root).getAttribute("aria-activedescendant")).toBe(
      "tree-option-8",
    );
    expect(list.querySelector("#tree-option-8")).not.toBeNull();
  });

  it("активная строка вне окна остаётся в DOM закреплённой", () => {
    const { root, list } = openTree();
    keydown(controlOf(root), "End");
    expect(activeText(root)).toBe("Узел 499");

    // Ручной скролл к началу: активная строка уходит из окна, но id жив.
    list.scrollTop = 0;
    list.dispatchEvent(new Event("scroll"));
    flush();

    const active = list.querySelector<HTMLElement>("#tree-option-499");
    expect(active).not.toBeNull();
    expect(active?.hasAttribute("data-pinned")).toBe(true);
    expect(controlOf(root).getAttribute("aria-activedescendant")).toBe(
      "tree-option-499",
    );
    expect(windowRows(root).length).toBeLessThanOrEqual(30);
  });

  it("typeahead без поиска: прыжок к совпадению и активная строка в DOM", () => {
    const { root, list } = openTree(bigNodes, { searchable: false });
    keydown(controlOf(root), "з");
    expect(controlOf(root).getAttribute("aria-activedescendant")).toBe(
      "tree-option-300",
    );
    expect(list.querySelector("#tree-option-300")).not.toBeNull();
    expect(activeText(root)).toBe("Зебра");
    expect(virtualRows(root).length).toBeLessThanOrEqual(31);
  });

  it("раскрытие и поиск не теряют окно", () => {
    const { root, list } = openTree();

    keydown(controlOf(root), "ArrowRight");
    expect(root.querySelector('[data-value="n0-child"]')).not.toBeNull();
    expect(windowRows(root).length).toBeGreaterThan(0);
    expect(query<HTMLElement>(root, ".sui-popup__virtual-spacer").style.height)
      .toBe("20040px");

    keydown(controlOf(root), "ArrowLeft");
    expect(root.querySelector('[data-value="n0-child"]')).toBeNull();
    expect(windowRows(root).length).toBeGreaterThan(0);
    expect(query<HTMLElement>(root, ".sui-popup__virtual-spacer").style.height)
      .toBe("20000px");

    // keep-ancestors: «Узел 4» совпадает с 4, 40..49, 400..499 — больше порога.
    const search = query<HTMLInputElement>(root, ".sui-popup__search");
    input(search, "Узел 4");
    expect(windowRows(root).length).toBeGreaterThan(0);
    expect(windowRows(root).length).toBeLessThanOrEqual(30);
    expect(virtualRows(root).length).toBeLessThanOrEqual(31);
    const activeId = controlOf(root).getAttribute("aria-activedescendant");
    expect(activeId).not.toBeNull();
    expect(list.querySelector(`#${activeId}`)).not.toBeNull();

    input(search, "");
    expect(query<HTMLElement>(root, ".sui-popup__virtual-spacer").style.height)
      .toBe("20000px");
    expect(windowRows(root).length).toBeGreaterThan(0);
  });

  it("малый список (< 30) рендерится полностью, без окна", () => {
    const { root } = openTree(smallNodes);
    expect(treeRows(root)).toHaveLength(29);
    expect(root.querySelector(".sui-popup__virtual-spacer")).toBeNull();
    expect(root.querySelector('[role="treeitem"][data-index]')).toBeNull();
    expect(controlOf(root).getAttribute("aria-activedescendant")).toBe(
      "tree-option-0",
    );
  });
});

function BigTree(): Node {
  return (
    <TreeSelect
      id="tree"
      name="tree"
      label="Дерево"
      nodes={bigNodes}
    />
  );
}

describe("TreeSelect: SSR и гидрация виртуализированного дерева", () => {
  it("панель отсутствует на сервере, гидрация без mismatch", async () => {
    const { html } = await renderToString(BigTree);
    expect(html).toContain('role="combobox"');
    expect(html).not.toContain('role="tree"');
    expect(html).not.toContain("sui-popup");
    expect(html).not.toContain('role="treeitem"');
    expect(html).not.toContain("sui-popup__virtual-spacer");

    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    const mismatches: string[] = [];
    const handle = await hydrate(container, BigTree, {
      onMismatch: (error) => mismatches.push(error.message),
    });
    cleanups.push(() => handle.dispose());
    flush();
    expect(mismatches).toEqual([]);
    expect(container.querySelector('[role="tree"]')).toBeNull();

    click(query<HTMLElement>(container, ".sui-tree-select__control"));
    const list = query<HTMLElement>(container, '[role="tree"]');
    expect(
      query<HTMLElement>(container, ".sui-popup__virtual-spacer"),
    ).not.toBeNull();
    const activeId = query<HTMLElement>(
      container,
      ".sui-tree-select__control",
    ).getAttribute("aria-activedescendant");
    expect(activeId).toBe("tree-option-0");
    expect(list.querySelector("#tree-option-0")).not.toBeNull();
    expect(windowRows(container).length).toBeLessThanOrEqual(30);
  });
});
