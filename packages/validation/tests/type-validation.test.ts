import { afterEach, describe, expect, it } from "vitest";
import { getValidationConfig, resetValidationConfig } from "../src/messages";
import { SCHEMA_SYMBOL, readClassSchema, readInstanceSchema } from "../src/schema";
import type { ClassSchema, FieldSchemaMap, TypeSchema } from "../src/schema";
import { validateType, typeName } from "../src/type-validation";
import type { ValidationConfig, ValidationError } from "../src/types";

function run(
  value: unknown,
  schema: TypeSchema,
  config: ValidationConfig = getValidationConfig(),
  labels?: Readonly<Record<string, string>>,
): ValidationError[] {
  const result = validateType(value, schema, {
    instance: {},
    field: "value",
    label: "Value",
    path: "value",
    config,
    ...(labels === undefined ? {} : { labels }),
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

  it("поддерживает optional-элементы кортежа", () => {
    const schema: TypeSchema = ["tuple", ["string", ["optional", "number"]]];
    expect(valid(["a"], schema)).toBe(true);
    expect(valid(["a", 1], schema)).toBe(true);
    expect(valid(["a", undefined], schema)).toBe(true);
    expect(valid([], schema)).toBe(false);
    expect(valid(["a", "b"], schema)).toBe(false);
    expect(valid(["a", 1, 2], schema)).toBe(false);
  });

  it("сочетает optional-элементы с null-маркером и rest", () => {
    const schema: TypeSchema = ["tuple", ["string", null, ["optional", "number"]], "boolean"];
    expect(valid(["a"], schema)).toBe(true);
    expect(valid(["a", true, 1], schema)).toBe(true);
    expect(valid(["a", true], schema)).toBe(true);
    expect(valid([], schema)).toBe(false);
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

  it("не дублирует одинаковые ошибки intersection", () => {
    const schema: TypeSchema = [
      "intersection",
      [["object", { a: "string" }], ["record", "string"]],
    ];
    const errors = run({ a: 1 }, schema);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.path).toBe("value.a");
  });

  it("сохраняет разные ошибки веток intersection", () => {
    const schema: TypeSchema = [
      "intersection",
      [["object", { a: "string" }], ["object", { a: "number" }]],
    ];
    expect(run({ a: true }, schema)).toHaveLength(2);
  });

  it("не схлопывает ошибки intersection с одинаковым сообщением", () => {
    const config: ValidationConfig = {
      messages: { ru: { "validation.type": "Неверный тип" } },
    };
    const schema: TypeSchema = [
      "intersection",
      [["object", { a: "string" }], ["object", { a: "number" }]],
    ];
    const errors = run({ a: true }, schema, config);
    expect(errors).toHaveLength(2);
    expect(errors.map((error) => error.params["type"])).toEqual([
      "string",
      "number",
    ]);
    expect(errors[0]?.message).toBe("Неверный тип");
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

  it("отклоняет record для не-plain объектов", () => {
    class Model {}
    const schema: TypeSchema = ["record", "number"];

    expect(valid({ a: 1 }, schema)).toBe(true);
    expect(valid(Object.create(null), schema)).toBe(true);
    expect(run(new Model(), schema)).toHaveLength(1);
    expect(run(new Date(), schema)).toHaveLength(1);
    expect(run(new Map(), schema)).toHaveLength(1);
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

  it("возвращает ошибку типа при превышении максимальной глубины", () => {
    let value: unknown = 1;
    let schema: TypeSchema = "number";
    for (let index = 0; index < 400; index += 1) {
      value = [value];
      schema = ["array", schema];
    }
    const errors = run(value, schema);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.params).toEqual({ type: "depth" });
    expect(errors[0]?.rule).toBe("type");
  });

  it("не читает прототип для схемного поля __proto__", () => {
    const fields = JSON.parse('{"__proto__":"string"}') as unknown as Readonly<
      Record<string, TypeSchema>
    >;
    const schema: TypeSchema = ["object", fields];
    const broken = JSON.parse('{"__proto__":5}') as unknown;
    const errors = run(broken, schema);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.path).toBe("value.__proto__");
    expect(valid(JSON.parse('{"__proto__":"ok"}'), schema)).toBe(true);
  });

  it("не читает отсутствующие поля из Object.prototype", () => {
    const fields: FieldSchemaMap = {
      toString: ["optional", "string"] as TypeSchema,
      constructor: ["optional", "string"] as TypeSchema,
      valueOf: ["optional", "string"] as TypeSchema,
      hasOwnProperty: ["optional", "string"] as TypeSchema,
    };
    expect(valid({}, ["object", fields])).toBe(true);
    expect(
      valid({}, [
        "object",
        JSON.parse('{"toString":"string"}') as FieldSchemaMap,
      ]),
    ).toBe(false);
  });

  it("читает собственные поля с именами из Object.prototype", () => {
    const schema: TypeSchema = [
      "object",
      JSON.parse('{"toString":"number","constructor":"number"}') as FieldSchemaMap,
    ];
    expect(valid({ toString: 1, constructor: 2 }, schema)).toBe(true);
    const errors = run({ toString: "1", constructor: 2 }, schema);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.path).toBe("value.toString");
  });

  it("читает auto-accessor с именем __proto__", () => {
    class WithProto {
      public accessor __proto__ = "ok";
    }
    const schema: TypeSchema = [
      "object",
      JSON.parse('{"__proto__":"string"}') as FieldSchemaMap,
    ];
    const instance = new WithProto();
    expect(valid(instance, schema)).toBe(true);
    instance.__proto__ = 5 as unknown as string;
    expect(run(instance, schema)).toHaveLength(1);
  });
});

describe("validateType: глубина данных", () => {
  function arraySchema(levels: number): TypeSchema {
    let schema: TypeSchema = "number";
    for (let index = 0; index < levels; index += 1) {
      schema = ["array", schema];
    }
    return schema;
  }

  function arrayValue(levels: number): unknown {
    let value: unknown = 1;
    for (let index = 0; index < levels; index += 1) {
      value = [value];
    }
    return value;
  }

  function objectSchema(levels: number): TypeSchema {
    let schema: TypeSchema = "number";
    for (let index = 0; index < levels; index += 1) {
      schema = ["object", { child: schema }];
    }
    return schema;
  }

  function objectValue(levels: number): unknown {
    let value: unknown = 1;
    for (let index = 0; index < levels; index += 1) {
      value = { child: value };
    }
    return value;
  }

  it("пропускает 128 и 200 уровней рекурсивного массива", () => {
    expect(valid(arrayValue(128), arraySchema(128))).toBe(true);
    expect(valid(arrayValue(200), arraySchema(200))).toBe(true);
  });

  it("пропускает 128 и 200 уровней рекурсивного объекта", () => {
    expect(valid(objectValue(128), objectSchema(128))).toBe(true);
    expect(valid(objectValue(200), objectSchema(200))).toBe(true);
  });

  it("сообщает понятную ошибку глубины для 400 уровней массива", () => {
    const errors = run(arrayValue(400), arraySchema(400));
    expect(errors).toHaveLength(1);
    expect(errors[0]?.params).toEqual({ type: "depth" });
    expect(errors[0]?.message).toContain("слишком глубоко вложено");
  });

  it("сообщает понятную ошибку глубины для 400 уровней объекта", () => {
    const errors = run(objectValue(400), objectSchema(400));
    expect(errors).toHaveLength(1);
    expect(errors[0]?.params).toEqual({ type: "depth" });
    expect(errors[0]?.message).toContain("слишком глубоко вложено");
  });

  it("не считает обёртки optional, nullable и union глубиной", () => {
    let schema: TypeSchema = "number";
    for (let index = 0; index < 400; index += 1) {
      schema = ["optional", ["nullable", ["union", [schema]]]];
    }
    expect(valid(1, schema)).toBe(true);
  });
});

describe("validateType: разделяемые ссылки (DAG)", () => {
  interface DagNode {
    x: number;
    left?: DagNode;
    right?: DagNode;
  }

  let dagSchema: TypeSchema;
  dagSchema = [
    "object",
    {
      x: "number",
      left: ["optional", ["lazy", () => dagSchema]],
      right: ["optional", ["lazy", () => dagSchema]],
    },
  ];

  function diamond(levels: number): DagNode {
    let node: DagNode = { x: 0 };
    for (let index = 0; index < levels; index += 1) {
      node = { x: index, left: node, right: node };
    }
    return node;
  }

  it("валидирует ромбовидный граф глубины 20 за приемлемое время", () => {
    // Прогрев, чтобы измерение не включало первую JIT-компиляцию.
    expect(valid(diamond(16), dagSchema)).toBe(true);

    const start = performance.now();
    const isValid = valid(diamond(20), dagSchema);
    const elapsed = performance.now() - start;

    expect(isValid).toBe(true);
    expect(elapsed).toBeLessThan(200);
  });

  it("не вешает процесс на графе 25 уровней", () => {
    const start = performance.now();
    const errors = run(diamond(25), dagSchema);
    const elapsed = performance.now() - start;

    expect(errors).toHaveLength(0);
    expect(elapsed).toBeLessThan(1000);
  });

  it("репортит ошибку общего узла на каждом пути", () => {
    const shared: DagNode = { x: "bad" as unknown as number };
    const root: DagNode = { x: 1, left: shared, right: shared };

    const errors = run(root, dagSchema);

    expect(errors.map((error) => error.path)).toEqual([
      "value.left.x",
      "value.right.x",
    ]);
    expect(errors.every((error) => (
      error.rule === "type" && error.params["type"] === "number"
    ))).toBe(true);
  });

  it("не кеширует успех, полученный через защиту от цикла", () => {
    const node: DagNode = { x: 1 };
    node.left = node;
    node.right = node;

    expect(run(node, dagSchema)).toHaveLength(0);
  });

  it("не обходит MAX_DEPTH при повторном использовании кеша", () => {
    let nodeSchema: TypeSchema;
    nodeSchema = [
      "object",
      {
        x: "number",
        next: ["optional", ["lazy", () => nodeSchema]],
      },
    ];

    let chainSchema: TypeSchema;
    chainSchema = [
      "object",
      {
        next: ["optional", ["lazy", () => chainSchema]],
        leaf: ["optional", ["lazy", () => nodeSchema]],
      },
    ];

    const rootSchema: TypeSchema = [
      "object",
      {
        early: ["lazy", () => nodeSchema],
        chain: ["lazy", () => chainSchema],
      },
    ];

    function nodeChain(levels: number): unknown {
      let node: unknown = { x: 0 };
      for (let index = 0; index < levels; index += 1) {
        node = { x: index, next: node };
      }
      return node;
    }

    const shared = nodeChain(20);
    let chain: unknown = shared;
    for (let index = 0; index < 240; index += 1) {
      chain = { next: chain };
    }

    const errors = run({ early: shared, chain }, rootSchema);

    expect(errors.some((error) => error.params["type"] === "depth")).toBe(true);
  });
});

describe("validateType: большие коллекции и экранирование ключей", () => {
  it("собирает 200 000 ошибок без переполнения стека", () => {
    const items = new Array<unknown>(200_000).fill("x");

    const errors = run({ items }, ["object", { items: ["array", "number"] }]);

    expect(errors).toHaveLength(200_000);
    expect(errors[0]?.path).toBe("value.items[0]");
    expect(errors[errors.length - 1]?.path).toBe("value.items[199999]");
  }, 30_000);

  it("не смешивает числовые и символьные ключи Map", () => {
    const value = new Map<unknown, unknown>([
      [0, "bad"],
      [Symbol("key"), "bad"],
    ]);

    const errors = run(value, ["mapof", "number", "number"]);

    expect(errors.map((error) => error.path)).toEqual([
      "value[0]",
      "value[Symbol(key)]",
      "value[Symbol(key)].key",
    ]);
  });

  it("экранирует ключи Record и не смешивает их с вложенным путём", () => {
    const recordErrors = run(
      { "a.b": { b: "bad" } },
      ["record", ["object", { b: "number" }]],
    );
    expect(recordErrors[0]?.path).toBe('value["a.b"].b');

    const objectErrors = run(
      { "a.b": "bad", a: { b: "bad" } },
      ["object", { "a.b": "number", a: ["object", { b: "number" }] }],
    );
    expect(objectErrors.map((error) => error.path)).toEqual([
      'value["a.b"]',
      "value.a.b",
    ]);
  });

  it("применяет labels к экранированному ключу по точному пути", () => {
    const errors = run(
      { "a.b": "bad" },
      ["record", "number"],
      getValidationConfig(),
      { 'value["a.b"]': "Ключ" },
    );

    expect(errors[0]?.label).toBe("Ключ");
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

  it("вызывает class-thunk один раз при ошибке", () => {
    let calls = 0;
    const schema: TypeSchema = ["class", () => {
      calls += 1;
      return Point;
    }];
    const errors = run("x", schema);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.params).toEqual({ type: "Point" });
    expect(calls).toBe(1);
  });

  it("сообщает ошибку типа при превышении глубины", () => {
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
    const errors = run(head, ["class", () => Link]);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.rule).toBe("type");
    expect(errors[0]?.params).toEqual({ type: "depth" });
  });
});

describe("validateType: ленивые схемы", () => {
  interface NodeValue {
    value: string;
    next?: NodeValue | null;
  }

  const nodeSchema: TypeSchema = [
    "object",
    {
      value: "string",
      next: ["optional", ["nullable", ["lazy", () => nodeSchema]]],
    },
  ];

  it("разрешает рекурсивный интерфейс на трёх уровнях", () => {
    const node: NodeValue = {
      value: "a",
      next: { value: "b", next: { value: "c", next: null } },
    };
    expect(valid(node, nodeSchema)).toBe(true);
    expect(valid({ value: "a" }, nodeSchema)).toBe(true);
    expect(valid({ value: "a", next: null }, nodeSchema)).toBe(true);
  });

  it("находит ошибку во вложенном рекурсивном поле", () => {
    const broken = {
      value: "a",
      next: { value: "b", next: { value: 5, next: null } },
    };
    const errors = run(broken, nodeSchema);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.path).toBe("value.next.next.value");
  });

  it("валидирует массив рекурсивных элементов", () => {
    const schema: TypeSchema = ["array", ["lazy", () => nodeSchema]];
    expect(valid([{ value: "a" }, { value: "b", next: null }], schema)).toBe(true);
    const errors = run([{ value: "a" }, { value: 5 }], schema);
    expect(errors[0]?.path).toBe("value[1].value");
  });

  it("комбинирует lazy с nullable", () => {
    const schema: TypeSchema = ["nullable", ["lazy", () => nodeSchema]];
    expect(valid(null, schema)).toBe(true);
    expect(valid({ value: "a" }, schema)).toBe(true);
    expect(valid(5, schema)).toBe(false);
  });

  it("вызывает thunk только при валидации", () => {
    let calls = 0;
    const schema: TypeSchema = ["lazy", () => {
      calls += 1;
      return "string";
    }];
    expect(calls).toBe(0);
    expect(valid("text", schema)).toBe(true);
    expect(calls).toBe(1);
    expect(valid(1, schema)).toBe(false);
    expect(calls).toBe(2);
  });

  it("возвращает ошибку, если thunk бросает исключение", () => {
    const schema: TypeSchema = ["lazy", () => {
      throw new Error("boom");
    }];
    const errors = run("text", schema);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.rule).toBe("type");
  });

  it("вызывает lazy-thunk один раз при ошибке", () => {
    let calls = 0;
    const schema: TypeSchema = ["lazy", () => {
      calls += 1;
      return "number";
    }];
    const errors = run("text", schema);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.params).toEqual({ type: "number" });
    expect(calls).toBe(1);
  });

  it("подписывается на thenable только один раз", async () => {
    let subscriptions = 0;
    const thenable = {
      then(resolve: (value: unknown) => void): void {
        subscriptions += 1;
        resolve(undefined);
      },
    };
    const schema = ["lazy", () => thenable] as unknown as TypeSchema;
    expect(run("text", schema)).toHaveLength(1);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(subscriptions).toBe(1);
  });

  it("возвращает ошибку типа для thunk с некорректной схемой", () => {
    const numberThunk = ["lazy", () => 42] as unknown as TypeSchema;
    const nullThunk = ["lazy", () => null] as unknown as TypeSchema;

    expect(run("text", numberThunk)).toHaveLength(1);
    expect(run("text", numberThunk)[0]?.rule).toBe("type");
    expect(run("text", nullThunk)).toHaveLength(1);
    expect(run("text", nullThunk)[0]?.rule).toBe("type");
  });

  it("возвращает ошибку для class с некорректным конструктором", () => {
    const arrow = (() => undefined) as unknown as Function;
    const schema = ["class", () => arrow] as unknown as TypeSchema;

    expect(() => run({}, schema)).not.toThrow();
    expect(run({}, schema)).toHaveLength(1);
  });

  it("не зацикливается на thunk, вернувшем сам себя", () => {
    const schema: TypeSchema = ["lazy", () => schema];
    expect(() => run("text", schema)).not.toThrow();
    expect(run("text", schema)).toHaveLength(0);
  });

  it("пропускает циклическое значение без ошибок", () => {
    const node: { value: string; next: unknown } = { value: "a", next: null };
    node.next = node;
    expect(() => run(node, nodeSchema)).not.toThrow();
    expect(run(node, nodeSchema)).toHaveLength(0);
  });

  it("гасит rejecting промис из lazy- и class-thunk", async () => {
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
      const lazySchema = ["lazy", () => Promise.reject(new Error("lazy"))] as unknown as TypeSchema;
      const classSchema = ["class", () => Promise.reject(new Error("class"))] as unknown as TypeSchema;

      expect(run("x", lazySchema)).toHaveLength(1);
      expect(run({}, classSchema)).toHaveLength(1);
      expect(typeName(lazySchema)).toBe("unknown");
      expect(typeName(classSchema)).toBe("object");

      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    } finally {
      proc.off("unhandledRejection", onRejection);
    }
    expect(rejections).toEqual([]);
  });

  it("сообщает ошибку глубины на большой глубине рекурсивных данных", () => {
    let node: NodeValue = { value: "end", next: null };
    for (let index = 0; index < 500; index += 1) {
      node = { value: String(index), next: node };
    }
    expect(() => run(node, nodeSchema)).not.toThrow();
    const errors = run(node, nodeSchema);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.every((error) => error.params["type"] === "depth")).toBe(true);
  });

  it("не тратит бюджет глубины на lazy", () => {
    function recursiveNode(levels: number): NodeValue {
      let node: NodeValue = { value: "end", next: null };
      for (let index = 0; index < levels; index += 1) {
        node = { value: String(index), next: node };
      }
      return node;
    }

    expect(valid(recursiveNode(200), nodeSchema)).toBe(true);

    const errors = run(recursiveNode(400), nodeSchema);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.every((error) => error.params["type"] === "depth")).toBe(true);
  });
});

