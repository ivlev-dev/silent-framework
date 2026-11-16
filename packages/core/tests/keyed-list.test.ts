// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { createRoot, createSignal, flushSync, onCleanup } from "@ivlev-dev/silent-reactivity";
import { For } from "../src/control-flow";
import { Keyed, mapKeyed } from "../src/keyed";

interface Item {
  readonly id: string;
  readonly label: string;
}

function item(id: string, label: string = id): Item {
  return { id, label };
}

function row(value: Item): HTMLInputElement {
  const input = document.createElement("input");
  input.dataset.id = value.id;
  input.value = value.label;
  return input;
}

function install(node: Node): HTMLElement {
  const host = document.createElement("div");
  host.appendChild(node);
  document.body.appendChild(host);
  return host;
}

function inputsOf(host: HTMLElement): HTMLInputElement[] {
  return Array.from(host.querySelectorAll("input"));
}

function idsOf(host: HTMLElement): string[] {
  return inputsOf(host).map((element) => element.dataset.id ?? "");
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe("For: keyOf", () => {
  it("матчит новые объекты по ключу и сохраняет DOM и фокус", () => {
    const [items, setItems] = createSignal<readonly Item[]>([
      item("a", "A"),
      item("b", "B"),
      item("c", "C"),
    ]);
    const host = install(
      For<Item>({ each: items, keyOf: (value) => value.id, children: row }),
    );
    const captured = new Map(inputsOf(host).map((element) => [element.dataset.id, element]));
    const focused = captured.get("b")!;
    focused.focus();
    expect(document.activeElement).toBe(focused);

    setItems([item("a", "A"), item("b", "B"), item("c", "C")]);
    flushSync();

    expect(idsOf(host)).toEqual(["a", "b", "c"]);
    expect(inputsOf(host)[1]).toBe(focused);
    expect(document.activeElement).toBe(focused);
  });

  it("переставляет узлы при новых объектах с теми же ключами", () => {
    const [items, setItems] = createSignal<readonly Item[]>([
      item("a"),
      item("b"),
      item("c"),
    ]);
    const host = install(
      For<Item>({ each: items, keyOf: (value) => value.id, children: row }),
    );
    const captured = new Map(inputsOf(host).map((element) => [element.dataset.id, element]));

    setItems([item("c"), item("a"), item("b")]);
    flushSync();

    expect(idsOf(host)).toEqual(["c", "a", "b"]);
    expect(inputsOf(host)[0]).toBe(captured.get("c"));
    expect(inputsOf(host)[1]).toBe(captured.get("a"));
    expect(inputsOf(host)[2]).toBe(captured.get("b"));
  });

  it("обновляет содержимое переиспользованного элемента при изменении данных", () => {
    const [items, setItems] = createSignal<readonly Item[]>([item("a", "A")]);
    const host = install(
      For<Item>({ each: items, keyOf: (value) => value.id, children: row }),
    );
    const before = inputsOf(host)[0]!;

    setItems([item("a", "A2")]);
    flushSync();

    expect(idsOf(host)).toEqual(["a"]);
    expect(inputsOf(host)[0]).not.toBe(before);
    expect(inputsOf(host)[0]!.value).toBe("A2");
  });

  it("работает с экземплярами классов и сохраняет фокус для равных данных", () => {
    class Row {
      constructor(
        readonly id: string,
        readonly label: string,
      ) {}
    }
    const [items, setItems] = createSignal<readonly Row[]>([new Row("a", "A"), new Row("b", "B")]);
    const host = install(
      For<Row>({ each: items, keyOf: (value) => value.id, children: row }),
    );
    const before = inputsOf(host)[1]!;
    before.focus();

    setItems([new Row("a", "A"), new Row("b", "B")]);
    flushSync();

    expect(inputsOf(host)[1]).toBe(before);
    expect(document.activeElement).toBe(before);

    setItems([new Row("a", "A"), new Row("b", "B2")]);
    flushSync();

    expect(inputsOf(host)[1]!.value).toBe("B2");
    expect(inputsOf(host)[1]).not.toBe(before);
  });

  it("корректно обрабатывает дубли ключей", () => {
    const [items, setItems] = createSignal<readonly Item[]>([
      item("dup", "one"),
      item("dup", "two"),
      item("other", "three"),
    ]);
    const host = install(
      For<Item>({ each: items, keyOf: (value) => value.id, children: row }),
    );
    expect(inputsOf(host).map((element) => element.value)).toEqual(["one", "two", "three"]);

    setItems([item("dup", "two"), item("dup", "one"), item("other", "three")]);
    flushSync();

    expect(inputsOf(host).map((element) => element.value)).toEqual(["two", "one", "three"]);
    expect(inputsOf(host).length).toBe(3);
  });

  it("удаляет и добавляет элементы по ключу", () => {
    const [items, setItems] = createSignal<readonly Item[]>([
      item("a"),
      item("b"),
      item("c"),
    ]);
    const host = install(
      For<Item>({ each: items, keyOf: (value) => value.id, children: row }),
    );
    const captured = new Map(inputsOf(host).map((element) => [element.dataset.id, element]));

    setItems([item("a"), item("d"), item("c")]);
    flushSync();

    expect(idsOf(host)).toEqual(["a", "d", "c"]);
    expect(inputsOf(host)[0]).toBe(captured.get("a"));
    expect(inputsOf(host)[2]).toBe(captured.get("c"));
    expect(captured.get("b")?.parentNode).toBeNull();
  });

  it("падает обратно на identity, когда ключ undefined", () => {
    const a = item("a");
    const b = item("b");
    const [items, setItems] = createSignal<readonly Item[]>([a, b]);
    const host = install(
      For<Item>({ each: items, keyOf: () => undefined, children: row }),
    );
    const captured = inputsOf(host).slice();

    setItems([b, a]);
    flushSync();
    expect(idsOf(host)).toEqual(["b", "a"]);
    expect(inputsOf(host)[0]).toBe(captured[1]);
    expect(inputsOf(host)[1]).toBe(captured[0]);

    setItems([item("a"), item("b")]);
    flushSync();
    expect(idsOf(host)).toEqual(["a", "b"]);
    expect(inputsOf(host)[0]).not.toBe(captured[0]);
  });

  it("сохраняет identity-режим по умолчанию", () => {
    const a = item("a", "A");
    const [items, setItems] = createSignal<readonly Item[]>([a]);
    const host = install(For<Item>({ each: items, children: row }));
    const before = inputsOf(host)[0]!;

    setItems([item("a", "A")]);
    flushSync();

    expect(inputsOf(host)[0]).not.toBe(before);
  });

  it("очищает элементы при dispose владельца", () => {
    const disposed: string[] = [];
    const [items] = createSignal<readonly Item[]>([item("a"), item("b")]);
    let stop: () => void = () => {};
    createRoot((dispose) => {
      stop = dispose;
      install(
        For<Item>({
          each: items,
          keyOf: (value) => value.id,
          children: (value) => {
            onCleanup(() => disposed.push(value.id));
            return row(value);
          },
        }),
      );
    });
    stop();
    expect(disposed.sort()).toEqual(["a", "b"]);
  });
});

describe("mapKeyed и Keyed", () => {
  it("mapKeyed использует ключи и сохраняет узлы", () => {
    const [items, setItems] = createSignal<readonly Item[]>([item("a"), item("b")]);
    const host = install(mapKeyed(items, (value) => value.id, row));
    const captured = new Map(inputsOf(host).map((element) => [element.dataset.id, element]));

    setItems([item("b"), item("a")]);
    flushSync();

    expect(idsOf(host)).toEqual(["b", "a"]);
    expect(inputsOf(host)[0]).toBe(captured.get("b"));
    expect(inputsOf(host)[1]).toBe(captured.get("a"));
  });

  it("mapKeyed принимает значение списка без сигнала и индекс", () => {
    const seen: number[] = [];
    const host = install(
      mapKeyed<Item>(
        [item("a"), item("b")],
        (value) => value.id,
        (value, index) => {
          seen.push(index());
          return row(value);
        },
      ),
    );
    expect(idsOf(host)).toEqual(["a", "b"]);
    expect(seen).toEqual([0, 1]);
  });

  it("Keyed работает как компонент", () => {
    const [items, setItems] = createSignal<readonly Item[]>([item("a"), item("b")]);
    const host = install(
      Keyed<Item>({ each: items, keyOf: (value) => value.id, children: row }),
    );
    const captured = new Map(inputsOf(host).map((element) => [element.dataset.id, element]));

    setItems([item("b"), item("a")]);
    flushSync();

    expect(idsOf(host)).toEqual(["b", "a"]);
    expect(inputsOf(host)[0]).toBe(captured.get("b"));
  });
});
