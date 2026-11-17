// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { RESOLVED_READY, getReady, setReady } from "../src/component-state";

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

    expect(getReady(parent)).toBe(ready);
    await ready;
  });
});
