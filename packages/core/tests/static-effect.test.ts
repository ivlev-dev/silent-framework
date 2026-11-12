import { describe, expect, it } from "vitest";
import { createSignal, flushSync } from "@ivlev-dev/silent-reactivity";
import { createEffectUnlessStatic } from "../src/static-effect.js";
import { text } from "../src/dom.js";

describe("createEffectUnlessStatic", () => {
  it("не создаёт эффект для статического выражения", () => {
    let calls = 0;
    const dispose = createEffectUnlessStatic(() => {
      calls += 1;
    });
    expect(dispose).toBeNull();
    expect(calls).toBe(1);
  });

  it("создаёт эффект для реактивного выражения", () => {
    const [value, setValue] = createSignal(0);
    let calls = 0;
    const dispose = createEffectUnlessStatic(() => {
      value();
      calls += 1;
    });
    expect(dispose).not.toBeNull();
    expect(calls).toBe(1);
    setValue(1);
    flushSync();
    expect(calls).toBe(2);
    dispose?.();
    setValue(2);
    flushSync();
    expect(calls).toBe(2);
  });

  it("поддерживает вложенные пробные проходы", () => {
    const [outer, setOuter] = createSignal("a");
    const [inner, setInner] = createSignal("x");
    const seen: string[] = [];
    const dispose = createEffectUnlessStatic(() => {
      seen.push(outer());
      createEffectUnlessStatic(() => {
        seen.push(inner());
      });
    });
    expect(dispose).not.toBeNull();
    expect(seen).toEqual(["a", "x"]);
    setInner("y");
    flushSync();
    expect(seen).toEqual(["a", "x", "y"]);
    setOuter("b");
    flushSync();
    expect(seen).toEqual(["a", "x", "y", "b", "y"]);
    dispose?.();
    setInner("z");
    flushSync();
    expect(seen).toEqual(["a", "x", "y", "b", "y"]);
  });

  it("переносит вложенную реактивную подписку в владельца эффекта", () => {
    const [value, setValue] = createSignal("a");
    const node = document.createTextNode("a");
    const dispose = createEffectUnlessStatic(() => {
      createEffectUnlessStatic(() => {
        node.data = value();
      });
    });
    expect(dispose).not.toBeNull();
    setValue("b");
    flushSync();
    expect(node.data).toBe("b");
    dispose?.();
    setValue("c");
    flushSync();
    expect(node.data).toBe("b");
  });
});

describe("text при монтировании", () => {
  it("оставляет реактивную подписку", () => {
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
