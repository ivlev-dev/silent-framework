// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSignal, flushSync } from "@ivlev-dev/silent-reactivity";
import { For } from "../src/control-flow";
import { Index } from "../src/index-list";
import { disposeNode, templateHoles } from "../src/dom";
import { hydrate } from "../src/hydrate";
import type { AnyComponent } from "../src/types";

const VIEW = Symbol.for("silent.view");

function install(node: Node): HTMLElement {
  const host = document.createElement("div");
  host.appendChild(node);
  document.body.appendChild(host);
  return host;
}

function rows(host: HTMLElement): HTMLElement[] {
  return Array.from(host.querySelectorAll<HTMLElement>("span"));
}

function texts(host: HTMLElement): (string | null)[] {
  return rows(host).map((row) => row.textContent);
}

function textRow(value: string): HTMLElement {
  const span = document.createElement("span");
  span.textContent = value;
  return span;
}

function itemMarkers(host: HTMLElement): Comment[] {
  return Array.from(host.childNodes).filter(
    (node): node is Comment =>
      node.nodeType === Node.COMMENT_NODE && (node as Comment).data === "silent-item",
  );
}

beforeEach(() => {
  document.body.replaceChildren();
});

afterEach(() => {
  document.body.replaceChildren();
});

describe("disposer строк списка", () => {
  it("снимает строку For по первому узлу", () => {
    const host = install(For({ each: ["a", "b"], children: textRow }));
    disposeNode(rows(host)[0]!);
    expect(texts(host)).toEqual(["b"]);
  });

  it("снимает строку Index по первому узлу", () => {
    const host = install(Index({ each: ["a", "b"], children: (item) => textRow(item()) }));
    disposeNode(rows(host)[1]!);
    expect(texts(host)).toEqual(["a"]);
  });

  it("не ломается при повторном dispose строки", () => {
    const host = install(For({ each: ["a", "b"], children: textRow }));
    const first = rows(host)[0]!;
    disposeNode(first);
    disposeNode(first);
    expect(texts(host)).toEqual(["b"]);
  });

  it("снимает строку гидратированного For по маркеру элемента", async () => {
    class VM {}
    function View(): Node {
      return For({
        each: ["a", "b"],
        children: (item: string) => templateHoles(`<span>${item}</span>`)().node,
      });
    }
    (View as unknown as Record<PropertyKey, unknown>)[VIEW] = { vm: VM, name: "Test" };

    const target = document.createElement("div");
    document.body.appendChild(target);
    target.innerHTML =
      "<!--silent-view--><!--silent-item--><span>a</span><!--silent-item--><span>b</span><!--silent-end--><!--silent-view-end-->";

    await hydrate(target, View as unknown as AnyComponent, {
      onMismatch: () => undefined,
    });
    expect(texts(target)).toEqual(["a", "b"]);

    const anchor = itemMarkers(target)[0]!;
    disposeNode(anchor);
    disposeNode(anchor);
    expect(texts(target)).toEqual(["b"]);
  });
});

describe("For: index false", () => {
  it("оставляет нулевой индекс у всех строк", () => {
    const [items, setItems] = createSignal(["a", "b", "c"]);
    const seen: number[] = [];
    const host = install(
      For({
        each: items,
        index: false,
        children: (item: string, index: () => number) => {
          seen.push(index());
          return textRow(item);
        },
      }),
    );
    expect(seen).toEqual([0, 0, 0]);

    setItems(["c", "b", "a"]);
    flushSync();
    expect(texts(host)).toEqual(["c", "b", "a"]);

    setItems(["c", "b", "a", "d", "e"]);
    flushSync();
    expect(texts(host)).toEqual(["c", "b", "a", "d", "e"]);
    expect(seen).toEqual([0, 0, 0, 0, 0]);
  });
});
