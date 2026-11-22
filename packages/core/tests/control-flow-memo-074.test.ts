// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { createSignal, flushSync } from "@ivlev-dev/silent-reactivity";
import { For, Show } from "../src/control-flow";
import { Index } from "../src/index-list";
import { Match, Switch } from "../src/switch";

function install(node: Node): HTMLElement {
  const host = document.createElement("div");
  host.appendChild(node);
  document.body.appendChild(host);
  return host;
}

function label(value: string): HTMLElement {
  const span = document.createElement("span");
  span.textContent = value;
  return span;
}

function row(value: string): HTMLElement {
  const span = document.createElement("span");
  span.dataset.id = value;
  span.textContent = value;
  return span;
}

function idsOf(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll("[data-id]")).map(
    (element) => (element as HTMLElement).dataset.id ?? "",
  );
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe("Show: сохранение ветки", () => {
  it("не пересоздаёт DOM при true→true", () => {
    const [count, setCount] = createSignal(1);
    let built = 0;
    const container = Show({
      when: () => count() > 0,
      children: () => {
        built += 1;
        return label("on");
      },
    });
    const host = install(container);
    const initial = host.querySelector("span");

    expect(built).toBe(1);
    expect(host.textContent).toBe("on");

    setCount(2);
    flushSync();
    expect(host.querySelector("span")).toBe(initial);
    expect(built).toBe(1);

    setCount(7);
    flushSync();
    expect(host.querySelector("span")).toBe(initial);
    expect(built).toBe(1);

    setCount(0);
    flushSync();
    expect(host.querySelector("span")).toBeNull();

    setCount(3);
    flushSync();
    expect(built).toBe(2);
    expect(host.textContent).toBe("on");
  });

  it("пересоздаёт ветку только при смене истинности", () => {
    const [count, setCount] = createSignal(1);
    let childrenBuilt = 0;
    let fallbackBuilt = 0;
    const container = Show({
      when: () => count() > 0,
      children: () => {
        childrenBuilt += 1;
        return label("on");
      },
      fallback: () => {
        fallbackBuilt += 1;
        return label("off");
      },
    });
    const host = install(container);

    setCount(2);
    flushSync();
    expect(childrenBuilt).toBe(1);
    expect(fallbackBuilt).toBe(0);

    setCount(-1);
    flushSync();
    expect(childrenBuilt).toBe(1);
    expect(fallbackBuilt).toBe(1);
    expect(host.textContent).toBe("off");
  });

  it("сохраняет реактивное содержимое ветки", () => {
    const [count, setCount] = createSignal(0);
    const container = Show({ when: true, children: () => `n=${count()}` });
    const host = install(container);
    expect(host.textContent).toBe("n=0");

    setCount(5);
    flushSync();
    expect(host.textContent).toBe("n=5");
  });
});

describe("Switch: мемоизация выбранной ветки", () => {
  it("не пересоздаёт DOM при изменении when внутри той же ветки", () => {
    const [value, setValue] = createSignal(2);
    let bigBuilt = 0;
    let smallBuilt = 0;
    const host = install(
      Switch({
        fallback: () => label("none"),
        children: () => [
          Match({
            when: () => value() > 1,
            children: () => {
              bigBuilt += 1;
              return label("big");
            },
          }),
          Match({
            when: () => value() > 0,
            children: () => {
              smallBuilt += 1;
              return label("small");
            },
          }),
        ],
      }),
    );
    const initial = host.querySelector("span");
    expect(host.textContent).toBe("big");
    expect(bigBuilt).toBe(1);
    expect(smallBuilt).toBe(0);

    setValue(5);
    flushSync();
    expect(host.querySelector("span")).toBe(initial);
    expect(bigBuilt).toBe(1);

    setValue(1);
    flushSync();
    expect(host.textContent).toBe("small");
    expect(smallBuilt).toBe(1);

    setValue(9);
    flushSync();
    expect(host.textContent).toBe("big");
    expect(bigBuilt).toBe(2);
  });

  it("сохраняет реактивное содержимое выбранной ветки", () => {
    const [value, setValue] = createSignal(3);
    const host = install(
      Switch({
        fallback: () => label("none"),
        children: () =>
          Match({
            when: () => value() > 0,
            children: () => label(`v=${value()}`),
          }),
      }),
    );
    expect(host.textContent).toBe("v=3");

    setValue(4);
    flushSync();
    expect(host.textContent).toBe("v=4");

    setValue(0);
    flushSync();
    expect(host.textContent).toBe("none");
  });
});

describe("For и Index: нормализация each", () => {
  it("For принимает Set", () => {
    const [items, setItems] = createSignal<Iterable<string>>(new Set(["a", "b"]));
    const host = install(For({ each: items, children: row }));
    expect(idsOf(host)).toEqual(["a", "b"]);

    setItems(new Set(["b", "c"]));
    flushSync();
    expect(idsOf(host)).toEqual(["b", "c"]);
  });

  it("For принимает генератор", () => {
    function* generate(): Generator<string, void, unknown> {
      yield "a";
      yield "b";
    }
    const host = install(For({ each: generate(), children: row }));
    expect(idsOf(host)).toEqual(["a", "b"]);
  });

  it("For трактует undefined и null как пустой список", () => {
    const host = install(
      For({
        each: undefined as unknown as string[],
        children: row,
        fallback: "empty",
      }),
    );
    expect(host.textContent).toBe("empty");

    const nullHost = install(
      For({
        each: () => null as unknown as string[],
        children: row,
        fallback: "empty",
      }),
    );
    expect(nullHost.textContent).toBe("empty");
  });

  it("For пропускает sparse-дырки", () => {
    const sparse: string[] = ["a", "b"];
    sparse.length = 4;
    sparse[3] = "c";
    const host = install(For({ each: sparse, children: row }));
    expect(idsOf(host)).toEqual(["a", "b", "c"]);
  });

  it("For принимает undefined внутри массива как пустой слот", () => {
    const items: (string | undefined)[] = ["a", undefined, "b"];
    const host = install(For({ each: items as unknown as string[], children: row }));
    expect(idsOf(host)).toEqual(["a", "b"]);
  });

  it("For рендерит текстовые строки", () => {
    const host = install(
      // @ts-expect-error For поддерживает строковые children в рантайме, типы требуют Node.
      For({ each: ["a", "b"], children: (item: string) => item }),
    );
    expect(host.textContent).toBe("ab");
  });

  it("Index принимает Set и undefined", () => {
    const [items, setItems] = createSignal<Iterable<string>>(new Set(["a", "b"]));
    const host = install(
      Index({
        each: items,
        children: (item) => row(item()),
      }),
    );
    expect(idsOf(host)).toEqual(["a", "b"]);

    setItems(new Set(["c"]));
    flushSync();
    expect(idsOf(host)).toEqual(["c"]);

    const emptyHost = install(
      Index({
        each: undefined as unknown as string[],
        children: (item) => row(item()),
        fallback: "empty",
      }),
    );
    expect(emptyHost.textContent).toBe("empty");
  });
});
