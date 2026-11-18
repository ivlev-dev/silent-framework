// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createRoot,
  createSignal,
  flushSync,
  onCleanup,
} from "@ivlev-dev/silent-reactivity";
import { For } from "../src/control-flow";
import { Index } from "../src/index-list";
import {
  attachDisposer,
  attachItemDisposer,
  attachItemState,
  clearItemDisposer,
  disposeNode,
  templateHoles,
} from "../src/dom";
import { hydrate } from "../src/hydrate";
import type { AnyComponent } from "../src/types";

const VIEW = Symbol.for("silent.view");

interface Row {
  readonly id: string;
  readonly label: string;
}

function row(id: string, label: string = id): Row {
  return { id, label };
}

function install(node: Node): HTMLElement {
  const host = document.createElement("div");
  host.appendChild(node);
  document.body.appendChild(host);
  return host;
}

function rows(host: ParentNode): HTMLElement[] {
  return Array.from(host.querySelectorAll<HTMLElement>("span.row"));
}

function texts(host: ParentNode): string[] {
  return rows(host).map((element) => element.textContent ?? "");
}

function textRow(value: string): HTMLElement {
  const span = document.createElement("span");
  span.className = "row";
  span.textContent = value;
  return span;
}

function itemMarkers(host: ParentNode): Comment[] {
  return Array.from(host.childNodes).filter(
    (node): node is Comment =>
      node.nodeType === Node.COMMENT_NODE && (node as Comment).data === "silent-item",
  );
}

async function hydrateView(
  View: () => Node,
  markup: string,
): Promise<{ target: HTMLElement; dispose: () => void }> {
  const target = document.createElement("div");
  document.body.appendChild(target);
  target.innerHTML = markup;
  const handle = await hydrate(target, View as unknown as AnyComponent, {
    onMismatch: () => undefined,
  });
  return { target, dispose: () => handle.dispose() };
}

function declareView(View: () => Node, name: string): void {
  class VM {}
  (View as unknown as Record<PropertyKey, unknown>)[VIEW] = { vm: VM, name };
}

beforeEach(() => {
  document.body.replaceChildren();
});

afterEach(() => {
  document.body.replaceChildren();
});

