import { describe, expect, it } from "vitest";
import {
  createRoot,
  createSignal,
  flushSync,
  onCleanup,
} from "@ivlev-dev/silent-reactivity";
import { createLazyRenderEffect } from "../src/lazy-effect.js";
import { text } from "../src/dom.js";

describe("createLazyRenderEffect", () => {
  it("снимает эффект без зависимостей и побочек", () => {
    let calls = 0;
    const dispose = createLazyRenderEffect(() => {
      calls += 1;
    });
    expect(calls).toBe(1);
    expect(dispose).toBeNull();
  });

  it("оставляет эффект, читающий сигнал", () => {
    const [value, setValue] = createSignal(0);
    let calls = 0;
    const dispose = createLazyRenderEffect(() => {
      value();
      calls += 1;
    });
    expect(dispose).not.toBeNull();
    setValue(1);
    flushSync();
    expect(calls).toBe(2);
    dispose?.();
    setValue(2);
    flushSync();
    expect(calls).toBe(2);
  });

  it("оставляет эффект с вложенным владельцем", () => {
    let cleaned = 0;
    const dispose = createLazyRenderEffect(() => {
      createRoot(() => {
        onCleanup(() => {
          cleaned += 1;
        });
        return null;
      });
    });
    expect(dispose).not.toBeNull();
    expect(cleaned).toBe(0);
    dispose?.();
    expect(cleaned).toBe(1);
  });

  it("оставляет эффект с cleanup", () => {
    let cleaned = 0;
    const dispose = createLazyRenderEffect(() => {
      onCleanup(() => {
        cleaned += 1;
      });
    });
    expect(dispose).not.toBeNull();
    expect(cleaned).toBe(0);
    dispose?.();
    expect(cleaned).toBe(1);
  });

  it("применяется к text и оставляет реактивную подписку", () => {
    const [value, setValue] = createSignal("a");
    const node = document.createTextNode("a");
    let calls = 0;
    const accessor = (): string => {
      calls += 1;
      return value();
    };
    text(node, accessor);
    expect(calls).toBe(1);
    setValue("b");
    flushSync();
    expect(node.data).toBe("b");
    expect(calls).toBe(2);
  });
});
