// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  createSignal,
  flushSync,
  type Accessor,
} from "@ivlev-dev/silent-reactivity";
import { Index, getIndexStats } from "../src/index-list";
import { insert, disposeNode } from "../src/dom";

function host(): HTMLElement {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return element;
}

function cells(element: HTMLElement): string[] {
  return Array.from(element.querySelectorAll("span")).map(
    (span) => span.textContent ?? "",
  );
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("Index: батч-переиндексация", () => {
  it("не пишет index O(N²) при удалении контейнера с 1000 строк", () => {
    const count = 1000;
    const items = Array.from({ length: count }, (_, index) => index);
    const target = host();
    Index<number>({
      each: items,
      parent: target,
      marker: null,
      children: (item: Accessor<number>, index: Accessor<number>) => {
        const span = document.createElement("span");
        span.textContent = `${index()}:${item()}`;
        return span;
      },
    });
    flushSync();
    expect(target.querySelectorAll("span").length).toBe(count);

    const before = getIndexStats().writes;
    disposeNode(target);
    const writes = getIndexStats().writes - before;

    expect(target.querySelectorAll("span").length).toBe(0);
    expect(writes).toBeLessThan(count);
  });

  it("сохраняет корректные index после внешнего удаления строки", () => {
    const [items] = createSignal<readonly string[]>(["a", "b", "c"]);
    const target = host();
    target.appendChild(
      Index<string>({
        each: items,
        children: (item: Accessor<string>, index: Accessor<number>) => {
          const span = document.createElement("span");
          insert(span, () => `${index()}:${item()}`);
          return span;
        },
      }),
    );
    expect(cells(target)).toEqual(["0:a", "1:b", "2:c"]);

    const firstRow = target.querySelector("span");
    expect(firstRow).not.toBeNull();
    disposeNode(firstRow as Node);
    flushSync();

    expect(cells(target)).toEqual(["0:b", "1:c"]);
  });
});
