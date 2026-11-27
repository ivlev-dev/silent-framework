import { afterEach, describe, expect, it, vi } from "vitest";
import { flushSync } from "@ivlev-dev/silent-core";
import {
  Select,
  type SelectItem,
} from "../src/form/select/index.js";
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

const options = [
  { value: "a", label: "Альфа" },
  { value: "b", label: "Бета" },
  { value: "c", label: "Гамма" },
] as const;

function optionRows(root: Element): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[role="option"]'));
}

describe("Select: асинхронные опции", () => {
  it("searchDelay объединяет быстрый ввод в один запрос", async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const loadOptions = async (text: string): Promise<readonly SelectItem[]> => {
      calls.push(text);
      return [{ value: text, label: `Ответ ${text}` }];
    };
    const root = rootOf(
      mount(handles, Select, {
        id: "async",
        options: [],
        searchable: true,
        loadOptions,
        searchDelay: 50,
      }),
    );
    const search = query<HTMLInputElement>(root, ".sui-select__search");
    keydown(search, "ArrowDown");
    expect(calls).toHaveLength(0);
    vi.advanceTimersByTime(60);
    await settle();
    expect(calls).toEqual([""]);

    input(search, "б");
    input(search, "бе");
    expect(calls).toEqual([""]);
    vi.advanceTimersByTime(50);
    await settle();
    expect(calls).toEqual(["", "бе"]);
    expect(optionRows(root).map((row) => row.textContent)).toEqual(["Ответ бе"]);
  });

  it("ответ async не фильтруется повторно по подписи", async () => {
    const loadOptions = async (): Promise<readonly SelectItem[]> => [
      { value: "sky", label: "Небо" },
    ];
    const root = rootOf(
      mount(handles, Select, {
        id: "async",
        options: [],
        searchable: true,
        loadOptions,
        searchDelay: 0,
      }),
    );
    const search = query<HTMLInputElement>(root, ".sui-select__search");
    keydown(search, "ArrowDown");
    await settle();
    input(search, "бе");
    await settle();
    expect(optionRows(root).map((row) => row.textContent)).toEqual(["Небо"]);
  });

  it("ошибка загрузки видна в панели и очищается следующим запросом", async () => {
    let shouldFail = true;
    const errors: unknown[] = [];
    const loadOptions = async (): Promise<readonly SelectItem[]> => {
      if (shouldFail) throw new Error("Нет сети");
      return [{ value: "a", label: "Альфа" }];
    };
    const root = rootOf(
      mount(handles, Select, {
        id: "async",
        options: [],
        searchable: true,
        loadOptions,
        searchDelay: 0,
        onLoadError: (error: unknown) => errors.push(error),
      }),
    );
    const search = query<HTMLInputElement>(root, ".sui-select__search");
    keydown(search, "ArrowDown");
    await settle();
    expect(root.querySelector(".sui-popup__error")?.textContent).toBe("Нет сети");
    expect(errors).toHaveLength(1);

    shouldFail = false;
    input(search, "а");
    await settle();
    expect(root.querySelector(".sui-popup__error")).toBeNull();
    expect(optionRows(root).map((row) => row.textContent)).toEqual(["Альфа"]);
  });
});

describe("Select: группы, multi и виртуализация", () => {
  it("multi показывает чипы, снимает и очищает значение", () => {
    const changes: unknown[] = [];
    const root = rootOf(
      mount(handles, Select, {
        id: "multi",
        options,
        multiple: true,
        defaultValue: ["a", "b"],
        clearable: true,
        onValueChange: (value: unknown) => changes.push(value),
      }),
    );
    expect(root.querySelectorAll(".sui-select__chip")).toHaveLength(2);
    click(query<HTMLElement>(root, ".sui-select__chip-remove"));
    expect(changes.at(-1)).toEqual(["b"]);
    expect(root.querySelectorAll(".sui-select__chip")).toHaveLength(1);
    click(query<HTMLElement>(root, ".sui-select__clear"));
    expect(changes.at(-1)).toEqual([]);
    expect(root.querySelector(".sui-select__placeholder")).not.toBeNull();
  });

  it("1000 опций рендерятся окном с общей высотой", () => {
    const many = Array.from({ length: 1000 }, (_, index) => ({
      value: `v${index}`,
      label: `Опция ${index}`,
    }));
    const root = rootOf(
      mount(handles, Select, { id: "big", options: many }),
    );
    click(query<HTMLElement>(root, ".sui-select__control"));
    const spacer = query<HTMLElement>(root, ".sui-popup__virtual-spacer");
    expect(spacer.style.height).toBe("40000px");
    expect(optionRows(root).length).toBeLessThan(200);
  });
});
