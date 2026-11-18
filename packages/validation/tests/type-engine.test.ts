import { afterEach, describe, expect, it } from "vitest";
import { Min, Required, validate, validateAsync } from "../src/index.js";
import { ruleDecorator } from "../src/rule.js";
import { resetValidationConfig } from "../src/messages.js";
import { SCHEMA_SYMBOL } from "../src/schema.js";
import type { ClassSchema, FieldSchemaMap } from "../src/schema.js";
import type { RuleDefinition, ValidationResult } from "../src/types.js";

function defineSchema(ctor: Function, schema: ClassSchema | FieldSchemaMap): void {
  Object.defineProperty(ctor, SCHEMA_SYMBOL, {
    value: schema,
    configurable: true,
  });
}

function rules(result: ValidationResult): string[] {
  return result.errors.map((error) => error.rule);
}

function paths(result: ValidationResult): string[] {
  return result.errors.map((error) => error.path);
}

class Address {
  public accessor city = "";
  public accessor zip = 0;
}

defineSchema(Address, { fields: { city: "string", zip: "number" } });

class Profile {
  public accessor email = "";
  public accessor age: number | undefined = undefined;
  public accessor tags: string[] = [];
  public accessor role = "user";
  public accessor address: Address | undefined = undefined;
  public accessor addresses: Address[] = [];
}

defineSchema(Profile, {
  fields: {
    email: "string",
    age: ["optional", "number"],
    tags: ["array", "string"],
    role: ["enum", ["admin", "user"]],
    address: ["optional", ["class", () => Address]],
    addresses: ["array", ["class", () => Address]],
  },
});

afterEach(() => {
  resetValidationConfig();
});

describe("валидация типов из схемы", () => {
  it("сообщает об ошибках для полей без декораторов", () => {
    const profile = new Profile();
    profile.email = 42 as unknown as string;
    profile.tags = ["ok", 1 as unknown as string];
    profile.role = "guest";

    const result = validate(profile);
    expect(result.valid).toBe(false);
    expect(paths(result)).toEqual(["email", "tags[1]", "role"]);
    expect(rules(result)).toEqual(["type", "type", "type"]);
    expect(result.errors[0]).toMatchObject({
      field: "email",
      rule: "type",
      params: { type: "string" },
      value: 42,
      label: "email",
    });
    expect(result.errors[1]).toMatchObject({
      path: "tags[1]",
      index: 1,
      params: { type: "string" },
    });
    expect(result.errors[2]?.params).toEqual({ type: '"admin" | "user"' });
  });

  it("валидирует вложенные классы с префиксом пути", () => {
    const profile = new Profile();
    const address = new Address();
    address.city = 5 as unknown as string;
    profile.address = address;

    const result = validate(profile);
    expect(paths(result)).toEqual(["address.city"]);
    expect(result.errors[0]).toMatchObject({
      field: "address",
      label: "city",
      params: { type: "string" },
    });
  });

  it("валидирует массивы классов", () => {
    const profile = new Profile();
    const broken = new Address();
    broken.zip = "x" as unknown as number;
    profile.addresses = [new Address(), broken];

    const result = validate(profile);
    expect(paths(result)).toEqual(["addresses[1].zip"]);
    expect(result.errors[0]?.index).toBeUndefined();
  });

  it("останавливается на первой ошибке типа внутри массива", () => {
    const profile = new Profile();
    profile.tags = [1, 2] as unknown as string[];
    const result = validate(profile, { stopAtFirst: true });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.path).toBe("tags[0]");
  });

  it("читает схему, заданную сырым объектом полей", () => {
    class RawModel {
      public accessor count = 0;
    }
    defineSchema(RawModel, { count: "number" });
    const model = new RawModel();
    model.count = "1" as unknown as number;
    expect(rules(validate(model))).toEqual(["type"]);
  });

  it("сохраняет порядок: сначала схема, затем только декораторы", () => {
    class Mixed {
      public accessor first = 0;

      @Required()
      public accessor second = "";
    }
    defineSchema(Mixed, { fields: { first: "number" } });
    const model = new Mixed();
    model.first = "x" as unknown as number;

    const result = validate(model);
    expect(paths(result)).toEqual(["first", "second"]);
    expect(rules(result)).toEqual(["type", "required"]);
  });
});

