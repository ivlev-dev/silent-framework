// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { createRenderEffect, createSignal, flushSync } from "@ivlev-dev/silent-reactivity";
import {
  attr,
  classNames,
  createComponent,
  mount,
  normalizeClass,
  normalizeStyle,
  setServerMode,
  spread,
  style,
  styleValue,
  updateProps,
} from "../src/index";
import type { AnyComponent } from "../src/types";

const VIEW = Symbol.for("silent.view");

function host(): HTMLElement {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return element;
}

beforeEach(() => {
  setServerMode(false);
  document.body.replaceChildren();
});

describe("class helpers", () => {
  it("нормализует строки, массивы и объекты рекурсивно", () => {
    expect(classNames("a b")).toBe("a b");
    expect(classNames("a", ["b", { c: true, d: false }], { a: true, e: true })).toBe(
      "a b c e",
    );
    expect(normalizeClass(["x", ["y", { z: "yes", skip: "" }]])).toBe("x y z");
    expect(normalizeClass({ one: true, two: 0, three: [true] })).toBe("one three");
    expect(classNames(null, undefined, false, 0)).toBe("0");
  });

  it("обновляет class из массива и объекта", () => {
    const element = document.createElement("div");
    const [value, setValue] = createSignal<unknown>([
      "base",
      { active: true, hidden: false },
      ["nested", { deep: true }],
    ]);
    attr(element, "class", value);
    expect(element.getAttribute("class")).toBe("base active nested deep");

    setValue("next");
    flushSync();
    expect(element.getAttribute("class")).toBe("next");

    setValue({ first: true, second: false });
    flushSync();
    expect(element.getAttribute("class")).toBe("first");

    setValue(null);
    flushSync();
    expect(element.hasAttribute("class")).toBe(false);
  });

  it("изолирует несколько class-биндингов", () => {
    const element = document.createElement("div");
    const [first, setFirst] = createSignal<unknown>("a");
    const [second, setSecond] = createSignal<unknown>({ b: true });
    attr(element, "class", first);
    attr(element, "class", second);
    expect(element.getAttribute("class")).toBe("a b");

    setFirst("c");
    flushSync();
    expect(element.getAttribute("class")).toBe("c b");

    setSecond(null);
    flushSync();
    expect(element.getAttribute("class")).toBe("c");
  });

  it("объединяет class со spread и убирает только свой вклад", () => {
    const element = document.createElement("div");
    const [props, setProps] = createSignal<Record<string, unknown>>({
      class: "spread-a",
      id: "x",
    });
    attr(element, "class", () => "own");
    spread(element, props);
    expect(element.getAttribute("class")).toBe("own spread-a");

    setProps({ id: "x", class: ["spread-b", { active: true }] });
    flushSync();
    expect(element.getAttribute("class")).toBe("own spread-b active");

    setProps({ id: "x" });
    flushSync();
    expect(element.getAttribute("class")).toBe("own");
  });
});

describe("style helpers", () => {
  it("добавляет px, поддерживает unitless и custom properties", () => {
    const result = normalizeStyle({
      width: 10,
      marginTop: 0,
      opacity: 0.5,
      lineHeight: 1.5,
      zIndex: 2,
      "--gap": 8,
      WebkitLineClamp: 3,
    });
    expect(result).toBe(
      "width: 10px; margin-top: 0; opacity: 0.5; line-height: 1.5; z-index: 2; --gap: 8; -webkit-line-clamp: 3;",
    );
    expect(styleValue({ width: 2 })).toBe("width: 2px;");
  });

  it("сливает строки и объекты, удаляя null/undefined", () => {
    expect(
      normalizeStyle(
        { color: "red", margin: 4 },
        "padding: 2px; --tone: teal;",
        [{ color: null, margin: undefined }],
      ),
    ).toBe("padding: 2px; --tone: teal;");
    expect(normalizeStyle({ display: "block" }, "display: flex;")).toBe(
      "display: flex;",
    );
    expect(style({ width: 2 }, { margin: 1 })).toBe("width: 2px; margin: 1px;");
  });

  it("применяет объект style с числовыми значениями", () => {
    const element = document.createElement("div");
    const [value, setValue] = createSignal<unknown>({
      width: 12,
      opacity: 0.25,
      "--gap": "4px",
    });
    style(element, value);
    expect(element.style.width).toBe("12px");
    expect(element.style.opacity).toBe("0.25");
    expect(element.style.getPropertyValue("--gap")).toBe("4px");

    setValue({ height: 8 });
    flushSync();
    expect(element.style.width).toBe("");
    expect(element.style.opacity).toBe("");
    expect(element.style.getPropertyValue("--gap")).toBe("");
    expect(element.style.height).toBe("8px");
  });

  it("изолирует несколько style-биндингов", () => {
    const element = document.createElement("div");
    const [first, setFirst] = createSignal<unknown>({ color: "red", margin: 4 });
    const [second, setSecond] = createSignal<unknown>({ padding: 2 });
    style(element, first);
    style(element, second);
    expect(element.style.color).toBe("red");
    expect(element.style.margin).toBe("4px");
    expect(element.style.padding).toBe("2px");

    setFirst({ color: "blue" });
    flushSync();
    expect(element.style.color).toBe("blue");
    expect(element.style.margin).toBe("");
    expect(element.style.padding).toBe("2px");

    setSecond(null);
    flushSync();
    expect(element.style.color).toBe("blue");
    expect(element.style.padding).toBe("");
  });

  it("объединяет style со spread", () => {
    const element = document.createElement("div");
    const [props, setProps] = createSignal<Record<string, unknown>>({
      style: { width: 10 },
    });
    style(element, () => ({ color: "red" }));
    spread(element, props);
    expect(element.style.color).toBe("red");
    expect(element.style.width).toBe("10px");

    setProps({});
    flushSync();
    expect(element.style.color).toBe("red");
    expect(element.style.width).toBe("");
  });
});