describe("disposeNode: строки For", () => {
  it("снимает строку по первому узлу и не расходится с each", () => {
    const [items, setItems] = createSignal(["a", "b"]);
    const host = install(For({ each: items, children: textRow }));
    expect(texts(host)).toEqual(["a", "b"]);

    disposeNode(rows(host)[0]!);
    expect(texts(host)).toEqual(["b"]);

    setItems(["a", "b", "c"]);
    flushSync();
    expect(texts(host)).toEqual(["a", "b", "c"]);

    setItems(["b"]);
    flushSync();
    expect(texts(host)).toEqual(["b"]);
  });

  it("снимает строку по якорю после перестановки", () => {
    const [items, setItems] = createSignal<Row[]>([row("a"), row("b"), row("c")]);
    const host = install(
      For({ each: items, keyOf: (value) => value.id, children: (value) => textRow(value.id) }),
    );

    setItems([row("c"), row("a"), row("b")]);
    flushSync();
    expect(texts(host)).toEqual(["c", "a", "b"]);
    expect(itemMarkers(host).length).toBe(3);

    disposeNode(itemMarkers(host)[0]!);
    expect(texts(host)).toEqual(["a", "b"]);

    setItems([row("c"), row("a"), row("b")]);
    flushSync();
    expect(texts(host)).toEqual(["c", "a", "b"]);
  });

  it("повторный dispose не вызывает очистку дважды", async () => {
    const cleaned: string[] = [];
    function View(): Node {
      return For({
        each: ["a", "b"],
        children: (value: string) => {
          onCleanup(() => cleaned.push(value));
          return templateHoles(`<span class="row">${value}</span>`)().node;
        },
      });
    }
    declareView(View, "Repeat");
    const { target, dispose } = await hydrateView(
      View,
      "<!--silent-view--><!--silent-item--><span class=\"row\">a</span><!--silent-item--><span class=\"row\">b</span><!--silent-end--><!--silent-view-end-->",
    );
    const anchor = itemMarkers(target)[0]!;
    const first = rows(target)[0]!;
    disposeNode(first);
    disposeNode(first);
    disposeNode(anchor);
    expect(texts(target)).toEqual(["b"]);
    expect(cleaned).toEqual(["a"]);
    dispose();
    expect(cleaned).toEqual(["a", "b"]);
  });

  it("снимает строку-примитив (текстовый узел)", () => {
    const cleaned: string[] = [];
    const [items] = createSignal(["a", "b"]);
    const host = install(
      For({
        each: items,
        children: (value: string) => {
          onCleanup(() => cleaned.push(value));
          return document.createTextNode(value);
        },
      }),
    );
    const first = host.firstChild!;
    expect(first.nodeType).toBe(Node.TEXT_NODE);
    disposeNode(first);
    expect(host.textContent).toBe("b");
    expect(cleaned).toEqual(["a"]);
  });

  it("снимает строку-фрагмент целиком", () => {
    const [items] = createSignal(["a", "b"]);
    const host = install(
      For({
        each: items,
        children: (value: string) => [textRow(value), " ", textRow(`${value}2`)],
      }),
    );
    expect(texts(host)).toEqual(["a", "a2", "b", "b2"]);

    disposeNode(rows(host)[0]!);
    expect(texts(host)).toEqual(["b", "b2"]);
    expect(host.textContent).toBe("b b2");
  });

  it("снимает контейнер с несколькими строками ровно по разу", () => {
    const cleaned: string[] = [];
    const [items, setItems] = createSignal(["a", "b", "c"]);
    const host = install(
      For({
        each: items,
        children: (value: string) => {
          onCleanup(() => cleaned.push(value));
          return textRow(value);
        },
      }),
    );

    disposeNode(host);
    expect(texts(host)).toEqual([]);
    expect(cleaned.sort()).toEqual(["a", "b", "c"]);

    setItems(["a", "c"]);
    flushSync();
    expect(texts(host)).toEqual(["a", "c"]);
  });

  it("dispose после обновления элемента снимает актуальную строку", () => {
    const [items, setItems] = createSignal<Row[]>([row("a", "A"), row("b", "B")]);
    const host = install(
      For({
        each: items,
        keyOf: (value) => value.id,
        children: (value) => textRow(`${value.id}:${value.label}`),
      }),
    );

    setItems([row("a", "A2"), row("b", "B")]);
    flushSync();
    expect(texts(host)).toEqual(["a:A2", "b:B"]);

    disposeNode(rows(host)[0]!);
    expect(texts(host)).toEqual(["b:B"]);

    setItems([row("b", "B"), row("a", "A3")]);
    flushSync();
    expect(texts(host)).toEqual(["b:B", "a:A3"]);
  });

  it("dispose владельца после внешнего dispose не дублирует очистку", () => {
    const cleaned: string[] = [];
    const [items] = createSignal(["a", "b"]);
    let stop: () => void = () => {};
    const host = install(
      createRoot((dispose) => {
        stop = dispose;
        return For({
          each: items,
          children: (value: string) => {
            onCleanup(() => cleaned.push(value));
            return textRow(value);
          },
        });
      }),
    );

    disposeNode(rows(host)[0]!);
    expect(texts(host)).toEqual(["b"]);

    stop();
    flushSync();
    expect(texts(host)).toEqual([]);
    expect(cleaned).toEqual(["a", "b"]);
  });

  it("dispose пустой строки по якорю не ломает следующие обновления", () => {
    const [items, setItems] = createSignal(["a", ""]);
    const host = install(
      For({
        each: items,
        children: (value: string) => (value === "" ? null : textRow(value)),
      }),
    );
    expect(itemMarkers(host).length).toBe(1);

    disposeNode(itemMarkers(host)[0]!);
    expect(texts(host)).toEqual(["a"]);

    setItems(["", "z"]);
    flushSync();
    expect(texts(host)).toEqual(["z"]);
    expect(host.textContent).toBe("z");
  });

  it("index false: dispose строки и добавление не меняют индекс", () => {
    const seen: number[] = [];
    const [items, setItems] = createSignal(["a", "b"]);
    const host = install(
      For({
        each: items,
        index: false,
        children: (value: string, index: () => number) => {
          seen.push(index());
          return textRow(value);
        },
      }),
    );
    expect(seen).toEqual([0, 0]);

    disposeNode(rows(host)[0]!);
    expect(texts(host)).toEqual(["b"]);

    setItems(["a", "b", "c"]);
    flushSync();
    expect(texts(host)).toEqual(["a", "b", "c"]);
    expect(seen).toEqual([0, 0, 0, 0]);
  });
});

