import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createComponent,
  flushSync,
  hydrate,
  setServerMode,
} from "@ivlev-dev/silent-core";
import { renderToString } from "@ivlev-dev/silent-server";
import { List, ListItem } from "../src/components/list/index.js";

interface Handle {
  dispose(): void;
}

interface Row {
  readonly id: string;
  readonly label: string;
  readonly disabled?: boolean;
}

const handles: Handle[] = [];

const ROW_HEIGHT = 41;

function rows(count: number): Row[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `row-${index}`,
    label: `Строка ${index}`,
  }));
}

function flush(): void {
  flushSync();
  flushSync();
}

function defineViewport(element: Element, height: number): void {
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    value: height,
  });
  Object.defineProperty(element, "clientWidth", {
    configurable: true,
    value: 320,
  });
}

function mount(props: Record<string, unknown>, viewport = 480): HTMLElement {
  const result = createComponent(List as never, props);
  const root = result.node as HTMLElement;
  defineViewport(root, viewport);
  document.body.appendChild(root);
  handles.push(result);
  flush();
  return root;
}

function indices(root: Element): number[] {
  return Array.from(root.querySelectorAll("li[data-index]")).map((node) =>
    Number(node.getAttribute("data-index")),
  );
}

function spacers(root: Element): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>('li[aria-hidden="true"].sui-list__spacer'),
  );
}

function rowAt(root: Element, index: number): HTMLElement | null {
  return root.querySelector<HTMLElement>(`li[data-index="${index}"]`);
}

function baseProps(items: readonly Row[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    items,
    keyOf: (item: Row) => item.id,
    renderItem: (item: Row) => <span>{item.label}</span>,
    selectable: true,
    ...extra,
  };
}

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", undefined);
  vi.stubGlobal("cancelAnimationFrame", undefined);
  setServerMode(false);
});

afterEach(() => {
  for (const handle of handles.splice(0)) handle.dispose();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  setServerMode(false);
});

