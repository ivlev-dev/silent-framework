import { describe, expect, it } from "vitest";
import { collectionRules } from "../src/rules/collections.js";
import type { RuleDefinition, RuleRunContext } from "../src/types.js";

function contextFor(
  params: Readonly<Record<string, unknown>>,
): RuleRunContext {
  return {
    instance: {},
    field: "value",
    label: "Value",
    path: "value",
    params,
  };
}

function run(
  rule: RuleDefinition,
  value: unknown,
  params?: Readonly<Record<string, unknown>>,
): boolean | Promise<boolean> {
  return rule.check(value, contextFor(params ?? rule.params));
}

describe("ArrayMinSize", () => {
  it("проверяет минимальный размер массива и Set", () => {
    const rule: RuleDefinition = {
      ...collectionRules.arrayMinSize,
      params: { min: 2 },
    };
    expect(run(rule, [1, 2])).toBe(true);
    expect(run(rule, [1, 2, 3])).toBe(true);
    expect(run(rule, [1])).toBe(false);
    expect(run(rule, [])).toBe(false);
    expect(run(rule, new Set([1, 2]))).toBe(true);
    expect(run(rule, new Set([1]))).toBe(false);
  });

  it("не пропускает не-коллекции", () => {
    const rule: RuleDefinition = {
      ...collectionRules.arrayMinSize,
      params: { min: 0 },
    };
    expect(run(rule, "ab")).toBe(false);
    expect(run(rule, null)).toBe(false);
    expect(run(rule, { length: 3 })).toBe(false);
  });
});

describe("ArrayMaxSize", () => {
  it("проверяет максимальный размер массива и Set", () => {
    const rule: RuleDefinition = {
      ...collectionRules.arrayMaxSize,
      params: { max: 2 },
    };
    expect(run(rule, [])).toBe(true);
    expect(run(rule, [1, 2])).toBe(true);
    expect(run(rule, [1, 2, 3])).toBe(false);
    expect(run(rule, new Set([1, 2]))).toBe(true);
    expect(run(rule, new Set([1, 2, 3]))).toBe(false);
    expect(run(rule, 3)).toBe(false);
  });
});

describe("ArrayNotEmpty", () => {
  it("требует непустую коллекцию", () => {
    expect(run(collectionRules.arrayNotEmpty, [1])).toBe(true);
    expect(run(collectionRules.arrayNotEmpty, new Set([1]))).toBe(true);
    expect(run(collectionRules.arrayNotEmpty, [])).toBe(false);
    expect(run(collectionRules.arrayNotEmpty, new Set())).toBe(false);
    expect(run(collectionRules.arrayNotEmpty, "a")).toBe(false);
    expect(run(collectionRules.arrayNotEmpty, null)).toBe(false);
    expect(collectionRules.arrayNotEmpty.params).toEqual({});
  });
});

describe("ArrayUnique", () => {
  it("пропускает уникальные элементы", () => {
    expect(run(collectionRules.arrayUnique, [1, 2, 3])).toBe(true);
    expect(run(collectionRules.arrayUnique, [])).toBe(true);
    expect(run(collectionRules.arrayUnique, new Set([1, 2]))).toBe(true);
    const first = {};
    const second = {};
    expect(run(collectionRules.arrayUnique, [first, second])).toBe(true);
  });

  it("сравнивает через SameValueZero", () => {
    expect(run(collectionRules.arrayUnique, [NaN, NaN])).toBe(false);
    expect(run(collectionRules.arrayUnique, [NaN, 1])).toBe(true);
    expect(run(collectionRules.arrayUnique, [0, -0])).toBe(false);
    expect(run(collectionRules.arrayUnique, [1, 1])).toBe(false);
    const shared = {};
    expect(run(collectionRules.arrayUnique, [shared, shared])).toBe(false);
  });

  it("не пропускает не-коллекции", () => {
    expect(run(collectionRules.arrayUnique, "abc")).toBe(false);
    expect(run(collectionRules.arrayUnique, null)).toBe(false);
    expect(run(collectionRules.arrayUnique, { a: 1 })).toBe(false);
  });
});

describe("HasKey", () => {
  it("ищет собственный ключ объекта", () => {
    expect(run(collectionRules.hasKey, { a: 1 }, { key: "a" })).toBe(true);
    expect(run(collectionRules.hasKey, { a: undefined }, { key: "a" })).toBe(
      true,
    );
    expect(run(collectionRules.hasKey, { a: 1 }, { key: "b" })).toBe(false);
    expect(run(collectionRules.hasKey, { a: 1 }, { key: "toString" })).toBe(
      false,
    );
    expect(
      run(collectionRules.hasKey, Object.create({ a: 1 }), { key: "a" }),
    ).toBe(false);
  });

  it("поддерживает символьные ключи", () => {
    const key = Symbol("key");
    expect(run(collectionRules.hasKey, { [key]: 1 }, { key })).toBe(true);
    expect(run(collectionRules.hasKey, {}, { key })).toBe(false);
  });

  it("работает с Map", () => {
    const map = new Map<string, number>([["a", 1]]);
    expect(run(collectionRules.hasKey, map, { key: "a" })).toBe(true);
    expect(run(collectionRules.hasKey, map, { key: "b" })).toBe(false);
  });

  it("возвращает false для массивов, Set, null и примитивов", () => {
    expect(run(collectionRules.hasKey, ["a"], { key: "0" })).toBe(false);
    expect(run(collectionRules.hasKey, new Set(["a"]), { key: "a" })).toBe(
      false,
    );
    expect(run(collectionRules.hasKey, null, { key: "a" })).toBe(false);
    expect(run(collectionRules.hasKey, "abc", { key: "length" })).toBe(false);
    expect(run(collectionRules.hasKey, { a: 1 }, { key: 1 })).toBe(false);
  });
});

describe("Nested", () => {
  it("описывает вложенный объект", () => {
    expect(collectionRules.nested.name).toBe("nested");
    expect(collectionRules.nested.nested).toBe("object");
    expect(collectionRules.nested.params).toEqual({});
  });

  it("пропускает только объекты, кроме массивов и null", () => {
    expect(run(collectionRules.nested, { a: 1 })).toBe(true);
    expect(run(collectionRules.nested, new (class Item {})())).toBe(true);
    expect(run(collectionRules.nested, [])).toBe(false);
    expect(run(collectionRules.nested, null)).toBe(false);
    expect(run(collectionRules.nested, "object")).toBe(false);
    expect(run(collectionRules.nested, 1)).toBe(false);
    expect(run(collectionRules.nested, undefined)).toBe(false);
  });
});

describe("Each", () => {
  it("описывает поэлементную проверку", () => {
    expect(collectionRules.each.name).toBe("each");
    expect(collectionRules.each.nested).toBe("each");
    expect(collectionRules.each.params).toEqual({});
  });

  it("пропускает массивы и Set", () => {
    expect(run(collectionRules.each, [])).toBe(true);
    expect(run(collectionRules.each, [1, 2])).toBe(true);
    expect(run(collectionRules.each, new Set([1, 2]))).toBe(true);
    expect(run(collectionRules.each, {})).toBe(false);
    expect(run(collectionRules.each, "ab")).toBe(false);
    expect(run(collectionRules.each, null)).toBe(false);
  });
});