describe("disposeNode: строки Index", () => {
  it("переиндексирует оставшиеся строки после dispose", () => {
    const [items, setItems] = createSignal(["a", "b", "c"]);
    const host = install(
      Index({ each: items, children: (item, index) => textRow(`${item()}${index()}`) }),
    );
    expect(texts(host)).toEqual(["a0", "b1", "c2"]);

    disposeNode(rows(host)[0]!);
    flushSync();
    expect(texts(host)).toEqual(["b0", "c1"]);

    setItems(["b", "c", "d"]);
    flushSync();
    expect(texts(host)).toEqual(["b0", "c1", "d2"]);

    setItems(["d"]);
    flushSync();
    expect(texts(host)).toEqual(["d0"]);
  });

  it("dispose всех строк показывает fallback после опустошения each", () => {
    const [items, setItems] = createSignal(["a", "b"]);
    const host = install(
      Index({
        each: items,
        fallback: textRow("empty"),
        children: (item) => textRow(item()),
      }),
    );

    disposeNode(host);
    expect(texts(host)).toEqual([]);

    setItems([]);
    flushSync();
    expect(texts(host)).toEqual(["empty"]);
  });
});

describe("вложенные списки", () => {
  it("dispose внешней строки освобождает внутренние ровно по разу", () => {
    const outerCleaned: string[] = [];
    const innerCleaned: string[] = [];
    const [outer] = createSignal([row("o1")]);
    const host = install(
      For({
        each: outer,
        children: (value: Row) => {
          onCleanup(() => outerCleaned.push(value.id));
          const container = document.createElement("div");
          container.appendChild(
            For({
              each: ["x", "y"],
              children: (inner: string) => {
                onCleanup(() => innerCleaned.push(`${value.id}:${inner}`));
                return textRow(`${value.id}:${inner}`);
              },
            }),
          );
          return container;
        },
      }),
    );
    expect(texts(host)).toEqual(["o1:x", "o1:y"]);

    disposeNode(host.querySelector("div")!);
    expect(texts(host)).toEqual([]);
    expect(outerCleaned).toEqual(["o1"]);
    expect(innerCleaned.sort()).toEqual(["o1:x", "o1:y"]);
  });

  it("dispose внутренней строки не ломает внешнюю", () => {
    const outerCleaned: string[] = [];
    const innerCleaned: string[] = [];
    const [outer] = createSignal([row("o1")]);
    const host = install(
      For({
        each: outer,
        children: (value: Row) => {
          onCleanup(() => outerCleaned.push(value.id));
          const container = document.createElement("div");
          container.appendChild(
            For({
              each: ["x", "y"],
              children: (inner: string) => {
                onCleanup(() => innerCleaned.push(inner));
                return textRow(inner);
              },
            }),
          );
          return container;
        },
      }),
    );

    disposeNode(rows(host)[0]!);
    expect(texts(host)).toEqual(["y"]);
    expect(innerCleaned).toEqual(["x"]);
    expect(outerCleaned).toEqual([]);

    disposeNode(rows(host)[0]!);
    expect(texts(host)).toEqual([]);
    expect(innerCleaned).toEqual(["x", "y"]);
    expect(outerCleaned).toEqual([]);

    disposeNode(host.querySelector("div")!);
    expect(outerCleaned).toEqual(["o1"]);
  });

  it("внутренний узел строки не снимает саму строку", () => {
    const [outer] = createSignal([row("o1")]);
    const [inner, setInner] = createSignal(["x", "y"]);
    const host = install(
      For({
        each: outer,
        children: (value: Row) => {
          const container = document.createElement("div");
          container.appendChild(
            For({
              each: inner,
              children: (item: string) => textRow(`${value.id}:${item}`),
            }),
          );
          return container;
        },
      }),
    );

    disposeNode(rows(host)[0]!);
    expect(texts(host)).toEqual(["o1:y"]);

    setInner(["z"]);
    flushSync();
    expect(texts(host)).toEqual(["o1:z"]);
  });

  it("пере-рендер строки с вложенным списком освобождает эффекты при удалении", () => {
    const innerCleaned: string[] = [];
    const [items, setItems] = createSignal<Row[]>([row("a", "A"), row("b", "B")]);
    const [inner] = createSignal(["x", "y"]);
    const host = install(
      For({
        each: items,
        keyOf: (value) => value.id,
        children: (value: Row) => {
          const container = document.createElement("div");
          container.appendChild(
            For({
              each: inner,
              children: (item: string) => {
                onCleanup(() => innerCleaned.push(`${value.id}:${item}`));
                return textRow(`${value.label}:${item}`);
              },
            }),
          );
          return container;
        },
      }),
    );

    setItems([row("a", "A2"), row("b", "B")]);
    flushSync();
    expect(texts(host)).toEqual(["A2:x", "A2:y", "B:x", "B:y"]);

    setItems([row("b", "B")]);
    flushSync();
    expect(texts(host)).toEqual(["B:x", "B:y"]);
    expect(innerCleaned.sort()).toEqual(["a:x", "a:x", "a:y", "a:y"]);
  });
});

