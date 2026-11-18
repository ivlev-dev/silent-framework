import { afterEach, describe, expect, it } from "vitest";
import {
  validate,
  validateAsync,
  validateOrThrow,
  validateOrThrowAsync,
} from "../src/engine";
import { ruleDecorator } from "../src/rule";
import {
  configureValidation,
  resetValidationConfig,
} from "../src/messages";
import {
  AsyncRuleError,
  ValidationException,
} from "../src/types";
import type {
  RuleDefinition,
  ValidationError,
  ValidationResult,
} from "../src/types";

const required: RuleDefinition = {
  name: "required",
  params: {},
  check: (value) => value !== undefined && value !== null && value !== "",
};

const alwaysInvalid: RuleDefinition = {
  name: "alwaysInvalid",
  params: {},
  check: () => false,
};

const minText: RuleDefinition = {
  name: "minText",
  params: { min: 2 },
  check: (value) => typeof value === "string" && value.length >= 2,
};

const nestedObject: RuleDefinition = {
  name: "nested",
  params: {},
  check: () => true,
  nested: "object",
};

const nestedEach: RuleDefinition = {
  name: "nestedEach",
  params: {},
  check: () => true,
  nested: "each",
};

const asyncCheck: RuleDefinition = {
  name: "asyncCheck",
  params: {},
  check: async (value) => value === "ok",
};

function firstError(result: ValidationResult): ValidationError {
  const [error] = result.errors;
  if (error === undefined) {
    throw new Error("Ожидалась хотя бы одна ошибка валидации");
  }
  return error;
}

afterEach(() => {
  resetValidationConfig();
});

