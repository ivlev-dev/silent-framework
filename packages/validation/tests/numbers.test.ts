import { describe, expect, it } from "vitest";
import type { RuleDecorator, RuleDefinition, RuleRunContext } from "../src/types.js";
import {
  Between,
  Max,
  Min,
  MultipleOf,
  Negative,
  NonNegative,
  NonPositive,
  Positive,
  numberRules,
} from "../src/rules/numbers.js";
import { validationStateFor } from "../src/registry.js";

function context(params: Record<string, unknown> = {}): RuleRunContext {
  return {
    instance: {},
    field: "value",
    label: "Value",
    path: "value",
    params,
  };
}

function check(
  rule: RuleDefinition,
  value: unknown,
  params: Record<string, unknown> = {},
): boolean {
  const result = rule.check(value, context(params));
  if (typeof result !== "boolean") {
    throw new TypeError("Синхронное правило вернуло не boolean");
  }
  return result;
}

function applyDecorator(
  decorator: RuleDecorator,
  ctor: new () => object,
  field: string,
): void {
  const initializers: Array<(this: object) => void> = [];
  const fakeContext = {
    kind: "accessor" as const,
    name: field,
    static: false,
    private: false,
    addInitializer: (initializer: (this: object) => void): void => {
      initializers.push(initializer);
    },
  };
  decorator(
    { get: () => undefined, set: () => {} } as unknown as ClassAccessorDecoratorTarget<object, unknown>,
    fakeContext as unknown as ClassAccessorDecoratorContext<object, unknown>,
  );
  const instance = new ctor();
  for (const initializer of initializers) {
    initializer.call(instance);
  }
}

describe("numberRules.min", () => {
  it("проверяет нижнюю границу включительно", () => {
    expect(check(numberRules.min, 5, { min: 5 })).toBe(true);
    expect(check(numberRules.min, 6, { min: 5 })).toBe(true);
    expect(check(numberRules.min, 4.999, { min: 5 })).toBe(false);
    expect(check(numberRules.min, -10, { min: -20 })).toBe(true);
  });

  it("отклоняет нечисловые и нечисловые значения", () => {
    expect(check(numberRules.min, Number.NaN, { min: 5 })).toBe(false);
    expect(check(numberRules.min, Number.POSITIVE_INFINITY, { min: 5 })).toBe(false);
    expect(check(numberRules.min, null, { min: 5 })).toBe(false);
    expect(check(numberRules.min, undefined, { min: 5 })).toBe(false);
    expect(check(numberRules.min, "10", { min: 5 })).toBe(false);
  });
});

describe("numberRules.max", () => {
  it("проверяет верхнюю границу включительно", () => {
    expect(check(numberRules.max, 5, { max: 5 })).toBe(true);
    expect(check(numberRules.max, 4, { max: 5 })).toBe(true);
    expect(check(numberRules.max, 5.001, { max: 5 })).toBe(false);
  });

  it("отклоняет нечисловые значения", () => {
    expect(check(numberRules.max, Number.NaN, { max: 5 })).toBe(false);
    expect(check(numberRules.max, Number.NEGATIVE_INFINITY, { max: 5 })).toBe(false);
    expect(check(numberRules.max, null, { max: 5 })).toBe(false);
    expect(check(numberRules.max, undefined, { max: 5 })).toBe(false);
  });
});

describe("numberRules.between", () => {
  it("проверяет обе границы включительно", () => {
    const params = { min: 1, max: 3 };
    expect(check(numberRules.between, 1, params)).toBe(true);
    expect(check(numberRules.between, 3, params)).toBe(true);
    expect(check(numberRules.between, 2, params)).toBe(true);
    expect(check(numberRules.between, 0.999, params)).toBe(false);
    expect(check(numberRules.between, 3.001, params)).toBe(false);
  });

  it("отклоняет нечисловые значения", () => {
    const params = { min: 1, max: 3 };
    expect(check(numberRules.between, Number.NaN, params)).toBe(false);
    expect(check(numberRules.between, Number.POSITIVE_INFINITY, params)).toBe(false);
    expect(check(numberRules.between, null, params)).toBe(false);
    expect(check(numberRules.between, undefined, params)).toBe(false);
  });
});

describe("numberRules.positive", () => {
  it("требует положительное конечное число", () => {
    expect(check(numberRules.positive, 0.1)).toBe(true);
    expect(check(numberRules.positive, 0)).toBe(false);
    expect(check(numberRules.positive, -1)).toBe(false);
    expect(check(numberRules.positive, Number.NaN)).toBe(false);
    expect(check(numberRules.positive, Number.POSITIVE_INFINITY)).toBe(false);
    expect(check(numberRules.positive, null)).toBe(false);
  });
});

