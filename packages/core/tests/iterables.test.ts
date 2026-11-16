// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { createSignal, flushSync } from "@ivlev-dev/silent-reactivity";
import { collectNodes, insert } from "../src/dom";

function host(): HTMLElement {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return element;
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe("Iterable в детях", () => {
  it("collectNodes разворачивает Set", () => {
    const first = document.createElement("span");
    const second = document.createElement("b");
    const nodes = collectNodes(new Set<Node | string>([first, "text", second]));
    expect(nodes.length).toBe(3);
    expect(nodes[0]).toBe(first);
    expect(nodes[1]?.textContent).toBe("text");
    expect(nodes[2]).toBe(second);
  });

  it("collectNodes разворачивает генератор", () => {
    const element = document.createElement("i");
    function* children(): Generator<Node | string | number, void, unknown> {
      yield "a";
      yield element;
      yield 3;
    }
    const nodes = collectNodes(children());
    expect(nodes.length).toBe(3);
    expect(nodes[0]?.textContent).toBe("a");
    expect(nodes[1]).toBe(element);
    expect(nodes[2]?.textContent).toBe("3");
  });

  it("collectNodes разворачивает NodeList", () => {
    const container = document.createElement("div");
    container.innerHTML = "<p>one</p><p>two</p>";
    const nodes = collectNodes(container.querySelectorAll("p"));
    expect(nodes.length).toBe(2);
    expect(nodes[0]?.textContent).toBe("one");
    expect(nodes[1]?.textContent).toBe("two");
  });

  it("не разворачивает DOM-узел как iterable", () => {
    const element = document.createElement("div");
    const nodes = collectNodes(element);
    expect(nodes.length).toBe(1);
    expect(nodes[0]).toBe(element);
  });

  it("insert обновляет Set и генератор", () => {
    const target = host();
    const [values, setValues] = createSignal(new Set<string>(["a", "b"]));
    insert(target, () => values());
    expect(target.textContent).toBe("ab");

    setValues(new Set<string>(["c"]));
    flushSync();
    expect(target.textContent).toBe("c");

    const [items] = createSignal(["x", "y"]);
    insert(target, () =>
      (function* render(): Generator<string, void, unknown> {
        for (const item of items()) {
          yield item;
        }
      })(),
    );
    expect(target.textContent).toBe("cxy");
  });

  it("вложенные iterable и массивы раскрываются", () => {
    const target = host();
    insert(target, () => new Set<unknown>(["a", ["b", "c"]]));
    expect(target.textContent).toBe("abc");
  });
});
