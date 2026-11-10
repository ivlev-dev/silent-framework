// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import type { Accessor } from "@ivlev-dev/silent-reactivity";
import { createSignal, flushSync } from "@ivlev-dev/silent-reactivity";
import { insert } from "../src/dom";
import { Index } from "../src/index-list";

function install(node: Node): HTMLElement {
  const host = document.createElement("div");
  host.appendChild(node);
  document.body.appendChild(host);
  return host;
}

function row(item: Accessor<string>): HTMLElement {
  const span = document.createElement("span");
  insert(span, () => item());
  return span;
}

function cells(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll("span")).map((span) => span.textContent ?? "");
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe("Index", () => {
  it("рендерит начальный список", () => {
    const [items] = createSignal(["a", "b", "c"]);
    const host = install(Index({ each: items, children: row }));
    expect(cells(host)).toEqual(["a", "b", "c"]);
  });

  it("принимает each как массив-значение", () => {
    const host = install(Index({ each: ["x", "y"], children: row }));
    expect(cells(host)).toEqual(["x", "y"]);
  });

  it("переиспользует узлы по индексам при смене значений", () => {
    const [items, setItems] = createSignal(["a", "b", "c"]);
    const host = install(Index({ each: items, children: row }));
    const before = Array.from(host.querySelectorAll("span"));

    setItems(["x", "y", "z"]);
    flushSync();

    const after = Array.from(host.querySelectorAll("span"));
    expect(cells(host)).toEqual(["x", "y", "z"]);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    expect(after[2]).toBe(before[2]);
  });

  it("не переставляет узлы при изменении порядка значений", () => {
    const [items, setItems] = createSignal(["a", "b"]);
    const host = install(Index({ each: items, children: row }));
    const before = Array.from(host.querySelectorAll("span"));

    setItems(["b", "a"]);
    flushSync();

    const after = Array.from(host.querySelectorAll("span"));
    expect(cells(host)).toEqual(["b", "a"]);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
  });

  it("добавляет элементы в конец, сохраняя существующие узлы", () => {
    const [items, setItems] = createSignal(["a", "b"]);
    const host = install(Index({ each: items, children: row }));
    const before = Array.from(host.querySelectorAll("span"));

    setItems(["a", "b", "c"]);
    flushSync();

    const after = Array.from(host.querySelectorAll("span"));
    expect(cells(host)).toEqual(["a", "b", "c"]);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
  });

  it("удаляет лишние элементы с конца", () => {
    const [items, setItems] = createSignal(["a", "b", "c"]);
    const host = install(Index({ each: items, children: row }));
    const before = Array.from(host.querySelectorAll("span"));

    setItems(["a"]);
    flushSync();

    const after = Array.from(host.querySelectorAll("span"));
    expect(cells(host)).toEqual(["a"]);
    expect(after[0]).toBe(before[0]);
  });

  it("показывает fallback при пустом списке", () => {
    const [items, setItems] = createSignal<string[]>([]);
    const host = install(
      Index({
        each: items,
        children: row,
        fallback: () => {
          const empty = document.createElement("em");
          empty.textContent = "empty";
          return empty;
        },
      }),
    );

    expect(host.querySelector("em")?.textContent).toBe("empty");

    setItems(["a"]);
    flushSync();
    expect(host.querySelector("em")).toBeNull();
    expect(cells(host)).toEqual(["a"]);

    setItems([]);
    flushSync();
    expect(host.querySelector("em")?.textContent).toBe("empty");
  });

  it("передаёт актуальный индекс в children", () => {
    const [items, setItems] = createSignal(["a", "b"]);
    const seen: number[] = [];
    const host = install(
      Index({
        each: items,
        children: (item: Accessor<string>, index: Accessor<number>) => {
          seen.push(index());
          const span = document.createElement("span");
          insert(span, () => `${index()}:${item()}`);
          return span;
        },
      }),
    );
    expect(cells(host)).toEqual(["0:a", "1:b"]);

    setItems(["a", "b", "c"]);
    flushSync();
    expect(cells(host)).toEqual(["0:a", "1:b", "2:c"]);
    expect(seen).toEqual([0, 1, 2]);
  });
});