describe("комбинация типов и декораторов", () => {
  class Account {
    @Required()
    public accessor name = "";

    @Min(18)
    public accessor age = 0;

    @Required()
    public accessor note: string | null = null;
  }

  defineSchema(Account, {
    fields: {
      name: "string",
      age: ["optional", "number"],
      note: ["nullable", "string"],
    },
  });

  it("запускает декораторы после успешной проверки типа", () => {
    const account = new Account();
    account.name = "ok";
    account.age = 10;
    const result = validate(account);
    expect(rules(result)).toEqual(["min"]);
    expect(result.errors[0]?.params).toEqual({ min: 18 });
  });

  it("не запускает декораторы при неверном типе", () => {
    const account = new Account();
    account.name = "ok";
    account.age = "10" as unknown as number;
    const result = validate(account);
    expect(rules(result)).toEqual(["type"]);
    expect(paths(result)).toEqual(["age"]);
  });

  it("пропускает все правила для optional при undefined", () => {
    const account = new Account();
    account.name = "ok";
    account.note = "note";
    account.age = undefined as unknown as number;
    expect(validate(account).valid).toBe(true);
  });

  it("пропускает все правила для nullable при null", () => {
    const account = new Account();
    account.name = "ok";
    account.age = 20;
    account.note = null;
    expect(validate(account).valid).toBe(true);
  });

  it("проверяет строковые ограничения после типа", () => {
    const account = new Account();
    account.name = "";
    account.age = 20;
    const result = validate(account);
    expect(rules(result)).toEqual(["required"]);
  });
});

describe("наследование схем", () => {
  class BaseEntity {
    public accessor id = 0;
  }

  class ChildEntity extends BaseEntity {
    public accessor title = "";
  }

  defineSchema(BaseEntity, { fields: { id: "number" } });
  defineSchema(ChildEntity, { fields: { title: "string" } });

  it("объединяет схемы базового и дочернего класса", () => {
    const entity = new ChildEntity();
    entity.id = "x" as unknown as number;
    entity.title = 5 as unknown as string;
    const result = validate(entity);
    expect(paths(result)).toEqual(["id", "title"]);
    expect(rules(result)).toEqual(["type", "type"]);
  });

  it("позволяет отключить типовую валидацию", () => {
    const entity = new ChildEntity();
    entity.id = "x" as unknown as number;
    entity.title = 5 as unknown as string;
    expect(validate(entity, { types: false }).valid).toBe(true);
  });

  it("останавливается на первой ошибке", () => {
    const entity = new ChildEntity();
    entity.id = "x" as unknown as number;
    entity.title = 5 as unknown as string;
    const result = validate(entity, { stopAtFirst: true });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.path).toBe("id");
  });
});

describe("локализация и метки", () => {
  it("использует английские сообщения", () => {
    const profile = new Profile();
    profile.email = 42 as unknown as string;
    const result = validate(profile, { locale: "en" });
    expect(result.errors[0]?.message).toBe("email must be of type string");
  });

  it("учитывает labels для типовых ошибок", () => {
    const profile = new Profile();
    profile.email = 42 as unknown as string;
    const result = validate(profile, { labels: { email: "Почта" } });
    expect(result.errors[0]?.message).toBe("Поле Почта должно быть типа string");
    expect(result.errors[0]?.label).toBe("Почта");
  });
});

describe("асинхронный движок", () => {
  const asyncValue: RuleDefinition = {
    name: "asyncValue",
    params: {},
    check: async (value) => value === "ok",
  };

  class AsyncModel {
    @ruleDecorator(asyncValue)
    public accessor value: unknown = "ok";
  }

  defineSchema(AsyncModel, { fields: { value: "string" } });

  it("запускает асинхронные правила после проверки типа", async () => {
    const model = new AsyncModel();
    model.value = "bad";
    const result = await validateAsync(model);
    expect(rules(result)).toEqual(["asyncValue"]);
  });

  it("не запускает асинхронные правила при неверном типе", async () => {
    const model = new AsyncModel();
    model.value = 5;
    const result = await validateAsync(model);
    expect(rules(result)).toEqual(["type"]);
  });

  it("не требует асинхронного режима для типовых ошибок", () => {
    const model = new AsyncModel();
    model.value = 5;
    expect(() => validate(model)).not.toThrow();
    expect(rules(validate(model))).toEqual(["type"]);
  });
});
