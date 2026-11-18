import { afterEach, describe, expect, it } from "vitest";
import { getValidationConfig, resetValidationConfig } from "../src/messages";
import { SCHEMA_SYMBOL } from "../src/schema";
import type { ClassSchema, FieldSchemaMap, TypeSchema } from "../src/schema";
import { validateType } from "../src/type-validation";
import type { ValidationConfig, ValidationError } from "../src/types";

function run(
  value: unknown,
  schema: TypeSchema,
  config: ValidationConfig = getValidationConfig(),
): ValidationError[] {
  const result = validateType(value, schema, {
    instance: {},
    field: "value",
    label: "Value",
    path: "value",
    config,
  });
  if (result === null) {
    return [];
  }
  return Array.isArray(result) ? result : [result];
}

function valid(value: unknown, schema: TypeSchema): boolean {
  return run(value, schema).length === 0;
}

function defineSchema(ctor: Function, schema: ClassSchema | FieldSchemaMap): void {
  Object.defineProperty(ctor, SCHEMA_SYMBOL, {
    value: schema,
    configurable: true,
  });
}

afterEach(() => {
  resetValidationConfig();
});

describe("validateType: примитивы", () => {
  it("проверяет string, number, boolean, bigint и symbol", () => {
    expect(valid("text", "string")).toBe(true);
    expect(valid(1, "string")).toBe(false);
    expect(valid(1.5, "number")).toBe(true);
    expect(valid("1", "number")).toBe(false);
    expect(valid(true, "boolean")).toBe(true);
    expect(valid(0, "boolean")).toBe(false);
    expect(valid(10n, "bigint")).toBe(true);
    expect(valid(10, "bigint")).toBe(false);
    expect(valid(Symbol("x"), "symbol")).toBe(true);
    expect(valid("x", "symbol")).toBe(false);
  });

  it("отклоняет NaN и Infinity для number", () => {
    expect(valid(Number.NaN, "number")).toBe(false);
    expect(valid(Number.POSITIVE_INFINITY, "number")).toBe(false);
    expect(valid(Number.NEGATIVE_INFINITY, "number")).toBe(false);
  });

  it("проверяет object и function", () => {
    expect(valid({}, "object")).toBe(true);
    expect(valid([], "object")).toBe(true);
    expect(valid(null, "object")).toBe(false);
    expect(valid("x", "object")).toBe(false);
    expect(valid(() => undefined, "function")).toBe(true);
    expect(valid({}, "function")).toBe(false);
  });

  it("проверяет undefined, null, void и never", () => {
    expect(valid(undefined, "undefined")).toBe(true);
    expect(valid(null, "undefined")).toBe(false);
    expect(valid(null, "null")).toBe(true);
    expect(valid(undefined, "null")).toBe(false);
    expect(valid(undefined, "void")).toBe(true);
    expect(valid(0, "void")).toBe(false);
    expect(valid(undefined, "never")).toBe(false);
    expect(valid(1, "never")).toBe(false);
  });
});

