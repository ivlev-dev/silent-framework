import { afterEach, describe, expect, it } from "vitest";
import { createRoot, createSignal, flushSync } from "@ivlev-dev/silent-reactivity";
import {
  component,
  createComponent,
  whenIdle,
  type AnyComponent,
  type ComponentResult,
} from "../src/component.js";
import { For, Show } from "../src/control-flow.js";
import { Suspense, lazy } from "../src/suspense.js";
import { attr, insert, on, prop, setServerMode, templateHoles } from "../src/dom.js";
import { hydrate } from "../src/hydrate.js";
import { HydrationMismatchError } from "../src/hydration.js";

const VIEW = Symbol.for("silent.view");
const hosts: HTMLElement[] = [];

function host(markup = ""): HTMLElement {
  const element = document.createElement("div");
  element.innerHTML = markup;
  document.body.appendChild(element);
  hosts.push(element);
  return element;
}

afterEach(() => {
  for (const element of hosts.splice(0)) {
    element.remove();
  }
  document.body.replaceChildren();
});

function attachMeta(target: unknown, vm: unknown): void {
  (target as Record<PropertyKey, unknown>)[VIEW] = { vm, name: "Test" };
}

function build(app: AnyComponent, props: Record<string, unknown> = {}): ComponentResult {
  let result: ComponentResult | null = null;
  createRoot(() => {
    result = createComponent(app, props);
    return null;
  });
  if (result === null) {
    throw new Error("component was not created");
  }
  return result;
}

async function renderServer(
  app: AnyComponent,
  props: Record<string, unknown> = {},
): Promise<string> {
  setServerMode(true);
  try {
    const result = build(app, props);
    await result.ready;
    await whenIdle();
    flushSync();
    await whenIdle();
    flushSync();
    const container = document.createElement("div");
    container.appendChild(result.node);
    const html = container.innerHTML;
    result.dispose();
    return html;
  } finally {
    setServerMode(false);
  }
}

function holeParent(template: { node: Node; holes: readonly Comment[] }, index: number): Node {
  const hole = template.holes[index];
  return hole?.parentNode ?? template.node;
}

const count = createSignal(0);

class RootVM {}
class CounterVM {}

function CounterView(this: { vm: CounterVM }): Node {
  void this.vm;
  const template = templateHoles(
    '<div class="counter"><strong class="value"><!--silent-hole-0--></strong></div>',
  )();
  insert(holeParent(template, 0), () => count[0](), template.holes[0]);
  return template.node;
}
attachMeta(CounterView, CounterVM);

function RootView(this: { vm: RootVM }): Node {
  void this.vm;
  const template = templateHoles(
    '<main class="app"><h1>Title</h1><!--silent-hole-0--></main>',
  )();
  insert(
    holeParent(template, 0),
    () => component(CounterView as unknown as AnyComponent, {}),
    template.holes[0],
  );
  return template.node;
}
attachMeta(RootView, RootVM);

