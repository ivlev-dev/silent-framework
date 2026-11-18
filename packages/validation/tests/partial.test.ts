import { afterEach, describe, expect, it } from "vitest";
import {
  Custom,
  Groups,
  IsEmail,
  Min,
  Required,
  validatePartial,
  validatePartialAsync,
} from "../src/index.js";
import { resetValidationConfig } from "../src/messages.js";
import { SCHEMA_SYMBOL } from "../src/schema.js";
import type { ClassSchema, FieldSchemaMap } from "../src/schema.js";
import type { ValidationResult } from "../src/types.js";

function defineSchema(ctor: Function, schema: ClassSchema | FieldSchemaMap): void {
  Object.defineProperty(ctor, SCHEMA_SYMBOL, {
    value: schema,
    configurable: true,
  });
}

function paths(result: ValidationResult): string[] {
  return result.errors.map((error) => error.path);
}

function rules(result: ValidationResult): string[] {
  return result.errors.map((error) => error.rule);
}

afterEach(() => {
  resetValidationConfig();
});

describe("validatePartial: схема", () => {
  class SchemaModel {
    public accessor first = 0;
    public accessor second = "";
    public accessor third = true;
  }
  defineSchema(SchemaModel, {
    fields: { first: "number", second: "string", third: "boolean" },
  });

  it("проверяет только перечисленные поля в порядке движка", () => {
    const model = new SchemaModel();
    model.first = "x" as unknown as number;
    model.second = 5 as unknown as string;
    model.third = "no" as unknown as boolean;

    const result = validatePartial(model, ["third", "first"]);

    expect(paths(result)).toEqual(["first", "third"]);
    expect(rules(result)).toEqual(["type", "type"]);
  });

  it("игнорирует неизвестные и отсутствующие поля", () => {
    const model = new SchemaModel();
    model.first = "x" as unknown as number;

    expect(validatePartial(model, ["missing"])).toEqual({ valid: true, errors: [] });
    expect(validatePartial(model, [])).toEqual({ valid: true, errors: [] });
  });

  it("уважает options.types: false", () => {
    const model = new SchemaModel();
    model.first = "x" as unknown as number;

    expect(validatePartial(model, ["first"], { types: false }).valid).toBe(true);
  });
});

describe("validatePartial: декораторы и вложенность", () => {
  class Address {
    @Required()
    @IsEmail()
    public accessor email = "";
  }
  defineSchema(Address, { fields: { email: "string" } });

  class Person {
    @Required()
    public accessor name = "";

    public accessor address = new Address();
  }
  defineSchema(Person, {
    fields: {
      name: "string",
      address: ["class", () => Address],
    },
  });

  it("запускает декораторы только выбранных полей", () => {
    const person = new Person();
    person.name = "Иван";
    person.address.email = "bad";

    expect(validatePartial(person, ["name"])).toEqual({ valid: true, errors: [] });
    expect(rules(validatePartial(person, ["address", "name"]))).toEqual(["isEmail"]);
  });

  it("запускает полный движок для вложенного поля", () => {
    const person = new Person();
    person.name = "Иван";
    person.address.email = "bad";

    const result = validatePartial(person, ["address"]);

    expect(rules(result)).toEqual(["isEmail"]);
    expect(paths(result)).toEqual(["address.email"]);
  });

  it("учитывает группы вызова", () => {
    class Grouped {
      @Required({ groups: ["create"] })
      public accessor email = "";
    }

    const grouped = new Grouped();

    expect(validatePartial(grouped, ["email"], { groups: ["update"] }).valid).toBe(true);
    expect(validatePartial(grouped, ["email"], { groups: ["create"] }).valid).toBe(false);
  });

  it("проверяет повторяющееся поле один раз", () => {
    class Pair {
      @Required()
      @Min(5)
      public accessor value = 0;
    }

    const result = validatePartial(new Pair(), ["value", "value"]);

    expect(rules(result)).toEqual(["min"]);
    expect(result.errors).toHaveLength(1);
  });

  it("валидирует оба символьных поля и не смешивает их со схемой", () => {
    const first = Symbol("secret");
    const second = Symbol("secret");

    class Symbols {
      @Required()
      public accessor [first] = "";

      @Required()
      public accessor [second] = "";
    }
    defineSchema(Symbols, { fields: { secret: "string" } });

    const result = validatePartial(new Symbols(), ["secret"]);

    expect(result.errors.map((error) => error.rule).sort()).toEqual([
      "required",
      "required",
      "type",
    ]);
    expect(result.errors.every((error) => error.field === "secret")).toBe(true);
  });
});

describe("validatePartialAsync", () => {
  class AsyncModel {
    @Custom(async (value) => value === "ok")
    public accessor value = "bad";

    public accessor other = "fine";
  }
  defineSchema(AsyncModel, {
    fields: { value: "string", other: "string" },
  });

  it("ждёт асинхронные правила выбранного поля", async () => {
    const result = await validatePartialAsync(new AsyncModel(), ["value"]);

    expect(result.valid).toBe(false);
    expect(result.errors[0]?.field).toBe("value");
  });

  it("не запускает правила невыбранных полей", async () => {
    const result = await validatePartialAsync(new AsyncModel(), ["other"]);

    expect(result).toEqual({ valid: true, errors: [] });
  });

  it("возвращает валидный результат для пустого списка", async () => {
    await expect(validatePartialAsync(new AsyncModel(), [])).resolves.toEqual({
      valid: true,
      errors: [],
    });
  });
});