describe("List items: SSR и гидрация", () => {
  // SSR/гидрация идут раньше клиентских mount-тестов: в одном процессе
  // повторное использование скомпилированных шаблонов после клиентского
  // рендера искажает проверку гидрации (не продуктовый сценарий).
  const SSR_ROWS = rows(1000);

  function VirtualDemo(): Node {
    return (
      <List
        items={SSR_ROWS}
        keyOf={(item: Row) => item.id}
        renderItem={(item: Row) => item.label}
        selectable
        selected={(item: Row) => item.id === "row-0"}
        virtual
      />
    );
  }

  it("renderToString даёт детерминированное окно", async () => {
    const { html } = await renderToString(VirtualDemo);

    expect(html).toContain('role="listbox"');
    expect(html).toContain('aria-setsize="1000"');
    expect(html).toContain('aria-posinset="1"');
    expect(html).toContain('aria-posinset="20"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain("sui-list__spacer");
    expect(html).toContain("Строка 0");
    expect(html).toContain("Строка 19");
    expect(html).not.toContain("Строка 20");
    expect(html).not.toContain("Строка 500");
  });

  it("hydrate проходит без mismatch и сохраняет окно", async () => {
    const { html } = await renderToString(VirtualDemo);
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    const scrollHost = container.querySelector(".sui-list");
    if (scrollHost === null) throw new Error("не найден .sui-list");
    defineViewport(scrollHost, 480);

    const mismatches: string[] = [];
    const handle = await hydrate(container, VirtualDemo, {
      onMismatch: (error) => {
        mismatches.push(error.message);
      },
    });
    handles.push(handle);
    flush();

    expect(mismatches).toEqual([]);
    const root = container.querySelector(".sui-list")!;
    expect(indices(root)).toHaveLength(20);
    expect(root.querySelector('li[data-index="0"]')!.getAttribute("aria-selected")).toBe("true");
    expect(spacers(root)).toHaveLength(2);
  });
});

describe("List items: виртуализация", () => {
  it("1000 элементов: окно, spacer-строки и ARIA-позиции", () => {
    const root = mount(baseProps(rows(1000)));

    expect(root.getAttribute("role")).toBe("listbox");
    expect(root.hasAttribute("data-virtual")).toBe(true);
    expect(root.style.maxHeight).toBe("480px");
    expect(root.style.overflowY).toBe("auto");

    const window = indices(root);
    expect(window).toHaveLength(20);
    expect(window[0]).toBe(0);
    expect(window[window.length - 1]).toBe(19);

    const [top, bottom] = spacers(root);
    expect(top).toBeDefined();
    expect(bottom).toBeDefined();
    expect(parseFloat(top!.style.height)).toBe(0);
    expect(parseFloat(bottom!.style.height)).toBe(
      1000 * ROW_HEIGHT - 20 * ROW_HEIGHT,
    );

    const first = rowAt(root, 0)!;
    expect(first.getAttribute("aria-setsize")).toBe("1000");
    expect(first.getAttribute("aria-posinset")).toBe("1");
    expect(first.getAttribute("aria-selected")).toBe("false");
    expect(rowAt(root, 19)!.getAttribute("aria-posinset")).toBe("20");
    expect(parseInt(first.getAttribute("tabindex") ?? "-1", 10)).toBe(0);
  });

  it("прокрутка сдвигает окно и пересчитывает распорки", () => {
    const root = mount(baseProps(rows(1000)));

    defineViewport(root, 480);
    root.scrollTop = 20_000;
    root.dispatchEvent(new Event("scroll"));
    flush();

    const window = indices(root);
    expect(window.length).toBeGreaterThan(0);
    expect(window[0]).toBeGreaterThan(0);
    expect(window).toContain(500);
    expect(window).not.toContain(0);

    const [top, bottom] = spacers(root);
    expect(parseFloat(top!.style.height)).toBe(window[0]! * ROW_HEIGHT);
    expect(parseFloat(bottom!.style.height)).toBe(
      1000 * ROW_HEIGHT - (window[window.length - 1]! + 1) * ROW_HEIGHT,
    );
  });

  it("virtual={false} рендерит весь набор без распорок", () => {
    const root = mount(baseProps(rows(1000), { virtual: false }));

    expect(indices(root)).toHaveLength(1000);
    expect(spacers(root)).toHaveLength(0);
    expect(root.hasAttribute("data-virtual")).toBe(false);
    expect(root.style.maxHeight).toBe("");
    expect(rowAt(root, 999)!.getAttribute("aria-posinset")).toBe("1000");
  });

  it("малый список и числовой порог: полный рендер или окно", () => {
    const small = mount(baseProps(rows(5)));
    expect(indices(small)).toHaveLength(5);
    expect(spacers(small)).toHaveLength(0);
    expect(small.hasAttribute("data-virtual")).toBe(false);

    const custom = mount(baseProps(rows(30), { virtual: 20 }));
    expect(custom.hasAttribute("data-virtual")).toBe(true);
    expect(indices(custom)).toHaveLength(20);
    expect(spacers(custom)).toHaveLength(2);

    const above = mount(baseProps(rows(30), { virtual: 100 }));
    expect(above.hasAttribute("data-virtual")).toBe(false);
    expect(indices(above)).toHaveLength(30);
  });

  it("dense и itemHeight меняют оценку строки", () => {
    const dense = mount(baseProps(rows(1000), { dense: true }));
    const [top] = spacers(dense);
    expect(parseFloat(top!.style.height)).toBe(0);
    // 480 / 33 = 14 видимых (0..14) + 8 overscan = 23 строки.
    expect(indices(dense)).toHaveLength(23);

    const custom = mount(baseProps(rows(1000), { itemHeight: 100 }));
    expect(indices(custom)).toHaveLength(13);
  });

  it("выбранный элемент сохраняется при прокрутке, onSelect получает item", () => {
    const picked: Array<[string, number]> = [];
    const root = mount(
      baseProps(rows(1000), {
        selected: (item: Row) => item.id === "row-500",
        onSelect: (item: Row, index: number) => {
          picked.push([item.id, index]);
        },
      }),
    );

    expect(rowAt(root, 500)).toBeNull();

    defineViewport(root, 480);
    root.scrollTop = 20_000;
    root.dispatchEvent(new Event("scroll"));
    flush();

    const selected = rowAt(root, 500);
    expect(selected).not.toBeNull();
    expect(selected!.getAttribute("aria-selected")).toBe("true");
    expect(selected!.hasAttribute("data-selected")).toBe(true);

    selected!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    selected!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    expect(picked).toEqual([
      ["row-500", 500],
      ["row-500", 500],
    ]);

    root.scrollTop = 0;
    root.dispatchEvent(new Event("scroll"));
    flush();
    expect(rowAt(root, 500)).toBeNull();

    root.scrollTop = 20_000;
    root.dispatchEvent(new Event("scroll"));
    flush();
    expect(rowAt(root, 500)!.getAttribute("aria-selected")).toBe("true");
  });

  it("disabled-элемент получает aria-disabled и не выбирается", () => {
    const picked: number[] = [];
    const items: Row[] = [
      { id: "row-0", label: "Строка 0" },
      { id: "row-1", label: "Строка 1", disabled: true },
    ];
    const root = mount(
      baseProps(items, {
        onSelect: (_item: Row, index: number) => {
          picked.push(index);
        },
      }),
    );

    const disabled = rowAt(root, 1)!;
    expect(disabled.getAttribute("aria-disabled")).toBe("true");
    expect(disabled.hasAttribute("tabindex")).toBe(false);

    disabled.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    expect(picked).toEqual([]);

    rowAt(root, 0)!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    expect(picked).toEqual([0]);
  });
});

describe("List children: обратная совместимость", () => {
  it("children-режим не виртуализируется и не меняет разметку", () => {
    const root = mount(
      {
        selectable: true,
        divider: true,
        dense: true,
        virtual: true,
        children: (
          <>
            <ListItem selected>Один</ListItem>
            <ListItem>Два</ListItem>
          </>
        ),
      },
    );

    expect(root.tagName).toBe("UL");
    expect(root.getAttribute("role")).toBe("listbox");
    expect(root.hasAttribute("data-divider")).toBe(true);
    expect(root.hasAttribute("data-dense")).toBe(true);
    expect(root.hasAttribute("data-virtual")).toBe(false);
    expect(root.style.maxHeight).toBe("");
    expect(root.querySelectorAll("li")).toHaveLength(2);
    expect(root.querySelectorAll("li[data-index]")).toHaveLength(0);
    expect(root.querySelectorAll('li[aria-hidden="true"]')).toHaveLength(0);
    expect(root.querySelector("li")!.getAttribute("aria-selected")).toBe("true");
  });
});
