import { afterEach, describe, expect, it } from "vitest";
import {
  IsEmail,
  Min,
  Required,
  validate,
  validateAsync,
} from "../src/index.js";
import { ruleDecorator } from "../src/rule.js";
import { resetValidationConfig } from "../src/messages.js";
import { SCHEMA_SYMBOL } from "../src/schema.js";
import type { ClassSchema, FieldSchemaMap } from "../src/schema.js";
import type { RuleDefinition, ValidationResult } from "../src/types.js";
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

function paths(result: ValidationResult): string[] {
  return result.errors.map((error) => error.path);
}

afterEach(() => {
  resetValidationConfig();
});

describe("вложенные классы: декораторы", () => {
  class Contact {
    @IsEmail()
    public accessor email = "";
  }

  defineSchema(Contact, { fields: { email: "string" } });

  class User {
    public accessor name = "";
    public accessor contact = new Contact();
  }

  defineSchema(User, {
    fields: {
      name: "string",
      contact: ["class", () => Contact],
    },
  });

  it("запускает декораторы вложенного класса", () => {
    const user = new User();
    user.contact.email = "not-an-email";
    const result = validate(user);
    expect(rules(result)).toEqual(["isEmail"]);
    expect(paths(result)).toEqual(["contact.email"]);
    expect(result.errors[0]?.field).toBe("email");
  });

  it("запускает декораторы для массива классов", () => {
    class Item {
      @IsEmail()
      public accessor email = "";
    }
    defineSchema(Item, { fields: { email: "string" } });

    class Cart {
      public accessor items: Item[] = [];
    }
    defineSchema(Cart, { fields: { items: ["array", ["class", () => Item]] } });

    const cart = new Cart();
    cart.items.push(new Item());
    expect(rules(validate(cart))).toEqual(["isEmail"]);
    expect(paths(validate(cart))).toEqual(["items[0].email"]);
  });

  it("запускает декораторы классов внутри object, record, mapof и setof", () => {
    class Leaf {
      @Required()
      public accessor name = "";
    }
    defineSchema(Leaf, { fields: { name: "string" } });

    class Box {
      public accessor payload: { leaf: Leaf } = { leaf: new Leaf() };
      public accessor dictionary: Record<string, Leaf> = { first: new Leaf() };
      public accessor mapped = new Map<string, Leaf>([["key", new Leaf()]]);
      public accessor grouped = new Set<Leaf>([new Leaf()]);
    }
    defineSchema(Box, {
      fields: {
        payload: ["object", { leaf: ["class", () => Leaf] }],
        dictionary: ["record", ["class", () => Leaf]],
        mapped: ["mapof", "string", ["class", () => Leaf]],
        grouped: ["setof", ["class", () => Leaf]],
      },
    });

    const result = validate(new Box());
    expect(paths(result)).toEqual([
      "payload.leaf.name",
      "dictionary.first.name",
      "mapped[key].name",
      "grouped[0].name",
    ]);
    expect(rules(result)).toEqual(["required", "required", "required", "required"]);
  });
});

describe("вложенные классы: async и cascade", () => {
  const asyncName: RuleDefinition = {
    name: "asyncName",
    params: {},
    check: async (value) => value === "ok",
  };

  class AsyncChild {
    @ruleDecorator(asyncName)
    public accessor name = "bad";
  }
  defineSchema(AsyncChild, { fields: { name: "string" } });

  class AsyncParent {
    public accessor child = new AsyncChild();
  }
  defineSchema(AsyncParent, { fields: { child: ["class", () => AsyncChild] } });

  it("ждёт async-правило вложенного класса", async () => {
    const result = await validateAsync(new AsyncParent());
    expect(rules(result)).toEqual(["asyncName"]);
    expect(paths(result)).toEqual(["child.name"]);
  });

  it("бросает AsyncRuleError в синхронном режиме", () => {
    expect(() => validate(new AsyncParent())).toThrow(AsyncRuleError);
  });

  class CascadeChild {
    @Min(18)
    public accessor age = 10;

    @Required()
    public accessor name = "";
  }
  defineSchema(CascadeChild, {
    fields: { name: "string", age: "number" },
  });

  class CascadeParent {
    public accessor child = new CascadeChild();
  }
  defineSchema(CascadeParent, {
    fields: { child: ["class", () => CascadeChild] },
  });

  it("применяет cascade к полям вложенного класса", () => {
    const parent = new CascadeParent();
    parent.child.name = 5 as unknown as string;
    parent.child.age = 10;

    const result = validate(parent);
    expect(rules(result)).toEqual(["type", "min"]);

    const noCascade = validate(parent, { cascade: false });
    expect(rules(noCascade)).toEqual(["type", "min"]);
    expect(paths(noCascade)).toEqual(["child.name", "child.age"]);
  });

  it("не запускает вложенные классы при ошибке типа и cascade: false", () => {
    class BrokenParent {
      public accessor child: unknown = { name: "" };
    }
    defineSchema(BrokenParent, { fields: { child: ["class", () => CascadeChild] } });

    const result = validate(new BrokenParent(), { cascade: false });
    expect(rules(result)).toEqual(["type"]);
  });
});

