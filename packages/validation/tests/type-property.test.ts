import { afterEach, describe, expect, it } from "vitest";
import {
  Custom,
  IsEmail,
  Label,
  Min,
  Required,
  validateProperty,
  validatePropertyAsync,
} from "../src/index.js";
import { resetValidationConfig } from "../src/messages.js";
import { SCHEMA_SYMBOL } from "../src/schema.js";
import type { ClassSchema, FieldSchemaMap } from "../src/schema.js";
import type { ValidationResult } from "../src/types.js";
import { AsyncRuleError } from "../src/types.js";

function defineSchema(ctor: Function, schema: ClassSchema | FieldSchemaMap): void {
  Object.defineProperty(ctor, SCHEMA_SYMBOL, {
    value: schema,
    configurable: true,
  });
}

function rules(result: ValidationResult): string[] {
  return result.errors.map((error) => error.rule);
}

afterEach(() => {
  resetValidationConfig();
});

describe("validateProperty: схема", () => {
  class SchemaModel {
    public accessor first = 0;
    public accessor second = "";
  }
  defineSchema(SchemaModel, { fields: { first: "number", second: "string" } });

  it("проверяет только указанное поле", () => {
    const model = new SchemaModel();
    model.first = "x" as unknown as number;
    model.second = 5 as unknown as string;

    const result = validateProperty(model, "first");
    expect(rules(result)).toEqual(["type"]);
    expect(result.errors[0]?.path).toBe("first");
    expect(validateProperty(model, "second").errors[0]?.path).toBe("second");
  });

  it("возвращает пустой результат для неизвестного поля", () => {
    const model = new SchemaModel();
    model.first = "x" as unknown as number;
    expect(validateProperty(model, "missing")).toEqual({ valid: true, errors: [] });
  });

  it("уважает options.types: false", () => {
    const model = new SchemaModel();
    model.first = "x" as unknown as number;
    expect(validateProperty(model, "first", { types: false }).valid).toBe(true);
  });
});

describe("validateProperty: декораторы", () => {
  class DecoratedModel {
    @Required()
    public accessor name = "";

    @IsEmail()
    public accessor email = "";
  }

  it("запускает декораторы только выбранного поля", () => {
    const model = new DecoratedModel();
    model.name = "ok";
    model.email = "bad";

    expect(rules(validateProperty(model, "email"))).toEqual(["isEmail"]);
    expect(validateProperty(model, "name").valid).toBe(true);
  });

  it("поддерживает labels и groups", () => {
    class GroupedModel {
      @Label("Почта")
      @Required({ groups: ["create"] })
      public accessor email = "";
    }

    const model = new GroupedModel();
    expect(validateProperty(model, "email", { groups: ["update"] }).valid).toBe(true);

    const result = validateProperty(model, "email", { groups: ["create"] });
    expect(result.errors[0]?.label).toBe("Почта");
    expect(result.errors[0]?.message).toContain("Почта");
  });
});

describe("validateProperty: вложенность и async", () => {
  class Address {
    @IsEmail()
    public accessor email = "";
  }
  defineSchema(Address, { fields: { email: "string" } });

  class Person {
    @Min(18)
    public accessor age = 10;

    public accessor address = new Address();
  }
  defineSchema(Person, {
    fields: {
      age: "number",
      address: ["class", () => Address],
    },
  });

  it("запускает полный движок для вложенного поля", () => {
    const person = new Person();
    person.age = 20;
    person.address.email = "bad";

    const result = validateProperty(person, "address");
    expect(rules(result)).toEqual(["isEmail"]);
    expect(result.errors[0]?.path).toBe("address.email");
    expect(validateProperty(person, "age").valid).toBe(true);
  });

  it("проверяет async-правило выбранного поля", async () => {
    class AsyncModel {
      @Custom(async (value) => value === "ok")
      public accessor value = "bad";

      public accessor other = "bad";
    }
    defineSchema(AsyncModel, {
      fields: { value: "string", other: "string" },
    });

    const model = new AsyncModel();
    expect(() => validateProperty(model, "value")).toThrow(AsyncRuleError);

    const result = await validatePropertyAsync(model, "value");
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.field).toBe("value");
  });

  it("не запускает async-правило другого поля", async () => {
    class AsyncModel {
      @Custom(async (value) => value === "ok")
      public accessor value = "bad";

      public accessor other = 0;
    }
    defineSchema(AsyncModel, {
      fields: { other: "number" },
    });

    const model = new AsyncModel();
    const result = await validatePropertyAsync(model, "other");
    expect(result.valid).toBe(true);
  });

  it("останавливается на первой ошибке выбранного поля", () => {
    class TwoRules {
      @Required()
      @Min(5)
      public accessor value = 0;
    }

    const model = new TwoRules();
    const result = validateProperty(model, "value", { stopAtFirst: true });
    expect(result.errors).toHaveLength(1);
  });
});
