import { describe, expect, it } from "vitest";
import { comparisonRules } from "../src/rules/comparison.js";
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

describe("Equals", () => {
  it("сравнивает через Object.is", () => {
    expect(run(comparisonRules.equals, 1, { expected: 1 })).toBe(true);
    expect(run(comparisonRules.equals, 1, { expected: 2 })).toBe(false);
    expect(run(comparisonRules.equals, "a", { expected: "a" })).toBe(true);
    expect(run(comparisonRules.equals, null, { expected: null })).toBe(true);
    expect(run(comparisonRules.equals, undefined, { expected: null })).toBe(
      false,
    );
  });

  it("различает NaN и нули по знаку", () => {
    expect(run(comparisonRules.equals, NaN, { expected: NaN })).toBe(true);
    expect(run(comparisonRules.equals, 0, { expected: -0 })).toBe(false);
    expect(run(comparisonRules.equals, -0, { expected: -0 })).toBe(true);
  });

  it("сравнивает объекты по ссылке", () => {
    const shared = {};
    expect(run(comparisonRules.equals, shared, { expected: shared })).toBe(
      true,
    );
    expect(run(comparisonRules.equals, {}, { expected: {} })).toBe(false);
  });

  it("хранит expected в параметрах", () => {
    const rule: RuleDefinition = {
      ...comparisonRules.equals,
      params: { expected: "x" },
    };
    expect(rule.params).toEqual({ expected: "x" });
  });
});

describe("NotEquals", () => {
  it("инвертирует Object.is", () => {
    expect(run(comparisonRules.notEquals, 1, { expected: 2 })).toBe(true);
    expect(run(comparisonRules.notEquals, 1, { expected: 1 })).toBe(false);
    expect(run(comparisonRules.notEquals, NaN, { expected: NaN })).toBe(false);
    expect(run(comparisonRules.notEquals, 0, { expected: -0 })).toBe(true);
  });
});

describe("IsIn", () => {
  it("ищет значение через includes", () => {
    const rule: RuleDefinition = {
      ...comparisonRules.isIn,
      params: { values: [1, 2, 3] },
    };
    expect(run(rule, 2)).toBe(true);
    expect(run(rule, 4)).toBe(false);
    expect(run(rule, "2")).toBe(false);
  });

  it("учитывает NaN и SameValueZero", () => {
    const nanRule: RuleDefinition = {
      ...comparisonRules.isIn,
      params: { values: [NaN] },
    };
    expect(run(nanRule, NaN)).toBe(true);

    const zeroRule: RuleDefinition = {
      ...comparisonRules.isIn,
      params: { values: [0] },
    };
    expect(run(zeroRule, -0)).toBe(true);
  });

  it("сравнивает объекты по ссылке", () => {
    const target = {};
    const rule: RuleDefinition = {
      ...comparisonRules.isIn,
      params: { values: [target] },
    };
    expect(run(rule, target)).toBe(true);
    expect(run(rule, {})).toBe(false);
  });

  it("хранит values массивом", () => {
    const values = ["a", "b"] as const;
    const rule: RuleDefinition = {
      ...comparisonRules.isIn,
      params: { values: [...values] },
    };
    expect(Array.isArray(rule.params.values)).toBe(true);
    expect(rule.params.values).toEqual(["a", "b"]);
  });

  it("возвращает false при некорректных параметрах", () => {
    expect(run(comparisonRules.isIn, 1, { values: "1" })).toBe(false);
  });
});

describe("NotIn", () => {
  it("инвертирует результат includes", () => {
    const rule: RuleDefinition = {
      ...comparisonRules.notIn,
      params: { values: [1, 2, 3] },
    };
    expect(run(rule, 4)).toBe(true);
    expect(run(rule, 2)).toBe(false);
    expect(run(comparisonRules.notIn, NaN, { values: [NaN] })).toBe(false);
    expect(run(comparisonRules.notIn, 0, { values: [-0] })).toBe(false);
  });

  it("пропускает значение при некорректных параметрах", () => {
    expect(run(comparisonRules.notIn, 1, { values: 1 })).toBe(false);
  });
});
