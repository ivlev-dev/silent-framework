import { describe, expect, it } from "vitest";
import {
  createRenderEffect,
  deepReactive,
  flushSync,
  isReactive,
} from "../src/index";

describe("getOwnPropertyDescriptor глубокого прокси", () => {
  it("возвращает прокси в value и сохраняет реактивность мутации", () => {
    const state = deepReactive<{ count: number }[]>([{ count: 0 }]);
    const descriptor = Object.getOwnPropertyDescriptor(state, "0");
    expect(descriptor).toBeDefined();
    expect(isReactive(descriptor?.value)).toBe(true);
    expect(descriptor?.value).toBe(state[0]);

    let runs = 0;
    let seen = -1;
    createRenderEffect(() => {
      seen = state[0]?.count ?? -1;
      runs += 1;
    });
    expect(seen).toBe(0);

    const nested = descriptor?.value as { count: number };
    nested.count = 5;
    flushSync();
    expect(seen).toBe(5);
    expect(runs).toBe(2);
  });

  it("не подменяет value для non-configurable + non-writable свойства", () => {
    const raw = Object.freeze({ nested: { count: 1 } });
    const state = deepReactive(raw);
    const descriptor = Object.getOwnPropertyDescriptor(state, "nested");
    expect(descriptor).toBeDefined();
    expect(isReactive(descriptor?.value)).toBe(false);
    expect(descriptor?.value).toBe(raw.nested);
  });

  it("не трогает accessor-дескрипторы", () => {
    const raw = {
      get doubled(): number {
        return 4;
      },
    };
    const state = deepReactive(raw);
    const descriptor = Object.getOwnPropertyDescriptor(state, "doubled");
    expect(descriptor).toBeDefined();
    expect(typeof descriptor?.get).toBe("function");
    expect(descriptor !== undefined && "value" in descriptor).toBe(false);
  });
});
