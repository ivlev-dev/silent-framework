import { describe, expect, it } from "vitest";
import {
  deepReactive,
  isRaw,
  isReactive,
  isReadonly,
  markRaw,
  markReactiveClass,
  readonly,
  unwrap,
} from "../src/index";

describe("кэш флагов прототипа", () => {
  it("инвалидируется при markRaw класса после первого чтения", () => {
    class Row {
      value = 1;
    }

    const row = new Row();
    expect(isRaw(row)).toBe(false);
    expect(deepReactive(row)).toBe(row);
    expect(isReactive(row)).toBe(false);

    markRaw(Row);

    expect(isRaw(row)).toBe(true);
    expect(deepReactive(row)).toBe(row);
    expect(isReactive(deepReactive(row))).toBe(false);

    const next = new Row();
    expect(isRaw(next)).toBe(true);
    expect(deepReactive(next)).toBe(next);
  });

  it("инвалидируется при markReactiveClass после первого чтения, включая наследников", () => {
    class Base {
      value = 1;
    }
    class Derived extends Base {}

    const base = new Base();
    const derived = new Derived();
    expect(deepReactive(base)).toBe(base);
    expect(deepReactive(derived)).toBe(derived);

    markReactiveClass(Base);

    expect(deepReactive(base)).toBe(base);
    expect(deepReactive(derived)).toBe(derived);
    expect(isReactive(base)).toBe(false);
    expect(isReactive(derived)).toBe(false);

    const later = new Derived();
    expect(deepReactive(later)).toBe(later);
    expect(deepReactive(later)).toBe(later);
  });

  it("не ломает isReactive/unwrap/readonly для plain-объектов и классов", () => {
    const raw = { nested: { value: 1 } };
    const state = deepReactive(raw);
    expect(isReactive(state)).toBe(true);
    expect(isReactive(state.nested)).toBe(true);
    expect(unwrap(state)).toBe(raw);
    expect(unwrap(state.nested)).toBe(raw.nested);
    expect(unwrap(state.nested)).toBe(unwrap(state.nested));

    const readonlyState = readonly(raw);
    expect(isReadonly(readonlyState)).toBe(true);
    expect(isReadonly(readonly(readonlyState))).toBe(true);

    class Row {
      #value = 1;

      get value(): number {
        return this.#value;
      }
    }
    const row = new Row();
    expect(readonly(row)).toBe(row);
    expect(isReadonly(readonly(row))).toBe(false);
    expect(unwrap(row)).toBe(row);
    expect(isReactive(row)).toBe(false);
  });

  it("повторные чтения попадают в кэш (мягкий замер)", () => {
    class Base {
      value = 1;
    }
    class Model extends Base {
      name = "";
    }
    const model = new Model();
    expect(deepReactive(model)).toBe(model);

    const iterations = 100000;
    const start = performance.now();
    for (let index = 0; index < iterations; index += 1) {
      deepReactive(model);
    }
    const elapsed = performance.now() - start;

    expect(deepReactive(model)).toBe(model);
    // Без жёсткого порога: просто страховка от деградации на порядки.
    expect(elapsed).toBeLessThan(2000);
  });
});