describe("renderItem/updateStateItem", () => {
  it("после смены item и индекса остаётся актуальное значение", () => {
    const [items, setItems] = createSignal<Row[]>([row("a", "A"), row("b", "B"), row("c", "C")]);
    const host = install(
      For({
        each: items,
        keyOf: (value) => value.id,
        children: (value: Row, index: () => number) => textRow(`${value.label}${index()}`),
      }),
    );
    expect(texts(host)).toEqual(["A0", "B1", "C2"]);

    setItems([row("a", "A2"), row("b", "B"), row("c", "C")]);
    flushSync();
    expect(texts(host)).toEqual(["A20", "B1", "C2"]);

    setItems([row("c", "C"), row("a", "A2"), row("b", "B")]);
    flushSync();
    expect(texts(host)).toEqual(["C0", "A21", "B2"]);
  });

  it("повторный пере-рендер не плодит строки", () => {
    const [items, setItems] = createSignal<Row[]>([row("a", "A")]);
    const host = install(
      For({
        each: items,
        keyOf: (value) => value.id,
        children: (value) => textRow(value.label),
      }),
    );

    setItems([row("a", "A2")]);
    flushSync();
    setItems([row("a", "A3")]);
    flushSync();

    expect(rows(host).length).toBe(1);
    expect(texts(host)).toEqual(["A3"]);
  });
});

describe("ключи, fallback и пустой список", () => {
  it("keyed-реконсиляция восстанавливает снятую строку при prepend", () => {
    const [items, setItems] = createSignal<Row[]>([row("a"), row("b")]);
    const host = install(
      For({ each: items, keyOf: (value) => value.id, children: (value) => textRow(value.id) }),
    );
    const [a, b] = rows(host);

    disposeNode(a!);
    expect(texts(host)).toEqual(["b"]);

    setItems([row("c"), row("a"), row("b")]);
    flushSync();
    expect(texts(host)).toEqual(["c", "a", "b"]);
    expect(rows(host).filter((element) => element === b).length).toBe(1);
  });

  it("fallback возвращается после dispose строк и опустошения списка", () => {
    const [items, setItems] = createSignal(["a"]);
    const host = install(
      For({ each: items, fallback: textRow("empty"), children: (value) => textRow(value) }),
    );
    expect(texts(host)).toEqual(["a"]);

    disposeNode(rows(host)[0]!);
    expect(texts(host)).toEqual([]);

    setItems([]);
    flushSync();
    expect(texts(host)).toEqual(["empty"]);

    setItems(["b"]);
    flushSync();
    expect(texts(host)).toEqual(["b"]);
  });
});

