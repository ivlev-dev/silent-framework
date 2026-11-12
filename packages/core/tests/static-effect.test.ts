import { describe, expect, it } from "vitest";
import { createSignal, flushSync } from "@ivlev-dev/silent-reactivity";
import {
  effectUnlessStatic,
  renderEffectUnlessStatic,
} from "../src/static-effect.js";
import { text } from "../src/dom.js";

describe("effectUnlessStatic", () => {
  it("не создаёт эффект для статического выражения", () => {
    let calls = 0;
    const dispose = effectUnlessStatic(() => {
      calls += 1;
    });
    expect(dispose).toBeNull();
    expect(calls).toBe(1);
  });

  it("создаёт эффект для реактивного выражения", () => {
    const [value, setValue] = createSignal(0);
    let calls = 0;
    const dispose = effectUnlessStatic(() => {
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
    const dispose = effectUnlessStatic(() => {
      seen.push(outer());
      effectUnlessStatic(() => {
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
    const dispose = effectUnlessStatic(() => {
      renderEffectUnlessStatic(() => {
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
