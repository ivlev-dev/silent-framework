import { afterEach, describe, expect, it } from "vitest";
import {
  validate,
  validateAsync,
  validateOrThrow,
  validateOrThrowAsync,
} from "../src/engine";
import { ruleDecorator } from "../src/rule";
import { Optional } from "../src/modifiers";
import { SCHEMA_SYMBOL } from "../src/schema";
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

const stringRule: RuleDefinition = {
  name: "isString",
  params: {},
  check: (value) => typeof value === "string",
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

const rejectingCheck: RuleDefinition = {
  name: "rejectingCheck",
  params: {},
  check: async () => {
    throw new Error("boom");
  },
};

const eachCollection: RuleDefinition = {
  name: "each",
  params: {},
  nested: "each",
  check: () => true,
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
      public accessor name = "";

      @ruleDecorator(minText)
      public accessor age = 1;
    }

    const result = validate(new Person());

    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.field)).toEqual(["name", "age"]);
    expect(result.errors.map((error) => error.rule)).toEqual(["required", "minText"]);
  });

  it("возвращает валидный результат без ошибок", () => {
    class Person {
      @ruleDecorator(required)
      public accessor name = "Иван";
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
      public accessor value = "x";
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
      public accessor name = "";
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
      public accessor value = "x";
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
      public accessor createValue = "x";

      @ruleDecorator(alwaysInvalid, { groups: ["update"] })
      public accessor updateValue = "x";

      @ruleDecorator(alwaysInvalid)
      public accessor shared = "x";
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
      public accessor first = "";

      @ruleDecorator(required)
      public accessor second = "";
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
      public accessor name = "";
    }

    const [error] = validate(new CustomMessage()).errors;

    expect(error?.message).toBe("Поле name: ");
  });

  it("использует кастомное сообщение функцией", () => {
    class CustomMessage {
      @ruleDecorator(required, {
        message: (context) => `${context.rule}:${context.label}:${String(context.value)}`,
      })
      public accessor name = "";
    }

    expect(firstError(validate(new CustomMessage())).message).toBe("required:name:");
  });

  it("разрешает messageKey через configureValidation", () => {
    configureValidation({
      messages: { ru: { "custom.required": "Ключ {label}" } },
    });

    class Keyed {
      @ruleDecorator(required, { messageKey: "custom.required" })
      public accessor name = "";
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
      public accessor name = "";
    }

    expect(firstError(validate(new Resolved())).message).toBe("Резолвер: name");
  });

  it("переопределяет конфиг на уровне вызова", () => {
    configureValidation({
      messages: { ru: { "validation.required": "Глобально {label}" } },
    });

    class Overridden {
      @ruleDecorator(required)
      public accessor name = "";
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
      public accessor name = "";
    }

    const result = validate(new Localized(), { locale: "en", labels: { name: "Name" } });

    expect(firstError(result).message).toBe("Name is required");
  });

  it("останавливается на первой ошибке", () => {
    class Inner {
      @ruleDecorator(required)
      public accessor name = "";
    }

    class Outer {
      @ruleDecorator(nestedObject)
      public accessor inner = new Inner();

      @ruleDecorator(required)
      public accessor title = "";
    }

    const instance = new Outer();

    expect(validate(instance, { stopAtFirst: true }).errors).toHaveLength(1);
    expect(firstError(validate(instance, { stopAtFirst: true })).path).toBe("inner.name");
    expect(validate(instance).errors).toHaveLength(2);
  });

  it("применяет правило к каждому элементу массива", () => {
    class Tags {
      @ruleDecorator(minText, { each: true })
      public accessor tags: unknown = ["ab", "c"];
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
      public accessor tags: unknown = new Set(["ab", "c"]);
    }

    const error = firstError(validate(new Tags()));

    expect(error.path).toBe("tags[1]");
    expect(error.index).toBe(1);
  });

  it("сообщает одно нарушение, если each-значение не коллекция", () => {
    class Tags {
      @ruleDecorator(minText, { each: true })
      public accessor tags: unknown = "abc";
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
      public accessor name = "";
    }

    class Outer {
      @ruleDecorator(nestedObject)
      public accessor inner = new Inner();
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
      public accessor inner: unknown = 42;
    }

    const error = firstError(validate(new Outer()));

    expect(error.rule).toBe("nested");
    expect(error.path).toBe("inner");
    expect(error.value).toBe(42);
  });

  it("рекурсивно валидирует каждый вложенный объект", () => {
    class Item {
      @ruleDecorator(required)
      public accessor name = "";
    }

    class Basket {
      @ruleDecorator(nestedEach)
      public accessor items: unknown = [new Item(), new Item()];
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
      public accessor name = "ok";
    }

    class Basket {
      @ruleDecorator(nestedEach)
      public accessor items: unknown = [new Item(), 5];
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
      public accessor items: unknown = "nope";
    }

    const error = firstError(validate(new Basket()));

    expect(error.rule).toBe("nestedEach");
    expect(error.path).toBe("items");
    expect(error.index).toBeUndefined();
  });

  it("пересобирает план после поздней регистрации полей", () => {
    class Late {
      public probe = validate(this);

      @ruleDecorator(required)
      public accessor name = "";
    }

    const late = new Late();

    expect(late.probe.valid).toBe(true);
    expect(validate(late).errors.map((error) => error.field)).toEqual(["name"]);
  });

  it("гасит отклонённый промис асинхронного правила", async () => {
    class Box {
      @ruleDecorator(rejectingCheck)
      public accessor value = "x";
    }

    const rejections: unknown[] = [];
    const onRejection = (reason: unknown): void => {
      rejections.push(reason);
    };
    const proc = (globalThis as unknown as {
      process: {
        once(event: "unhandledRejection", listener: (reason: unknown) => void): void;
        off(event: "unhandledRejection", listener: (reason: unknown) => void): void;
      };
    }).process;
    proc.once("unhandledRejection", onRejection);
    try {
      expect(() => validate(new Box())).toThrow(AsyncRuleError);
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    } finally {
      proc.off("unhandledRejection", onRejection);
    }

    expect(rejections).toEqual([]);
  });

  it("считает thenable в when асинхронным условием", async () => {
    const when = (() => Promise.resolve(true)) as unknown as (instance: object) => boolean;

    class Box {
      @ruleDecorator(alwaysInvalid, { when })
      public accessor value = "x";
    }

    let thrown: unknown;
    try {
      validate(new Box());
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AsyncRuleError);
    expect((thrown as AsyncRuleError).field).toBe("value");
    expect((thrown as AsyncRuleError).rule).toBe("when");

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  });

  it("распознаёт функцию-thenable в синхронной проверке", () => {
    const functionThenable = Object.assign(() => undefined, {
      then: () => undefined,
    }) as unknown as boolean;
    const rule: RuleDefinition = {
      name: "functionThenable",
      params: {},
      check: () => functionThenable,
    };

    class Box {
      @ruleDecorator(rule)
      public accessor value = "x";
    }

    expect(() => validate(new Box())).toThrow(AsyncRuleError);
  });

  it("сообщает о не-коллекции без литерала {index}", () => {
    class Tags {
      @ruleDecorator(eachCollection)
      public accessor tags: unknown = "nope";
    }

    const error = firstError(validate(new Tags()));

    expect(error.rule).toBe("each");
    expect(error.message).toBe("Поле tags должно быть коллекцией");
    expect(error.message).not.toContain("{index}");
  });

  it("бросает TypeError для не-объекта", () => {
    expect(() => validate(null as unknown as object)).toThrow(TypeError);
    expect(() => validate(null as unknown as object)).toThrow(/объектом/);
    expect(() => validate("text" as unknown as object)).toThrow(TypeError);
  });

  it("бросает TypeError для массива", () => {
    expect(() => validate([] as unknown as object)).toThrow(TypeError);
    expect(() => validate([{}] as unknown as object)).toThrow(/объектом/);
  });

  it("принимает подклассы Array", () => {
    class List extends Array<number> {}
    expect(() => validate(new List())).not.toThrow();
    expect(validate(new List())).toEqual({ valid: true, errors: [] });
  });

  it("не читает отсутствующие поля из Object.prototype", () => {
    class Model {
      @ruleDecorator(required)
      public accessor name = "ok";
    }
    const model = new Model();
    const schema = {
      fields: {
        name: "string",
        toString: "string",
        constructor: "string",
        valueOf: "string",
      },
    };
    Object.defineProperty(Model, SCHEMA_SYMBOL, {
      value: schema,
      configurable: true,
    });

    const result = validate(model);

    expect(result.errors.map((error) => error.path)).toEqual([
      "toString",
      "constructor",
      "valueOf",
    ]);
    expect(result.errors.every((error) => error.value === undefined)).toBe(true);
  });

  it("читает auto-accessor с именем __proto__", () => {
    class Model {
      @ruleDecorator(stringRule)
      public accessor __proto__ = "ok";
    }

    expect(validate(new Model()).valid).toBe(true);
  });

  it("не падает при собственном constructor не-функции", () => {
    class Model {
      @ruleDecorator(required)
      public accessor name = "ok";
    }
    const model = new Model();
    Object.defineProperty(model, "constructor", {
      value: "broken",
      configurable: true,
    });

    expect(() => validate(model)).not.toThrow();
    expect(validate(model).valid).toBe(true);
  });

  it("принимает Date и пустые объекты без полей", () => {
    expect(validate(new Date())).toEqual({ valid: true, errors: [] });
    expect(validate({})).toEqual({ valid: true, errors: [] });
  });

  it("бросает AsyncRuleError при синхронной проверке", () => {
    class Box {
      @ruleDecorator(asyncCheck)
      public accessor value = "bad";
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
      public accessor value = "";
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
      public accessor value = "ok";
    }

    expect(() => validateOrThrow(new Box())).not.toThrow();
  });
});

