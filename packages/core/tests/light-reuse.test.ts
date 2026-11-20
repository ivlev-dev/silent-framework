// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  createRenderEffect,
  createSignal,
  flushSync,
  type Accessor,
} from "@ivlev-dev/silent-reactivity";
import { mount } from "../src/mount.js";
import { insert } from "../src/dom.js";
import { component } from "../src/component-lite.js";
import { Index } from "../src/index-list.js";
import type { AnyComponent } from "../src/types.js";

interface LabelProps {
  readonly text: string;
}

const hosts: HTMLElement[] = [];

function host(): HTMLElement {
  const element = document.createElement("div");
  document.body.appendChild(element);
  hosts.push(element);
  return element;
}

function asComponent(fn: (props: LabelProps) => unknown): AnyComponent {
  return fn as unknown as AnyComponent;
}

function Label(props: LabelProps): HTMLElement {
  const element = document.createElement("span");
  element.textContent = props.text;
  return element;
}

beforeEach(() => {
  for (const element of hosts.splice(0)) {
    element.remove();
  }
  document.body.replaceChildren();
});

describe("переиспользование light-компонента", () => {
  it("обновляет props при повторном вызове из кэша", async () => {
    let update: (value: number) => void = () => undefined;
    function App(): HTMLElement {
      const [value, setValue] = createSignal(0);
      update = setValue;
      const element = document.createElement("div");
      insert(element, () =>
        component(asComponent(Label), { text: String(value()) }),
      );
      return element;
    }

    const target = host();
    await mount(target, asComponent(() => App()));
    expect(target.innerHTML).toBe("<div><span>0</span></div>");

    update(1);
    flushSync();
    expect(target.innerHTML).toBe("<div><span>1</span></div>");

    update(2);
    flushSync();
    expect(target.innerHTML).toBe("<div><span>2</span></div>");
  });

  it("не освобождает живой экземпляр при замене узла", async () => {
    const [suffix, setSuffix] = createSignal("!");
    let update: (value: string) => void = () => undefined;

    function Marker(props: LabelProps): HTMLElement {
      const element = document.createElement("span");
      element.textContent = props.text;
      createRenderEffect(() => {
        element.dataset.suffix = suffix();
      });
      return element;
    }

    function App(): HTMLElement {
      const [value, setValue] = createSignal("a");
      update = setValue;
      const element = document.createElement("div");
      insert(element, () => component(asComponent(Marker), { text: value() }));
      return element;
    }

    const target = host();
    await mount(target, asComponent(() => App()));

    update("b");
    flushSync();
    expect(target.textContent).toBe("b");

    setSuffix("?");
    flushSync();
    const span = target.querySelector("span");
    expect(span?.dataset.suffix).toBe("?");
  });

  it("обновляет light-компоненты unkeyed-списка при смене props", async () => {
    const [items, setItems] = createSignal<readonly string[]>(["a", "b", "c"]);

    const list = Index<string>({
      each: items,
      children: (item: Accessor<string>) => {
        const row = document.createElement("p");
        insert(row, () => component(asComponent(Label), { text: item() }));
        return row;
      },
    });

    const target = host();
    target.appendChild(list);
    const before = Array.from(target.querySelectorAll("p"));
    expect(Array.from(target.querySelectorAll("span")).map((node) => node.textContent)).toEqual([
      "a",
      "b",
      "c",
    ]);

    setItems(["x", "y", "z"]);
    flushSync();

    const after = Array.from(target.querySelectorAll("p"));
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    expect(after[2]).toBe(before[2]);
    expect(Array.from(target.querySelectorAll("span")).map((node) => node.textContent)).toEqual([
      "x",
      "y",
      "z",
    ]);
  });
});
