// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { createRoot, createSignal, flushSync, onCleanup } from "@ivlev98/silent-reactivity";
import {
  NODE_DISPOSER,
  attachDisposer,
  attr,
  disposeNode,
  dynamic,
  effect,
  fragment,
  insert,
  on,
  prop,
  ref,
  spread,
  style,
  template,
  text,
} from "../src/dom";
import { Fragment, jsx } from "../src/jsx-runtime";

const SVG_NS = "http://www.w3.org/2000/svg";

function click(element: Element): void {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe("template", () => {
  it("возвращает изолированные клоны для одного корня", () => {
    const render = template(`<div class="tpl"><span>hello</span></div>`);
    const first = render();
    const second = render();
    expect(first).not.toBe(second);
    expect(second).not.toBe(first);
    expect((first as Element).tagName).toBe("DIV");
    expect((second as Element).querySelector("span")?.textContent).toBe("hello");
    (first as Element).querySelector("span")?.replaceChildren("changed");
    expect((second as Element).querySelector("span")?.textContent).toBe("hello");
  });

  it("возвращает DocumentFragment для нескольких корней", () => {
    const node = template(`<p></p><i></i><u></u>`)();
    expect(node).toBeInstanceOf(DocumentFragment);
    expect(node.childNodes.length).toBe(3);
  });
});

describe("insert", () => {
  it("вставляет значение одиночного корневого узла", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const element = document.createElement("b");
    insert(parent, () => element);
    expect(parent.contains(element)).toBe(true);
    expect(parent.childNodes.length).toBe(1);
  });

  it("поддерживает строку, число и булево", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const [value, setValue] = createSignal<string | number | boolean | null>("a");
    insert(parent, value);
    expect(parent.textContent).toBe("a");
    setValue(42);
    flushSync();
    expect(parent.textContent).toBe("42");
    setValue(42);
    flushSync();
    expect(parent.textContent).toBe("42");
    setValue(true);
    flushSync();
    expect(parent.textContent).toBe("");
    setValue(null);
    flushSync();
    expect(parent.textContent).toBe("");
  });

  it("обновляет строковые значения через один текстовый узел", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const [value, setValue] = createSignal("one");
    insert(parent, value);
    const first = parent.childNodes[0];
    expect(first?.nodeType).toBe(Node.TEXT_NODE);
    setValue("two");
    flushSync();
    expect(parent.textContent).toBe("two");
    expect(parent.childNodes[0]).toBe(first);
  });

  it("заменяет строку элементом и удаляет старые узлы", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const [value, setValue] = createSignal<string | Node>("text");
    insert(parent, value);
    expect(parent.textContent).toBe("text");
    const element = document.createElement("i");
    setValue(element);
    flushSync();
    expect(parent.textContent).toBe("");
    expect(parent.contains(element)).toBe(true);
    expect(parent.childNodes.length).toBe(1);
  });

  it("вставляет массив значений и функции-толкатели", () => {
    const nested = document.createElement("em");
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    insert(parent, () => [document.createElement("b"), "raw", 5, () => nested, null, false]);
    expect(parent.childNodes.length).toBe(4);
    expect(parent.textContent).toBe("raw5");
    expect(parent.contains(nested)).toBe(true);
  });

  it("уважает маркер при вставке", () => {
    const parent = document.createElement("div");
    const head = document.createTextNode("x");
    const marker = document.createComment("marker");
    const tail = document.createTextNode("y");
    parent.append(head, marker, tail);
    document.body.appendChild(parent);
    const [value, setValue] = createSignal("a");
    insert(parent, value, marker);
    expect(parent.textContent).toBe("xay");
    setValue("b");
    flushSync();
    expect(parent.textContent).toBe("xby");
  });

  it("вызывает disposer удаляемых узлов", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const disposed: string[] = [];
    const first = document.createElement("b");
    attachDisposer(first, () => disposed.push("first"));
    const [value, setValue] = createSignal<Node>(first);
    insert(parent, value);
    const second = document.createElement("i");
    setValue(second);
    flushSync();
    expect(disposed).toEqual(["first"]);
    expect(parent.contains(first)).toBe(false);
    expect(parent.contains(second)).toBe(true);
  });

  it("разворачивает DocumentFragment при вставке", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const fragmentNode = template(`<b></b><u></u>`)();
    insert(parent, () => fragmentNode);
    expect(parent.childNodes.length).toBe(2);
    expect(parent.querySelectorAll("b, u").length).toBe(2);
  });

  it("считает 0, NaN и Infinity текстом", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const [value, setValue] = createSignal<number>(0);
    insert(parent, value);
    expect(parent.textContent).toBe("0");
    setValue(Number.NaN);
    flushSync();
    expect(parent.textContent).toBe("NaN");
    setValue(Number.POSITIVE_INFINITY);
    flushSync();
    expect(parent.textContent).toBe("Infinity");
    setValue(Number.NEGATIVE_INFINITY);
    flushSync();
    expect(parent.textContent).toBe("-Infinity");
    setValue(0);
    flushSync();
    expect(parent.textContent).toBe("0");
  });
});