describe("гидрация с сохранением узлов", () => {
  it("переиспользует статические узлы и динамический текст", async () => {
    count[1](0);
    const html = await renderServer(RootView as unknown as AnyComponent);
    expect(html).toContain("silent-view");

    const target = host(html);
    const serverMain = target.querySelector("main");
    const serverH1 = target.querySelector("h1");
    const serverValue = target.querySelector("strong.value");
    const serverText = Array.from(serverValue?.childNodes ?? []).find(
      (node) => node.nodeType === 3,
    );
    expect(serverText?.textContent).toBe("0");

    const mismatches: HydrationMismatchError[] = [];
    await hydrate(target, RootView as unknown as AnyComponent, {
      onMismatch: (error) => mismatches.push(error),
    });

    expect(mismatches).toEqual([]);
    expect(target.querySelector("main")).toBe(serverMain);
    expect(target.querySelector("h1")).toBe(serverH1);
    expect(target.querySelector("strong.value")).toBe(serverValue);
    expect(
      Array.from(target.querySelector("strong.value")?.childNodes ?? []).find(
        (node) => node.nodeType === 3,
      ),
    ).toBe(serverText);
    expect(target.textContent).toBe("Title0");

    count[1](2);
    flushSync();
    expect(target.querySelector("strong.value")?.textContent).toBe("2");
    expect(
      Array.from(target.querySelector("strong.value")?.childNodes ?? []).find(
        (node) => node.nodeType === 3,
      ),
    ).toBe(serverText);
  });

  it("переиспользует элементы списка и обновляет его реактивно", async () => {
    const items = createSignal([{ name: "a" }, { name: "b" }]);
    class ListVM {}
    function ListView(this: { vm: ListVM }): Node {
      void this.vm;
      const template = templateHoles('<ul class="items"><!--silent-hole-0--></ul>')();
      insert(
        holeParent(template, 0),
        () =>
          For({
            each: items[0],
            children: (item: { name: string }) => {
              const template = templateHoles("<li><!--silent-hole-0--></li>")();
              insert(
                holeParent(template, 0),
                () => item.name,
                template.holes[0],
              );
              return template.node;
            },
          }),
        template.holes[0],
      );
      return template.node;
    }
    attachMeta(ListView, ListVM);

    const html = await renderServer(ListView as unknown as AnyComponent);
    const target = host(html);
    const serverRows = Array.from(target.querySelectorAll("li"));

    const mismatches: HydrationMismatchError[] = [];
    await hydrate(target, ListView as unknown as AnyComponent, {
      onMismatch: (error) => mismatches.push(error),
    });

    expect(mismatches).toEqual([]);
    expect(Array.from(target.querySelectorAll("li"))).toEqual(serverRows);
    expect(target.querySelectorAll("li").length).toBe(2);

    items[1]([...items[0](), { name: "c" }]);
    flushSync();
    const rows = Array.from(target.querySelectorAll("li"));
    expect(rows.length).toBe(3);
    expect(rows[0]).toBe(serverRows[0]);
    expect(rows[1]).toBe(serverRows[1]);
    expect(rows[2]?.textContent).toBe("c");
  });

  it("переключает Show без потери исходного узла", async () => {
    const visible = createSignal(true);
    class ShowVM {}
    function ShowView(this: { vm: ShowVM }): Node {
      void this.vm;
      const template = templateHoles('<section class="s"><!--silent-hole-0--></section>')();
      insert(
        holeParent(template, 0),
        () =>
          Show({
            when: visible[0],
            children: () =>
              templateHoles("<p>on</p>")().node,
            fallback: () =>
              templateHoles("<p>off</p>")().node,
          }),
        template.holes[0],
      );
      return template.node;
    }
    attachMeta(ShowView, ShowVM);

    const target = host(await renderServer(ShowView as unknown as AnyComponent));
    const serverParagraph = target.querySelector("p");

    const mismatches: HydrationMismatchError[] = [];
    await hydrate(target, ShowView as unknown as AnyComponent, {
      onMismatch: (error) => mismatches.push(error),
    });

    expect(mismatches).toEqual([]);
    expect(target.querySelector("p")).toBe(serverParagraph);
    expect(target.textContent).toBe("on");

    visible[1](false);
    flushSync();
    expect(target.textContent).toBe("off");

    visible[1](true);
    flushSync();
    expect(target.textContent).toBe("on");
  });

  it("адоптирует содержимое Suspense и lazy", async () => {
    const Loading = (): Node => document.createTextNode("loading");
    const LazyText = lazy(async () => ({
      default: (() => templateHoles("<span>lazy</span>")().node) as unknown as AnyComponent,
    }));
    class SuspenseVM {}
    function SuspenseView(this: { vm: SuspenseVM }): Node {
      void this.vm;
      const template = templateHoles('<div class="wrapper"><!--silent-hole-0--></div>')();
      insert(
        holeParent(template, 0),
        () =>
          Suspense({
            fallback: Loading,
            children: () => component(LazyText as unknown as AnyComponent, {}),
          }),
        template.holes[0],
      );
      return template.node;
    }
    attachMeta(SuspenseView, SuspenseVM);

    const target = host(await renderServer(SuspenseView as unknown as AnyComponent));
    const serverSpan = target.querySelector("span");

    const mismatches: HydrationMismatchError[] = [];
    await hydrate(target, SuspenseView as unknown as AnyComponent, {
      onMismatch: (error) => mismatches.push(error),
    });

    expect(mismatches).toEqual([]);
    expect(target.querySelector("span")).toBe(serverSpan);
    expect(target.textContent).toBe("lazy");
  });

  it("снимает серверные маркеры атрибутов и применяет значение", async () => {
    class AttrVM {}
    function AttrView(this: { vm: AttrVM }): Node {
      void this.vm;
      const template = templateHoles(
        '<button class="btn" data-silent-a-0="">click</button>',
      )();
      attr(template.node as Element, "title", () => "hint");
      return template.node;
    }
    attachMeta(AttrView, AttrVM);

    const html = await renderServer(AttrView as unknown as AnyComponent);
    expect(html).toContain("data-silent-a-0");

    const target = host(html);
    const serverButton = target.querySelector("button");
    const mismatches: HydrationMismatchError[] = [];
    await hydrate(target, AttrView as unknown as AnyComponent, {
      onMismatch: (error) => mismatches.push(error),
    });

    expect(mismatches).toEqual([]);
    expect(target.querySelector("button")).toBe(serverButton);
    expect(target.querySelector("button")?.getAttribute("title")).toBe("hint");
    expect(target.innerHTML.includes("data-silent-a-")).toBe(false);
  });

  it("адоптирует сложный view с несколькими атрибутами и дырами", async () => {
    const value = createSignal(0);
    class ComplexVM {}
    function ComplexView(this: { vm: ComplexVM }): Node {
      void this.vm;
      const template = templateHoles(
        '<section class="counter"><h2>Счётчик</h2><div class="row"><button data-silent-a-0="">-</button><strong class="value"><!--silent-hole-0--></strong><button data-silent-a-1="">+</button></div><p>Город:<span class="city"><!--silent-hole-1--></span> <button data-silent-a-2="">Сменить</button></p></section>',
      )();
      on(template.attrs[0]!, "onClick", () => () => value[1](value[0]() - 1));
      on(template.attrs[1]!, "onClick", () => () => value[1](value[0]() + 1));
      on(template.attrs[2]!, "onClick", () => () => undefined);
      insert(holeParent(template, 0), () => value[0](), template.holes[0]);
      insert(holeParent(template, 1), () => "Moscow", template.holes[1]);
      return template.node;
    }
    attachMeta(ComplexView, ComplexVM);

    const target = host(await renderServer(ComplexView as unknown as AnyComponent));
    const serverSection = target.querySelector("section");
    const serverButton = target.querySelectorAll("button")[1];
    const mismatches: HydrationMismatchError[] = [];
    await hydrate(target, ComplexView as unknown as AnyComponent, {
      onMismatch: (error) => mismatches.push(error),
    });

    expect(mismatches).toEqual([]);
    expect(target.querySelector("section")).toBe(serverSection);
    expect(target.querySelectorAll("button")[1]).toBe(serverButton);
    serverButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    flushSync();
    expect(target.querySelector("strong.value")?.textContent).toBe("1");
  });

  it("адоптирует fallback пустого списка и переключает его", async () => {
    const items = createSignal<{ name: string }[]>([]);
    class EmptyVM {}
    function EmptyListView(this: { vm: EmptyVM }): Node {
      void this.vm;
      const template = templateHoles('<div class="list"><!--silent-hole-0--></div>')();
      insert(
        holeParent(template, 0),
        () =>
          For({
            each: items[0],
            children: (item: { name: string }) => {
              const row = templateHoles("<li><!--silent-hole-0--></li>")();
              insert(holeParent(row, 0), () => item.name, row.holes[0]);
              return row.node;
            },
            fallback: () => templateHoles("<p>empty</p>")().node,
          }),
        template.holes[0],
      );
      return template.node;
    }
    attachMeta(EmptyListView, EmptyVM);

    const target = host(await renderServer(EmptyListView as unknown as AnyComponent));
    const serverParagraph = target.querySelector("p");

    const mismatches: HydrationMismatchError[] = [];
    await hydrate(target, EmptyListView as unknown as AnyComponent, {
      onMismatch: (error) => mismatches.push(error),
    });

    expect(mismatches).toEqual([]);
    expect(target.querySelector("p")).toBe(serverParagraph);
    expect(target.textContent).toBe("empty");

    items[1]([{ name: "a" }]);
    flushSync();
    expect(target.querySelector("p")).toBeNull();
    expect(target.querySelectorAll("li").length).toBe(1);
    expect(target.textContent).toBe("a");

    items[1]([]);
    flushSync();
    expect(target.querySelector("li")).toBeNull();
    expect(target.textContent).toBe("empty");
  });

  it("адоптирует шаблон с несколькими корневыми узлами", async () => {
    class MultiVM {}
    function MultiView(this: { vm: MultiVM }): Node {
      void this.vm;
      return templateHoles("<h1>Title</h1><p>Body</p>")().node;
    }
    attachMeta(MultiView, MultiVM);

    const target = host(await renderServer(MultiView as unknown as AnyComponent));
    const serverHeading = target.querySelector("h1");
    const serverParagraph = target.querySelector("p");

    const mismatches: HydrationMismatchError[] = [];
    await hydrate(target, MultiView as unknown as AnyComponent, {
      onMismatch: (error) => mismatches.push(error),
    });

    expect(mismatches).toEqual([]);
    expect(target.querySelector("h1")).toBe(serverHeading);
    expect(target.querySelector("p")).toBe(serverParagraph);
    expect(target.textContent).toBe("TitleBody");
  });

  it("откатывается на клиентский рендер при несовпадении", async () => {
    count[1](0);
    const target = host("<div>stale</div>");
    const mismatches: HydrationMismatchError[] = [];
    await hydrate(target, RootView as unknown as AnyComponent, {
      onMismatch: (error) => mismatches.push(error),
    });

    expect(mismatches.length).toBeGreaterThan(0);
    expect(target.querySelector("h1")?.textContent).toBe("Title");
    expect(target.querySelector("strong.value")?.textContent).toBe("0");
    expect(target.querySelectorAll("main.app").length).toBe(1);
  });

  it("адоптирует узлы по переданному плану и обновляет текст", async () => {
    count[1](0);
    class PlanVM {}
    function PlanView(this: { vm: PlanVM }): Node {
      void this.vm;
      const template = templateHoles(
        '<strong class="value"><!--silent-hole-0--></strong>',
        {
          roots: 1,
          holes: [{ path: [0, 0], counts: [1, 1] }],
          attrs: [],
          strips: [],
        },
      )();
      insert(holeParent(template, 0), () => count[0](), template.holes[0]);
      return template.node;
    }
    attachMeta(PlanView, PlanVM);

    const target = host(await renderServer(PlanView as unknown as AnyComponent));
    const serverStrong = target.querySelector("strong.value");
    const serverText = Array.from(serverStrong?.childNodes ?? []).find(
      (node) => node.nodeType === 3,
    );
    const mismatches: HydrationMismatchError[] = [];
    const handle = await hydrate(target, PlanView as unknown as AnyComponent, {
      onMismatch: (error) => mismatches.push(error),
    });

    expect(mismatches).toEqual([]);
    expect(target.querySelector("strong.value")).toBe(serverStrong);
    expect(
      Array.from(target.querySelector("strong.value")?.childNodes ?? []).find(
        (node) => node.nodeType === 3,
      ),
    ).toBe(serverText);
    expect(target.textContent).toBe("0");

    count[1](4);
    flushSync();
    expect(target.querySelector("strong.value")?.textContent).toBe("4");
    handle.dispose();
  });

  it("игнорирует устаревший путь, если маркер на месте", async () => {
    function StalePath(): Node {
      const template = templateHoles('<p class="broken"><!--silent-hole-0--></p>', {
        roots: 1,
        holes: [{ path: [0, 1], counts: [1, 1] }],
        attrs: [],
        strips: [],
      })();
      insert(holeParent(template, 0), () => "value", template.holes[0]);
      return template.node;
    }

    const target = host('<p class="broken">value<!--silent-hole-0--></p>');
    const mismatches: HydrationMismatchError[] = [];
    const handle = await hydrate(target, StalePath as unknown as AnyComponent, {
      onMismatch: (error) => mismatches.push(error),
    });

    expect(mismatches).toEqual([]);
    expect(target.textContent).toBe("value");
    handle.dispose();
  });

  it("отклоняет план, если маркера не хватает", async () => {
    function MissingHole(): Node {
      const template = templateHoles('<p class="broken"></p>', {
        roots: 1,
        holes: [{ path: [0, 0], counts: [1] }],
        attrs: [],
        strips: [],
      })();
      return template.node;
    }

    const target = host(await renderServer(MissingHole as unknown as AnyComponent));
    const mismatches: HydrationMismatchError[] = [];
    const handle = await hydrate(target, MissingHole as unknown as AnyComponent, {
      onMismatch: (error) => mismatches.push(error),
    });

    expect(mismatches.length).toBeGreaterThan(0);
    expect(mismatches[0]).toBeInstanceOf(HydrationMismatchError);
    handle.dispose();
  });

  it("отклоняет план с неверным индексом маркера", async () => {
    function BrokenIndex(): Node {
      const template = templateHoles('<p class="broken"><!--silent-hole-1--></p>', {
        roots: 1,
        holes: [{ path: [0, 0], counts: [1, 1] }],
        attrs: [],
        strips: [],
      })();
      insert(holeParent(template, 0), () => "value", template.holes[0]);
      return template.node;
    }

    const target = host(await renderServer(BrokenIndex as unknown as AnyComponent));
    const mismatches: HydrationMismatchError[] = [];
    const handle = await hydrate(target, BrokenIndex as unknown as AnyComponent, {
      onMismatch: (error) => mismatches.push(error),
    });

    expect(mismatches.length).toBeGreaterThan(0);
    expect(mismatches[0]).toBeInstanceOf(HydrationMismatchError);
    handle.dispose();
  });

  it("снимает метки с RCDATA-элемента при адопции по плану", async () => {
    function Textarea(): Node {
      const template = templateHoles(
        '<textarea class="note" data-silent-a-0="" data-silent-text=""></textarea>',
        {
          roots: 1,
          holes: [],
          attrs: [{ path: [0], counts: [1] }],
          strips: [
            {
              path: [0],
              counts: [1],
              names: ["data-silent-a-0", "data-silent-text"],
            },
          ],
        },
      )();
      prop(template.attrs[0]!, "value", () => "hello");
      return template.node;
    }

    const target = host(await renderServer(Textarea as unknown as AnyComponent));
    const serverTextarea = target.querySelector("textarea");
    const mismatches: HydrationMismatchError[] = [];
    const handle = await hydrate(target, Textarea as unknown as AnyComponent, {
      onMismatch: (error) => mismatches.push(error),
    });

    expect(mismatches).toEqual([]);
    expect(target.querySelector("textarea")).toBe(serverTextarea);
    expect(target.innerHTML.includes("data-silent-")).toBe(false);
    expect((target.querySelector("textarea") as HTMLTextAreaElement | null)?.value).toBe(
      "hello",
    );
    handle.dispose();
  });

  it("адоптирует текст без региона и переиспользует серверный текстовый узел", async () => {
    count[1](0);
    const html = await renderServer(CounterView as unknown as AnyComponent);
    expect(html).not.toContain("silent-insert");
    expect(html).toContain("0<!--silent-hole-0-->");

    const target = host(html);
    const serverStrong = target.querySelector("strong.value");
    const serverText = Array.from(serverStrong?.childNodes ?? []).find(
      (node) => node.nodeType === 3,
    );
    const mismatches: HydrationMismatchError[] = [];
    const handle = await hydrate(target, CounterView as unknown as AnyComponent, {
      onMismatch: (error) => mismatches.push(error),
    });

    expect(mismatches).toEqual([]);
    expect(target.querySelector("strong.value")).toBe(serverStrong);
    expect(
      Array.from(target.querySelector("strong.value")?.childNodes ?? []).find(
        (node) => node.nodeType === 3,
      ),
    ).toBe(serverText);

    count[1](5);
    flushSync();
    expect(target.querySelector("strong.value")?.textContent).toBe("5");
    expect(
      Array.from(target.querySelector("strong.value")?.childNodes ?? []).find(
        (node) => node.nodeType === 3,
      ),
    ).toBe(serverText);
    handle.dispose();
  });

  it("не трогает статический текст перед дырой", async () => {
    const value = createSignal("world");
    function PrefixView(): Node {
      const template = templateHoles(
        '<p class="prefix">Hello <!--silent-hole-0--></p>',
      )();
      insert(holeParent(template, 0), () => value[0](), template.holes[0]);
      return template.node;
    }

    const html = await renderServer(PrefixView as unknown as AnyComponent);
    expect(html).toContain("silent-insert");

    const target = host(html);
    const mismatches: HydrationMismatchError[] = [];
    const handle = await hydrate(target, PrefixView as unknown as AnyComponent, {
      onMismatch: (error) => mismatches.push(error),
    });

    expect(mismatches).toEqual([]);
    expect(target.textContent).toBe("Hello world");

    value[1]("there");
    flushSync();
    expect(target.textContent).toBe("Hello there");
    handle.dispose();
  });

  it("переключает текстовую дыру на узел и обратно", async () => {
    const value = createSignal<unknown>("text");
    function SwitchView(): Node {
      const template = templateHoles('<div class="target"><!--silent-hole-0--></div>')();
      insert(holeParent(template, 0), () => value[0](), template.holes[0]);
      return template.node;
    }

    const target = host(await renderServer(SwitchView as unknown as AnyComponent));
    const mismatches: HydrationMismatchError[] = [];
    const handle = await hydrate(target, SwitchView as unknown as AnyComponent, {
      onMismatch: (error) => mismatches.push(error),
    });

    expect(mismatches).toEqual([]);
    expect(target.textContent).toBe("text");

    const span = document.createElement("span");
    span.textContent = "node";
    value[1](span);
    flushSync();
    expect(target.querySelector(".target > span")).toBe(span);
    expect(target.textContent).toBe("node");

    value[1]("again");
    flushSync();
    expect(target.querySelector(".target > span")).toBe(null);
    expect(target.textContent).toBe("again");
    handle.dispose();
  });

  it("адоптирует старую разметку с регионом вокруг текста", async () => {
    count[1](0);
    function PlainCounter(): Node {
      const template = templateHoles(
        '<div class="counter"><strong class="value"><!--silent-hole-0--></strong></div>',
      )();
      insert(holeParent(template, 0), () => count[0](), template.holes[0]);
      return template.node;
    }

    const target = host(
      '<div class="counter"><strong class="value"><!--silent-insert-->0<!--silent-insert-end--><!--silent-hole-0--></strong></div>',
    );
    const serverStrong = target.querySelector("strong.value");
    const serverText = Array.from(serverStrong?.childNodes ?? []).find(
      (node) => node.nodeType === 3,
    );
    const mismatches: HydrationMismatchError[] = [];
    const handle = await hydrate(target, PlainCounter as unknown as AnyComponent, {
      onMismatch: (error) => mismatches.push(error),
    });

    expect(mismatches).toEqual([]);
    expect(target.querySelector("strong.value")).toBe(serverStrong);
    expect(
      Array.from(target.querySelector("strong.value")?.childNodes ?? []).find(
        (node) => node.nodeType === 3,
      ),
    ).toBe(serverText);

    count[1](7);
    flushSync();
    expect(target.querySelector("strong.value")?.textContent).toBe("7");
    handle.dispose();
  });

  it("адоптирует bare-текст перед дырой по плану", async () => {
    const value = createSignal("start");
    class BareVM {}
    function BareView(this: { vm: BareVM }): Node {
      void this.vm;
      const template = templateHoles(
        '<p class="bare"><!--silent-hole-0--><i>tail</i></p>',
        {
          roots: 1,
          holes: [{ path: [0, 0], counts: [1, 2] }],
          attrs: [],
          strips: [],
        },
      )();
      insert(holeParent(template, 0), () => value[0](), template.holes[0]);
      return template.node;
    }
    attachMeta(BareView, BareVM);

    const html = await renderServer(BareView as unknown as AnyComponent);
    expect(html).toContain("start<!--silent-hole-0--><i>tail</i>");
    const target = host(html);
    const serverParagraph = target.querySelector("p.bare");
    const serverTail = target.querySelector("p.bare > i");
    const serverText = Array.from(serverParagraph?.childNodes ?? []).find(
      (node) => node.nodeType === 3,
    );
    const mismatches: HydrationMismatchError[] = [];
    const handle = await hydrate(target, BareView as unknown as AnyComponent, {
      onMismatch: (error) => mismatches.push(error),
    });

    expect(mismatches).toEqual([]);
    expect(target.querySelector("p.bare")).toBe(serverParagraph);
    expect(target.querySelector("p.bare > i")).toBe(serverTail);
    expect(
      Array.from(target.querySelector("p.bare")?.childNodes ?? []).find(
        (node) => node.nodeType === 3,
      ),
    ).toBe(serverText);

    value[1]("next");
    flushSync();
    expect(target.textContent).toBe("nexttail");
    expect(
      Array.from(target.querySelector("p.bare")?.childNodes ?? []).find(
        (node) => node.nodeType === 3,
      ),
    ).toBe(serverText);
    handle.dispose();
  });

  it("откатывается на обход при разъехавшихся путях bare-дыр", async () => {
    const left = createSignal("x");
    const right = createSignal("y");
    class PairVM {}
    function PairView(this: { vm: PairVM }): Node {
      void this.vm;
      const template = templateHoles(
        '<div class="pair"><!--silent-hole-0--><!--silent-hole-1--><i>a</i><i>b</i><i>c</i></div>',
        {
          roots: 1,
          holes: [
            { path: [0, 0], counts: [1, 5] },
            { path: [0, 1], counts: [1, 5] },
          ],
          attrs: [],
          strips: [],
        },
      )();
      insert(holeParent(template, 0), () => left[0](), template.holes[0]);
      insert(holeParent(template, 1), () => right[0](), template.holes[1]);
      return template.node;
    }
    attachMeta(PairView, PairVM);

    const html = await renderServer(PairView as unknown as AnyComponent);
    expect(html).toContain("x<!--silent-hole-0-->y<!--silent-hole-1--><i>a</i>");
    const target = host(html);
    const serverPair = target.querySelector("div.pair");
    const serverTexts = Array.from(serverPair?.childNodes ?? []).filter(
      (node) => node.nodeType === 3,
    );
    const mismatches: HydrationMismatchError[] = [];
    const handle = await hydrate(target, PairView as unknown as AnyComponent, {
      onMismatch: (error) => mismatches.push(error),
    });

    expect(mismatches).toEqual([]);
    expect(target.querySelector("div.pair")).toBe(serverPair);
    expect(
      Array.from(target.querySelector("div.pair")?.childNodes ?? []).filter(
        (node) => node.nodeType === 3,
      ),
    ).toEqual(serverTexts);
    expect(target.textContent).toBe("xyabc");

    left[1]("z");
    flushSync();
    expect(target.textContent).toBe("zyabc");
    handle.dispose();
  });

  it("откатывается на обход при attr после bare-дыры", async () => {
    const value = createSignal("v");
    class ShiftVM {}
    function ShiftView(this: { vm: ShiftVM }): Node {
      void this.vm;
      const template = templateHoles(
        '<div class="wrap"><!--silent-hole-0--><span data-silent-a-0="" class="s">x</span><i></i><i></i></div>',
        {
          roots: 1,
          holes: [{ path: [0, 0], counts: [1, 4] }],
          attrs: [{ path: [0, 1], counts: [1, 4] }],
          strips: [
            { path: [0, 1], counts: [1, 4], names: ["data-silent-a-0"] },
          ],
        },
      )();
      insert(holeParent(template, 0), () => value[0](), template.holes[0]);
      attr(template.attrs[0]!, "title", () => value[0]());
      return template.node;
    }
    attachMeta(ShiftView, ShiftVM);

    const html = await renderServer(ShiftView as unknown as AnyComponent);
    expect(html).toContain('data-silent-a-0=""');
    const target = host(html);
    const serverSpan = target.querySelector("div.wrap > span.s");
    const mismatches: HydrationMismatchError[] = [];
    const handle = await hydrate(target, ShiftView as unknown as AnyComponent, {
      onMismatch: (error) => mismatches.push(error),
    });

    expect(mismatches).toEqual([]);
    expect(target.querySelector("div.wrap > span.s")).toBe(serverSpan);
    expect(target.innerHTML.includes("data-silent-a-")).toBe(false);
    expect(serverSpan?.getAttribute("title")).toBe("v");
    expect(target.textContent).toBe("vx");

    value[1]("next");
    flushSync();
    expect(target.textContent).toBe("nextx");
    expect(serverSpan?.getAttribute("title")).toBe("next");
    handle.dispose();
  });
});
