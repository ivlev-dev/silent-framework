// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { createRoot, createSignal, flushSync } from "@ivlev-dev/silent-reactivity";
import {
  createComponent,
  whenIdle,
} from "../src/component";
import type { AnyComponent } from "../src/types";
import { For, Show } from "../src/control-flow";
import { insert, setServerMode, templateHoles, type TemplateClone } from "../src/dom";
import { ErrorBoundary } from "../src/error-boundary";
import { hydrate } from "../src/hydrate";
import { HydrationMismatchError } from "../src/hydration";
import type { MountHandle } from "../src/mount";
import { Match, Switch } from "../src/switch";
import { Suspense, lazy } from "../src/suspense";
import type { ComponentResult } from "../src/component";

const VIEW = Symbol.for("silent.view");
const hosts: HTMLElement[] = [];
const handles: MountHandle[] = [];

function host(markup = ""): HTMLElement {
  const element = document.createElement("div");
  element.innerHTML = markup;
  document.body.appendChild(element);
  hosts.push(element);
  return element;
}

function holeParent(template: TemplateClone, index: number): Node {
  const hole = template.holes[index];
  return (hole?.parentNode as Node | undefined) ?? template.node;
}

function attachMeta(component: unknown, vm: unknown): void {
  (component as Record<PropertyKey, unknown>)[VIEW] = { vm, name: "Test" };
}

function build(app: AnyComponent): ComponentResult {
  let result: ComponentResult | null = null;
  createRoot(() => {
    result = createComponent(app, {});
    return null;
  });
  if (result === null) {
    throw new Error("component was not created");
  }
  return result;
}

