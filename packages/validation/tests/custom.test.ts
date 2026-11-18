import { describe, expect, it } from "vitest";
import { Custom, customRules } from "../src/rules/custom.js";
import { validationStateFor } from "../src/registry.js";
import type { RuleDefinition, RuleRunContext } from "../src/types.js";

function contextFor(
  params: Readonly<Record<string, unknown>>,
  instance: object = {},
): RuleRunContext {
  return {
    instance,
    field: "value",
    label: "Value",
    path: "value",
    params,
  };
}

function ruleOf(instance: object): RuleDefinition {
  const entries = validationStateFor(instance).fields.get("value")?.rules ?? [];
  const first = entries[0];
  if (first === undefined) {
    throw new Error("Правило не зарегистрировано");
  }
  return first.rule;
}

describe("customRules", () => {
  it("описывает базовое правило", () => {
    expect(customRules.custom.name).toBe("custom");
    expect(customRules.custom.params).toEqual({});
    expect(customRules.custom.check("anything", contextFor({}))).toBe(true);
  });
});

describe("Custom", () => {
  it("регистрирует синхронную проверку", async () => {
    class SyncForm {
      @Custom((value) => value === "ok")
      value = "ok";
    }

    const instance = new SyncForm();
    const rule = ruleOf(instance);

    expect(rule.name).toBe("custom");
    expect(rule.params).toEqual({});
    await expect(rule.check("ok", contextFor(rule.params, instance))).toBe(
      true,
    );
    await expect(rule.check("no", contextFor(rule.params, instance))).toBe(
      false,
    );
  });

  it("передаёт контекст выполнения в проверку", async () => {
    class ContextForm {
      @Custom((_value, context) => context.field === "value")
      value = "ok";
    }

    const instance = new ContextForm();
    const rule = ruleOf(instance);

    await expect(rule.check("ok", contextFor(rule.params, instance))).toBe(
      true,
    );
  });

  it("поддерживает асинхронную проверку", async () => {
    class AsyncForm {
      @Custom(
        async (value) => typeof value === "string" && value.startsWith("a"),
      )
      value = "abc";
    }

    const instance = new AsyncForm();
    const rule = ruleOf(instance);
    const result = rule.check("abc", contextFor(rule.params, instance));

    expect(result).toBeInstanceOf(Promise);
    await expect(result).resolves.toBe(true);
    await expect(rule.check("xyz", contextFor(rule.params, instance))).resolves
      .toBe(false);
  });

  it("сохраняет опции декоратора", () => {
    class OptionsForm {
      @Custom(() => true, {
        message: "Неверное значение",
        label: "Поле",
        groups: ["create"],
      })
      value = "ok";
    }

    const entries = validationStateFor(new OptionsForm()).fields.get("value")
      ?.rules ?? [];

    expect(entries).toHaveLength(1);
    expect(entries[0]?.options.message).toBe("Неверное значение");
    expect(entries[0]?.options.label).toBe("Поле");
    expect(entries[0]?.options.groups).toEqual(["create"]);
  });
});
