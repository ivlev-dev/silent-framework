import { describe, expect, it } from "vitest";
import {
  safeParseAsync,
  validate,
  validateAsync,
  validateProperty,
  validatePropertyAsync,
} from "../src/engine";
import { ruleDecorator } from "../src/rule";
import { Groups, Label, Optional, ValidateIf } from "../src/modifiers";
import { Each, IsEmail, Nested, Required } from "../src/index";
import { AsyncRuleError } from "../src/types";
import type {
  InstancePredicate,
  RuleDefinition,
  ValidationResult,
} from "../src/types";

const required: RuleDefinition = {
  name: "required",
  params: {},
  check: (value) => value !== undefined && value !== null && value !== "",
};

function firstMessage(result: ValidationResult): string {
  const [error] = result.errors;
  if (error === undefined) {
    throw new Error("Ожидалась хотя бы одна ошибка валидации");
  }
  return error.message;
}

describe("ValidateIf", () => {
  it("пропускает правила, если условие ложно (ValidateIf выше правила)", () => {
    class ConditionalBefore {
      enabled = false;

      @ValidateIf((instance) => (instance as ConditionalBefore).enabled)
      @ruleDecorator(required)
      public accessor name = "";
    }

    const instance = new ConditionalBefore();
    expect(validate(instance).valid).toBe(true);

    instance.enabled = true;
    expect(validate(instance).valid).toBe(false);
  });

  it("работает независимо от порядка декораторов", () => {
    class ConditionalAfter {
      enabled = true;

      @ruleDecorator(required)
      @ValidateIf((instance) => (instance as ConditionalAfter).enabled)
      public accessor name = "";
    }

    const instance = new ConditionalAfter();
    expect(validate(instance).valid).toBe(false);

    instance.enabled = false;
    expect(validate(instance).valid).toBe(true);
  });

  it("получает сам экземпляр в предикат", () => {
    const seen: object[] = [];

    class Conditional {
      @ValidateIf((instance) => {
        seen.push(instance);
        return true;
      })
      @ruleDecorator(required)
      public accessor name = "";
    }

    const instance = new Conditional();
    validate(instance);

    expect(seen).toContain(instance);
  });

  it("не влияет на другие поля", () => {
    class Mixed {
      enabled = false;

      @ValidateIf((instance) => (instance as Mixed).enabled)
      @ruleDecorator(required)
      public accessor conditional = "";

      @ruleDecorator(required)
      public accessor always = "";
    }

    const result = validate(new Mixed());

    expect(result.errors.map((error) => error.field)).toEqual(["always"]);
  });

  it("сообщает об асинхронном предикате в синхронном движке и гасит промис", async () => {
    const predicate = (() => Promise.reject(new Error("boom"))) as unknown as InstancePredicate;

    class Conditional {
      @ValidateIf(predicate)
      @ruleDecorator(required)
      public accessor name = "";
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
      let thrown: unknown;
      try {
        validate(new Conditional());
      } catch (error: unknown) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(AsyncRuleError);
      expect((thrown as AsyncRuleError).field).toBe("name");
      expect((thrown as AsyncRuleError).rule).toBe("validateIf");

      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    } finally {
      proc.off("unhandledRejection", onRejection);
    }

    expect(rejections).toEqual([]);
  });
});

