// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { createSignal, flushSync } from "@ivlev-dev/silent-reactivity";
import {
  attachDisposer,
  attr,
  createMountPoint,
  innerHtml,
  insert,
  on,
  prop,
  spread,
  style,
  templateHoles,
} from "../src/dom";
import { For } from "../src/control-flow";

function click(element: Element): void {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function option(value: string): HTMLOptionElement {
  const element = document.createElement("option");
  element.value = value;
  element.textContent = value;
  return element;
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe("createMountPoint: повторный рендер тех же узлов", () => {
  it("не освобождает и не переставляет те же узлы", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const mount = createMountPoint(parent, null);
    const first = document.createElement("span");
    const second = document.createElement("b");
    first.textContent = "a";
    second.textContent = "b";
    let disposed = 0;
    attachDisposer(first, () => {
      disposed += 1;
    });

    mount.render([first, second]);
    const initial = Array.from(parent.childNodes);
    mount.render([first, second]);

    expect(disposed).toBe(0);
    expect(Array.from(parent.childNodes)).toEqual(initial);
    expect(mount.nodes()).toEqual([first, second]);
  });

  it("перестраивает узлы, если порядок изменился", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const mount = createMountPoint(parent, null);
    const first = document.createElement("span");
    const second = document.createElement("b");
    mount.render([first, second]);
    let disposed = 0;
    attachDisposer(first, () => {
      disposed += 1;
    });

    mount.render([second, first]);

    expect(disposed).toBe(1);
    expect(Array.from(parent.childNodes)).toEqual([second, first]);
  });
});

describe("createMountPoint: clear", () => {
  it("сбрасывает состояние и позволяет снова вставить то же значение", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const mount = createMountPoint(parent, null);

    mount.render("a");
    expect(parent.textContent).toBe("a");

    mount.clear();
    expect(parent.childNodes.length).toBe(0);
    expect(mount.nodes().length).toBe(0);

    mount.render("a");
    expect(parent.textContent).toBe("a");
    expect(parent.childNodes.length).toBe(1);
  });
});

describe("spread: снятие значений", () => {
  it("снимает атрибуты и обработчики при null", () => {
    const element = document.createElement("button");
    document.body.appendChild(element);
    const calls: string[] = [];
    const [props, setProps] = createSignal<Record<string, unknown> | null>({
      class: "one",
      title: "tip",
      onClick: () => calls.push("click"),
    });
    spread(element, () => props());
    expect(element.getAttribute("class")).toBe("one");
    expect(element.getAttribute("title")).toBe("tip");

    setProps(null);
    flushSync();

    expect(element.hasAttribute("class")).toBe(false);
    expect(element.hasAttribute("title")).toBe(false);
    click(element);
    expect(calls).toEqual([]);
  });
});

describe("style: независимые биндинги", () => {
  it("не затирают ключи друг друга", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const [color, setColor] = createSignal({ color: "red" });
    const [margin, setMargin] = createSignal({ margin: "1px" });
    style(element, () => color());
    style(element, () => margin());

    expect(element.style.color).toBe("red");
    expect(element.style.margin).toBe("1px");

    setColor({ "font-size": "12px" });
    flushSync();
    expect(element.style.color).toBe("");
    expect(element.style.margin).toBe("1px");
    expect(element.style.fontSize).toBe("12px");

    setMargin({});
    flushSync();
    expect(element.style.margin).toBe("");
    expect(element.style.fontSize).toBe("12px");
  });

  it("не конфликтует со spread", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const [props, setProps] = createSignal<Record<string, unknown>>({
      style: { color: "red" },
    });
    const [margin, setMargin] = createSignal({ margin: "1px" });
    spread(element, () => props());
    style(element, () => margin());

    expect(element.style.color).toBe("red");
    expect(element.style.margin).toBe("1px");

    setProps({});
    flushSync();
    expect(element.style.color).toBe("");
    expect(element.style.margin).toBe("1px");

    setMargin({ padding: "2px" });
    flushSync();
    expect(element.style.margin).toBe("");
    expect(element.style.padding).toBe("2px");
  });

  it("не конфликтует с attr(style)", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const [base, setBase] = createSignal({ color: "red" });
    const [custom, setCustom] = createSignal({ margin: "1px" });
    attr(element, "style", () => base());
    style(element, () => custom());

    setBase({ color: "blue" });
    flushSync();
    expect(element.style.color).toBe("blue");
    expect(element.style.margin).toBe("1px");

    setCustom({ padding: "2px" });
    flushSync();
    expect(element.style.padding).toBe("2px");
    expect(element.style.color).toBe("blue");
  });
});

