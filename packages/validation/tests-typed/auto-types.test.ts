import { describe, expect, it } from "vitest";
import { IsEmail, validate } from "../src/index.js";
import { Address } from "./address.js";

enum Role {
  Admin = "admin",
  User = "user",
}

enum Level {
  Low,
  High,
}

interface Point {
  x: number;
  y: number;
}

class Item {
  public accessor name: string = "";

  public accessor quantity: number = 0;
}

class Order {
  public accessor email: string = "";

  public accessor age: number | null = null;

  public accessor role: Role = Role.Admin;

  public accessor level: Level = Level.Low;

  public accessor items: Item[] = [];

  public accessor address: Address = new Address();

  public accessor point: Point = { x: 0, y: 0 };

  public accessor tags: string[] = [];

  public accessor tuple: [string, number] = ["", 0];

  public accessor counts: Map<string, number> = new Map();

  public accessor maybe: string | undefined = undefined;
}

function schemaOf(ctor: Function): unknown {
  return (ctor as unknown as Record<symbol, unknown>)[
    Symbol.for("silent.validation.schema")
  ];
}

describe("валидация из TS-типов", () => {
  it("генерирует метаданные и принимает корректный объект", () => {
    expect(schemaOf(Order)).toBeDefined();
    const order = new Order();
    order.email = "user@example.com";
    order.items = [new Item()];
    order.items[0]!.name = "Book";
    order.items[0]!.quantity = 2;
    order.tags = ["a"];
    order.counts.set("a", 1);
    expect(validate(order)).toEqual({ valid: true, errors: [] });
  });

  it("проверяет примитивы, enum, literal-поля и null", () => {
    const order = new Order();
    order.email = 42 as unknown as string;
    order.role = "guest" as Role;
    order.level = "Low" as unknown as Level;
    order.tags = [1 as unknown as string];

    const errors = validate(order).errors;
    expect(errors.map((error) => `${error.path}:${String(error.params["type"])}`)).toEqual([
      "email:string",
      "role:\"admin\" | \"user\"",
      "level:0 | 1",
      "tags[0]:string",
    ]);
    expect(order.age).toBeNull();
    expect(validate(order, { types: false }).errors).toEqual([]);
  });

  it("валидирует вложенные классы, массивы классов и tuple", () => {
    const order = new Order();
    order.items = [new Item(), new Item()];
    order.items[0]!.quantity = "x" as unknown as number;
    order.address.city = 5 as unknown as string;
    order.tuple = ["a"] as unknown as [string, number];

    expect(validate(order).errors.map((error) => `${error.path}:${error.rule}`)).toEqual([
      "items[0].quantity:type",
      "address.city:type",
      "tuple:type",
    ]);
  });

  it("валидирует interface и Map", () => {
    const order = new Order();
    order.point = { x: "1" as unknown as number, y: 2 };
    order.counts.set("a", "b" as unknown as number);

    const errors = validate(order).errors;
    expect(errors.map((error) => error.path)).toEqual(["point.x", "counts[a]"]);
  });

  it("пропускает optional-поля и комбинируется с декораторами", () => {
    class Decorated {
      @IsEmail()
      public accessor contact: string = "not-email";
    }

    expect(validate(new Decorated()).errors.map((error) => error.rule)).toEqual([
      "isEmail",
    ]);
    new Order().maybe = undefined;
    expect(validate(new Order()).valid).toBe(true);

    class Mixed {
      @IsEmail()
      public accessor contact: string = "not-email";
    }

    const mixed = new Mixed();
    mixed.contact = 1 as unknown as string;
    expect(validate(mixed).errors.map((error) => error.rule)).toEqual([
      "type",
      "isEmail",
    ]);
    expect(validate(mixed, { cascade: false }).errors.map((error) => error.rule)).toEqual([
      "type",
    ]);
    expect(validate(mixed, { types: false }).errors.map((error) => error.rule)).toEqual([
      "isEmail",
    ]);
  });
});