describe("SSR-нормализация class и style", () => {
  it("передаёт серверному бэкенду нормализованные значения", () => {
    const writes = new Map<string, unknown>();
    const fake = {
      setAttribute(name: string, value: unknown): void {
        writes.set(name, value);
      },
      removeAttribute(name: string): void {
        writes.delete(name);
      },
    };
    setServerMode(true);
    attr(fake as unknown as Element, "class", () => [
      "a",
      { b: true, c: false },
      ["c", { d: true }],
    ]);
    attr(fake as unknown as Element, "style", () => ({ width: 10, opacity: 0.5 }));
    expect(writes.get("class")).toBe("a b c d");
    expect(writes.get("style")).toEqual({ width: "10px", opacity: "0.5" });

    spread(fake as unknown as Element, () => ({
      class: ["x", { y: true }],
      style: "color: red;",
    }));
    expect(writes.get("class")).toBe("x y");
    expect(writes.get("style")).toBe("color: red;");
  });
});

describe("updateProps", () => {
  it("обновляет view-компонент без пересоздания VM и сохраняет focus", async () => {
    class PanelVM {
      static last: PanelVM | null = null;
      props: Record<string, unknown> | null = null;
      readonly events: string[] = [];

      constructor() {
        PanelVM.last = this;
      }

      updated(): void {
        this.events.push("updated");
      }
    }

    function Panel(this: { vm: PanelVM }, props: { label: string }): Node {
      const input = document.createElement("input");
      createRenderEffect(() => {
        input.value = props.label;
      });
      return input;
    }
    (Panel as unknown as Record<PropertyKey, unknown>)[VIEW] = {
      vm: PanelVM,
      name: "Panel",
    };

    const target = host();
    const handle = await mount(target, Panel as unknown as AnyComponent, {
      props: { label: "a" },
    });
    const input = target.querySelector("input");
    expect(input).not.toBeNull();
    input!.focus();

    const vm = PanelVM.last;
    handle.updateProps({ label: "b" });
    flushSync();

    expect(PanelVM.last).toBe(vm);
    expect(target.querySelector("input")).toBe(input);
    expect(input!.value).toBe("b");
    expect(document.activeElement).toBe(input);
    expect(vm?.events).toEqual(["updated"]);
    handle.dispose();
  });

  it("обновляет light-компонент через стабильный Proxy без потери focus", () => {
    function Field(props: { value: string }): Node {
      const input = document.createElement("input");
      attr(input, "value", () => props.value);
      return input;
    }

    const result = createComponent(Field as unknown as AnyComponent, { value: "a" });
    document.body.appendChild(result.node);
    const input = result.node as HTMLInputElement;
    input.focus();

    result.update({ value: "b" });
    flushSync();

    expect(result.node).toBe(input);
    expect(input.value).toBe("b");
    expect(document.activeElement).toBe(input);
  });

  it("пересобирает light-компонент с обычными props по реестру", () => {
    function Plain(props: { text: string }): Node {
      const element = document.createElement("p");
      element.textContent = props.text;
      return element;
    }

    const result = createComponent(Plain as unknown as AnyComponent, { text: "a" });
    document.body.appendChild(result.node);
    const first = result.node as HTMLElement;
    expect(first.textContent).toBe("a");

    expect(updateProps(first, { text: "b" })).toBe(true);
    flushSync();

    const next = document.querySelector("p");
    expect(next).not.toBeNull();
    expect(next).not.toBe(first);
    expect(next?.textContent).toBe("b");
    expect((result.node as HTMLElement).textContent).toBe("b");
    expect(updateProps(document.createElement("div"), { text: "x" })).toBe(false);
    result.dispose();
  });
});