describe("on: имена событий", () => {
  it("принимает канонические и on:-имена", () => {
    const element = document.createElement("button");
    document.body.appendChild(element);
    const calls: string[] = [];
    on(element, "click", () => () => calls.push("canonical"));
    on(element, "on:custom-event", () => () => calls.push("custom"));
    click(element);
    element.dispatchEvent(new CustomEvent("custom-event"));
    expect(calls).toEqual(["canonical", "custom"]);
  });

  it("бросает понятную ошибку на опечатку", () => {
    const element = document.createElement("button");
    document.body.appendChild(element);
    expect(() => on(element, "onClik", () => undefined)).toThrow(/Неизвестное событие/);
    expect(() => on(element, "on:", () => undefined)).toThrow(/Некорректное имя события/);
  });

  it("продолжает всплытие после исключения и очищает currentTarget", () => {
    const outer = document.createElement("div");
    const inner = document.createElement("button");
    outer.appendChild(inner);
    document.body.appendChild(outer);
    const order: string[] = [];
    let seen: EventTarget | null = null;
    let eventSeen: Event | null = null;
    on(outer, "onClick", () => (event: Event) => {
      order.push("outer");
      seen = event.currentTarget;
      eventSeen = event;
    });
    on(inner, "onClick", () => (event: Event) => {
      order.push("inner");
      expect(event.currentTarget).toBe(inner);
      throw new Error("boom");
    });

    click(inner);

    expect(order).toEqual(["inner", "outer"]);
    expect(seen).toBe(outer);
    expect(eventSeen).not.toBeNull();
    expect((eventSeen as Event | null)?.currentTarget).toBeNull();
  });
});

describe("boolean-атрибуты", () => {
  it("пишет true для не-булевых имён", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    attr(element, "aria-hidden", () => true);
    attr(element, "draggable", () => true);
    attr(element, "data-flag", () => true);
    attr(element, "hidden", () => true);

    expect(element.getAttribute("aria-hidden")).toBe("true");
    expect(element.getAttribute("draggable")).toBe("true");
    expect(element.getAttribute("data-flag")).toBe("true");
    expect(element.getAttribute("hidden")).toBe("");
  });

  it("пишет true через spread", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    spread(element, () => ({ "aria-hidden": true, draggable: true, "data-on": true }));
    expect(element.getAttribute("aria-hidden")).toBe("true");
    expect(element.getAttribute("draggable")).toBe("true");
    expect(element.getAttribute("data-on")).toBe("true");
  });
});

describe("innerHtml", () => {
  it("заменяет разметку и освобождает прежних детей", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const old = document.createElement("span");
    old.textContent = "old";
    element.appendChild(old);
    let disposed = 0;
    attachDisposer(old, () => {
      disposed += 1;
    });
    const [html, setHtml] = createSignal("<b>first</b>");
    innerHtml(element, () => html());

    expect(disposed).toBe(1);
    expect(element.innerHTML).toBe("<b>first</b>");

    setHtml("<i>second</i>");
    flushSync();
    expect(element.innerHTML).toBe("<i>second</i>");
    expect(element.querySelector("b")).toBeNull();
  });

  it("держит dangerouslySetInnerHTML в spread и applyProps", async () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const [value, setValue] = createSignal<{ __html: string } | null>({
      __html: "<u>a</u>",
    });
    spread(element, () => ({ dangerouslySetInnerHTML: value() }));
    expect(element.innerHTML).toBe("<u>a</u>");
    setValue(null);
    flushSync();
    expect(element.innerHTML).toBe("");
  });
});

