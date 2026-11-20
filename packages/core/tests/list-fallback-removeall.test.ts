// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  createRoot,
  createSignal,
  flushSync,
  onCleanup,
} from "@ivlev-dev/silent-reactivity";
import { For } from "../src/control-flow";
import { Index } from "../src/index-list";
import type { Accessor } from "@ivlev-dev/silent-reactivity";

function host(): HTMLElement {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return element;
}

function fallbackInput(): HTMLInputElement {
  const input = document.createElement("input");
  input.value = "kept";
  return input;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("стабильность fallback списков", () => {
  it("For не пересоздаёт fallback, пока список остаётся пустым", () => {
    const [rows, setRows] = createSignal<readonly string[]>([]);
    const target = host();
    target.appendChild(
      For<string>({
        each: rows,
        fallback: fallbackInput,
        children: (row) => {
          const span = document.createElement("span");
          span.textContent = row;
          return span;
        },
      }),
    );

    const input = target.querySelector("input");
    expect(input).not.toBeNull();
    input!.value = "typed";

    setRows([]);
    flushSync();
    expect(target.querySelector("input")).toBe(input);
    expect(input!.value).toBe("typed");

    setRows(["a"]);
    flushSync();
    expect(target.querySelector("input")).toBeNull();
    expect(target.textContent).toBe("a");

    setRows([]);
    flushSync();
    const fresh = target.querySelector("input");
    expect(fresh).not.toBeNull();
    expect(fresh).not.toBe(input);
    expect(fresh?.value).toBe("kept");
  });

  it("Index не пересоздаёт fallback, пока список остаётся пустым", () => {
    const [rows, setRows] = createSignal<readonly string[]>([]);
    const target = host();
    target.appendChild(
      Index<string>({
        each: rows,
        fallback: fallbackInput,
        children: (row: Accessor<string>) => {
          const span = document.createElement("span");
          span.textContent = row();
          return span;
        },
      }),
    );

    const input = target.querySelector("input");
    expect(input).not.toBeNull();
    input!.value = "typed";

    setRows([]);
    flushSync();
    expect(target.querySelector("input")).toBe(input);
    expect(input!.value).toBe("typed");

    setRows(["a"]);
    flushSync();
    expect(target.querySelector("input")).toBeNull();
    expect(target.textContent).toBe("a");

    setRows([]);
    flushSync();
    const fresh = target.querySelector("input");
    expect(fresh).not.toBeNull();
    expect(fresh).not.toBe(input);
    expect(fresh?.value).toBe("kept");
  });

  it("For сохраняет реактивность внутри fallback", () => {
    const [rows, setRows] = createSignal<readonly string[]>([]);
    const [name, setName] = createSignal("gone");
    const target = host();
    target.appendChild(
      For<string>({
        each: rows,
        fallback: () => `no: ${name()}`,
        children: (row) => {
          const span = document.createElement("span");
          span.textContent = row;
          return span;
        },
      }),
    );

    expect(target.textContent).toBe("no: gone");
    setName("vacant");
    flushSync();
    expect(target.textContent).toBe("no: vacant");
    setRows(["a"]);
    flushSync();
    expect(target.textContent).toBe("a");
    setRows([]);
    flushSync();
    expect(target.textContent).toBe("no: vacant");
  });
});

function listWithThrowingRow(
  kind: "for" | "index",
  items: readonly number[],
  calls: number[],
): { host: HTMLElement; dispose: () => void } {
  const target = host();
  let disposeRoot: () => void = () => undefined;
  disposeRoot = createRoot((dispose) => {
    const row = (item: number): HTMLElement => {
      onCleanup(() => {
        calls.push(item);
        if (item === 2) {
          throw new Error("boom");
        }
      });
      const span = document.createElement("span");
      span.textContent = String(item);
      return span;
    };
    const list =
      kind === "for"
        ? For<number>({ each: items, children: (item) => row(item) })
        : Index<number>({
          each: items,
          children: (item: Accessor<number>) => row(item()),
        });
    target.appendChild(list);
    return dispose;
  });
  return { host: target, dispose: disposeRoot };
}

describe("удаление всех строк списка", () => {
  it("For освобождает все строки, даже если cleanup бросает", () => {
    const calls: number[] = [];
    const { host: target, dispose } = listWithThrowingRow("for", [1, 2, 3], calls);
    expect(target.querySelectorAll("span").length).toBe(3);

    let caught: unknown = null;
    try {
      dispose();
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("boom");
    expect([...calls].sort((left, right) => left - right)).toEqual([1, 2, 3]);
    expect(target.querySelectorAll("span").length).toBe(0);
    expect(target.textContent).toBe("");
  });

  it("Index освобождает все строки, даже если cleanup бросает", () => {
    const calls: number[] = [];
    const { host: target, dispose } = listWithThrowingRow("index", [1, 2, 3], calls);
    expect(target.querySelectorAll("span").length).toBe(3);

    let caught: unknown = null;
    try {
      dispose();
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("boom");
    expect([...calls].sort((left, right) => left - right)).toEqual([1, 2, 3]);
    expect(target.querySelectorAll("span").length).toBe(0);
    expect(target.textContent).toBe("");
  });
});
