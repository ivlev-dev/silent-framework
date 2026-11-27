import { afterEach, describe, expect, it } from "vitest";
import meta, {
  CalendarRange,
  ColorPickerPlayground,
  ColorSwatches,
  DatePickerPlayground,
  DateRangePickerPlayground,
  States,
} from "../src/date-color.stories.js";
import { disposeStory, mountStory } from "../src/silent-story.js";

function canvas(): Element {
  const element = document.createElement("section");
  document.body.appendChild(element);
  return element;
}

function mount(story: unknown, args: object): Element {
  const element = canvas();
  mountStory(story, { ...args }, element);
  return element;
}

afterEach(() => {
  disposeStory();
  document.body.replaceChildren();
});

describe("Date & Color stories", () => {
  it("meta описывает controls и autodocs", () => {
    const value = meta as Record<string, unknown>;
    expect(value["title"]).toBe("Components/Date & Color");
    expect(value["tags"]).toContain("autodocs");
    expect(Object.keys(value["argTypes"] as object).length).toBeGreaterThan(10);
    expect(value["args"]).toBeTypeOf("object");
  });

  it("DatePicker Playground монтируется", () => {
    const element = mount(DatePickerPlayground.render, {
      ...(meta.args as object),
    });
    expect(element.querySelector(".sui-date-picker")).not.toBeNull();
    expect(element.textContent).toContain("15.11.2026");
  });

  it("DateRangePicker Playground показывает пресеты", () => {
    const element = mount(DateRangePickerPlayground.render, {
      ...(meta.args as object),
    });
    expect(element.querySelector(".sui-date-range-picker")).not.toBeNull();
    expect(element.querySelectorAll(".sui-date-range-picker__preset").length).toBe(3);
  });

  it("ColorPicker Playground монтируется", () => {
    const element = mount(ColorPickerPlayground.render, {
      ...(meta.args as object),
    });
    expect(element.querySelector(".sui-color-picker")).not.toBeNull();
    expect(element.textContent).toContain("#1F4E6B");
  });

  it("States показывает disabled/readOnly/error", () => {
    const element = mount(States.render, {
      ...(meta.args as object),
    });
    expect(element.querySelector('.sui-date-picker [data-disabled]')).not.toBeNull();
    expect(element.querySelector('.sui-date-picker [data-readonly]')).not.toBeNull();
    expect(element.querySelectorAll(".sui-field__error").length).toBeGreaterThan(0);
  });

  it("CalendarRange открывает календарь с круглыми днями диапазона", () => {
    const element = mount(CalendarRange.render, {
      ...(meta.args as object),
    });
    const start = element.querySelector(
      ".sui-date-picker__cell[data-range-start] .sui-date-picker__day[data-selected]",
    );
    const end = element.querySelector(
      ".sui-date-picker__cell[data-range-end] .sui-date-picker__day[data-selected]",
    );
    expect(start?.textContent).toBe("3");
    expect(end?.textContent).toBe("18");
    expect(
      element.querySelectorAll(
        ".sui-date-picker__cell[data-in-range]:not([data-range-start]):not([data-range-end]) .sui-date-picker__day",
      ).length,
    ).toBeGreaterThan(0);
  });

  it("ColorSwatches показывает lowercase HEX и swatch-переменную", () => {
    const element = mount(ColorSwatches.render, {
      ...(meta.args as object),
    });
    const controls = element.querySelectorAll<HTMLElement>(".sui-color-picker__control");
    expect(controls.length).toBe(4);
    expect(controls[0]?.textContent).toContain("#1f4e6b");
    expect(controls[1]?.textContent).toContain("#1f6b45");
    expect(
      controls[0]?.querySelector<HTMLElement>(".sui-color-picker__swatch")
        ?.style.getPropertyValue("--sui-color-picker-swatch"),
    ).toBe("rgba(31, 78, 107, 1)");
    expect(
      controls[3]?.querySelector<HTMLElement>(".sui-color-picker__swatch")
        ?.hasAttribute("data-empty"),
    ).toBe(true);
  });
});