describe("numberRules.negative", () => {
  it("требует отрицательное конечное число", () => {
    expect(check(numberRules.negative, -0.1)).toBe(true);
    expect(check(numberRules.negative, 0)).toBe(false);
    expect(check(numberRules.negative, 1)).toBe(false);
    expect(check(numberRules.negative, Number.NaN)).toBe(false);
    expect(check(numberRules.negative, Number.NEGATIVE_INFINITY)).toBe(false);
    expect(check(numberRules.negative, undefined)).toBe(false);
  });
});

describe("numberRules.nonNegative", () => {
  it("допускает ноль и положительные числа", () => {
    expect(check(numberRules.nonNegative, 0)).toBe(true);
    expect(check(numberRules.nonNegative, 1)).toBe(true);
    expect(check(numberRules.nonNegative, -0.001)).toBe(false);
    expect(check(numberRules.nonNegative, Number.NaN)).toBe(false);
    expect(check(numberRules.nonNegative, null)).toBe(false);
  });
});

describe("numberRules.nonPositive", () => {
  it("допускает ноль и отрицательные числа", () => {
    expect(check(numberRules.nonPositive, 0)).toBe(true);
    expect(check(numberRules.nonPositive, -1)).toBe(true);
    expect(check(numberRules.nonPositive, 0.001)).toBe(false);
    expect(check(numberRules.nonPositive, Number.NaN)).toBe(false);
    expect(check(numberRules.nonPositive, undefined)).toBe(false);
  });
});

describe("numberRules.multipleOf", () => {
  it("проверяет кратность целых чисел", () => {
    expect(check(numberRules.multipleOf, 12, { factor: 4 })).toBe(true);
    expect(check(numberRules.multipleOf, 0, { factor: 4 })).toBe(true);
    expect(check(numberRules.multipleOf, -8, { factor: 4 })).toBe(true);
    expect(check(numberRules.multipleOf, 10, { factor: 4 })).toBe(false);
  });

  it("поддерживает отрицательный множитель", () => {
    expect(check(numberRules.multipleOf, 8, { factor: -4 })).toBe(true);
    expect(check(numberRules.multipleOf, 9, { factor: -4 })).toBe(false);
  });

  it("сравнивает float-кратность с допуском", () => {
    expect(check(numberRules.multipleOf, 0.3, { factor: 0.1 })).toBe(true);
    expect(check(numberRules.multipleOf, 1.5, { factor: 0.5 })).toBe(true);
    expect(check(numberRules.multipleOf, 0.1 + 0.2, { factor: 0.1 })).toBe(true);
    expect(check(numberRules.multipleOf, 0.35, { factor: 0.1 })).toBe(false);
  });

  it("отклоняет нечисловые значения и нулевой множитель", () => {
    expect(check(numberRules.multipleOf, Number.NaN, { factor: 2 })).toBe(false);
    expect(check(numberRules.multipleOf, Number.POSITIVE_INFINITY, { factor: 2 })).toBe(false);
    expect(check(numberRules.multipleOf, null, { factor: 2 })).toBe(false);
    expect(check(numberRules.multipleOf, undefined, { factor: 2 })).toBe(false);
    expect(check(numberRules.multipleOf, 4, { factor: 0 })).toBe(false);
  });
});

describe("фабрики numbers", () => {
  it("возвращают декораторы", () => {
    expect(typeof Min(1)).toBe("function");
    expect(typeof Max(1)).toBe("function");
    expect(typeof Between(1, 2)).toBe("function");
    expect(typeof Positive()).toBe("function");
    expect(typeof Negative()).toBe("function");
    expect(typeof NonNegative()).toBe("function");
    expect(typeof NonPositive()).toBe("function");
    expect(typeof MultipleOf(2)).toBe("function");
  });

  it("регистрируют правило с параметрами", () => {
    class Sample {
      value!: number;
    }
    applyDecorator(Min(3), Sample, "value");
    applyDecorator(Max(10), Sample, "value");

    const slot = validationStateFor(new Sample()).fields.get("value");
    expect(slot?.rules.length).toBe(2);
    expect(slot?.rules[0]?.rule.name).toBe("min");
    expect(slot?.rules[0]?.rule.params).toEqual({ min: 3 });
    expect(slot?.rules[1]?.rule.name).toBe("max");
    expect(slot?.rules[1]?.rule.params).toEqual({ max: 10 });
  });

  it("запрещает нулевой и нечисловой множитель", () => {
    expect(() => MultipleOf(0)).toThrow(RangeError);
    expect(() => MultipleOf(Number.NaN)).toThrow(RangeError);
    expect(() => MultipleOf(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});
