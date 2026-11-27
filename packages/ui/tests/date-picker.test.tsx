import { afterEach, describe, expect, it } from "vitest";
import { createSignal, flushSync } from "@ivlev-dev/silent-core";
import { DatePicker } from "../src/components/date-picker/index.js";
import {
  buildMonthDays,
  formatDateValue,
  parseDateValue,
  startOfWeek,
} from "../src/components/date-picker/date.js";
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

function keydown(
  element: Element,
  key: string,
  init: KeyboardEventInit = {},
): void {
  element.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ...init,
    }),
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

function day(root: Element, date: Date): HTMLButtonElement {
  return query<HTMLButtonElement>(
    root,
    `button.sui-date-picker__day[data-date="${dateKey(date)}"]`,
  );
}

function dateKey(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const dayOfMonth = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${dayOfMonth}`;
}

describe("DatePicker: формат и разбор", () => {
  it("форматирует по шаблону и локали", () => {
    const value = new Date(2026, 10, 5);
    expect(formatDateValue(value, "dd.MM.yyyy")).toBe("05.11.2026");
    expect(formatDateValue(value, "d MMMM yyyy", "ru-RU")).toBe("5 Ноябрь 2026");
    expect(formatDateValue(value, undefined, "ru-RU")).toBe("05.11.2026");
  });

  it("разбирает ISO, локальные даты и шаблон", () => {
    expect(parseDateValue("2026-11-05")?.getDate()).toBe(5);
    expect(parseDateValue("05.11.2026")?.getMonth()).toBe(10);
    expect(parseDateValue("05/11/2026", { locale: "ru-RU" })?.getDate()).toBe(5);
    expect(parseDateValue("11/05/2026", { locale: "en-US" })?.getDate()).toBe(5);
    expect(parseDateValue("5.11.2026", { format: "d.M.yyyy" })?.getMonth()).toBe(10);
    expect(parseDateValue("31.02.2026")).toBeNull();
    expect(parseDateValue("вчера")).toBeNull();
    expect(parseDateValue("05.11.2026", { parse: () => new Date(2020, 0, 2) })?.getFullYear()).toBe(2020);
  });

  it("принимает строковое значение и кастомный parse", () => {
    const root = rootOf(
      mount(handles, DatePicker, {
        label: "Дата",
        value: "15.11.2026",
        format: "dd.MM.yyyy",
      }),
    );
    flush();
    expect(query(root, "button.sui-date-picker__control").textContent).toContain("15.11.2026");

    const custom = rootOf(
      mount(handles, DatePicker, {
        label: "Дата",
        value: "завтра",
        parse: () => new Date(2026, 10, 16),
      }),
    );
    flush();
    expect(query(custom, "button.sui-date-picker__control").textContent).toContain("16.11.2026");
  });

  it("строит 42 дня сетки с понедельника", () => {
    const days = buildMonthDays(new Date(2026, 10, 1), 1);
    expect(days).toHaveLength(42);
    expect(days[0]?.getDay()).toBe(1);
  });
});

describe("DatePicker: выбор значения", () => {
  it("открывает календарь, выбирает дату и пишет ISO в скрытый input", () => {
    const root = rootOf(
      mount(handles, DatePicker, {
        id: "date",
        label: "Дата",
        defaultValue: new Date(2026, 10, 15),
      }),
    );
    flush();
    const trigger = query<HTMLButtonElement>(root, "button.sui-date-picker__control");
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.textContent).toContain("15.11.2026");

    open(root);
    expect(panel(root).hidden).toBe(false);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(query(root, '[role="grid"]')).not.toBeNull();

    const selected = day(root, new Date(2026, 10, 20));
    expect(selected.getAttribute("aria-label")).toContain("20");
    click(selected);

    expect(panel(root).hidden).toBe(true);
    const hidden = query<HTMLInputElement>(root, 'input[type="hidden"]');
    expect(hidden.value).toBe(new Date(2026, 10, 20).toISOString());
    expect(trigger.textContent).toContain("20.11.2026");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("очищает значение кнопкой", () => {
    const root = rootOf(
      mount(handles, DatePicker, {
        label: "Дата",
        defaultValue: new Date(2026, 10, 15),
      }),
    );
    flush();
    const clear = query<HTMLButtonElement>(root, ".sui-date-picker__clear");
    expect(clear.getAttribute("aria-label")).toBe("Очистить дату");
    click(clear);
    const hidden = query<HTMLInputElement>(root, 'input[type="hidden"]');
    expect(hidden.value).toBe("");
    expect(root.querySelector(".sui-date-picker__clear")).toBeNull();
  });

  it("уважает min/max и блокирует «Сегодня» вне границ", () => {
    const root = rootOf(
      mount(handles, DatePicker, {
        label: "Дата",
        defaultValue: new Date(2026, 10, 15),
        min: new Date(2026, 10, 10),
        max: new Date(2026, 10, 20),
      }),
    );
    flush();
    open(root);
    expect(day(root, new Date(2026, 10, 9)).disabled).toBe(true);
    expect(day(root, new Date(2026, 10, 10)).disabled).toBe(false);
    expect(day(root, new Date(2026, 10, 20)).disabled).toBe(false);
    expect(day(root, new Date(2026, 10, 21)).disabled).toBe(true);
  });

  it("переключает месяцы и годы", () => {
    const root = rootOf(
      mount(handles, DatePicker, {
        label: "Дата",
        defaultValue: new Date(2026, 10, 15),
      }),
    );
    flush();
    open(root);
    click(query(root, 'button[aria-label="Выбор месяца"]'));
    expect(query(root, ".sui-date-picker__picker-grid").getAttribute("role")).toBe("grid");
    const picker = Array.from(root.querySelectorAll<HTMLButtonElement>(".sui-date-picker__picker-cell"));
    expect(picker.length).toBe(12);
    click(picker[2] as HTMLElement);
    expect(query(root, ".sui-date-picker__calendar").getAttribute("data-mode")).toBe("days");
    expect(panel(root).textContent).toContain("Март");

    click(query(root, 'button[aria-label="Выбор года"]'));
    const years = Array.from(root.querySelectorAll<HTMLButtonElement>(".sui-date-picker__picker-cell"));
    expect(years.length).toBe(12);
    click(years[0] as HTMLElement);
    expect(query(root, ".sui-date-picker__calendar").getAttribute("data-mode")).toBe("months");
  });

  it("не меняет DOM управляемого значения без обновления props", () => {
    const [value, setValue] = createSignal<Date | null>(new Date(2026, 10, 15));
    const calls: (Date | null)[] = [];
    const root = rootOf(
      mount(handles, DatePicker, {
        label: "Дата",
        get value() {
          return value();
        },
        onValueChange: (next: Date | null) => {
          calls.push(next);
        },
      }),
    );
    flush();
    open(root);
    click(day(root, new Date(2026, 10, 18)));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.getDate()).toBe(18);
    expect(query(root, "button.sui-date-picker__control").textContent).toContain("15.11.2026");

    setValue(new Date(2026, 10, 18));
    flush();
    expect(query(root, "button.sui-date-picker__control").textContent).toContain("18.11.2026");
  });
});

describe("DatePicker: клавиатура и доступность", () => {
  it("двигает активный день стрелками и выбирает Enter", async () => {
    const root = rootOf(
      mount(handles, DatePicker, {
        label: "Дата",
        defaultValue: new Date(2026, 10, 15),
      }),
    );
    flush();
    open(root);
    await Promise.resolve();
    flush();

    const active = day(root, new Date(2026, 10, 15));
    active.focus();
    keydown(active, "ArrowRight");
    await Promise.resolve();
    flush();
    expect(document.activeElement).toBe(day(root, new Date(2026, 10, 16)));
    keydown(day(root, new Date(2026, 10, 16)), "Enter");
    expect(panel(root).hidden).toBe(true);
    expect(query<HTMLInputElement>(root, 'input[type="hidden"]').value).toBe(
      new Date(2026, 10, 16).toISOString(),
    );
  });

  it("PageDown меняет месяц, Home/End — границы недели", async () => {
    const root = rootOf(
      mount(handles, DatePicker, {
        label: "Дата",
        defaultValue: new Date(2026, 10, 15),
      }),
    );
    flush();
    open(root);
    await Promise.resolve();
    flush();

    const active = day(root, new Date(2026, 10, 15));
    active.focus();
    keydown(active, "PageDown");
    await Promise.resolve();
    flush();
    expect(panel(root).textContent).toContain("Декабрь");
    const next = day(root, new Date(2026, 11, 15));
    next.focus();
    keydown(next, "Home");
    await Promise.resolve();
    flush();
    const expected = startOfWeek(new Date(2026, 11, 15), 1);
    expect(document.activeElement).toBe(day(root, expected));
    keydown(day(root, expected), "End");
    await Promise.resolve();
    flush();
    const end = new Date(expected);
    end.setDate(end.getDate() + 6);
    expect(document.activeElement).toBe(day(root, end));
  });

  it("Escape закрывает поповер и возвращает фокус на триггер", async () => {
    const root = rootOf(
      mount(handles, DatePicker, {
        label: "Дата",
        defaultValue: new Date(2026, 10, 15),
        hint: "Подсказка",
        error: "Ошибка",
        required: true,
      }),
    );
    flush();
    const trigger = query<HTMLButtonElement>(root, "button.sui-date-picker__control");
    open(root);
    await Promise.resolve();
    flush();
    day(root, new Date(2026, 10, 15)).focus();

    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
    flush();
    await Promise.resolve();
    flush();

    expect(panel(root).hidden).toBe(true);
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute("aria-required")).toBe("true");
    expect(trigger.getAttribute("aria-invalid")).toBe("true");
    expect(trigger.getAttribute("aria-describedby")).toContain("-hint");
    expect(trigger.getAttribute("aria-describedby")).toContain("-error");
    expect(root.querySelector("label.sui-field__label")?.textContent).toContain("Дата");
  });

  it("не открывается в readOnly и disabled", () => {
    const readOnly = rootOf(
      mount(handles, DatePicker, { label: "Дата", readOnly: true }),
    );
    flush();
    click(query(readOnly, "button.sui-date-picker__control"));
    expect(panel(readOnly).hidden).toBe(true);

    const disabled = rootOf(
      mount(handles, DatePicker, { label: "Дата", disabled: true }),
    );
    flush();
    expect(query<HTMLButtonElement>(disabled, "button.sui-date-picker__control").disabled).toBe(true);
    click(query(disabled, "button.sui-date-picker__control"));
    expect(panel(disabled).hidden).toBe(true);
  });
});