describe("text", () => {
  it("обновляет data только при изменении значения", () => {
    const node = document.createTextNode("1");
    let writes = 0;
    let inner = "1";
    Object.defineProperty(node, "data", {
      configurable: true,
      get: () => inner,
      set: (next: string) => {
        writes += 1;
        inner = String(next);
      },
    });
    const [value, setValue] = createSignal("1");
    text(node, value);
    expect(inner).toBe("1");
    expect(writes).toBe(0);
    setValue("2");
    flushSync();
    expect(inner).toBe("2");
    expect(writes).toBe(1);
    setValue("2");
    flushSync();
    expect(writes).toBe(1);
    setValue(null);
    flushSync();
    expect(inner).toBe("");
    setValue(7);
    flushSync();
    expect(inner).toBe("7");
  });
});

describe("attr", () => {
  it("управляет class и className", () => {
    const [cls, setCls] = createSignal<string | null>("a b");
    const element = document.createElement("div");
    document.body.appendChild(element);
    attr(element, "class", cls);
    expect(element.getAttribute("class")).toBe("a b");
    setCls("c");
    flushSync();
    expect(element.getAttribute("class")).toBe("c");
    setCls(null);
    flushSync();
    expect(element.hasAttribute("class")).toBe(false);
    const other = document.createElement("div");
    attr(other, "className", () => "k");
    expect(other.getAttribute("class")).toBe("k");
  });

  it("использует свойства для value/checked/selected/disabled", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    const [value, setValue] = createSignal("x");
    attr(input, "value", value);
    expect(input.value).toBe("x");
    setValue(null);
    flushSync();
    expect(input.value).toBe("");
    expect(input.hasAttribute("value")).toBe(false);
    const [checked, setChecked] = createSignal(true);
    attr(input, "checked", checked);
    expect(input.checked).toBe(true);
    setChecked(false);
    flushSync();
    expect(input.checked).toBe(false);
    expect(input.hasAttribute("checked")).toBe(false);
    attr(input, "disabled", () => true);
    expect(input.disabled).toBe(true);
    const select = document.createElement("option");
    attr(select, "selected", () => true);
    expect(select.selected).toBe(true);
  });

  it("обрабатывает булевые и обычные атрибуты", () => {
    const [hidden, setHidden] = createSignal(true);
    const [label, setLabel] = createSignal("small");
    const element = document.createElement("div");
    document.body.appendChild(element);
    attr(element, "hidden", hidden);
    attr(element, "title", label);
    expect(element.getAttribute("hidden")).toBe("");
    expect(element.getAttribute("title")).toBe("small");
    setHidden(false);
    setLabel(null);
    flushSync();
    expect(element.hasAttribute("hidden")).toBe(false);
    expect(element.hasAttribute("title")).toBe(false);
  });

  it("строковые стили через attr", () => {
    const [value, setValue] = createSignal("color: red;");
    const element = document.createElement("div");
    document.body.appendChild(element);
    attr(element, "style", value);
    expect(element.getAttribute("style")).toBe("color: red;");
    setValue("color: blue;");
    flushSync();
    expect(element.getAttribute("style")).toBe("color: blue;");
  });

  it("SVG использует атрибуты вместо свойств", () => {
    const svg = document.createElementNS(SVG_NS, "svg");
    const path = document.createElementNS(SVG_NS, "path");
    svg.appendChild(path);
    document.body.appendChild(svg);
    expect(path instanceof SVGElement).toBe(true);
    attr(path, "class", () => "stroke");
    expect(path.getAttribute("class")).toBe("stroke");
    attr(path, "value", () => "3");
    expect(path.getAttribute("value")).toBe("3");
    expect((path as unknown as Record<string, unknown>).value).toBeUndefined();
  });
});

