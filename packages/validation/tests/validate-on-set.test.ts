import { afterEach, describe, expect, it } from "vitest";
import {
  AsyncRuleError,
  Custom,
  Groups,
  IsEmail,
  Min,
  Optional,
  Required,
  ValidateOnSet,
  ValidationException,
} from "../src/index.js";
import { resetValidationConfig } from "../src/messages.js";
import { SCHEMA_SYMBOL } from "../src/schema.js";
import type { ClassSchema, FieldSchemaMap } from "../src/schema.js";

function defineSchema(ctor: Function, schema: ClassSchema | FieldSchemaMap): void {
  Object.defineProperty(ctor, SCHEMA_SYMBOL, {
    value: schema,
    configurable: true,
  });
}

function capture(action: () => void): unknown {
  try {
    action();
  } catch (error: unknown) {
    return error;
  }
  return undefined;
}

afterEach(() => {
  resetValidationConfig();
});

describe("ValidateOnSet: базовое поведение", () => {
  class Model {
    @ValidateOnSet()
    @Required()
    public accessor name = "start";
  }

  it("не валидирует инициализацию поля", () => {
    class InitInvalid {
      @ValidateOnSet()
      @Required()
      public accessor name = "";
    }

    expect(() => new InitInvalid()).not.toThrow();
  });

  it("пропускает валидное значение", () => {
    const model = new Model();

    expect(() => {
      model.name = "ok";
    }).not.toThrow();
    expect(model.name).toBe("ok");
  });

  it("бросает ValidationException с ошибками поля", () => {
    const model = new Model();

    const thrown = capture(() => {
      model.name = "";
    });

    expect(thrown).toBeInstanceOf(ValidationException);
    const exception = thrown as ValidationException;
    expect(exception.errors.map((error) => error.field)).toEqual(["name"]);
    expect(exception.result.valid).toBe(false);
    expect(model.name).toBe("");
  });

  it("пропускает поле без схемы и правил", () => {
    class Plain {
      @ValidateOnSet()
      public accessor value: unknown = 0;
    }

    const plain = new Plain();

    expect(() => {
      plain.value = "anything";
      plain.value = null;
    }).not.toThrow();
    expect(plain.value).toBeNull();
  });
});

describe("ValidateOnSet: комбинации", () => {
  class Account {
    @ValidateOnSet()
    @Required()
    @Min(0)
    public accessor age = 1;
  }

  it("работает вместе с Required и Min", () => {
    const account = new Account();

    const thrown = capture(() => {
      account.age = -1;
    });

    expect(thrown).toBeInstanceOf(ValidationException);
    expect((thrown as ValidationException).errors.map((error) => error.rule)).toEqual(["min"]);

    expect(() => {
      account.age = 5;
    }).not.toThrow();
  });

  it("учитывает Optional", () => {
    class Prefs {
      @ValidateOnSet()
      @Optional()
      @Min(10)
      public accessor age: number | undefined = undefined;
    }

    const prefs = new Prefs();

    expect(() => {
      prefs.age = undefined;
    }).not.toThrow();
    expect(() => {
      prefs.age = 5;
    }).toThrow(ValidationException);
    expect(() => {
      prefs.age = 11;
    }).not.toThrow();
  });

  it("учитывает группы правил", () => {
    class Draft {
      @ValidateOnSet()
      @Groups("update")
      @Min(5)
      public accessor score = 10;
    }

    const draft = new Draft();

    expect(() => {
      draft.score = 1;
    }).toThrow(ValidationException);
    expect(() => {
      draft.score = 6;
    }).not.toThrow();
  });

  it("проверяет вложенный объект по схеме", () => {
    class Address {
      @Required()
      @IsEmail()
      public accessor email = "user@example.com";
    }
    defineSchema(Address, { fields: { email: "string" } });

    class User {
      @ValidateOnSet()
      public accessor address = new Address();
    }
    defineSchema(User, { fields: { address: ["class", () => Address] } });

    const user = new User();
    const invalid = new Address();
    invalid.email = "bad";

    const thrown = capture(() => {
      user.address = invalid;
    });

    expect(thrown).toBeInstanceOf(ValidationException);
    const exception = thrown as ValidationException;
    expect(exception.errors.map((error) => error.rule)).toEqual(["isEmail"]);
    expect(exception.errors[0]?.path).toBe("address.email");
  });

  it("пробрасывает AsyncRuleError для асинхронного правила", () => {
    class AsyncBox {
      @ValidateOnSet()
      @Custom(async (value) => value === "ok")
      public accessor value = "ok";
    }

    const box = new AsyncBox();

    expect(() => {
      box.value = "bad";
    }).toThrow(AsyncRuleError);
    expect(box.value).toBe("bad");
  });
});