async function renderServer(app: AnyComponent): Promise<string> {
  setServerMode(true);
  try {
    const result = build(app);
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

async function adopt(
  target: HTMLElement,
  app: AnyComponent,
): Promise<HydrationMismatchError[]> {
  const mismatches: HydrationMismatchError[] = [];
  const handle = await hydrate(target, app, {
    onMismatch: (error) => mismatches.push(error),
  });
  handles.push(handle);
  return mismatches;
}

afterEach(() => {
  for (const handle of handles.splice(0)) {
    handle.dispose();
  }
  for (const element of hosts.splice(0)) {
    element.remove();
  }
  document.body.replaceChildren();
});

describe("гидрация регионов с корнем управляющей конструкции", () => {
  it("адоптирует View с корнем Show", async () => {
    const visible = createSignal(true);
    class ShowVM {}
    function ShowView(this: { vm: ShowVM }): Node {
      void this.vm;
      return Show({
        when: visible[0],
        children: () => templateHoles("<p>on</p>")().node,
        fallback: () => templateHoles("<p>off</p>")().node,
      });
    }
    attachMeta(ShowView, ShowVM);

    const html = await renderServer(ShowView as unknown as AnyComponent);
    expect(html).toContain("silent-show");

    const target = host(html);
    const serverParagraph = target.querySelector("p");
    const mismatches = await adopt(target, ShowView as unknown as AnyComponent);

    expect(mismatches).toEqual([]);
    expect(target.querySelector("p")).toBe(serverParagraph);
    expect(target.textContent).toBe("on");

    visible[1](false);
    flushSync();
    expect(target.textContent).toBe("off");
    expect(target.querySelectorAll("p").length).toBe(1);
  });

  it("адоптирует View с корнем For", async () => {
    const items = createSignal([{ id: "a" }, { id: "b" }]);
    class ForVM {}
    function ForView(this: { vm: ForVM }): Node {
      void this.vm;
      return For({
        each: items[0],
        children: (item: { id: string }) => templateHoles(`<li>${item.id}</li>`)().node,
      });
    }
    attachMeta(ForView, ForVM);

    const target = host(await renderServer(ForView as unknown as AnyComponent));
    const serverRows = Array.from(target.querySelectorAll("li"));
    expect(serverRows.length).toBe(2);

    const mismatches = await adopt(target, ForView as unknown as AnyComponent);

    expect(mismatches).toEqual([]);
    expect(Array.from(target.querySelectorAll("li"))).toEqual(serverRows);
    expect(target.textContent).toBe("ab");

    items[1]([...items[0](), { id: "c" }]);
    flushSync();
    expect(target.querySelectorAll("li").length).toBe(3);
    expect(target.textContent).toBe("abc");
  });

  it("адоптирует View с корнем For и текстовыми элементами", async () => {
    const items = createSignal([{ name: "a" }, { name: "b" }]);
    class TextForVM {}
    function TextForView(this: { vm: TextForVM }): Node {
      void this.vm;
      return For({
        each: items[0],
        // @ts-expect-error For поддерживает строковые children в рантайме, типы требуют Node.
        children: (item: { name: string }) => item.name,
      });
    }
    attachMeta(TextForView, TextForVM);

    const html = await renderServer(TextForView as unknown as AnyComponent);
    expect(html).toContain("silent-item");

    const target = host(html);
    const mismatches = await adopt(target, TextForView as unknown as AnyComponent);

    expect(mismatches).toEqual([]);
    expect(target.textContent).toBe("ab");

    items[1]([...items[0](), { name: "c" }]);
    flushSync();
    expect(target.textContent).toBe("abc");
  });

  it("адоптирует View с корнем Switch", async () => {
    const [value, setValue] = createSignal(2);
    class SwitchVM {}
    function SwitchView(this: { vm: SwitchVM }): Node {
      void this.vm;
      return Switch({
        fallback: () => templateHoles("<p>none</p>")().node,
        children: () => [
          Match({
            when: () => value() > 1,
            children: () => templateHoles("<p>first</p>")().node,
          }),
          Match({
            when: () => value() > 0,
            children: () => templateHoles("<p>second</p>")().node,
          }),
        ],
      });
    }
    attachMeta(SwitchView, SwitchVM);

    const target = host(await renderServer(SwitchView as unknown as AnyComponent));
    const serverParagraph = target.querySelector("p");

    const mismatches = await adopt(target, SwitchView as unknown as AnyComponent);

    expect(mismatches).toEqual([]);
    expect(target.querySelector("p")).toBe(serverParagraph);
    expect(target.textContent).toBe("first");

    setValue(1);
    flushSync();
    expect(target.textContent).toBe("second");

    setValue(0);
    flushSync();
    expect(target.textContent).toBe("none");

    setValue(4);
    flushSync();
    expect(target.textContent).toBe("first");
  });

  it("адоптирует View с корнем Suspense", async () => {
    class SuspenseVM {}
    function SuspenseView(this: { vm: SuspenseVM }): Node {
      void this.vm;
      return Suspense({
        fallback: () => templateHoles("<p>loading</p>")().node,
        children: () => templateHoles("<p>done</p>")().node,
      });
    }
    attachMeta(SuspenseView, SuspenseVM);

    const target = host(await renderServer(SuspenseView as unknown as AnyComponent));
    const serverParagraph = target.querySelector("p");

    const mismatches = await adopt(target, SuspenseView as unknown as AnyComponent);

    expect(mismatches).toEqual([]);
    expect(target.querySelector("p")).toBe(serverParagraph);
    expect(target.textContent).toBe("done");
  });

  it("адоптирует View с корнем ErrorBoundary", async () => {
    class BoundaryVM {}
    function BoundaryView(this: { vm: BoundaryVM }): Node {
      void this.vm;
      return ErrorBoundary({
        fallback: () => templateHoles("<p>error</p>")().node,
        children: () => templateHoles("<p>ok</p>")().node,
      });
    }
    attachMeta(BoundaryView, BoundaryVM);

    const target = host(await renderServer(BoundaryView as unknown as AnyComponent));
    const serverParagraph = target.querySelector("p");

    const mismatches = await adopt(target, BoundaryView as unknown as AnyComponent);

    expect(mismatches).toEqual([]);
    expect(target.querySelector("p")).toBe(serverParagraph);
    expect(target.textContent).toBe("ok");
  });

  it("адоптирует корневой lazy после загрузки модуля", async () => {
    const loader = lazy(async () => ({
      default: (() =>
        templateHoles("<p>lazy</p>")().node) as unknown as AnyComponent,
    }));
    class LazyVM {}
    function LazyView(this: { vm: LazyVM }): Node {
      void this.vm;
      return loader({});
    }
    attachMeta(LazyView, LazyVM);

    const target = host(await renderServer(LazyView as unknown as AnyComponent));
    const serverParagraph = target.querySelector("p");

    const mismatches = await adopt(target, LazyView as unknown as AnyComponent);

    expect(mismatches).toEqual([]);
    expect(target.querySelector("p")).toBe(serverParagraph);
    expect(target.textContent).toBe("lazy");
  });
});

describe("вложенные регионы", () => {
  it("адоптирует Show с For и компонентом внутри", async () => {
    const items = createSignal([{ name: "a" }, { name: "b" }]);
    class RowVM {}
    function RowView(this: { vm: RowVM }, props: { item: { name: string } }): Node {
      void this.vm;
      const template = templateHoles("<li><!--silent-hole-0--></li>")();
      insert(holeParent(template, 0), () => props.item.name, template.holes[0]);
      return template.node;
    }
    attachMeta(RowView, RowVM);

    class ComboVM {}
    function ComboView(this: { vm: ComboVM }): Node {
      void this.vm;
      return Show({
        when: true,
        children: () =>
          For({
            each: items[0],
            children: (item: { name: string }) =>
              createComponent(RowView as unknown as AnyComponent, { item }).node,
          }),
      });
    }
    attachMeta(ComboView, ComboVM);

    const html = await renderServer(ComboView as unknown as AnyComponent);
    const target = host(html);
    const serverRows = Array.from(target.querySelectorAll("li"));
    expect(serverRows.length).toBe(2);

    const mismatches = await adopt(target, ComboView as unknown as AnyComponent);

    expect(mismatches).toEqual([]);
    expect(Array.from(target.querySelectorAll("li"))).toEqual(serverRows);
    expect(target.textContent).toBe("ab");

    items[1]([...items[0](), { name: "c" }]);
    flushSync();
    await whenIdle();
    flushSync();
    expect(target.querySelectorAll("li").length).toBe(3);
    expect(target.textContent).toBe("abc");
    expect(target.querySelectorAll("li")[0]).toBe(serverRows[0]);
  });

  it("адоптирует текстовые ветки Show и Switch", async () => {
    class TextShowVM {}
    function TextShowView(this: { vm: TextShowVM }): Node {
      void this.vm;
      return Show({ when: true, children: () => "hello" });
    }
    attachMeta(TextShowView, TextShowVM);

    const showTarget = host(
      await renderServer(TextShowView as unknown as AnyComponent),
    );
    const showMismatches = await adopt(
      showTarget,
      TextShowView as unknown as AnyComponent,
    );
    expect(showMismatches).toEqual([]);
    expect(showTarget.textContent).toBe("hello");

    class TextSwitchVM {}
    function TextSwitchView(this: { vm: TextSwitchVM }): Node {
      void this.vm;
      return Switch({
        children: () => Match({ when: true, children: () => "value" }),
      });
    }
    attachMeta(TextSwitchView, TextSwitchVM);

    const switchTarget = host(
      await renderServer(TextSwitchView as unknown as AnyComponent),
    );
    const switchMismatches = await adopt(
      switchTarget,
      TextSwitchView as unknown as AnyComponent,
    );
    expect(switchMismatches).toEqual([]);
    expect(switchTarget.textContent).toBe("value");
  });

  it("адоптирует несколько view в одном регионе", async () => {
    class FirstVM {}
    function FirstView(this: { vm: FirstVM }): Node {
      void this.vm;
      return templateHoles("<b>first</b>")().node;
    }
    attachMeta(FirstView, FirstVM);

    class SecondVM {}
    function SecondView(this: { vm: SecondVM }): Node {
      void this.vm;
      return templateHoles("<i>second</i>")().node;
    }
    attachMeta(SecondView, SecondVM);

    class RootVM {}
    function RootView(this: { vm: RootVM }): Node {
      void this.vm;
      return [
        createComponent(FirstView as unknown as AnyComponent, {}).node,
        createComponent(SecondView as unknown as AnyComponent, {}).node,
      ] as unknown as Node;
    }
    attachMeta(RootView, RootVM);

    const target = host(await renderServer(RootView as unknown as AnyComponent));
    const serverBold = target.querySelector("b");
    const serverItalic = target.querySelector("i");

    const mismatches = await adopt(target, RootView as unknown as AnyComponent);

    expect(mismatches).toEqual([]);
    expect(target.querySelector("b")).toBe(serverBold);
    expect(target.querySelector("i")).toBe(serverItalic);
    expect(target.textContent).toBe("firstsecond");
  });

  it("адоптирует For с компонентом и текстовыми элементами", async () => {
    const items = createSignal([{ name: "a" }, { name: "b" }]);
    class ItemVM {}
    function ItemView(this: { vm: ItemVM }, props: { item: { name: string } }): Node {
      void this.vm;
      const template = templateHoles("<span><!--silent-hole-0--></span>")();
      insert(holeParent(template, 0), () => props.item.name, template.holes[0]);
      return template.node;
    }
    attachMeta(ItemView, ItemVM);

    class MixedVM {}
    function MixedView(this: { vm: MixedVM }): Node {
      void this.vm;
      return For({
        each: items[0],
        // @ts-expect-error For поддерживает строковые children в рантайме, типы требуют Node.
        children: (item: { name: string }) =>
          item.name === "b"
            ? createComponent(ItemView as unknown as AnyComponent, { item }).node
            : item.name,
      });
    }
    attachMeta(MixedView, MixedVM);

    const target = host(await renderServer(MixedView as unknown as AnyComponent));
    const serverSpan = target.querySelector("span");

    const mismatches = await adopt(target, MixedView as unknown as AnyComponent);

    expect(mismatches).toEqual([]);
    expect(target.textContent).toBe("ab");
    expect(target.querySelector("span")).toBe(serverSpan);
  });
});

describe("SSR-паритет списков", () => {
  const source = createSignal<readonly string[]>(["a", "b"]);

  class ParityVM {}
  function ParityView(this: { vm: ParityVM }): Node {
    void this.vm;
    return For({
      each: source[0] as unknown as string[],
      // @ts-expect-error For поддерживает строковые children в рантайме, типы требуют Node.
      children: (item: string) => item,
    });
  }
  attachMeta(ParityView, ParityVM);

  it("Set и генератор дают ту же разметку, что и массив", async () => {
    source[1](["a", "b"]);
    const arrayHtml = await renderServer(ParityView as unknown as AnyComponent);

    source[1](new Set(["a", "b"]) as unknown as readonly string[]);
    const setHtml = await renderServer(ParityView as unknown as AnyComponent);
    expect(setHtml).toBe(arrayHtml);

    function* generate(): Generator<string, void, unknown> {
      yield "a";
      yield "b";
    }
    source[1](generate() as unknown as readonly string[]);
    const generatorHtml = await renderServer(ParityView as unknown as AnyComponent);
    expect(generatorHtml).toBe(arrayHtml);
  });

  it("sparse-массив даёт ту же разметку, что и плотный", async () => {
    source[1](["a", "b"]);
    const denseHtml = await renderServer(ParityView as unknown as AnyComponent);

    const sparse: string[] = ["a", "b"];
    sparse.length = 4;
    source[1](sparse);
    const sparseHtml = await renderServer(ParityView as unknown as AnyComponent);
    expect(sparseHtml).toBe(denseHtml);
  });

  it("undefined и null дают пустой список без падения", async () => {
    source[1](["a", "b"]);
    const denseHtml = await renderServer(ParityView as unknown as AnyComponent);

    source[1](undefined as unknown as readonly string[]);
    const undefinedHtml = await renderServer(ParityView as unknown as AnyComponent);
    expect(undefinedHtml).toContain("silent-end");
    expect(undefinedHtml).not.toContain("silent-item");

    source[1](null as unknown as readonly string[]);
    const nullHtml = await renderServer(ParityView as unknown as AnyComponent);
    expect(nullHtml).toBe(undefinedHtml);
    expect(denseHtml).not.toBe(undefinedHtml);
  });

  it("адоптирует список из Set и sparse-массива", async () => {
    source[1](new Set(["a", "b"]) as unknown as readonly string[]);
    const setTarget = host(await renderServer(ParityView as unknown as AnyComponent));
    const setMismatches = await adopt(
      setTarget,
      ParityView as unknown as AnyComponent,
    );
    expect(setMismatches).toEqual([]);
    expect(setTarget.textContent).toBe("ab");

    const sparse: string[] = ["a", "b"];
    sparse.length = 3;
    source[1](sparse);
    const sparseTarget = host(
      await renderServer(ParityView as unknown as AnyComponent),
    );
    const sparseMismatches = await adopt(
      sparseTarget,
      ParityView as unknown as AnyComponent,
    );
    expect(sparseMismatches).toEqual([]);
    expect(sparseTarget.textContent).toBe("ab");
  });
});