describe("validateType: rest-кортежи", () => {
  it("валидирует фиксированную часть и хвост", () => {
    const schema: TypeSchema = ["tuple", ["string", "number"], "boolean"];
    expect(valid(["a", 1], schema)).toBe(true);
    expect(valid(["a", 1, true], schema)).toBe(true);
    expect(valid(["a", 1, true, false], schema)).toBe(true);
    expect(valid(["a"], schema)).toBe(false);
    expect(valid([], schema)).toBe(false);
    const errors = run(["a", 1, true, 5], schema);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.path).toBe("value[3]");
  });

  it("сообщает тип кортежа с rest", () => {
    const schema: TypeSchema = ["tuple", ["string", "number"], "boolean"];
    expect(run([], schema)[0]?.params).toEqual({
      type: "[string, number, ...boolean[]]",
    });
  });

  it("поддерживает кортеж только из rest", () => {
    const schema: TypeSchema = ["tuple", [], "number"];
    expect(valid([], schema)).toBe(true);
    expect(valid([1, 2, 3], schema)).toBe(true);
    expect(valid(["x"], schema)).toBe(false);
    const errors = run([1, "x"], schema);
    expect(errors[0]?.path).toBe("value[1]");
  });

  it("сочетает необязательные элементы и rest", () => {
    const schema: TypeSchema = ["tuple", ["string", null], "number"];
    expect(valid(["a"], schema)).toBe(true);
    expect(valid(["a", 1, 2], schema)).toBe(true);
    expect(valid([], schema)).toBe(false);
    const errors = run(["a", 1, "x"], schema);
    expect(errors[0]?.path).toBe("value[2]");
  });

  it("не меняет поведение обычного кортежа", () => {
    const schema: TypeSchema = ["tuple", ["string", "number", null]];
    expect(valid(["a", 1], schema)).toBe(true);
    expect(valid(["a", 1, true], schema)).toBe(true);
    expect(valid([], schema)).toBe(false);
    expect(valid(["a", 1, true, false], schema)).toBe(false);
  });
});