describe("validateAsync", () => {
  it("ждёт асинхронные правила", async () => {
    class Box {
      @ruleDecorator(asyncCheck)
      public accessor value = "bad";
    }

    const result = await validateAsync(new Box());

    expect(result.valid).toBe(false);
    expect(firstError(result).rule).toBe("asyncCheck");
  });

  it("возвращает валидный результат для асинхронного успеха", async () => {
    class Box {
      @ruleDecorator(asyncCheck)
      public accessor value = "ok";
    }

    await expect(validateAsync(new Box())).resolves.toEqual({ valid: true, errors: [] });
  });

  it("ждёт вложенные асинхронные правила", async () => {
    class Inner {
      @ruleDecorator(asyncCheck)
      public accessor name = "bad";
    }

    class Outer {
      @ruleDecorator(nestedObject)
      public accessor inner = new Inner();
    }

    const error = firstError(await validateAsync(new Outer()));

    expect(error.path).toBe("inner.name");
  });

  it("бросает ValidationException из validateOrThrowAsync", async () => {
    class Box {
      @ruleDecorator(asyncCheck)
      public accessor value = "bad";
    }

    await expect(validateOrThrowAsync(new Box())).rejects.toBeInstanceOf(ValidationException);
  });

  it("не бросает при успешной асинхронной проверке", async () => {
    class Box {
      @ruleDecorator(asyncCheck)
      public accessor value = "ok";
    }

    await expect(validateOrThrowAsync(new Box())).resolves.toBeUndefined();
  });

  it("бросает TypeError для не-объекта", async () => {
    await expect(validateAsync(undefined as unknown as object)).rejects.toBeInstanceOf(TypeError);
  });
});