describe("validate", () => {
  it("валидирует несколько полей и правил", () => {
    class Person {
      @ruleDecorator(required)
      name = "";

      @ruleDecorator(minText)
      age = 1;
    }

    const result = validate(new Person());

    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.field)).toEqual(["name", "age"]);
    expect(result.errors.map((error) => error.rule)).toEqual(["required", "minText"]);
  });

  it("возвращает валидный результат без ошибок", () => {
    class Person {
      @ruleDecorator(required)
      name = "Иван";
    }

    const result = validate(new Person());

    expect(result).toEqual({ valid: true, errors: [] });
  });

  it("запускает верхний декоратор первым", () => {
    const second: RuleDefinition = {
      name: "second",
      params: {},
      check: () => false,
    };

    class Ordered {
      @ruleDecorator(alwaysInvalid)
      @ruleDecorator(second)
      value = "x";
    }

    const result = validate(new Ordered());

    expect(result.errors.map((error) => error.rule)).toEqual([
      "alwaysInvalid",
      "second",
    ]);
  });

  it("поддерживает required-подобную проверку", () => {
    class Required {
      @ruleDecorator(required)
      name = "";
    }

    expect(validate(new Required()).valid).toBe(false);
    const instance = new Required();
    instance.name = "ok";
    expect(validate(instance).valid).toBe(true);
  });

  it("пропускает правило при options.when === false", () => {
    const seen: object[] = [];

    class Conditional {
      enabled = false;

      @ruleDecorator(alwaysInvalid, {
        when: (instance) => {
          seen.push(instance);
          return (instance as Conditional).enabled;
        },
      })
      value = "x";
    }

    const instance = new Conditional();
    expect(validate(instance).valid).toBe(true);
    expect(seen).toEqual([instance]);

    instance.enabled = true;
    expect(validate(instance).valid).toBe(false);
  });

  it("учитывает группы вызова и правила", () => {
    class Grouped {
      @ruleDecorator(alwaysInvalid, { groups: ["create"] })
      createValue = "x";

      @ruleDecorator(alwaysInvalid, { groups: ["update"] })
      updateValue = "x";

      @ruleDecorator(alwaysInvalid)
      shared = "x";
    }

    const instance = new Grouped();

    expect(validate(instance, { groups: ["update"] }).errors.map((error) => error.field)).toEqual([
      "updateValue",
      "shared",
    ]);
    expect(validate(instance, { groups: ["create", "update"] }).errors).toHaveLength(3);
    expect(validate(instance).errors).toHaveLength(3);
    expect(validate(instance, { groups: ["other"] }).errors.map((error) => error.field)).toEqual([
      "shared",
    ]);
  });

  it("подставляет label из опций правила, слота и вызова", () => {
    class Labelled {
      @ruleDecorator(required, { label: "Из правила" })
      first = "";

      @ruleDecorator(required)
      second = "";
    }

    const instance = new Labelled();
    const defaults = validate(instance).errors;

    expect(defaults[0]?.label).toBe("Из правила");
    expect(defaults[1]?.label).toBe("second");
    expect(defaults[1]?.message).toContain("Поле second обязательно");

    const overridden = validate(instance, { labels: { second: "Из вызова" } }).errors;

    expect(overridden[0]?.label).toBe("Из правила");
    expect(overridden[1]?.label).toBe("Из вызова");
    expect(overridden[1]?.message).toContain("Из вызова");
  });

  it("использует кастомное сообщение строкой", () => {
    class CustomMessage {
      @ruleDecorator(required, { message: "Поле {label}: {value}" })
      name = "";
    }

    const [error] = validate(new CustomMessage()).errors;

    expect(error?.message).toBe("Поле name: ");
  });

  it("использует кастомное сообщение функцией", () => {
    class CustomMessage {
      @ruleDecorator(required, {
        message: (context) => `${context.rule}:${context.label}:${String(context.value)}`,
      })
      name = "";
    }

    expect(firstError(validate(new CustomMessage())).message).toBe("required:name:");
  });

  it("разрешает messageKey через configureValidation", () => {
    configureValidation({
      messages: { ru: { "custom.required": "Ключ {label}" } },
    });

    class Keyed {
      @ruleDecorator(required, { messageKey: "custom.required" })
      name = "";
    }

    expect(firstError(validate(new Keyed())).message).toBe("Ключ name");
  });

  it("разрешает сообщение через resolve из configureValidation", () => {
    configureValidation({
      resolve: (context) => (
        context.key === "validation.required" ? `Резолвер: ${context.label}` : undefined
      ),
    });

    class Resolved {
      @ruleDecorator(required)
      name = "";
    }

    expect(firstError(validate(new Resolved())).message).toBe("Резолвер: name");
  });

  it("переопределяет конфиг на уровне вызова", () => {
    configureValidation({
      messages: { ru: { "validation.required": "Глобально {label}" } },
    });

    class Overridden {
      @ruleDecorator(required)
      name = "";
    }

    const instance = new Overridden();

    expect(firstError(validate(instance)).message).toBe("Глобально name");
    expect(firstError(validate(instance, {
      messages: { ru: { "validation.required": "Вызов {label}" } },
    })).message).toBe("Вызов name");
    expect(firstError(validate(instance, {
      resolve: (context) => `Резолвер вызова: ${context.key}`,
    })).message).toBe("Резолвер вызова: validation.required");
  });

  it("переключает локаль на уровне вызова", () => {
    class Localized {
      @ruleDecorator(required)
      name = "";
    }

    const result = validate(new Localized(), { locale: "en", labels: { name: "Name" } });

    expect(firstError(result).message).toBe("Name is required");
  });

  it("останавливается на первой ошибке", () => {
    class Inner {
      @ruleDecorator(required)
      name = "";
    }

    class Outer {
      @ruleDecorator(nestedObject)
      inner = new Inner();

      @ruleDecorator(required)
      title = "";
    }

    const instance = new Outer();

    expect(validate(instance, { stopAtFirst: true }).errors).toHaveLength(1);
    expect(firstError(validate(instance, { stopAtFirst: true })).path).toBe("inner.name");
    expect(validate(instance).errors).toHaveLength(2);
  });

  it("применяет правило к каждому элементу массива", () => {
    class Tags {
      @ruleDecorator(minText, { each: true })
      tags: unknown = ["ab", "c"];
    }

    const result = validate(new Tags());

    expect(result.errors).toHaveLength(1);
    const error = firstError(result);
    expect(error.field).toBe("tags");
    expect(error.path).toBe("tags[1]");
    expect(error.index).toBe(1);
    expect(error.value).toBe("c");
  });

  it("применяет правило к каждому элементу Set", () => {
    class Tags {
      @ruleDecorator(minText, { each: true })
      tags: unknown = new Set(["ab", "c"]);
    }

    const error = firstError(validate(new Tags()));

    expect(error.path).toBe("tags[1]");
    expect(error.index).toBe(1);
  });

  it("сообщает одно нарушение, если each-значение не коллекция", () => {
    class Tags {
      @ruleDecorator(minText, { each: true })
      tags: unknown = "abc";
    }

    const result = validate(new Tags());

    expect(result.errors).toHaveLength(1);
    const error = firstError(result);
    expect(error.path).toBe("tags");
    expect(error.index).toBeUndefined();
    expect(error.value).toBe("abc");
  });

  it("рекурсивно валидирует вложенный объект", () => {
    class Inner {
      @ruleDecorator(required)
      name = "";
    }

    class Outer {
      @ruleDecorator(nestedObject)
      inner = new Inner();
    }

    const result = validate(new Outer());

    expect(result.errors).toHaveLength(1);
    const error = firstError(result);
    expect(error.field).toBe("name");
    expect(error.path).toBe("inner.name");
    expect(error.rule).toBe("required");
  });

  it("сообщает ошибку nested-правила для не-объекта", () => {
    class Outer {
      @ruleDecorator(nestedObject)
      inner: unknown = 42;
    }

    const error = firstError(validate(new Outer()));

    expect(error.rule).toBe("nested");
    expect(error.path).toBe("inner");
    expect(error.value).toBe(42);
  });

  it("рекурсивно валидирует каждый вложенный объект", () => {
    class Item {
      @ruleDecorator(required)
      name = "";
    }

    class Basket {
      @ruleDecorator(nestedEach)
      items: unknown = [new Item(), new Item()];
    }

    const result = validate(new Basket());

    expect(result.errors.map((error) => error.path)).toEqual([
      "items[0].name",
      "items[1].name",
    ]);
  });

  it("сообщает ошибку nested each для не-объекта", () => {
    class Item {
      @ruleDecorator(required)
      name = "ok";
    }

    class Basket {
      @ruleDecorator(nestedEach)
      items: unknown = [new Item(), 5];
    }

    const result = validate(new Basket());

    expect(result.errors).toHaveLength(1);
    const error = firstError(result);
    expect(error.rule).toBe("nestedEach");
    expect(error.path).toBe("items[1]");
    expect(error.index).toBe(1);
    expect(error.value).toBe(5);
  });

  it("сообщает ошибку nested each для не-коллекции", () => {
    class Basket {
      @ruleDecorator(nestedEach)
      items: unknown = "nope";
    }

    const error = firstError(validate(new Basket()));

    expect(error.rule).toBe("nestedEach");
    expect(error.path).toBe("items");
    expect(error.index).toBeUndefined();
  });

  it("бросает TypeError для не-объекта", () => {
    expect(() => validate(null as unknown as object)).toThrow(TypeError);
    expect(() => validate(null as unknown as object)).toThrow(/объектом/);
    expect(() => validate("text" as unknown as object)).toThrow(TypeError);
  });

  it("бросает AsyncRuleError при синхронной проверке", () => {
    class Box {
      @ruleDecorator(asyncCheck)
      value = "bad";
    }

    let thrown: unknown;
    try {
      validate(new Box());
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AsyncRuleError);
    const asyncError = thrown as AsyncRuleError;
    expect(asyncError.field).toBe("value");
    expect(asyncError.rule).toBe("asyncCheck");
  });

  it("бросает ValidationException из validateOrThrow", () => {
    class Box {
      @ruleDecorator(required)
      value = "";
    }

    let thrown: unknown;
    try {
      validateOrThrow(new Box());
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ValidationException);
    expect((thrown as ValidationException).errors).toHaveLength(1);
    expect((thrown as ValidationException).result.valid).toBe(false);
  });

  it("не бросает ValidationException при успехе", () => {
    class Box {
      @ruleDecorator(required)
      value = "ok";
    }

    expect(() => validateOrThrow(new Box())).not.toThrow();
  });
});