describe("prop", () => {
  it("устанавливает DOM-свойства и реагирует на изменения", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    const [value, setValue] = createSignal(5);
    let calls = 0;
    prop(input, "tabIndex", () => {
      calls += 1;
      return 3;
    });
    expect(input.tabIndex).toBe(3);
    prop(input, "value", value);
    expect(input.value).toBe("5");
    setValue(9);
    flushSync();
    expect(input.value).toBe("9");
    expect(calls).toBe(1);
  });
});

describe("style", () => {
  it("поддерживает объект и удаляет исчезнувшие ключи", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const [css, setCss] = createSignal<Record<string, string>>({ color: "red", margin: "1px" });
    style(element, css);
    expect(element.style.color).toBe("red");
    expect(element.style.margin).toBe("1px");
    setCss({ color: "blue" });
    flushSync();
    expect(element.style.color).toBe("blue");
    expect(element.style.margin).toBe("");
    expect(element.style.getPropertyValue("color")).toBe("blue");
  });

  it("поддерживает camelCase и строковые значения", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const [value, setValue] = createSignal<string | Record<string, string>>("color: red;");
    style(element, value);
    expect(element.style.getPropertyValue("color")).toBe("red");
    setValue({ fontFamily: "serif" });
    flushSync();
    expect(element.style.getPropertyValue("font-family")).toBe("serif");
    expect(element.style.getPropertyValue("color")).toBe("");
    setValue("background: green;");
    flushSync();
    expect(element.style.cssText).toBe("background: green;");
    expect(element.style.getPropertyValue("font-family")).toBe("");
  });
});

describe("spread", () => {
  it("диффит ключи и удаляет старые значения", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const [props, setProps] = createSignal<Record<string, unknown>>({
      class: "one",
      "data-x": "1",
      id: "main",
    });
    spread(element, () => props());
    expect(element.getAttribute("class")).toBe("one");
    expect(element.getAttribute("data-x")).toBe("1");
    expect(element.getAttribute("id")).toBe("main");
    setProps({ class: "two", id: "main", style: { color: "red" } });
    flushSync();
    expect(element.getAttribute("class")).toBe("two");
    expect(element.hasAttribute("data-x")).toBe(false);
    expect(element.style.color).toBe("red");
    setProps({ id: "main" });
    flushSync();
    expect(element.hasAttribute("class")).toBe(false);
    expect(element.style.color).toBe("");
  });

  it("обновляет value/checked через spread", () => {
    const element = document.createElement("input");
    document.body.appendChild(element);
    const [props, setProps] = createSignal<Record<string, unknown>>({
      type: "checkbox",
      checked: true,
    });
    spread(element, () => props());
    expect(element.checked).toBe(true);
    setProps({ type: "checkbox", checked: false });
    flushSync();
    expect(element.checked).toBe(false);
    expect(element.hasAttribute("checked")).toBe(false);
  });

  it("обновляет события и убирает старые", () => {
    const element = document.createElement("button");
    document.body.appendChild(element);
    const calls: string[] = [];
    const [props, setProps] = createSignal<Record<string, unknown>>({
      onClick: () => calls.push("first"),
    });
    spread(element, () => props());
    click(element);
    expect(calls).toEqual(["first"]);
    setProps({ onClick: () => calls.push("second") });
    flushSync();
    click(element);
    expect(calls).toEqual(["first", "second"]);
    setProps({});
    flushSync();
    click(element);
    expect(calls).toEqual(["first", "second"]);
  });

  it("убирает стили при null и undefined", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const [props, setProps] = createSignal<Record<string, unknown>>({
      style: { color: "red", margin: "2px" },
    });
    spread(element, () => props());
    expect(element.style.color).toBe("red");
    expect(element.style.margin).toBe("2px");
    setProps({ style: null });
    flushSync();
    expect(element.style.color).toBe("");
    expect(element.style.margin).toBe("");
    setProps({ style: { color: "blue" } });
    flushSync();
    expect(element.style.color).toBe("blue");
    setProps({ style: undefined });
    flushSync();
    expect(element.style.color).toBe("");
  });

  it("освобождает ref при замене и удалении ключа", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const calls: [string, unknown][] = [];
    const fnA = (node: unknown): void => {
      calls.push(["a", node]);
    };
    const fnB = (node: unknown): void => {
      calls.push(["b", node]);
    };
    const [props, setProps] = createSignal<Record<string, unknown>>({ ref: fnA });
    spread(element, () => props());
    expect(calls).toEqual([["a", element]]);
    setProps({ ref: fnB });
    flushSync();
    expect(calls).toEqual([
      ["a", element],
      ["a", null],
      ["b", element],
    ]);
    setProps({});
    flushSync();
    expect(calls).toEqual([
      ["a", element],
      ["a", null],
      ["b", element],
      ["b", null],
    ]);
  });
});