describe("ValidateIf: асинхронные условия", () => {
  it("ожидает true и false в validateAsync", async () => {
    class Conditional {
      enabled = true;

      @ValidateIf(async (instance) => (instance as Conditional).enabled)
      @ruleDecorator(required)
      public accessor name = "";
    }

    const instance = new Conditional();
    expect((await validateAsync(instance)).valid).toBe(false);

    instance.enabled = false;
    expect((await validateAsync(instance)).valid).toBe(true);
  });

  it("в синхронном движке бросает AsyncRuleError", async () => {
    class Conditional {
      @ValidateIf(async () => true)
      @ruleDecorator(required)
      public accessor name = "";
    }

    expect(() => validate(new Conditional())).toThrow(AsyncRuleError);
    expect(() => validateProperty(new Conditional(), "name")).toThrow(AsyncRuleError);
    // Промис предиката не должен всплыть как unhandled rejection.
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  });

  it("отклонённый предикат отклоняет validateAsync исходной ошибкой", async () => {
    const boom = new Error("boom");

    class Conditional {
      @ValidateIf(async () => {
        throw boom;
      })
      @ruleDecorator(required)
      public accessor name = "";
    }

    await expect(validateAsync(new Conditional())).rejects.toBe(boom);
  });

  it("сочетается с Required и IsEmail", async () => {
    class EmailModel {
      enabled = true;

      @ValidateIf(async (instance) => (instance as EmailModel).enabled)
      @Required()
      @IsEmail()
      public accessor email = "not-an-email";
    }

    const instance = new EmailModel();
    const invalid = await validateAsync(instance);
    expect(invalid.errors.map((error) => error.rule)).toEqual(["isEmail"]);

    instance.enabled = false;
    expect((await validateAsync(instance)).valid).toBe(true);
  });

  it("объединяет несколько асинхронных условий по «И»", async () => {
    class Conditional {
      first = true;
      second = true;

      @ValidateIf(async (instance) => (instance as Conditional).first)
      @ValidateIf(async (instance) => (instance as Conditional).second)
      @ruleDecorator(required)
      public accessor name = "";
    }

    const instance = new Conditional();
    expect((await validateAsync(instance)).valid).toBe(false);

    instance.first = false;
    expect((await validateAsync(instance)).valid).toBe(true);

    instance.first = true;
    instance.second = false;
    expect((await validateAsync(instance)).valid).toBe(true);
  });

  it("учитывает groups и stopAtFirst при асинхронном условии", async () => {
    class Conditional {
      enabled = true;

      @ValidateIf(async (instance) => (instance as Conditional).enabled)
      @Groups("update")
      @ruleDecorator(required)
      public accessor name = "";

      @ruleDecorator(required)
      public accessor other = "";
    }

    const instance = new Conditional();
    const create = await validateAsync(instance, {
      groups: ["create"],
      stopAtFirst: true,
    });
    expect(create.errors.map((error) => error.field)).toEqual(["other"]);

    const update = await validateAsync(instance, {
      groups: ["update"],
      stopAtFirst: true,
    });
    expect(update.errors.map((error) => error.field)).toEqual(["name"]);
  });

  it("не вызывает предикат для Optional-поля без значения", async () => {
    let calls = 0;

    class Conditional {
      @Optional()
      @ValidateIf(async () => {
        calls += 1;
        return true;
      })
      @ruleDecorator(required)
      public accessor name: string | undefined = undefined;
    }

    expect((await validateAsync(new Conditional())).valid).toBe(true);
    expect(calls).toBe(0);
  });

  it("работает в validatePropertyAsync и safeParseAsync", async () => {
    class Conditional {
      enabled = false;

      @ValidateIf(async (instance) => (instance as Conditional).enabled)
      @ruleDecorator(required)
      public accessor name = "";
    }

    const instance = new Conditional();
    expect((await validatePropertyAsync(instance, "name")).valid).toBe(true);

    instance.enabled = true;
    const parsed = await safeParseAsync(instance);
    expect(parsed.success).toBe(false);
    expect(parsed.errors.map((error) => error.field)).toEqual(["name"]);
  });

  it("работает во вложенных формах и в @Each", async () => {
    class Child {
      enabled = true;

      @ValidateIf(async (instance) => (instance as Child).enabled)
      @ruleDecorator(required)
      public accessor name = "";
    }

    class Parent {
      @Nested()
      public accessor child = new Child();
    }

    const parent = new Parent();
    expect((await validateAsync(parent)).errors.map((error) => error.path))
      .toEqual(["child.name"]);

    parent.child.enabled = false;
    expect((await validateAsync(parent)).valid).toBe(true);

    class List {
      @Each()
      public accessor children = [new Child(), new Child()];
    }

    const list = new List();
    const first = list.children[0];
    expect(first).toBeDefined();
    if (first !== undefined) {
      first.enabled = false;
    }
    const result = await validateAsync(list);
    expect(result.errors.map((error) => error.path)).toEqual(["children[1].name"]);
  });
});

