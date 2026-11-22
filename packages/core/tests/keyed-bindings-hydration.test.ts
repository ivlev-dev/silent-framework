// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { createRoot, createSignal, flushSync } from "@ivlev-dev/silent-reactivity";
import {
  createComponent,
  whenIdle,
} from "../src/component";
import type { AnyComponent } from "../src/types";
import { For } from "../src/control-flow";
import { bindValue, setServerMode, templateHoles } from "../src/dom";
import { hydrate } from "../src/hydrate";
import { HydrationMismatchError } from "../src/hydration";
import type { MountHandle } from "../src/mount";

const VIEW = Symbol.for("silent.view");
const hosts: HTMLElement[] = [];
const handles: MountHandle[] = [];

interface Item {
  readonly id: string;
  readonly label: string;
}

function host(markup: string): HTMLElement {
  const element = document.createElement("div");
  element.innerHTML = markup;
  document.body.appendChild(element);
  hosts.push(element);
  return element;
}

function attachMeta(component: unknown, vm: unknown): void {
  (component as Record<PropertyKey, unknown>)[VIEW] = { vm, name: "Test" };
}

async function renderServer(app: AnyComponent): Promise<string> {
  setServerMode(true);
  try {
    let node: Node | null = null;
    createRoot(() => {
      node = createComponent(app, {}).node;
      return null;
    });
    await whenIdle();
    flushSync();
    await whenIdle();
    flushSync();
    const container = document.createElement("div");
    container.appendChild(node as unknown as Node);
    return container.innerHTML;
  } finally {
    setServerMode(false);
  }
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

describe("гидрация keyed-списков и bindValue", () => {
  it("адоптирует серверные узлы и сохраняет их при перестановке", async () => {
    const [items, setItems] = createSignal<readonly Item[]>([
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ]);
    class VM {}
    function View(this: { vm: VM }): Node {
      void this.vm;
      return For<Item>({
        each: items,
        keyOf: (item) => item.id,
        children: (item) => {
          const template = templateHoles('<input data-silent-a-0="">')();
          bindValue(template.attrs[0]!, () => item.label);
          return template.node;
        },
      });
    }
    attachMeta(View, VM);

    const html = await renderServer(View as unknown as AnyComponent);

    const target = host(html);
    const serverInputs = Array.from(target.querySelectorAll("input"));
    expect(serverInputs.length).toBe(2);
    serverInputs[1]!.focus();

    const mismatches: HydrationMismatchError[] = [];
    const handle = await hydrate(target, View as unknown as AnyComponent, {
      onMismatch: (error) => mismatches.push(error),
    });
    handles.push(handle);

    expect(mismatches).toEqual([]);
    expect(Array.from(target.querySelectorAll("input"))).toEqual(serverInputs);
    expect(serverInputs[0]!.value).toBe("A");
    expect(serverInputs[1]!.value).toBe("B");

    setItems([
      { id: "b", label: "B" },
      { id: "a", label: "A" },
    ]);
    flushSync();

    const nextInputs = Array.from(target.querySelectorAll("input"));
    expect(nextInputs).toEqual([serverInputs[1], serverInputs[0]]);
    expect(nextInputs[0]!.value).toBe("B");
    expect(nextInputs[1]!.value).toBe("A");
  });

  it("создаёт новые узлы для появившихся ключей после гидрации", async () => {
    const [items, setItems] = createSignal<readonly Item[]>([{ id: "a", label: "A" }]);
    class VM {}
    function View(this: { vm: VM }): Node {
      void this.vm;
      return For<Item>({
        each: items,
        keyOf: (item) => item.id,
        children: (item) => {
          const template = templateHoles('<input data-silent-a-0="">')();
          bindValue(template.attrs[0]!, () => item.label);
          return template.node;
        },
      });
    }
    attachMeta(View, VM);

    const target = host(await renderServer(View as unknown as AnyComponent));
    const handle = await hydrate(target, View as unknown as AnyComponent, {
      onMismatch: () => undefined,
    });
    handles.push(handle);
    const first = target.querySelector("input");

    setItems([
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ]);
    flushSync();

    expect(target.querySelectorAll("input").length).toBe(2);
    expect(target.querySelector("input")).toBe(first);
    expect(target.querySelectorAll("input")[1]!.value).toBe("B");
  });
});
