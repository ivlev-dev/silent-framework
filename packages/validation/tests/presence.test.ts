import { describe, expect, it } from "vitest";
import type { RuleDecorator, RuleDefinition, RuleRunContext } from "../src/types.js";
import {
  IsDefined,
  NotEmpty,
  NotNull,
  NotUndefined,
  Required,
  presenceRules,
} from "../src/rules/presence.js";
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

function check(rule: RuleDefinition, value: unknown): boolean {
  const result = rule.check(value, context());
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
    kind: "field" as const,
    name: field,
    static: false,
    private: false,
    addInitializer: (initializer: (this: object) => void): void => {
      initializers.push(initializer);
    },
  };
  decorator(
    undefined,
    fakeContext as unknown as ClassFieldDecoratorContext<object, unknown>,
  );
  const instance = new ctor();
  for (const initializer of initializers) {
    initializer.call(instance);
  }
}

describe("presenceRules.required", () => {
  it("отклоняет undefined, null и пустую строку", () => {
    expect(check(presenceRules.required, undefined)).toBe(false);
    expect(check(presenceRules.required, null)).toBe(false);
    expect(check(presenceRules.required, "")).toBe(false);
  });

  it("принимает прочие значения", () => {
    expect(check(presenceRules.required, " ")).toBe(true);
    expect(check(presenceRules.required, "a")).toBe(true);
    expect(check(presenceRules.required, 0)).toBe(true);
    expect(check(presenceRules.required, false)).toBe(true);
    expect(check(presenceRules.required, [])).toBe(true);
    expect(check(presenceRules.required, {})).toBe(true);
    expect(check(presenceRules.required, Number.NaN)).toBe(true);
  });
});

describe("presenceRules.notNull", () => {
  it("отклоняет null и undefined", () => {
    expect(check(presenceRules.notNull, null)).toBe(false);
    expect(check(presenceRules.notNull, undefined)).toBe(false);
  });

  it("принимает остальные значения, включая пустую строку", () => {
    expect(check(presenceRules.notNull, "")).toBe(true);
    expect(check(presenceRules.notNull, 0)).toBe(true);
    expect(check(presenceRules.notNull, false)).toBe(true);
  });
});

describe("presenceRules.notUndefined", () => {
  it("отклоняет только undefined", () => {
    expect(check(presenceRules.notUndefined, undefined)).toBe(false);
    expect(check(presenceRules.notUndefined, null)).toBe(true);
    expect(check(presenceRules.notUndefined, "")).toBe(true);
    expect(check(presenceRules.notUndefined, 0)).toBe(true);
  });
});

describe("presenceRules.isDefined", () => {
  it("ведёт себя как notUndefined и имеет собственное имя", () => {
    expect(presenceRules.isDefined.name).toBe("isDefined");
    expect(check(presenceRules.isDefined, undefined)).toBe(false);
    expect(check(presenceRules.isDefined, null)).toBe(true);
  });
});

describe("presenceRules.notEmpty", () => {
  it("отклоняет null и undefined", () => {
    expect(check(presenceRules.notEmpty, null)).toBe(false);
    expect(check(presenceRules.notEmpty, undefined)).toBe(false);
  });

  it("отклоняет пустые и пробельные строки", () => {
    expect(check(presenceRules.notEmpty, "")).toBe(false);
    expect(check(presenceRules.notEmpty, "   ")).toBe(false);
    expect(check(presenceRules.notEmpty, "\n\t ")).toBe(false);
    expect(check(presenceRules.notEmpty, " a ")).toBe(true);
  });

  it("отклоняет пустые массивы, Set, Map и объекты", () => {
    expect(check(presenceRules.notEmpty, [])).toBe(false);
    expect(check(presenceRules.notEmpty, [0])).toBe(true);
    expect(check(presenceRules.notEmpty, new Set())).toBe(false);
    expect(check(presenceRules.notEmpty, new Set([0]))).toBe(true);
    expect(check(presenceRules.notEmpty, new Map())).toBe(false);
    expect(check(presenceRules.notEmpty, new Map([["a", 0]]))).toBe(true);
    expect(check(presenceRules.notEmpty, {})).toBe(false);
    expect(check(presenceRules.notEmpty, { a: undefined })).toBe(true);
  });

  it("принимает прочие значения", () => {
    expect(check(presenceRules.notEmpty, 0)).toBe(true);
    expect(check(presenceRules.notEmpty, false)).toBe(true);
    expect(check(presenceRules.notEmpty, Number.NaN)).toBe(true);
  });
});

describe("фабрики presence", () => {
  it("возвращают декоратор и регистрируют правило", () => {
    class Sample {
      value!: string;
    }

    expect(typeof Required()).toBe("function");
    expect(typeof NotNull()).toBe("function");
    expect(typeof NotUndefined()).toBe("function");
    expect(typeof IsDefined()).toBe("function");
    expect(typeof NotEmpty()).toBe("function");

    applyDecorator(Required(), Sample, "value");

    const state = validationStateFor(new Sample());
    const slot = state.fields.get("value");
    expect(slot?.rules.length).toBe(1);
    expect(slot?.rules[0]?.rule.name).toBe("required");
    expect(slot?.rules[0]?.rule.params).toEqual({});
  });
});