describe("validateType: глобальные типы", () => {
  it("проверяет Date и RegExp", () => {
    expect(valid(new Date(), "date")).toBe(true);
    expect(valid(new Date(Number.NaN), "date")).toBe(false);
    expect(valid("2024-01-01", "date")).toBe(false);
    expect(valid(/a/g, "regexp")).toBe(true);
    expect(valid("/a/", "regexp")).toBe(false);
  });

  it("проверяет Map, Set, WeakMap и WeakSet", () => {
    expect(valid(new Map(), "map")).toBe(true);
    expect(valid(new Set(), "set")).toBe(true);
    expect(valid(new WeakMap(), "weakmap")).toBe(true);
    expect(valid(new WeakSet(), "weakset")).toBe(true);
    expect(valid({}, "map")).toBe(false);
    expect(valid([], "set")).toBe(false);
    expect(valid(new Map(), "weakmap")).toBe(false);
  });

  it("проверяет Promise и thenable", () => {
    expect(valid(Promise.resolve(1), "promise")).toBe(true);
    expect(valid({ then: () => undefined }, "promise")).toBe(true);
    expect(valid({}, "promise")).toBe(false);
    expect(valid(1, "promise")).toBe(false);
  });

  it("проверяет Error, ArrayBuffer, DataView, URL и URLSearchParams", () => {
    expect(valid(new Error("x"), "error")).toBe(true);
    expect(valid(new TypeError("x"), "error")).toBe(true);
    expect(valid({ message: "x" }, "error")).toBe(false);
    expect(valid(new ArrayBuffer(8), "arraybuffer")).toBe(true);
    expect(valid(new DataView(new ArrayBuffer(8)), "dataview")).toBe(true);
    expect(valid(new URL("https://example.com"), "url")).toBe(true);
    expect(valid("https://example.com", "url")).toBe(false);
    expect(valid(new URLSearchParams("a=1"), "urlsearchparams")).toBe(true);
    expect(valid({}, "urlsearchparams")).toBe(false);
  });

  it("проверяет iterable, asynciterable, iterator и asynciterator", () => {
    expect(valid([1, 2], "iterable")).toBe(true);
    expect(valid("text", "iterable")).toBe(true);
    expect(valid(new Set([1]), "iterable")).toBe(true);
    expect(valid({}, "iterable")).toBe(false);

    async function* generate(): AsyncGenerator<number> {
      yield 1;
    }
    const asyncIterator = generate();
    expect(valid(asyncIterator, "asynciterable")).toBe(true);
    expect(valid({}, "asynciterable")).toBe(false);
    expect(valid([1][Symbol.iterator](), "iterator")).toBe(true);
    expect(valid(asyncIterator, "asynciterator")).toBe(true);
    expect(valid([1][Symbol.iterator](), "asynciterator")).toBe(false);
    expect(valid({ next: 1 }, "iterator")).toBe(false);
  });

  it("проверяет typed arrays", () => {
    expect(valid(new Int8Array(), "int8array")).toBe(true);
    expect(valid(new Uint8Array(), "uint8array")).toBe(true);
    expect(valid(new Uint8ClampedArray(), "uint8clampedarray")).toBe(true);
    expect(valid(new Int16Array(), "int16array")).toBe(true);
    expect(valid(new Uint16Array(), "uint16array")).toBe(true);
    expect(valid(new Int32Array(), "int32array")).toBe(true);
    expect(valid(new Uint32Array(), "uint32array")).toBe(true);
    expect(valid(new Float32Array(), "float32array")).toBe(true);
    expect(valid(new Float64Array(), "float64array")).toBe(true);
    expect(valid(new ArrayBuffer(8), "int8array")).toBe(false);
    expect(valid([], "int8array")).toBe(false);
  });

  it("проверяет sharedarraybuffer при наличии глобала", () => {
    if (typeof SharedArrayBuffer === "function") {
      expect(valid(new SharedArrayBuffer(8), "sharedarraybuffer")).toBe(true);
    }
    expect(valid(new ArrayBuffer(8), "sharedarraybuffer")).toBe(false);
  });
});

