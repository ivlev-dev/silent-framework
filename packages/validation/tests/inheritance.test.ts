import { describe, expect, it } from "vitest";
import { validate } from "../src/engine";
import { Label, ValidateIf } from "../src/modifiers";
import { Matches } from "../src/rules/strings";
import { Required } from "../src/rules/presence";
import { validationStateFor } from "../src/registry";

function messages(instance: object): string[] {
  return validate(instance).errors.map((error) => error.message);
}

describe("наследование правил валидации", () => {
  it("не дублирует Required при переопределении поля в подклассе", () => {
    class BaseForm {
      @Required()
      public accessor name = "";
    }

    class SubForm extends BaseForm {
      @Required()
      public accessor name = "";
    }

    const result = validate(new SubForm());

    expect(result.errors.map((error) => error.rule)).toEqual(["required"]);
    expect(messages(new SubForm())).toEqual(["Поле name обязательно"]);
  });

  it("не дублирует Required без переопределения поля", () => {
    class BaseForm {
      @Required()
      public accessor name = "";
    }

    class SubForm extends BaseForm {}

    expect(validate(new SubForm()).errors.map((error) => error.rule)).toEqual([
      "required",
    ]);
  });

  it("сохраняет два Matches с разными шаблонами", () => {
    class PatternForm {
      @Matches(/^\d+$/)
      @Matches(/^[a-z]+$/)
      public accessor code = "abc123";
    }

    const result = validate(new PatternForm());

    expect(result.errors.map((error) => error.rule)).toEqual([
      "matches",
      "matches",
    ]);
    expect(
      result.errors.map((error) => (error.params.pattern as RegExp).source),
    ).toEqual(["^\\d+$", "^[a-z]+$"]);
  });

  it("дедуплицирует Matches с одинаковым шаблоном", () => {
    class PatternForm {
      @Matches(/^\d+$/)
      @Matches(/^\d+$/)
      public accessor code = "abc";
    }

    expect(validate(new PatternForm()).errors).toHaveLength(1);
  });

  it("Label из подкласса переопределяет базовый", () => {
    class BaseForm {
      @Label("Имя")
      @Required()
      public accessor name = "";
    }

    class SubForm extends BaseForm {
      @Label("Название")
      @Required()
      public accessor name = "";
    }

    expect(messages(new SubForm())).toEqual(["Поле Название обязательно"]);
  });

  it("не дублирует ValidateIf при переопределении поля", () => {
    let calls = 0;
    const enabled = (instance: object): boolean => {
      calls += 1;
      return (instance as { flag: boolean }).flag;
    };

    class BaseForm {
      flag = true;

      @ValidateIf(enabled)
      @Required()
      public accessor name = "";
    }

    class SubForm extends BaseForm {
      @ValidateIf(enabled)
      @Required()
      public accessor name = "";
    }

    const result = validate(new SubForm());

    expect(result.errors.map((error) => error.rule)).toEqual(["required"]);
    expect(calls).toBe(1);
  });

  it("сохраняет разные условия ValidateIf", () => {
    class BaseForm {
      flag = true;

      @ValidateIf((instance) => (instance as BaseForm).flag)
      @Required()
      public accessor name = "";
    }

    class SubForm extends BaseForm {
      @ValidateIf(() => false)
      @Required()
      public accessor name = "";
    }

    expect(validate(new SubForm()).valid).toBe(true);
    expect(
      validationStateFor(new SubForm()).fields.get("name")?.conditions,
    ).toHaveLength(2);
  });
});