describe("чтение схем", () => {
  it("не читает символ схемы по цепочке прототипов функции", () => {
    class Parent {}
    defineSchema(Parent, { fields: { value: "string" } });

    class Child extends Parent {}

    expect(readClassSchema(Child)).toBeNull();
    expect(readInstanceSchema(new Child())).toEqual({ value: "string" });
  });

  it("не кеширует отсутствие схемы", () => {
    class Late {}
    expect(readClassSchema(Late)).toBeNull();
    expect(readInstanceSchema(new Late())).toBeNull();

    defineSchema(Late, { fields: { value: "number" } });

    expect(readClassSchema(Late)).not.toBeNull();
    expect(readInstanceSchema(new Late())).toEqual({ value: "number" });
  });

  it("пересобирает кеш при замене схемы", () => {
    class Replaced {}
    defineSchema(Replaced, { fields: { first: "string" } });
    expect(readInstanceSchema(new Replaced())).toEqual({ first: "string" });

    defineSchema(Replaced, { fields: { second: "number" } });

    expect(readClassSchema(Replaced)).toEqual({ fields: { second: "number" } });
    expect(readInstanceSchema(new Replaced())).toEqual({ second: "number" });
  });

  it("подхватывает замену fields внутри объекта схемы", () => {
    class Mutable {}
    const schema: { version?: number; fields: FieldSchemaMap } = {
      version: 1,
      fields: { first: "string" },
    };
    defineSchema(Mutable, schema);
    expect(readInstanceSchema(new Mutable())).toEqual({ first: "string" });

    schema.fields = { second: "number" };

    expect(readClassSchema(Mutable)).toEqual({
      version: 1,
      fields: { second: "number" },
    });
    expect(readInstanceSchema(new Mutable())).toEqual({ second: "number" });
  });

  it("инвалидирует кеш при росте цепочки прототипов", () => {
    class Base {}
    class Middle extends Base {}
    class Child extends Base {}
    defineSchema(Base, { fields: { base: "number" } });
    defineSchema(Middle, { fields: { middle: "string" } });
    defineSchema(Child, { fields: { child: "boolean" } });

    const instance = new Child();
    expect(readInstanceSchema(instance)).toEqual({
      base: "number",
      child: "boolean",
    });

    Object.setPrototypeOf(Child, Middle);
    try {
      expect(readInstanceSchema(instance)).toEqual({
        base: "number",
        middle: "string",
        child: "boolean",
      });
    } finally {
      Object.setPrototypeOf(Child, Base);
    }
  });

  it("не считает версией нечисловое поле legacy bare-map", () => {
    class Legacy {}
    defineSchema(Legacy, { version: "string" });

    expect(readClassSchema(Legacy)).toEqual({
      fields: { version: "string" },
    });
    expect(readInstanceSchema(new Legacy())).toEqual({ version: "string" });
  });

  it("пересобирает кеш при удалении схемы", () => {
    class Removed {}
    defineSchema(Removed, { fields: { value: "string" } });
    expect(readInstanceSchema(new Removed())).toEqual({ value: "string" });

    expect(Reflect.deleteProperty(Removed, SCHEMA_SYMBOL)).toBe(true);

    expect(readClassSchema(Removed)).toBeNull();
    expect(readInstanceSchema(new Removed())).toBeNull();
  });

  it("сохраняет собственное поле __proto__ при слиянии схем", () => {
    class Parent {}
    class Child extends Parent {}
    const parentFields = JSON.parse('{"__proto__":"string"}') as unknown as FieldSchemaMap;
    const childFields = JSON.parse('{"age":"number"}') as unknown as FieldSchemaMap;
    defineSchema(Parent, { fields: parentFields });
    defineSchema(Child, { fields: childFields });

    const merged = readInstanceSchema(new Child());

    expect(merged).not.toBeNull();
    expect(Object.getOwnPropertyDescriptor(merged ?? {}, "__proto__")?.value)
      .toBe("string");
    expect(merged?.["age"]).toBe("number");
  });

  it("бросает ошибку для версии без fields", () => {
    class BrokenVersion {}
    defineSchema(BrokenVersion, { version: 2 } as unknown as ClassSchema);
    expect(() => readClassSchema(BrokenVersion)).toThrow(/версия/);
  });

  it("бросает ошибку формата для версии 1 без fields", () => {
    class BrokenFormat {}
    defineSchema(BrokenFormat, { version: 1 } as unknown as ClassSchema);
    expect(() => readClassSchema(BrokenFormat)).toThrow(/fields/);
  });
});