describe("повторное использование декоратора", () => {
  it("применяет один экземпляр правила к нескольким полям", () => {
    const decorator = ruleDecorator(required);

    class Model {
      @decorator
      public accessor first = "";

      @decorator
      public accessor second = "";
    }

    expect(validate(new Model()).errors.map((error) => error.field))
      .toEqual(["first", "second"]);
  });

  it("применяет один экземпляр Label к нескольким полям", () => {
    const label = Label("Общее");

    class Model {
      @label
      @ruleDecorator(required)
      public accessor first = "";

      @label
      @ruleDecorator(required)
      public accessor second = "";
    }

    expect(validate(new Model()).errors.map((error) => error.label))
      .toEqual(["Общее", "Общее"]);
  });

  it("применяет один экземпляр Optional к нескольким полям", () => {
    const optional = Optional();

    class Model {
      @optional
      @ruleDecorator(required)
      public accessor first: string | undefined = undefined;

      @optional
      @ruleDecorator(required)
      public accessor second: string | undefined = undefined;
    }

    expect(validate(new Model()).valid).toBe(true);
  });
});

describe("Optional", () => {
  it("пропускает правила для undefined и null", () => {
    class Maybe {
      @Optional()
      @ruleDecorator(required)
      public accessor name: string | null | undefined = undefined;
    }

    const instance = new Maybe();
    expect(validate(instance).valid).toBe(true);

    instance.name = null;
    expect(validate(instance).valid).toBe(true);

    instance.name = "ok";
    expect(validate(instance).valid).toBe(true);
  });

  it("не пропускает пустую строку", () => {
    class Maybe {
      @Optional()
      @ruleDecorator(required)
      public accessor name: string | null | undefined = "";
    }

    expect(validate(new Maybe()).valid).toBe(false);
    expect(validate(new Maybe()).errors).toHaveLength(1);
  });

  it("работает при обратном порядке декораторов", () => {
    class Maybe {
      @ruleDecorator(required)
      @Optional()
      public accessor name: string | undefined = undefined;
    }

    expect(validate(new Maybe()).valid).toBe(true);
  });
});

describe("Label", () => {
  it("подставляет label в сообщение", () => {
    class Labelled {
      @Label("Имя")
      @ruleDecorator(required)
      public accessor name = "";
    }

    expect(firstMessage(validate(new Labelled()))).toBe("Поле Имя обязательно");
  });

  it("работает при обратном порядке декораторов", () => {
    class Labelled {
      @ruleDecorator(required)
      @Label("Имя")
      public accessor name = "";
    }

    expect(firstMessage(validate(new Labelled()))).toBe("Поле Имя обязательно");
  });

  it("сохраняет label в описании ошибки", () => {
    class Labelled {
      @Label("Имя")
      @ruleDecorator(required)
      public accessor name = "";
    }

    const [error] = validate(new Labelled()).errors;
    expect(error?.label).toBe("Имя");
  });
});

describe("Groups", () => {
  it("выполняет правило только при пересечении групп", () => {
    class Grouped {
      @Groups("update")
      @ruleDecorator(required)
      public accessor name = "";
    }

    const instance = new Grouped();

    expect(validate(instance).valid).toBe(false);
    expect(validate(instance, { groups: ["update"] }).valid).toBe(false);
    expect(validate(instance, { groups: ["create"] }).valid).toBe(true);
    expect(validate(instance, { groups: ["create", "update"] }).valid).toBe(false);
  });

  it("работает при обратном порядке декораторов", () => {
    class Grouped {
      @ruleDecorator(required)
      @Groups("update")
      public accessor name = "";
    }

    expect(validate(new Grouped(), { groups: ["create"] }).valid).toBe(true);
    expect(validate(new Grouped(), { groups: ["update"] }).valid).toBe(false);
  });

  it("применяется ко всем правилам поля", () => {
    const second: RuleDefinition = {
      name: "second",
      params: {},
      check: () => false,
    };

    class Grouped {
      @Groups("update")
      @ruleDecorator(required)
      @ruleDecorator(second)
      public accessor name = "";
    }

    expect(validate(new Grouped(), { groups: ["create"] }).valid).toBe(true);
    expect(validate(new Grouped(), { groups: ["update"] }).errors).toHaveLength(2);
  });

  it("отдаёт приоритет группам из опций правила", () => {
    const second: RuleDefinition = {
      name: "second",
      params: {},
      check: () => false,
    };

    class Grouped {
      @Groups("update")
      @ruleDecorator(required, { groups: ["create"] })
      @ruleDecorator(second)
      public accessor name = "";
    }

    const instance = new Grouped();

    expect(validate(instance, { groups: ["update"] }).errors.map((error) => error.rule))
      .toEqual(["second"]);
    expect(validate(instance, { groups: ["create"] }).errors.map((error) => error.rule))
      .toEqual(["required"]);
  });
});