describe("validateType: составные схемы", () => {
  it("валидирует array с путями и индексами", () => {
    const errors = run(["ok", 5], ["array", "string"]);
    expect(errors).toHaveLength(1);
    const [error] = errors;
    expect(error?.path).toBe("value[1]");
    expect(error?.index).toBe(1);
    expect(error?.field).toBe("value");
    expect(error?.params).toEqual({ type: "string" });
    expect(run([], ["array", "string"])).toHaveLength(0);
    expect(run("nope", ["array", "string"])[0]?.params).toEqual({
      type: "Array<string>",
    });
  });

  it("валидирует tuple с обязательной и необязательной частью", () => {
    const schema: TypeSchema = ["tuple", ["string", "number", null]];
    expect(valid(["a", 1], schema)).toBe(true);
    expect(valid(["a", 1, true], schema)).toBe(true);
    expect(valid(["a"], schema)).toBe(false);
    expect(valid([], schema)).toBe(false);
    expect(valid(["a", "b"], schema)).toBe(false);
    const errors = run(["a", "b"], schema);
    expect(errors[0]?.path).toBe("value[1]");
  });

  it("валидирует union и intersection", () => {
    expect(valid("a", ["union", ["string", "number"]])).toBe(true);
    expect(valid(1, ["union", ["string", "number"]])).toBe(true);
    expect(valid(true, ["union", ["string", "number"]])).toBe(false);
    const errors = run(true, ["union", ["string", "number"]]);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.params).toEqual({ type: "string | number" });

    const intersection = run("a", [
      "intersection",
      ["string", ["literal", "a"], ["literal", "b"]],
    ]);
    expect(intersection).toHaveLength(1);
    expect(valid("a", ["intersection", ["string", ["literal", "a"]]])).toBe(true);
  });

  it("валидирует literal и enum по SameValueZero", () => {
    expect(valid("admin", ["literal", "admin"])).toBe(true);
    expect(valid("user", ["literal", "admin"])).toBe(false);
    expect(valid(Number.NaN, ["literal", Number.NaN])).toBe(true);
    expect(valid(-0, ["literal", 0])).toBe(false);
    expect(valid("admin", ["enum", ["admin", "user"]])).toBe(true);
    expect(valid("guest", ["enum", ["admin", "user"]])).toBe(false);
    expect(valid(1, ["enum", [1, 2]])).toBe(true);
    expect(valid("1", ["enum", [1, 2]])).toBe(false);
    expect(valid(-0, ["enum", [0]])).toBe(true);
    expect(valid(Number.NaN, ["enum", [Number.NaN]])).toBe(true);
  });

  it("валидирует object с вложенными путями и optional-полями", () => {
    const schema: TypeSchema = [
      "object",
      { email: "string", age: ["optional", "number"] },
    ];
    expect(valid({ email: "a@b.c" }, schema)).toBe(true);
    expect(valid({ email: "a@b.c", age: 10 }, schema)).toBe(true);
    expect(valid({ email: "a@b.c", age: undefined }, schema)).toBe(true);
    const errors = run({ email: 5 }, schema);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.path).toBe("value.email");
    expect(errors[0]?.label).toBe("email");
    expect(run(null, schema)).toHaveLength(1);
  });

  it("валидирует record", () => {
    const schema: TypeSchema = ["record", "number"];
    expect(valid({ a: 1, b: 2 }, schema)).toBe(true);
    expect(valid({ a: 1, b: "2" }, schema)).toBe(false);
    expect(valid([], schema)).toBe(false);
    expect(valid(null, schema)).toBe(false);
    const errors = run({ a: "x" }, schema);
    expect(errors[0]?.path).toBe("value.a");
  });

  it("валидирует mapof и setof", () => {
    const mapSchema: TypeSchema = ["mapof", "string", "number"];
    expect(valid(new Map([["a", 1]]), mapSchema)).toBe(true);
    const mapErrors = run(new Map([["a", "1"]]), mapSchema);
    expect(mapErrors).toHaveLength(1);
    expect(mapErrors[0]?.path).toBe("value[a]");
    expect(mapErrors[0]?.index).toBe(0);
    const keyErrors = run(new Map([[1, 1]]), mapSchema);
    expect(keyErrors[0]?.path).toBe("value[1].key");
    expect(keyErrors[0]?.index).toBe(0);

    const setSchema: TypeSchema = ["setof", "number"];
    expect(valid(new Set([1, 2]), setSchema)).toBe(true);
    const setErrors = run(new Set([1, "2"]), setSchema);
    expect(setErrors[0]?.path).toBe("value[1]");
    expect(setErrors[0]?.index).toBe(1);
    expect(valid(new Map(), setSchema)).toBe(false);
  });

  it("пропускает вложенные optional/nullable и отвергает массивы для object", () => {
    const schema: TypeSchema = ["optional", ["nullable", "string"]];
    expect(valid(undefined, schema)).toBe(true);
    expect(valid(null, schema)).toBe(true);
    expect(valid("x", schema)).toBe(true);
    expect(valid(1, schema)).toBe(false);

    const objectSchema: TypeSchema = ["object", { name: "string" }];
    expect(valid({ name: "x" }, objectSchema)).toBe(true);
    expect(valid([], objectSchema)).toBe(false);
  });

  it("пропускает undefined для optional и null для nullable", () => {
    expect(valid(undefined, ["optional", "string"])).toBe(true);
    expect(valid(null, ["optional", "string"])).toBe(false);
    expect(valid(undefined, ["nullable", "string"])).toBe(false);
    expect(valid(null, ["nullable", "string"])).toBe(true);
    expect(valid(1, ["nullable", "string"])).toBe(false);
    expect(valid(null, ["optional", ["nullable", "string"]])).toBe(true);
    const errors = run(1, ["optional", "string"]);
    expect(errors[0]?.params).toEqual({ type: "string" });
  });
});

