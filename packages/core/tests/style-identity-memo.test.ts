// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { createRoot, createSignal, flushSync } from "@ivlev-dev/silent-reactivity";
import { style } from "../src/dom";

afterEach(() => {
  document.body.replaceChildren();
});

describe("style: identity-мемо", () => {
  it("не перечитывает и не переприменяет тот же объект стилей", () => {
    let reads = 0;
    const styles = {
      get color(): string {
        reads += 1;
        return "red";
      },
      get width(): string {
        reads += 1;
        return "10px";
      },
    };
    let current: Record<string, unknown> = styles;
    const [tick, setTick] = createSignal(0);
    const element = document.createElement("div");
    document.body.appendChild(element);

    const dispose = createRoot((disposeRoot) => {
      style(element, () => {
        tick();
        return current;
      });
      return disposeRoot;
    });
    flushSync();
    expect(element.style.color).toBe("red");
    expect(element.style.width).toBe("10px");

    const firstReads = reads;
    expect(firstReads).toBeGreaterThan(0);

    setTick(1);
    flushSync();
    expect(element.style.color).toBe("red");
    expect(reads).toBe(firstReads);

    current = { color: "blue" };
    setTick(2);
    flushSync();
    expect(element.style.color).toBe("blue");
    expect(element.style.width).toBe("");
    expect(reads).toBe(firstReads);

    dispose();
  });
});
