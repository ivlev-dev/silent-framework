import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync } from "@ivlev-dev/silent-core";
import { Listbox } from "../src/form/listbox/index.js";
import { Select, type SelectItem } from "../src/form/select/index.js";
import {
  mount,
  query,
  rootOf,
  type TestHandles,
} from "./form-test-utils.js";

const handles: TestHandles = { items: [] };
const tallRows = new Set<number>();
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
  for (const handle of handles.items.splice(0)) handle.dispose();
  document.body.replaceChildren();
  tallRows.clear();
  flush();
}

function click(element: Element): void {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  flush();
}

function keydown(target: EventTarget, key: string): void {
  target.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
  );
  flush();
}

beforeEach(() => {
  reset();
  vi.stubGlobal("requestAnimationFrame", undefined);
  vi.stubGlobal("cancelAnimationFrame", undefined);
  stubHeight("clientHeight", function clientHeight(): number {
    return this.getAttribute("role") === "listbox" ? 320 : 0;
  });
  stubHeight("offsetHeight", function offsetHeight(): number {
    const raw = this.getAttribute("data-index");
    if (raw === null) return 0;
    return tallRows.has(Number(raw)) ? 64 : 40;
  });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  for (const entry of descriptors.splice(0).reverse()) {
    if (entry.descriptor === undefined) {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>)[entry.name];
    } else {
      Object.defineProperty(HTMLElement.prototype, entry.name, entry.descriptor);
    }
  }
  reset();
  await new Promise((resolve) => setTimeout(resolve, 0));
  reset();
});

const bigOptions = Array.from({ length: 1000 }, (_, index) => ({
  value: `v${index}`,
  label: index === 900 ? "Zebra" : `Опция ${index}`,
}));

function optionRows(root: Element): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[role="option"]'));
}

function virtualRows(root: Element): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>("[data-index]"));
}

function windowRows(root: Element): HTMLElement[] {
  return virtualRows(root).filter((row) => !row.hasAttribute("data-pinned"));
}

function openListbox(): { root: Element; list: HTMLElement } {
  const root = rootOf(mount(handles, Listbox, { id: "big", options: bigOptions }));
  return { root, list: query<HTMLElement>(root, '[role="listbox"]') };
}

