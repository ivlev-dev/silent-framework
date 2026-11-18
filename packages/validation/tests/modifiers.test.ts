import { describe, expect, it } from "vitest";
import { validate } from "../src/engine";
import { ruleDecorator } from "../src/rule";
import { Groups, Label, Optional, ValidateIf } from "../src/modifiers";
import type { RuleDefinition, ValidationResult } from "../src/types";

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