describe("глубина вложенных экземпляров", () => {
  class DeepNode {
    @ruleDecorator(required)
    public accessor name = "ok";

    @Optional()
    @ruleDecorator(nestedObject)
    public accessor next: DeepNode | null = null;
  }

  function chain(length: number): DeepNode {
    const head = new DeepNode();
    let current = head;
    for (let index = 1; index < length; index += 1) {
      const next = new DeepNode();
      current.next = next;
      current = next;
    }
    current.next = null;
    return head;
  }

  function depthErrors(result: ValidationResult): ValidationError[] {
    return result.errors.filter(
      (error) => error.rule === "type" && error.params["type"] === "depth",
    );
  }

  it("полностью обходит цепочку из 200 уровней", () => {
    expect(validate(chain(200)).valid).toBe(true);
  });

  it("на цепочке 300 уровней возвращает depth, а не RangeError", () => {
    const result = validate(chain(300));

    expect(result.valid).toBe(false);
    expect(depthErrors(result)).toHaveLength(1);
  });

  it("на цепочке 50 000 уровней возвращает depth, а не RangeError", () => {
    const result = validate(chain(50_000));

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.params).toEqual({ type: "depth" });
    expect(result.errors[0]?.rule).toBe("type");
    expect(result.errors[0]?.message).toContain("слишком глубоко");
  });

  it("ведёт себя одинаково в асинхронном режиме", async () => {
    expect((await validateAsync(chain(200))).valid).toBe(true);

    const deep = await validateAsync(chain(300));
    expect(depthErrors(deep)).toHaveLength(1);

    const tooDeep = await validateAsync(chain(50_000));
    expect(tooDeep.errors).toHaveLength(1);
    expect(tooDeep.errors[0]?.params).toEqual({ type: "depth" });
  });
});