describe("on", () => {
  it("навешивает обработчик один раз и читает актуальную функцию", () => {
    const element = document.createElement("button");
    document.body.appendChild(element);
    const calls: string[] = [];
    const [handler, setHandler] = createSignal<[() => void]>([() => calls.push("first")]);
    on(element, "onClick", () => handler()[0]);
    click(element);
    expect(calls).toEqual(["first"]);
    setHandler([() => calls.push("second")]);
    flushSync();
    click(element);
    expect(calls).toEqual(["first", "second"]);
  });

  it("поддерживает on:click", () => {
    const element = document.createElement("button");
    document.body.appendChild(element);
    const calls: string[] = [];
    on(element, "on:click", () => calls.push("click"));
    click(element);
    expect(calls).toEqual(["click"]);
  });

  it("onClickCapture срабатывает в фазе захвата", () => {
    const outer = document.createElement("div");
    const inner = document.createElement("button");
    outer.appendChild(inner);
    document.body.appendChild(outer);
    const order: string[] = [];
    on(outer, "onClickCapture", () => order.push("capture"));
    on(inner, "onClick", () => order.push("bubble"));
    click(inner);
    expect(order).toEqual(["capture", "bubble"]);
  });
});

describe("ref", () => {
  it("вызывает колбэк с элементом", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const calls: Node[] = [];
    ref(element, () => (node: Node) => calls.push(node));
    expect(calls).toEqual([element]);
  });

  it("делает cleanup при замене", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const calls: [string, unknown][] = [];
    const fnA = (node: unknown): void => {
      calls.push(["a", node]);
    };
    const fnB = (node: unknown): void => {
      calls.push(["b", node]);
    };
    const [target, setTarget] = createSignal<[typeof fnA]>([fnA]);
    ref(element, () => target()[0]);
    expect(calls).toEqual([["a", element]]);
    setTarget([fnB]);
    flushSync();
    expect(calls).toEqual([
      ["a", element],
      ["a", null],
      ["b", element],
    ]);
  });

  it("не трогает колбэк, если ссылка не изменилась", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const calls: [string, unknown][] = [];
    const fn = (node: unknown): void => {
      calls.push(["a", node]);
    };
    const [target, setTarget] = createSignal<[typeof fn]>([fn]);
    ref(element, () => target()[0]);
    setTarget([fn]);
    flushSync();
    expect(calls).toEqual([["a", element]]);
  });

  it("вызывает cleanup при dispose владельца", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const calls: (Node | null)[] = [];
    let dispose: () => void = () => {};
    createRoot((stop) => {
      dispose = stop;
      ref(element, () => (node: Node | null) => calls.push(node));
    });
    expect(calls).toEqual([element]);
    dispose();
    expect(calls).toEqual([element, null]);
  });
});

