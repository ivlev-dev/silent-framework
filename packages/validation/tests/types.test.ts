import { describe, expect, it } from "vitest";
import type { RuleDecorator, RuleDefinition, RuleRunContext } from "../src/types.js";
import {
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
  IsFloat,
  IsFunction,
  IsInstanceOf,
  IsInt,
  IsNumber,
  IsObject,
  IsString,
  typeRules,
} from "../src/rules/types.js";
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

describe("typeRules.isString", () => {
  it("проверяет тип", () => {
    expect(check(typeRules.isString, "a")).toBe(true);
    expect(check(typeRules.isString, "")).toBe(true);
    expect(check(typeRules.isString, 1)).toBe(false);
    expect(check(typeRules.isString, null)).toBe(false);
    expect(check(typeRules.isString, undefined)).toBe(false);
    expect(check(typeRules.isString, ["a"])).toBe(false);
  });
});

describe("typeRules.isBoolean", () => {
  it("проверяет тип", () => {
    expect(check(typeRules.isBoolean, true)).toBe(true);
    expect(check(typeRules.isBoolean, false)).toBe(true);
    expect(check(typeRules.isBoolean, 0)).toBe(false);
    expect(check(typeRules.isBoolean, "true")).toBe(false);
    expect(check(typeRules.isBoolean, null)).toBe(false);
    expect(check(typeRules.isBoolean, undefined)).toBe(false);
  });
});

describe("typeRules.isInt", () => {
  it("принимает только целые числа", () => {
    expect(check(typeRules.isInt, 3)).toBe(true);
    expect(check(typeRules.isInt, -3)).toBe(true);
    expect(check(typeRules.isInt, 0)).toBe(true);
    expect(check(typeRules.isInt, 3.5)).toBe(false);
    expect(check(typeRules.isInt, Number.NaN)).toBe(false);
    expect(check(typeRules.isInt, Number.POSITIVE_INFINITY)).toBe(false);
    expect(check(typeRules.isInt, "3")).toBe(false);
  });
});

describe("typeRules.isFloat", () => {
  it("принимает конечные нецелые числа", () => {
    expect(check(typeRules.isFloat, 3.5)).toBe(true);
    expect(check(typeRules.isFloat, -0.5)).toBe(true);
    expect(check(typeRules.isFloat, 3)).toBe(false);
    expect(check(typeRules.isFloat, Number.NaN)).toBe(false);
    expect(check(typeRules.isFloat, Number.POSITIVE_INFINITY)).toBe(false);
    expect(check(typeRules.isFloat, "3.5")).toBe(false);
  });
});

describe("typeRules.isNumber", () => {
  it("принимает конечные числа, включая целые", () => {
    expect(check(typeRules.isNumber, 3)).toBe(true);
    expect(check(typeRules.isNumber, 3.5)).toBe(true);
    expect(check(typeRules.isNumber, -1)).toBe(true);
    expect(check(typeRules.isNumber, Number.NaN)).toBe(false);
    expect(check(typeRules.isNumber, Number.NEGATIVE_INFINITY)).toBe(false);
    expect(check(typeRules.isNumber, "3")).toBe(false);
    expect(check(typeRules.isNumber, null)).toBe(false);
    expect(check(typeRules.isNumber, undefined)).toBe(false);
  });
});

describe("typeRules.isArray", () => {
  it("проверяет массив", () => {
    expect(check(typeRules.isArray, [])).toBe(true);
    expect(check(typeRules.isArray, [1, 2])).toBe(true);
    expect(check(typeRules.isArray, { length: 0 })).toBe(false);
    expect(check(typeRules.isArray, "ab")).toBe(false);
    expect(check(typeRules.isArray, null)).toBe(false);
    expect(check(typeRules.isArray, undefined)).toBe(false);
  });
});

describe("typeRules.isDate", () => {
  it("принимает только валидные Date", () => {
    expect(check(typeRules.isDate, new Date())).toBe(true);
    expect(check(typeRules.isDate, new Date("2020-01-01T00:00:00Z"))).toBe(true);
    expect(check(typeRules.isDate, new Date("invalid"))).toBe(false);
    expect(check(typeRules.isDate, Date.now())).toBe(false);
    expect(check(typeRules.isDate, "2020-01-01")).toBe(false);
    expect(check(typeRules.isDate, null)).toBe(false);
    expect(check(typeRules.isDate, undefined)).toBe(false);
  });
});

describe("typeRules.isFunction", () => {
  it("проверяет функцию", () => {
    expect(check(typeRules.isFunction, () => undefined)).toBe(true);
    expect(check(typeRules.isFunction, class {})).toBe(true);
    expect(check(typeRules.isFunction, {})).toBe(false);
    expect(check(typeRules.isFunction, null)).toBe(false);
    expect(check(typeRules.isFunction, undefined)).toBe(false);
  });
});

