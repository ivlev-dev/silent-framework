// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { createRoot, createSignal, flushSync, onCleanup } from "@ivlev98/silent-reactivity";
import { For, Show } from "../src/control-flow";
import { disposeTree, insert, text } from "../src/dom";

interface Item {
  id: string;
}

function item(id: string): Item {
  return { id };
}

function row(itemValue: Item): HTMLElement {
  const span = document.createElement("span");
  span.dataset.id = itemValue.id;
  span.textContent = itemValue.id;
  return span;
}

function idsOf(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll("[data-id]")).map((element) => element.dataset.id ?? "");
}

function install(node: Node): HTMLElement {
  const host = document.createElement("div");
  host.appendChild(node);
  document.body.appendChild(host);
  return host;
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe("For", () => {
  it("рендерит начальный список", () => {
    const [items] = createSignal<Item[]>([item("a"), item("b"), item("c")]);
    const container = For({ each: items, children: row });
    const host = install(container);
    expect(idsOf(host)).toEqual(["a", "b", "c"]);
  });

  it("принимает each как массив-значение", () => {
    const container = For({ each: [item("x"), item("y")], children: row });
    const host = install(container);
    expect(idsOf(host)).toEqual(["x", "y"]);
  });

  it("добавляет элементы в конец и сохраняет узлы", () => {
    const a = item("a");
    const b = item("b");
    const c = item("c");
    const [items, setItems] = createSignal<Item[]>([a, b]);
    const container = For({ each: items, children: row });
    const host = install(container);
    const before = new Map(
      Array.from(host.querySelectorAll("span")).map((span) => [span.dataset.id, span]),
    );
    setItems([a, b, c]);
    flushSync();
    expect(idsOf(host)).toEqual(["a", "b", "c"]);
    expect(host.querySelectorAll("span")[0]).toBe(before.get("a"));
    expect(host.querySelectorAll("span")[1]).toBe(before.get("b"));
  });

  it("keyed-реконсиляция перестановок сохраняет идентичность узлов", () => {
    const a = item("a");
    const b = item("b");
    const c = item("c");
    const [items, setItems] = createSignal<Item[]>([a, b, c]);
    const container = For({ each: items, children: row });
    const host = install(container);
    const captured = new Map(
      Array.from(host.querySelectorAll("span")).map((span) => [span.dataset.id, span]),
    );
    setItems([c, a, b]);
    flushSync();
    expect(idsOf(host)).toEqual(["c", "a", "b"]);
    expect(host.querySelectorAll("span")[0]).toBe(captured.get("c"));
    expect(host.querySelectorAll("span")[1]).toBe(captured.get("a"));
    expect(host.querySelectorAll("span")[2]).toBe(captured.get("b"));
    setItems([b, a]);
    flushSync();
    expect(idsOf(host)).toEqual(["b", "a"]);
    expect(host.querySelectorAll("span")[0]).toBe(captured.get("b"));
    expect(host.querySelectorAll("span")[1]).toBe(captured.get("a"));
    expect(captured.get("c")?.parentNode).toBeNull();
  });

  it("вставляет элемент в середину после монтирования", () => {
    const a = item("a");
    const b = item("b");
    const c = item("c");
    const x = item("x");
    const [items, setItems] = createSignal<Item[]>([a, b, c]);
    const container = For({ each: items, children: row });
    const host = install(container);
    const captured = new Map(
      Array.from(host.querySelectorAll("span")).map((span) => [span.dataset.id, span]),
    );
    setItems([a, x, b, c]);
    flushSync();
    expect(idsOf(host)).toEqual(["a", "x", "b", "c"]);
    expect(host.querySelectorAll("span")[0]).toBe(captured.get("a"));
    expect(host.querySelectorAll("span")[2]).toBe(captured.get("b"));
    expect(host.querySelectorAll("span")[3]).toBe(captured.get("c"));
  });

  it("вставка в середину вместе с перестановкой сохраняет узлы", () => {
    const a = item("a");
    const b = item("b");
    const c = item("c");
    const x = item("x");
    const [items, setItems] = createSignal<Item[]>([a, b, c]);
    const container = For({ each: items, children: row });
    const host = install(container);
    const captured = new Map(
      Array.from(host.querySelectorAll("span")).map((span) => [span.dataset.id, span]),
    );
    setItems([x, c, a]);
    flushSync();
    expect(idsOf(host)).toEqual(["x", "c", "a"]);
    expect(host.querySelectorAll("span")[1]).toBe(captured.get("c"));
    expect(host.querySelectorAll("span")[2]).toBe(captured.get("a"));
    expect(captured.get("b")?.parentNode).toBeNull();
  });

  it("не перемещает узлы без изменения порядка", () => {
    const a = item("a");
    const b = item("b");
    const [items, setItems] = createSignal<Item[]>([a, b]);
    const container = For({ each: items, children: row });
    const host = install(container);
    const original = Node.prototype.insertBefore;
    let moves = 0;
    Node.prototype.insertBefore = function (this: Node, node: Node, child: Node | null): Node {
      moves += 1;
      return original.call(this, node, child);
    };
    try {
      setItems([a, b]);
      flushSync();
    } finally {
      Node.prototype.insertBefore = original;
    }
    expect(moves).toBe(0);
    expect(idsOf(host)).toEqual(["a", "b"]);
  });

  it("сохраняет состояния для повторяющихся элементов", () => {
    const a = item("a");
    const [items, setItems] = createSignal<Item[]>([a, a]);
    const container = For({ each: items, children: row });
    const host = install(container);
    const captured = Array.from(host.querySelectorAll("span"));
    expect(captured.length).toBe(2);
    expect(captured[0]).not.toBe(captured[1]);
    setItems([a]);
    flushSync();
    expect(idsOf(host)).toEqual(["a"]);
    expect(host.querySelector("span")).toBe(captured[0]);
  });

  it("dispose владельца очищает элементы", () => {
    const disposed: string[] = [];
    const [items] = createSignal<Item[]>([item("a"), item("b")]);
    let stop: () => void = () => {};
    createRoot((dispose) => {
      stop = dispose;
      install(
        For({
          each: items,
          children: (entry) => {
            onCleanup(() => disposed.push(entry.id));
            return row(entry);
          },
        }),
      );
    });
    expect(disposed).toEqual([]);
    stop();
    expect(disposed.sort()).toEqual(["a", "b"]);
  });

  it("перестановка с переносом концов сохраняет узлы", () => {
    const a = item("a");
    const b = item("b");
    const c = item("c");
    const d = item("d");
    const [items, setItems] = createSignal<Item[]>([a, b, c, d]);
    const container = For({ each: items, children: row });
    const host = install(container);
    const captured = new Map(
      Array.from(host.querySelectorAll("span")).map((span) => [span.dataset.id, span]),
    );
    setItems([d, b, c, a]);
    flushSync();
    expect(idsOf(host)).toEqual(["d", "b", "c", "a"]);
    expect(host.querySelectorAll("span")[0]).toBe(captured.get("d"));
    expect(host.querySelectorAll("span")[1]).toBe(captured.get("b"));
    expect(host.querySelectorAll("span")[2]).toBe(captured.get("c"));
    expect(host.querySelectorAll("span")[3]).toBe(captured.get("a"));
    setItems([b, c, a, d]);
    flushSync();
    expect(idsOf(host)).toEqual(["b", "c", "a", "d"]);
    expect(host.querySelectorAll("span")[0]).toBe(captured.get("b"));
    expect(host.querySelectorAll("span")[3]).toBe(captured.get("d"));
  });

  it("dispose удалённых элементов", () => {
    const disposed: string[] = [];
    const a = item("a");
    const b = item("b");
    const c = item("c");
    const [items, setItems] = createSignal<Item[]>([a, b, c]);
    const container = For({
      each: items,
      children: (entry) => {
        onCleanup(() => disposed.push(entry.id));
        return row(entry);
      },
    });
    install(container);
    setItems([a, c]);
    flushSync();
    expect(disposed).toEqual(["b"]);
    setItems([]);
    flushSync();
    expect(disposed).toEqual(["b", "a", "c"]);
  });

  it("реактивный индекс после перестановки", () => {
    const [items, setItems] = createSignal<Item[]>([item("a"), item("b"), item("c")]);
    const container = For({
      each: items,
      children: (entry, index) => {
        const span = document.createElement("span");
        span.dataset.id = entry.id;
        const node = document.createTextNode("");
        span.appendChild(node);
        text(node, () => entry.id + String(index()));
        return span;
      },
    });
    const host = install(container);
    expect(idsOf(host)).toEqual(["a", "b", "c"]);
    setItems([item("c"), item("a"), item("b")]);
    flushSync();
    expect(host.textContent).toBe("c0a1b2");
  });

  it("fallback появляется и исчезает", () => {
    const [items, setItems] = createSignal<Item[]>([]);
    const container = For({ each: items, children: row, fallback: "empty" });
    const host = install(container);
    expect(host.textContent).toBe("empty");
    setItems([item("a")]);
    flushSync();
    expect(idsOf(host)).toEqual(["a"]);
    expect(host.textContent).not.toBe("empty");
    setItems([]);
    flushSync();
    expect(idsOf(host)).toEqual([]);
    expect(host.textContent).toBe("empty");
  });

  it("реактивный fallback обновляется", () => {
    const [items, setItems] = createSignal<Item[]>([]);
    const [name, setName] = createSignal("gone");
    const container = For({ each: items, children: row, fallback: () => `no: ${name()}` });
    const host = install(container);
    expect(host.textContent).toBe("no: gone");
    setName("vacant");
    flushSync();
    expect(host.textContent).toBe("no: vacant");
    setItems([item("z")]);
    flushSync();
    expect(host.textContent).toBe("z");
  });

  it("dispose содержимого при замене через insert", () => {
    const disposed: string[] = [];
    const build = (list: Item[]): Node =>
      For({
        each: list,
        children: (entry) => {
          onCleanup(() => disposed.push(entry.id));
          return row(entry);
        },
      });
    const [variant, setVariant] = createSignal<Node>(build([item("a")]));
    const host = document.createElement("div");
    document.body.appendChild(host);
    insert(host, variant);
    setVariant(build([item("b")]));
    flushSync();
    expect(idsOf(host)).toEqual(["b"]);
    expect(disposed).toEqual(["a"]);
    disposeTree(Array.from(host.childNodes));
    expect(disposed.sort()).toEqual(["a", "b"]);
    expect(host.querySelector("[data-id]")).toBeNull();
  });
});

describe("Show", () => {
  it("переключает ветки с dispose", () => {
    const [visible, setVisible] = createSignal(true);
    const container = Show({
      when: visible,
      children: () => document.createElement("b"),
      fallback: () => document.createElement("em"),
    });
    const host = install(container);
    expect(host.querySelector("b")).not.toBeNull();
    setVisible(false);
    flushSync();
    expect(host.querySelector("b")).toBeNull();
    expect(host.querySelector("em")).not.toBeNull();
    setVisible(true);
    flushSync();
    expect(host.querySelector("b")).not.toBeNull();
    expect(host.querySelector("em")).toBeNull();
  });

  it("поддерживает значение когда вместо accessor", () => {
    const container = Show({ when: 1, children: "positive", fallback: "negative" });
    const host = install(container);
    expect(host.textContent).toBe("positive");
    const other = Show({ when: 0, children: "positive", fallback: "negative" });
    const host2 = install(other);
    expect(host2.textContent).toBe("negative");
    expect(install(Show({ when: "", children: "on", fallback: "off" })).textContent).toBe("off");
    expect(install(Show({ when: null, children: "on", fallback: "off" })).textContent).toBe("off");
    expect(install(Show({ when: "x", children: "on", fallback: "off" })).textContent).toBe("on");
    expect(install(Show({ when: false, children: "on", fallback: "off" })).textContent).toBe("off");
  });

  it("без fallback пустой контейнер", () => {
    const container = Show({ when: false, children: "shown" });
    const host = install(container);
    expect(host.textContent).toBe("");
    expect(install(Show({ when: true, children: "shown" })).textContent).toBe("shown");
  });

  it("children как сырой узел", () => {
    const node = document.createTextNode("raw");
    const container = Show({ when: true, children: node });
    const host = install(container);
    expect(host.textContent).toBe("raw");
  });

  it("реактивное содержимое ветки", () => {
    const [count, setCount] = createSignal(0);
    const container = Show({ when: true, children: () => `n=${count()}` });
    const host = install(container);
    expect(host.textContent).toBe("n=0");
    setCount(5);
    flushSync();
    expect(host.textContent).toBe("n=5");
  });

  it("количество узлов после ветвления аккуратное", () => {
    const [visible, setVisible] = createSignal(false);
    const container = Show({ when: visible, children: "shown", fallback: "gone" });
    const host = install(container);
    expect(host.textContent).toBe("gone");
    setVisible(true);
    flushSync();
    expect(host.textContent).toBe("shown");
    setVisible(false);
    flushSync();
    expect(host.textContent).toBe("gone");
    expect(host.childNodes.length).toBe(2);
  });

  it("children-функция без fallback приFalsy", () => {
    const [visible, setVisible] = createSignal(false);
    const container = Show({ when: visible, children: () => "visible" });
    const host = install(container);
    setVisible(true);
    flushSync();
    expect(host.textContent).toBe("visible");
    setVisible(false);
    flushSync();
    expect(host.textContent).toBe("");
  });
});