describe("вложенные классы: остановка и циклы", () => {
  class Child {
    @Required()
    public accessor first = "";

    @Required()
    public accessor second = "";
  }
  defineSchema(Child, { fields: { first: "string", second: "string" } });

  class Parent {
    public accessor child = new Child();

    public accessor other = 0;
  }
  defineSchema(Parent, {
    fields: { child: ["class", () => Child], other: "number" },
  });

  it("останавливается на первой ошибке внутри вложенного класса", () => {
    const parent = new Parent();
    parent.other = Number.NaN;
    const result = validate(parent, { stopAtFirst: true });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.path).toBe("child.first");
  });

  it("останавливается на первой ошибке после вложенного класса", () => {
    const parent = new Parent();
    parent.child.first = "ok";
    parent.child.second = "ok";
    parent.other = Number.NaN;
    const result = validate(parent, { stopAtFirst: true });
    expect(paths(result)).toEqual(["other"]);
  });

  it("не зацикливается на самоссылках", () => {
    class Node {
      @Required()
      public accessor name = "";

      public accessor next: Node | null = null;
    }
    defineSchema(Node, {
      fields: {
        name: "string",
        next: ["nullable", ["class", () => Node]],
      },
    });

    const node = new Node();
    node.name = 5 as unknown as string;
    node.next = node;

    const result = validate(node);
    expect(paths(result)).toEqual(["name"]);
  });

  it("не зацикливается на взаимных ссылках", () => {
    class Left {
      public accessor right: Right | null = null;
    }
    class Right {
      @Required()
      public accessor name = "";

      public accessor left: Left | null = null;
    }
    defineSchema(Left, { fields: { right: ["nullable", ["class", () => Right]] } });
    defineSchema(Right, {
      fields: { name: "string", left: ["nullable", ["class", () => Left]] },
    });

    const left = new Left();
    const right = new Right();
    left.right = right;
    right.left = left;

    expect(paths(validate(left))).toEqual(["right.name"]);

    left.right = null;
    right.left = null;
    expect(validate(left).valid).toBe(true);
  });

  it("не дублирует ошибки классов в intersection", () => {
    class Duplicate {
      @Required()
      public accessor name = "";
    }
    defineSchema(Duplicate, { fields: { name: "string" } });

    class Holder {
      public accessor value = new Duplicate();
    }
    defineSchema(Holder, {
      fields: {
        value: ["intersection", [["class", () => Duplicate], ["class", () => Duplicate]]],
      },
    });

    expect(rules(validate(new Holder()))).toEqual(["required"]);
  });

  it("откатывает вложенные классы неудачной ветки union", () => {
    class Email {
      @IsEmail()
      public accessor value = "";
    }
    defineSchema(Email, { fields: { value: "string" } });

    class UnionModel {
      public accessor payload: unknown = { email: new Email() };
    }
    defineSchema(UnionModel, {
      fields: {
        payload: [
          "union",
          [
            ["object", { email: ["class", () => Email], extra: "number" }],
            ["object", { email: "object" }],
          ],
        ],
      },
    });

    expect(validate(new UnionModel()).valid).toBe(true);
  });
});

describe("вложенные классы: groups и labels", () => {
  class Grouped {
    @Required({ groups: ["create"] })
    public accessor token = "";
  }
  defineSchema(Grouped, { fields: { token: "string" } });

  class GroupedParent {
    public accessor child = new Grouped();
  }
  defineSchema(GroupedParent, { fields: { child: ["class", () => Grouped] } });

  it("учитывает groups вложенного класса", () => {
    expect(validate(new GroupedParent(), { groups: ["update"] }).valid).toBe(true);
    expect(rules(validate(new GroupedParent(), { groups: ["create"] }))).toEqual([
      "required",
    ]);
  });

  it("учитывает labels вложенного класса", () => {
    const result = validate(new GroupedParent(), {
      groups: ["create"],
      labels: { token: "Токен" },
    });
    expect(result.errors[0]?.label).toBe("Токен");
    expect(result.errors[0]?.message).toContain("Токен");
  });
});

describe("вложенные классы: schema version", () => {
  it("принимает версию 1 в обёрнутом формате", () => {
    class Versioned {
      public accessor value = 0;
    }
    defineSchema(Versioned, { version: 1, fields: { value: "number" } });
    const model = new Versioned();
    model.value = "x" as unknown as number;
    expect(rules(validate(model))).toEqual(["type"]);
  });

  it("принимает сырой формат без версии", () => {
    class Raw {
      public accessor value = 0;
    }
    defineSchema(Raw, { value: "number" });
    const model = new Raw();
    model.value = "x" as unknown as number;
    expect(rules(validate(model))).toEqual(["type"]);
  });

  it("бросает ошибку при неподдерживаемой версии", () => {
    class Future {
      public accessor value = 0;
    }
    defineSchema(Future, {
      version: 2,
      fields: { value: "number" },
    });
    expect(() => validate(new Future())).toThrow(/версия схемы 2/);
  });
});