describe("controlled select", () => {
  it("применяет value после вставки опций", async () => {
    const select = document.createElement("select");
    document.body.appendChild(select);
    attr(select, "value", () => "b");

    insert(select, () => [option("a"), option("b")]);
    await Promise.resolve();

    expect(select.value).toBe("b");
  });

  it("применяет value после For-опций", async () => {
    const select = document.createElement("select");
    document.body.appendChild(select);
    attr(select, "value", () => "b");
    select.appendChild(
      For({
        each: ["a", "b"],
        children: (value: string): Node => option(value),
      }),
    );

    await Promise.resolve();

    expect(select.value).toBe("b");
    expect(select.selectedOptions[0]?.value).toBe("b");
  });

  it("применяет value сразу, когда опции уже есть", () => {
    const select = document.createElement("select");
    select.appendChild(option("a"));
    select.appendChild(option("b"));
    document.body.appendChild(select);
    attr(select, "value", () => "b");
    expect(select.value).toBe("b");
  });
});

describe("SVG-атрибуты", () => {
  it("маппит camelCase и xlink", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    svg.appendChild(path);
    document.body.appendChild(svg);
    attr(path, "strokeWidth", () => 2);
    attr(path, "fillRule", () => "evenodd");
    attr(path, "xlink:href", () => "#shape");
    expect(path.getAttribute("stroke-width")).toBe("2");
    expect(path.getAttribute("fill-rule")).toBe("evenodd");
    expect(path.getAttributeNS("http://www.w3.org/1999/xlink", "href")).toBe("#shape");
  });
});

describe("гидрация raw-text и innerHTML", () => {
  const VIEW = Symbol.for("silent.view");

  function attachMeta(component: unknown): void {
    (component as Record<PropertyKey, unknown>)[VIEW] = { vm: class {}, name: "Test" };
  }

  async function hydrateMarkup(markup: string, view: () => Node): Promise<HTMLElement> {
    attachMeta(view);
    const target = document.createElement("div");
    target.innerHTML = markup;
    document.body.appendChild(target);
    const { hydrate } = await import("../src/hydrate");
    await hydrate(target, view as never, { onMismatch: () => undefined });
    return target;
  }

  it("применяет raw-text через textContent после гидрации", async () => {
    const target = await hydrateMarkup(
      '<!--silent-view--><style data-silent-a-0="" data-silent-text="">a &gt; b</style><!--silent-view-end-->',
      (): Node => {
        const template = templateHoles(
          '<style data-silent-a-0="" data-silent-text=""></style>',
        )();
        prop(template.attrs[0]!, "textContent", () => "a > b && c");
        return template.node;
      },
    );
    expect(target.querySelector("style")?.textContent).toBe("a > b && c");
  });

  it("применяет dangerouslySetInnerHTML после гидрации", async () => {
    const target = await hydrateMarkup(
      '<!--silent-view--><div data-silent-a-0="" data-silent-text=""><b>x</b></div><!--silent-view-end-->',
      (): Node => {
        const template = templateHoles(
          '<div data-silent-a-0="" data-silent-text=""></div>',
        )();
        innerHtml(template.attrs[0]!, () => "<b>x</b>");
        return template.node;
      },
    );
    expect(target.querySelector("div")?.innerHTML).toBe("<b>x</b>");
  });

  it("применяет spread после гидрации без дублей class", async () => {
    const calls: string[] = [];
    const target = await hydrateMarkup(
      '<!--silent-view--><button class="static" data-silent-a-0=""></button><!--silent-view-end-->',
      (): Node => {
        const template = templateHoles(
          '<button class="static" data-silent-a-0=""></button>',
        )();
        spread(template.attrs[0]!, () => ({
          class: "dyn",
          onClick: () => calls.push("click"),
        }));
        return template.node;
      },
    );
    const button = target.querySelector("button");
    expect(button?.getAttribute("class")).toBe("dyn");
    expect(button?.hasAttribute("data-silent-a-0")).toBe(false);
    if (button !== null) {
      click(button);
    }
    expect(calls).toEqual(["click"]);
  });
});