describe("validateAsync", () => {
  it("ждёт асинхронные правила", async () => {
    class Box {
      @ruleDecorator(asyncCheck)
      value = "bad";
    }

    const result = await validateAsync(new Box());

    expect(result.valid).toBe(false);
    expect(firstError(result).rule).toBe("asyncCheck");
  });

  it("возвращает валидный результат для асинхронного успеха", async () => {
    class Box {
      @ruleDecorator(asyncCheck)
      value = "ok";
    }

    await expect(validateAsync(new Box())).resolves.toEqual({ valid: true, errors: [] });
  });

  it("ждёт вложенные асинхронные правила", async () => {
    class Inner {
      @ruleDecorator(asyncCheck)
      name = "bad";
    }

    class Outer {
      @ruleDecorator(nestedObject)
      inner = new Inner();
    }

    const error = firstError(await validateAsync(new Outer()));

    expect(error.path).toBe("inner.name");
  });

  it("бросает ValidationException из validateOrThrowAsync", async () => {
    class Box {
      @ruleDecorator(asyncCheck)
      value = "bad";
    }

    await expect(validateOrThrowAsync(new Box())).rejects.toBeInstanceOf(ValidationException);
  });

  it("не бросает при успешной асинхронной проверке", async () => {
    class Box {
      @ruleDecorator(asyncCheck)
      value = "ok";
    }

    await expect(validateOrThrowAsync(new Box())).resolves.toBeUndefined();
  });

  it("бросает TypeError для не-объекта", async () => {
    await expect(validateAsync(undefined as unknown as object)).rejects.toBeInstanceOf(TypeError);
  });
});
