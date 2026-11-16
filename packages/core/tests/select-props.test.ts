// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { createRoot, createSignal, flushSync } from "@ivlev-dev/silent-reactivity";
import { applyAttr, attr } from "../src/dom";

interface Tracked<T extends Element> {
  readonly element: T;
  writes(): number;
}

function prototypeDescriptor(element: Element, key: string): PropertyDescriptor {
  let target: object | null = Object.getPrototypeOf(element);
  while (target !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    if (descriptor !== undefined) {
      return descriptor;
    }
    target = Object.getPrototypeOf(target);
  }
  throw new Error(`Свойство ${key} не найдено в прототипах`);
}

function trackProperty<T extends Element>(element: T, key: string): Tracked<T> {
  const descriptor = prototypeDescriptor(element, key);
  let writes = 0;
  Object.defineProperty(element, key, {
    configurable: true,
    enumerable: true,
    get(): unknown {
      return descriptor.get?.call(element);
    },
    set(value: unknown): void {
      writes += 1;
      descriptor.set?.call(element, value);
    },
  });
  return { element, writes: () => writes };
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe("applyAttr: нативные свойства без лишних записей", () => {
  it("не записывает value повторно при том же значении", () => {
    const tracked = trackProperty(document.createElement("input"), "value");
    applyAttr(tracked.element, "value", "a", false);
    expect(tracked.writes()).toBe(1);
    expect(tracked.element.value).toBe("a");

    applyAttr(tracked.element, "value", "a", false);
    expect(tracked.writes()).toBe(1);
    expect(tracked.element.value).toBe("a");
  });

  it("нормализует null и undefined в пустую строку один раз", () => {
    const tracked = trackProperty(document.createElement("input"), "value");
    applyAttr(tracked.element, "value", "abc", false);
    expect(tracked.writes()).toBe(1);

    applyAttr(tracked.element, "value", null, false);
    expect(tracked.writes()).toBe(2);
    expect(tracked.element.value).toBe("");

    applyAttr(tracked.element, "value", null, false);
    applyAttr(tracked.element, "value", undefined, false);
    expect(tracked.writes()).toBe(2);
  });

  it("attr с сигналом пишет только при реальном изменении", () => {
    const tracked = trackProperty(document.createElement("input"), "value");
    const [value, setValue] = createSignal("x");

    createRoot(() => {
      attr(tracked.element, "value", value);
    });

    expect(tracked.writes()).toBe(1);
    setValue("x");
    flushSync();
    expect(tracked.writes()).toBe(1);
    setValue("y");
    flushSync();
    expect(tracked.writes()).toBe(2);
    expect(tracked.element.value).toBe("y");
  });

  it("не записывает selected повторно и не меняет узел", () => {
    const select = document.createElement("select");
    select.appendChild(document.createElement("option"));
    const option = trackProperty(document.createElement("option"), "selected");
    select.appendChild(option.element);
    document.body.appendChild(select);

    applyAttr(option.element, "selected", true, false);
    expect(option.writes()).toBe(1);
    expect(option.element.selected).toBe(true);
    expect(option.element.hasAttribute("selected")).toBe(true);
    expect(select.lastElementChild).toBe(option.element);

    applyAttr(option.element, "selected", true, false);
    expect(option.writes()).toBe(1);
    expect(select.lastElementChild).toBe(option.element);
  });

  it("не записывает checked и disabled повторно", () => {
    const checked = trackProperty(document.createElement("input"), "checked");
    applyAttr(checked.element, "checked", true, false);
    applyAttr(checked.element, "checked", true, false);
    expect(checked.writes()).toBe(1);
    applyAttr(checked.element, "checked", false, false);
    expect(checked.writes()).toBe(2);
    expect(checked.element.hasAttribute("checked")).toBe(false);

    const disabled = trackProperty(document.createElement("input"), "disabled");
    applyAttr(disabled.element, "disabled", true, false);
    applyAttr(disabled.element, "disabled", true, false);
    expect(disabled.writes()).toBe(1);
    expect(disabled.element.disabled).toBe(true);
  });
});