describe("validateType: классы", () => {
  class Address {
    public accessor city = "";
  }

  class Point {
    public accessor x = 0;
  }

  it("проверяет instanceof без схемы", () => {
    expect(valid(new Point(), ["class", () => Point])).toBe(true);
    expect(valid(new Address(), ["class", () => Point])).toBe(false);
    const errors = run("x", ["class", () => Point]);
    expect(errors[0]?.params).toEqual({ type: "Point" });
  });

  it("рекурсивно валидирует поля класса со схемой", () => {
    defineSchema(Address, {
      fields: { city: "string", zip: ["optional", "number"] },
    });
    expect(valid(new Address(), ["class", () => Address])).toBe(true);
    const broken = new Address();
    broken.city = 5 as unknown as string;
    const errors = run(broken, ["class", () => Address]);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.path).toBe("value.city");
    expect(errors[0]?.field).toBe("value");
    expect(errors[0]?.label).toBe("city");
  });

  it("читает схему, заданную напрямую полем-объектом", () => {
    class Raw {
      public accessor city = "";
    }
    defineSchema(Raw, { city: "string" });
    const broken = new Raw();
    broken.city = 1 as unknown as string;
    expect(run(broken, ["class", () => Raw])).toHaveLength(1);
  });

  it("не уходит в бесконечность на циклах", () => {
    class Node {
      public accessor next: unknown = null;
    }
    defineSchema(Node, {
      fields: { next: ["nullable", ["class", () => Node]] },
    });
    const node = new Node();
    node.next = node;
    expect(run(node, ["class", () => Node])).toHaveLength(0);
  });

  it("безопасно ограничивает глубину вложенности", () => {
    class Link {
      public accessor next: unknown = null;
    }
    defineSchema(Link, {
      fields: { next: ["nullable", ["class", () => Link]] },
    });
    const head = new Link();
    let current = head;
    for (let index = 0; index < 500; index += 1) {
      const next = new Link();
      current.next = next;
      current = next;
    }
    expect(() => run(head, ["class", () => Link])).not.toThrow();
    expect(run(head, ["class", () => Link])).toHaveLength(0);
  });
});

describe("validateType: сообщения", () => {
  it("формирует ошибку с полями и параметрами", () => {
    const errors = run(5, "string");
    expect(errors[0]).toEqual({
      field: "value",
      rule: "type",
      message: "Поле Value должно быть типа string",
      params: { type: "string" },
      value: 5,
      path: "value",
      label: "Value",
    });
  });

  it("поддерживает английскую локаль", () => {
    const errors = run(5, "string", { locale: "en" });
    expect(errors[0]?.message).toBe("Value must be of type string");
  });

  it("использует кастомный resolve", () => {
    const errors = run(5, "string", {
      resolve: (context) => `${context.rule}:${context.params.type}`,
    });
    expect(errors[0]?.message).toBe("type:string");
  });
});