describe("NODE_DISPOSER", () => {
  it("вызывает dispose при удалении узла", () => {
    expect(typeof NODE_DISPOSER).toBe("symbol");
    const cleaned: string[] = [];
    const element = document.createElement("div");
    attachDisposer(element, () => cleaned.push("root"));
    const child = document.createElement("span");
    element.appendChild(child);
    disposeNode(element);
    expect(cleaned).toEqual(["root"]);
  });
});

describe("effect", () => {
  it("реагирует на изменения сигнала", () => {
    const [value, setValue] = createSignal(0);
    let runs = 0;
    effect(() => {
      void value();
      runs += 1;
    });
    expect(runs).toBe(1);
    setValue(1);
    flushSync();
    expect(runs).toBe(2);
  });
});

describe("fragment", () => {
  it("вставляет реактивное содержимое и живёт в DOM", async () => {
    const [value, setValue] = createSignal("a");
    const fragmentNode = fragment(value);
    expect(fragmentNode).toBeInstanceOf(DocumentFragment);
    const host = document.createElement("div");
    document.body.appendChild(host);
    host.appendChild(fragmentNode);
    expect(host.textContent).toBe("a");
    setValue("b");
    flushSync();
    expect(host.textContent).toBe("b");
    setValue(0);
    flushSync();
    expect(host.textContent).toBe("0");
  });
});

describe("dynamic", () => {
  it("создаёт элементы по строковому тегу", () => {
    const element = dynamic(() => "div", { class: "box" });
    expect(element.tagName).toBe("DIV");
    expect(element.getAttribute("class")).toBe("box");
    const withChildren = dynamic(() => "section", { children: "hello" });
    expect(withChildren.textContent).toBe("hello");
  });

  it("реактивное содержимое внутри dynamic", () => {
    const [value, setValue] = createSignal("one");
    const element = dynamic(() => "span", { children: () => value() });
    document.body.appendChild(element);
    expect(element.textContent).toBe("one");
    setValue("two");
    flushSync();
    expect(element.textContent).toBe("two");
  });

  it("SVG создаётся через createElementNS", () => {
    const svg = dynamic(() => "svg", {});
    expect(svg.namespaceURI).toBe(SVG_NS);
    const path = dynamic(() => "path", { d: "M0 0" });
    expect(path.namespaceURI).toBe(SVG_NS);
    expect((path as SVGElement).tagName.toLowerCase()).toBe("path");
  });
});

describe("onCleanup внутри insert", () => {
  it("регистрирует cleanup в области вставки", () => {
    const cleaned: boolean[] = [];
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const [value, setValue] = createSignal<Node | null>(document.createElement("b"));
    const scoped = () => value();
    insert(parent, () => {
      onCleanup(() => cleaned.push(true));
      return scoped();
    });
    setValue(null);
    flushSync();
    expect(cleaned).toEqual([true]);
  });
});

describe("jsx-runtime", () => {
  it("метаданные Fragment через symbol", () => {
    expect(Fragment).toBe(Symbol.for("silent.fragment"));
  });

  it("создаёт DOM для строкового тега", () => {
    const element = jsx("section", { id: "root", children: "hello" });
    expect(element.tagName).toBe("SECTION");
    expect(element.getAttribute("id")).toBe("root");
    expect(element.textContent).toBe("hello");
  });

  it("вызывает компонент с props", () => {
    let received: Record<string, unknown> | null = null;
    const Component = (props: Record<string, unknown>): Node => {
      received = props;
      return document.createElement("b");
    };
    const element = jsx(Component, { label: "yes" });
    expect(element.tagName).toBe("B");
    expect(received?.["label"]).toBe("yes");
  });

  it("выбрасывает ошибку при метаданных silent.view", () => {
    const viewMetaSymbol = Symbol.for("silent.view");
    const component = (props: Record<string, unknown>): Node => document.createElement("u");
    (component as unknown as Record<symbol, unknown>)[viewMetaSymbol] = { name: "View" };
    expect(() => jsx(component, {})).toThrow(/@ivlev98\/silent-vite/);
  });

  it("рендерит Fragment как DocumentFragment", () => {
    const node = jsx(Fragment, { children: ["a", 0, null, "b"] });
    expect(node).toBeInstanceOf(DocumentFragment);
    expect(node.textContent).toBe("a0b");
  });
});