describe("typeRules.isObject", () => {
  it("принимает объекты, кроме null и массивов", () => {
    expect(check(typeRules.isObject, {})).toBe(true);
    expect(check(typeRules.isObject, { a: 1 })).toBe(true);
    expect(check(typeRules.isObject, new Date())).toBe(true);
    expect(check(typeRules.isObject, [])).toBe(false);
    expect(check(typeRules.isObject, null)).toBe(false);
    expect(check(typeRules.isObject, undefined)).toBe(false);
    expect(check(typeRules.isObject, "{}")).toBe(false);
    expect(check(typeRules.isObject, () => undefined)).toBe(false);
  });
});

describe("typeRules.isEnum", () => {
  it("проверяет членство в массиве", () => {
    const params = { values: ["a", "b"] };
    expect(check(typeRules.isEnum, "a", params)).toBe(true);
    expect(check(typeRules.isEnum, "b", params)).toBe(true);
    expect(check(typeRules.isEnum, "c", params)).toBe(false);
    expect(check(typeRules.isEnum, null, params)).toBe(false);
    expect(check(typeRules.isEnum, undefined, params)).toBe(false);
  });

  it("проверяет членство по значениям объекта", () => {
    const params = { values: { A: "a", B: "b" } };
    expect(check(typeRules.isEnum, "a", params)).toBe(true);
    expect(check(typeRules.isEnum, "z", params)).toBe(false);
    expect(check(typeRules.isEnum, "A", params)).toBe(false);
  });

  it("поддерживает числовые enum-объекты", () => {
    const numericEnum = { 0: "Zero", 1: "One", Zero: 0, One: 1 };
    const params = { values: numericEnum };
    expect(check(typeRules.isEnum, 0, params)).toBe(true);
    expect(check(typeRules.isEnum, 1, params)).toBe(true);
    expect(check(typeRules.isEnum, 2, params)).toBe(false);
  });

  it("возвращает false без корректного параметра values", () => {
    expect(check(typeRules.isEnum, "a")).toBe(false);
    expect(check(typeRules.isEnum, "a", { values: null })).toBe(false);
  });
});

describe("typeRules.isInstanceOf", () => {
  class Animal {}
  class Dog extends Animal {}

  it("проверяет instanceof", () => {
    const params = { type: "Animal", ctor: Animal };
    expect(check(typeRules.isInstanceOf, new Animal(), params)).toBe(true);
    expect(check(typeRules.isInstanceOf, new Dog(), params)).toBe(true);
    expect(check(typeRules.isInstanceOf, {}, params)).toBe(false);
    expect(check(typeRules.isInstanceOf, null, params)).toBe(false);
    expect(check(typeRules.isInstanceOf, undefined, params)).toBe(false);
  });

  it("возвращает false без корректного конструктора", () => {
    expect(check(typeRules.isInstanceOf, new Animal(), { type: "Animal" })).toBe(false);
  });

  it("возвращает false для некорректной функции-конструктора", () => {
    const arrow = (() => undefined) as unknown as new () => unknown;
    expect(
      check(typeRules.isInstanceOf, new Animal(), { type: "Arrow", ctor: arrow }),
    ).toBe(false);
  });

  it("использует имя конструктора в параметрах декоратора", () => {
    class Sample {
      value!: Animal;
    }
    applyDecorator(IsInstanceOf(Animal), Sample, "value");

    const slot = validationStateFor(new Sample()).fields.get("value");
    expect(slot?.rules[0]?.rule.name).toBe("isInstanceOf");
    expect(slot?.rules[0]?.rule.params["type"]).toBe("Animal");

    class EnumSample {
      value!: string;
    }
    applyDecorator(IsEnum(["a", "b"]), EnumSample, "value");

    const enumSlot = validationStateFor(new EnumSample()).fields.get("value");
    expect(enumSlot?.rules[0]?.rule.name).toBe("isEnum");
    expect(enumSlot?.rules[0]?.rule.params["values"]).toEqual(["a", "b"]);
  });
});

describe("фабрики type", () => {
  it("возвращают декоратор", () => {
    expect(typeof IsString()).toBe("function");
    expect(typeof IsBoolean()).toBe("function");
    expect(typeof IsInt()).toBe("function");
    expect(typeof IsFloat()).toBe("function");
    expect(typeof IsNumber()).toBe("function");
    expect(typeof IsArray()).toBe("function");
    expect(typeof IsDate()).toBe("function");
    expect(typeof IsFunction()).toBe("function");
    expect(typeof IsObject()).toBe("function");
    expect(typeof IsEnum(["a"])).toBe("function");
    expect(typeof IsInstanceOf(Date)).toBe("function");
  });
});
