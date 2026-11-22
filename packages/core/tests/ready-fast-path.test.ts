// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  RESOLVED_READY,
  clearReady,
  getReady,
  getReadyStats,
  setReady,
} from "../src/component-state";

const nodes: Node[] = [];

afterEach(() => {
  for (const node of nodes.splice(0)) {
    clearReady(node);
  }
  document.body.replaceChildren();
});

describe("getReady: быстрый путь без ready-компонентов", () => {
  it("не обходит поддерево, пока ready не выставлялся", () => {
    const node = {
      nodeType: 1,
      get firstChild(): never {
        throw new Error("поддерево не должно обходиться");
      },
    } as unknown as Node;

    expect(getReady(node)).toBe(RESOLVED_READY);
  });

  it("возвращает ready, выставленный через setReady", async () => {
    const parent = document.createElement("div");
    const child = document.createElement("span");
    parent.appendChild(child);
    const ready = Promise.resolve();
    setReady(child, ready);
    nodes.push(child);

    expect(getReady(parent)).toBe(ready);
    await ready;
  });

  it("не обходит поддерево и не пересобирает промис без изменений", async () => {
    const parent = document.createElement("div");
    const child = document.createElement("span");
    parent.appendChild(child);
    const sibling = document.createElement("i");
    parent.appendChild(sibling);
    setReady(child, Promise.resolve());
    nodes.push(child);

    const before = getReadyStats().traversals;
    const first = getReady(parent);
    const second = getReady(parent);
    expect(second).toBe(first);
    expect(getReadyStats().traversals).toBe(before + 1);

    // Соседнее поддерево без ready-узлов не должно обходить DOM.
    const other = document.createElement("section");
    for (let index = 0; index < 100; index += 1) {
      expect(getReady(other)).toBe(RESOLVED_READY);
    }
    expect(getReadyStats().traversals).toBe(before + 1);
    await first;
  });
});