describe("Listbox: виртуализация больших наборов", () => {
  it("1000 опций: в DOM окно, totalSize и глобальные индексы", () => {
    const { root, list } = openListbox();
    const rows = windowRows(root);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(30);

    const spacer = query<HTMLElement>(root, ".sui-popup__virtual-spacer");
    expect(spacer.style.height).toBe("40000px");

    for (const row of rows) {
      const index = Number(row.getAttribute("data-index"));
      const option = query<HTMLElement>(row, '[role="option"]');
      expect(option.id).toBe(`big-option-${index}`);
      expect(option.getAttribute("data-option-index")).toBe(String(index));
      expect(option.getAttribute("aria-posinset")).toBe(String(index + 1));
      expect(option.getAttribute("aria-setsize")).toBe("1000");
    }
    expect(list.getAttribute("aria-activedescendant")).toBe("big-option-0");
    expect(list.querySelector("#big-option-0")).not.toBeNull();
  });

  it("прокрутка показывает окно, а активная строка остаётся в DOM", () => {
    const { root, list } = openListbox();
    list.scrollTop = 20_000;
    list.dispatchEvent(new Event("scroll"));
    flush();

    const rows = windowRows(root);
    expect(rows.length).toBeLessThanOrEqual(30);
    expect(virtualRows(root).length).toBeLessThanOrEqual(31);
    const indices = rows.map((row) => Number(row.getAttribute("data-index")));
    expect(Math.min(...indices)).toBeGreaterThanOrEqual(480);
    expect(Math.max(...indices)).toBeLessThanOrEqual(530);

    const activeId = list.getAttribute("aria-activedescendant");
    expect(activeId).toBe("big-option-0");
    const active = list.querySelector<HTMLElement>(`#${activeId}`);
    expect(active).not.toBeNull();
    expect(active?.closest("[data-pinned]")).not.toBeNull();
    expect(query<HTMLElement>(list, ".sui-popup__virtual-spacer").style.height)
      .toBe("40000px");
  });

  it("End/PageUp/typeahead: активная строка в DOM и aria-activedescendant", () => {
    const { root, list } = openListbox();

    keydown(list, "End");
    expect(list.getAttribute("aria-activedescendant")).toBe("big-option-999");
    expect(list.querySelector("#big-option-999")).not.toBeNull();
    expect(virtualRows(root).length).toBeLessThanOrEqual(31);

    keydown(list, "PageUp");
    expect(list.getAttribute("aria-activedescendant")).toBe("big-option-991");
    expect(list.querySelector("#big-option-991")).not.toBeNull();

    keydown(list, "z");
    expect(list.getAttribute("aria-activedescendant")).toBe("big-option-900");
    expect(list.querySelector("#big-option-900")).not.toBeNull();
    expect(virtualRows(root).length).toBeLessThanOrEqual(31);
  });

  it("высокая строка с description сдвигает следующие позиции", () => {
    tallRows.add(1);
    const options = Array.from({ length: 40 }, (_, index) => ({
      value: `d${index}`,
      label: `Строка ${index}`,
      description: index === 1 ? "Пояснение" : undefined,
    }));
    const root = rootOf(mount(handles, Listbox, { id: "desc", options }));
    flush();
    const spacer = query<HTMLElement>(root, ".sui-popup__virtual-spacer");
    const second = query<HTMLElement>(root, '[data-index="2"]');
    expect(second.style.transform).toBe("translateY(104px)");
    // 40 строк по 40px плюс 24px разницы у высокой.
    expect(spacer.style.height).toBe("1624px");
  });

  it("группы на границе окна не теряются и не дублируются", () => {
    const groups = Array.from({ length: 4 }, (_, group) => ({
      label: `Группа ${group}`,
      options: Array.from({ length: 10 }, (_, offset) => ({
        value: `g${group * 10 + offset}`,
        label: `Опция ${group * 10 + offset}`,
      })),
    }));
    const root = rootOf(
      mount(handles, Listbox, { id: "groups", options: groups }),
    );
    const labels = (): HTMLElement[] =>
      Array.from(root.querySelectorAll<HTMLElement>(".sui-popup__group-label"));

    const initial = labels();
    expect(initial.map((label) => label.textContent)).toEqual([
      "Группа 0",
      "Группа 1",
    ]);
    expect(new Set(initial.map((label) => label.id)).size).toBe(initial.length);

    const list = query<HTMLElement>(root, '[role="listbox"]');
    keydown(list, "End");
    const atEnd = labels();
    expect(atEnd.map((label) => label.textContent)).toEqual(["Группа 3"]);
    expect(atEnd[0]?.id).toBe("groups-group-3");
  });

  it("малый список рендерится полностью, без окна", () => {
    const options = Array.from({ length: 29 }, (_, index) => ({
      value: `s${index}`,
      label: `Строка ${index}`,
    }));
    const root = rootOf(mount(handles, Listbox, { id: "small", options }));
    expect(optionRows(root)).toHaveLength(29);
    expect(root.querySelector(".sui-popup__virtual-spacer")).toBeNull();
  });
});

describe("Select: виртуализация", () => {
  it("1000 опций в панели рендерятся окном", () => {
    const options: readonly SelectItem[] = bigOptions;
    const root = rootOf(mount(handles, Select, { id: "role", options }));
    click(query<HTMLElement>(root, ".sui-select__control"));

    const list = query<HTMLElement>(root, '[role="listbox"]');
    const rows = virtualRows(root);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(31);
    expect(query<HTMLElement>(root, ".sui-popup__virtual-spacer").style.height)
      .toBe("40000px");
    expect(list.querySelector("#role-option-0")).not.toBeNull();
    expect(optionRows(root)[0]?.getAttribute("aria-setsize")).toBe("1000");
  });
});
