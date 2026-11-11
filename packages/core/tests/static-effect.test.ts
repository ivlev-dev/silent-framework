import { describe, expect, it } from "vitest";
import { createSignal, flushSync } from "@ivlev-dev/silent-reactivity";
import { renderEffectUnlessStatic } from "../src/static-effect.js";
import { text } from "../src/dom.js";

describe("renderEffectUnlessStatic", () => {
  it("не создаёт подписку для статического выражения", () => {
    let calls = 0;
    const created = renderEffectUnlessStatic(() => {
      calls += 1;
    });
    expect(created).toBe(false);
    expect(calls).toBe(1);
    flushSync();
    expect(calls).toBe(1);
  });

  it("создаёт подписку для реактивного выражения", () => {
    const [value, setValue] = createSignal(0);
    let calls = 0;
    const created = renderEffectUnlessStatic(() => {
      value();
      calls += 1;
    });
    expect(created).toBe(true);
    expect(calls).toBe(1);
    setValue(1);
    flushSync();
    expect(calls).toBe(2);
  });

  it("оставляет реактивную подписку в text", () => {
    const [value, setValue] = createSignal("a");
    const node = document.createTextNode("a");
    let calls = 0;
    text(node, () => {
      calls += 1;
      return value();
    });
    expect(calls).toBe(1);
    setValue("b");
    flushSync();
    expect(node.data).toBe("b");
    expect(calls).toBe(2);
  });

  it("применяет статический текст один раз", () => {
    const node = document.createTextNode("a");
    let calls = 0;
    text(node, () => {
      calls += 1;
      return "b";
    });
    expect(calls).toBe(1);
    expect(node.data).toBe("b");
    flushSync();
    expect(calls).toBe(1);
  });
});
