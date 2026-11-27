import { afterEach, describe, expect, it } from "vitest";
import { createSignal, flushSync } from "@ivlev-dev/silent-core";
import {
  DateRangePicker,
  type DateRangeValue,
} from "../src/components/date-range-picker/index.js";
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
});

function flush(): void {
  flushSync();
  flushSync();
}

function click(element: Element): void {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  flush();
}

function keydown(element: Element, key: string): void {
  element.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
  );
  flush();
}

function open(root: Element): void {
  click(query(root, "button.sui-date-picker__control"));
  flush();
}

function panel(root: Element): HTMLElement {
  return query<HTMLElement>(root, ".sui-popover__panel");
}

function dateKey(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const dayOfMonth = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${dayOfMonth}`;
}

function day(root: Element, date: Date): HTMLButtonElement {
  return query<HTMLButtonElement>(
    root,
    `button.sui-date-picker__day[data-date="${dateKey(date)}"]`,
  );
}

function cells(root: Element): Element[] {
  return Array.from(root.querySelectorAll(".sui-date-picker__cell"));
}

describe("DateRangePicker: выбор и подсветка", () => {
  it("выбирает две даты, упорядочивает и закрывает поповер", () => {
    const calls: DateRangeValue[] = [];
    const root = rootOf(
      mount(handles, DateRangePicker, {
        label: "Период",
        defaultValue: { start: new Date(2026, 10, 10), end: new Date(2026, 10, 12) },
        onValueChange: (next: DateRangeValue) => {
          calls.push(next);
        },
      }),
    );
    flush();
    open(root);
    expect(panel(root).querySelectorAll(".sui-date-picker__calendar")).toHaveLength(2);

    click(day(root, new Date(2026, 10, 20)));
    expect(calls.at(-1)?.start?.getDate()).toBe(20);
    expect(calls.at(-1)?.end).toBeNull();

    click(day(root, new Date(2026, 10, 25)));
    expect(calls.at(-1)?.start?.getDate()).toBe(20);
    expect(calls.at(-1)?.end?.getDate()).toBe(25);
    expect(panel(root).hidden).toBe(true);
  });

  it("подсвечивает диапазон и превью между датами", () => {
    const root = rootOf(
      mount(handles, DateRangePicker, {
        label: "Период",
        defaultValue: { start: new Date(2026, 10, 10), end: new Date(2026, 10, 15) },
      }),
    );
    flush();
    open(root);

    const inRange = cells(root).filter((cell) => cell.hasAttribute("data-in-range"));
    expect(inRange.length).toBeGreaterThan(0);
    expect(day(root, new Date(2026, 10, 12)).closest(".sui-date-picker__cell")?.hasAttribute("data-in-range")).toBe(true);
    expect(day(root, new Date(2026, 10, 10)).closest(".sui-date-picker__cell")?.hasAttribute("data-range-start")).toBe(true);
    expect(day(root, new Date(2026, 10, 15)).closest(".sui-date-picker__cell")?.hasAttribute("data-range-end")).toBe(true);
  });

  it("подсвечивает превью после первой даты", () => {
    const root = rootOf(
      mount(handles, DateRangePicker, {
        label: "Период",
        defaultValue: { start: null, end: null },
      }),
    );
    flush();
    open(root);
    click(day(root, new Date(2026, 10, 10)));
    const target = day(root, new Date(2026, 10, 13));
    target.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false }));
    flush();
    expect(day(root, new Date(2026, 10, 11)).closest(".sui-date-picker__cell")?.hasAttribute("data-in-range")).toBe(true);
  });

  it("пресеты 7/30 дней и текущий месяц", () => {
    const calls: DateRangeValue[] = [];
    const root = rootOf(
      mount(handles, DateRangePicker, {
        label: "Период",
        onValueChange: (next: DateRangeValue) => {
          calls.push(next);
        },
      }),
    );
    flush();
    open(root);
    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>(".sui-date-range-picker__preset"));
    expect(buttons.map((button) => button.textContent)).toEqual([
      "7 дней",
      "30 дней",
      "Этот месяц",
    ]);
    expect(root.querySelector('[role="group"][aria-label="Быстрый выбор"]')).not.toBeNull();

    click(buttons[0] as HTMLElement);
    const next = calls.at(-1);
    expect(next?.start).not.toBeNull();
    expect(next?.end).not.toBeNull();
    expect(
      Math.round(((next?.end?.getTime() ?? 0) - (next?.start?.getTime() ?? 0)) / 86_400_000) + 1,
    ).toBe(7);
  });

  it("уважает min/max в календаре и пресетах", () => {
    const root = rootOf(
      mount(handles, DateRangePicker, {
        label: "Период",
        min: new Date(2026, 10, 10),
        max: new Date(2026, 10, 20),
      }),
    );
    flush();
    open(root);
    expect(day(root, new Date(2026, 10, 9)).disabled).toBe(true);
    expect(day(root, new Date(2026, 10, 21)).disabled).toBe(true);
    const presets = Array.from(root.querySelectorAll<HTMLButtonElement>(".sui-date-range-picker__preset"));
    expect(presets.every((button) => button.disabled)).toBe(true);
  });

  it("очищает период", () => {
    const root = rootOf(
      mount(handles, DateRangePicker, {
        label: "Период",
        defaultValue: { start: new Date(2026, 10, 10), end: new Date(2026, 10, 15) },
      }),
    );
    flush();
    const clear = query<HTMLButtonElement>(root, ".sui-date-picker__clear");
    click(clear);
    expect(panel(root).hidden).toBe(true);
    const hidden = root.querySelectorAll<HTMLInputElement>('input[type="hidden"]');
    expect(hidden[0]?.value).toBe("");
    expect(hidden[1]?.value).toBe("");
  });

  it("поддерживает управляемое значение", () => {
    const [range, setRange] = createSignal<DateRangeValue>({
      start: new Date(2026, 10, 10),
      end: new Date(2026, 10, 12),
    });
    const root = rootOf(
      mount(handles, DateRangePicker, {
        label: "Период",
        get value() {
          return range();
        },
      }),
    );
    flush();
    open(root);
    click(day(root, new Date(2026, 10, 20)));
    click(day(root, new Date(2026, 10, 22)));
    expect(query(root, "button.sui-date-picker__control").textContent).toContain("10.11.2026");
    setRange({ start: new Date(2026, 10, 20), end: new Date(2026, 10, 22) });
    flush();
    expect(query(root, "button.sui-date-picker__control").textContent).toContain("20.11.2026");
  });
});

describe("DateRangePicker: клавиатура и доступность", () => {
  it("выбирает начало и конец клавиатурой", () => {
    const root = rootOf(
      mount(handles, DateRangePicker, {
        label: "Период",
        defaultValue: { start: null, end: null },
      }),
    );
    flush();
    open(root);

    const start = day(root, new Date(2026, 10, 10));
    start.focus();
    keydown(start, "Enter");
    expect(panel(root).hidden).toBe(false);
    expect(day(root, new Date(2026, 10, 10)).closest(".sui-date-picker__cell")?.hasAttribute("data-range-start")).toBe(true);

    const next = day(root, new Date(2026, 10, 11));
    next.focus();
    keydown(next, "ArrowRight");
    keydown(day(root, new Date(2026, 10, 12)), "Enter");
    expect(panel(root).hidden).toBe(true);
    const hidden = root.querySelectorAll<HTMLInputElement>('input[type="hidden"]');
    expect(hidden[0]?.value).toBe(new Date(2026, 10, 10).toISOString());
    expect(hidden[1]?.value).toBe(new Date(2026, 10, 12).toISOString());
  });

  it("имеет доступные имена и grid-семантику", () => {
    const root = rootOf(
      mount(handles, DateRangePicker, {
        label: "Период",
        hint: "Выберите даты",
      }),
    );
    flush();
    const trigger = query(root, "button.sui-date-picker__control");
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
    expect(trigger.getAttribute("aria-describedby")).toContain("-hint");
    open(root);
    expect(panel(root).getAttribute("role")).toBe("dialog");
    expect(panel(root).getAttribute("aria-label")).toBe("Выбор периода");
    expect(root.querySelectorAll('[role="grid"]').length).toBe(2);
    expect(root.querySelector('[role="gridcell"][aria-selected="false"]')).not.toBeNull();
  });
});