describe("validateType: labels структурных схем", () => {
  it("применяет label по полному пути для object", () => {
    const errors = run(
      { email: 5 },
      ["object", { email: "string" }],
      getValidationConfig(),
      { "value.email": "Почта" },
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]?.label).toBe("Почта");
    expect(errors[0]?.message).toContain("Почта");
  });

  it("применяет labels для record, mapof, setof, array и tuple", () => {
    const config = getValidationConfig();

    expect(run({ a: "x" }, ["record", "number"], config, { "value.a": "Ключ" })[0]?.label)
      .toBe("Ключ");
    expect(
      run(new Map([["a", "x"]]), ["mapof", "string", "number"], config, { "value[a]": "Значение" })[0]?.label,
    ).toBe("Значение");
    expect(run(new Set(["x"]), ["setof", "number"], config, { "value[0]": "Элемент" })[0]?.label)
      .toBe("Элемент");
    expect(run(["x", 1], ["array", "string"], config, { "value[1]": "Второй" })[0]?.label)
      .toBe("Второй");
    expect(run([1], ["tuple", ["string"]], config, { "value[0]": "Первый" })[0]?.label)
      .toBe("Первый");
  });

  it("не падает на undefined-схеме поля", () => {
    const fields = { a: undefined } as unknown as FieldSchemaMap;
    const schema: TypeSchema = ["object", fields];

    expect(() => run({ a: 1 }, schema)).not.toThrow();
    expect(run({ a: 1 }, schema)).toHaveLength(0);

    const withoutFields = ["object", undefined] as unknown as TypeSchema;
    expect(run({}, withoutFields)).toHaveLength(0);
  });

  it("сохраняет ключ как label без карты labels", () => {
    expect(run({ email: 5 }, ["object", { email: "string" }])[0]?.label).toBe("email");
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