describe("гидрация", () => {
  it("dispose по первому узлу сразу после hydrate", async () => {
    const [items] = createSignal(["a", "b"]);
    function View(): Node {
      return For({
        each: items,
        children: (value: string) => templateHoles(`<span class="row">${value}</span>`)().node,
      });
    }
    declareView(View, "HydrateFirstNode");
    const { target, dispose } = await hydrateView(
      View,
      "<!--silent-view--><!--silent-item--><span class=\"row\">a</span><!--silent-item--><span class=\"row\">b</span><!--silent-end--><!--silent-view-end-->",
    );
    expect(texts(target)).toEqual(["a", "b"]);

    disposeNode(rows(target)[0]!);
    expect(texts(target)).toEqual(["b"]);
    dispose();
    expect(texts(target)).toEqual([]);
  });

  it("dispose гидратированной строки Index по узлу и якорю", async () => {
    function View(): Node {
      return Index({
        each: ["a", "b"],
        children: (item) => templateHoles(`<span class="row">${item()}</span>`)().node,
      });
    }
    declareView(View, "HydrateIndex");
    const { target, dispose } = await hydrateView(
      View,
      "<!--silent-view--><!--silent-item--><span class=\"row\">a</span><!--silent-item--><span class=\"row\">b</span><!--silent-end--><!--silent-view-end-->",
    );
    expect(texts(target)).toEqual(["a", "b"]);

    disposeNode(rows(target)[1]!);
    expect(texts(target)).toEqual(["a"]);

    disposeNode(itemMarkers(target)[0]!);
    expect(texts(target)).toEqual([]);
    dispose();
  });

  it("статические строки пересоздаются после dispose по якорю", async () => {
    const [items, setItems] = createSignal(["a", "b"]);
    function View(): Node {
      return For({
        each: items,
        staticRows: true,
        children: (value: string) => templateHoles(`<span class="row">${value}</span>`)().node,
      });
    }
    declareView(View, "HydrateStatic");
    const { target, dispose } = await hydrateView(
      View,
      "<!--silent-view--><!--silent-item--><span class=\"row\">a</span><!--silent-item--><span class=\"row\">b</span><!--silent-end--><!--silent-view-end-->",
    );
    expect(texts(target)).toEqual(["a", "b"]);

    disposeNode(itemMarkers(target)[0]!);
    expect(texts(target)).toEqual(["b"]);

    setItems(["a", "b"]);
    flushSync();
    expect(texts(target)).toEqual(["a", "b"]);
    expect(rows(target).length).toBe(2);
    dispose();
  });
});

describe("совместимость item-диспозеров", () => {
  it("attachItemDisposer работает, clearItemDisposer снимает его", () => {
    const calls: string[] = [];
    const element = document.createElement("div");
    const child = document.createElement("span");
    element.appendChild(child);
    attachItemDisposer(element, () => calls.push("item"));
    attachDisposer(child, () => calls.push("child"));

    disposeNode(element);
    expect(calls).toEqual(["item"]);

    clearItemDisposer(element);
    disposeNode(element);
    expect(calls).toEqual(["item", "child"]);
  });

  it("ITEM_STATE приоритетнее старых диспозеров", () => {
    const calls: string[] = [];
    const element = document.createElement("div");
    const child = document.createElement("span");
    element.appendChild(child);
    attachItemState(element, { dispose: () => calls.push("state") });
    attachItemDisposer(element, () => calls.push("item"));
    attachDisposer(child, () => calls.push("child"));

    disposeNode(element);
    expect(calls).toEqual(["state"]);

    clearItemDisposer(element);
    disposeNode(element);
    expect(calls).toEqual(["state", "child"]);
  });
});
