import { describe, expect, it } from "vitest";
import {
  PROTOCOL_SCHEMA,
  ProtocolModel,
  SCHEMA_VERSION,
  decode,
  defineProtocol,
  encode,
  getSchema,
} from "../src/index.js";
import { bytesOf, expectProtocolError, hex, model } from "./helpers.js";

describe("схема: ручное определение", () => {
  it("массив SchemaEntry", () => {
    class Manual {
      public value = 0;
    }
    defineProtocol(Manual, [{ kind: "field", name: "value", type: "int32" }]);
    const value = new Manual();
    value.value = 3;
    expect(hex(encode(value))).toBe("06");
    expect(decode(Manual, bytesOf(0x06)).value).toBe(3);
  });

  it("объект с fields массивом", () => {
    class Manual {
      public value = "";
    }
    defineProtocol(Manual, { fields: [{ name: "value", type: "string" }] });
    const value = new Manual();
    value.value = "a";
    expect(hex(encode(value))).toBe("0161");
  });

  it("объект с fields-записью", () => {
    class Manual {
      public value = 0;
    }
    defineProtocol(Manual, { fields: { value: "int32" } });
    const value = new Manual();
    value.value = 1;
    expect(hex(encode(value))).toBe("02");
  });

  it("символ схемы можно установить напрямую", () => {
    class Manual {
      public value = 0;
    }
    Object.defineProperty(Manual, PROTOCOL_SCHEMA, {
      value: { fields: [{ name: "value", type: "int32" }] },
    });
    const value = new Manual();
    value.value = 2;
    expect(hex(encode(value))).toBe("04");
  });

  it("oneof в массиве SchemaEntry", () => {
    enum Mode {
      On = 1,
      Off = 2,
    }
    class Manual {
      public mode: Mode = Mode.On;
      public on: null | undefined = null;
      public off: null | undefined = undefined;
    }
    defineProtocol(Manual, [
      {
        kind: "oneof",
        name: "mode",
        enum: () => Mode,
        variants: [
          { value: Mode.On, field: "on", type: null },
          { value: Mode.Off, field: "off", type: null },
        ],
      },
    ]);
    const value = new Manual();
    value.mode = Mode.Off;
    value.on = undefined;
    expect(hex(encode(value))).toBe("02");
  });

  it("версия схемы", () => {
    class Manual {
      public value = 0;
    }
    defineProtocol(Manual, { version: SCHEMA_VERSION, fields: [{ name: "value", type: "int32" }] });
    expect(getSchema(Manual).fields.length).toBe(1);
  });

  it("неподдерживаемая версия", () => {
    class Manual {
      public value = 0;
    }
    defineProtocol(Manual, { version: 99, fields: [{ name: "value", type: "int32" }] });
    expectProtocolError(() => getSchema(Manual), "schema");
  });
});

describe("схема: наследование", () => {
  class Base {
    public alpha = "";
    public shared: unknown = 0;
  }

  class Derived extends Base {
    public beta = 0;
    public shared: unknown = "";
  }

  defineProtocol(Base, {
    fields: [
      { name: "alpha", type: "string" },
      { name: "shared", type: "int32" },
    ],
  });

  defineProtocol(Derived, {
    fields: [
      { name: "beta", type: "int32" },
      { name: "shared", type: "string" },
    ],
  });

  it("включает унаследованные поля", () => {
    const names = getSchema(Derived).fields.map((field) => field.name);
    expect(names).toEqual(["alpha", "beta", "shared"]);
  });

  it("поле потомка переопределяет базовое", () => {
    const value = new Derived();
    value.alpha = "a";
    value.beta = 1;
    value.shared = "s";
    const restored = decode(Derived, encode(value));
    expect(restored.alpha).toBe("a");
    expect(restored.beta).toBe(1);
    expect(restored.shared).toBe("s");
  });
});

describe("схема: oneof", () => {
  enum Mode {
    One = 1,
    Two = 2,
  }

  it("тип варианта берётся из описанного поля", () => {
    class Payload {
      public name = "";
    }
    defineProtocol(Payload, { fields: [{ name: "name", type: "string" }] });

    class Lazy {
      public mode: Mode = Mode.One;
      public one: Payload | undefined = undefined;
    }

    defineProtocol(Lazy, {
      fields: [{ name: "one", type: ["class", () => Payload], optional: true }],
      oneofs: [
        {
          name: "mode",
          enum: () => Mode,
          variants: [{ value: Mode.One, field: "one" }],
        },
      ],
    });

    const value = new Lazy();
    value.one = new Payload();
    value.one.name = "x";
    expect(hex(encode(value))).toBe("010178");
    expect(decode(Lazy, encode(value)).one?.name).toBe("x");
  });

  it("дубликат значения oneof", () => {
    class Broken {
      public mode = 1;
      public a: null | undefined = null;
      public b: null | undefined = null;
    }
    defineProtocol(Broken, {
      fields: [],
      oneofs: [
        {
          name: "mode",
          enum: () => ({}),
          variants: [
            { value: 1, field: "a", type: null },
            { value: 1, field: "b", type: null },
          ],
        },
      ],
    });
    expectProtocolError(() => getSchema(Broken), "schema");
  });

  it("дубликат поля варианта", () => {
    class Broken {
      public mode = 1;
      public a: null | undefined = null;
    }
    defineProtocol(Broken, {
      fields: [],
      oneofs: [
        {
          name: "mode",
          enum: () => ({}),
          variants: [
            { value: 1, field: "a", type: null },
            { value: 2, field: "a", type: null },
          ],
        },
      ],
    });
    expectProtocolError(() => getSchema(Broken), "schema");
  });

  it("oneof не может совпадать с полем", () => {
    class Broken {
      public mode = 1;
    }
    defineProtocol(Broken, {
      fields: [{ name: "mode", type: "int32" }],
      oneofs: [{ name: "mode", enum: () => ({}), variants: [] }],
    });
    expectProtocolError(() => getSchema(Broken), "schema");
  });

  it("вариант без типа", () => {
    class Broken {
      public mode = 1;
    }
    defineProtocol(Broken, {
      fields: [],
      oneofs: [
        { name: "mode", enum: () => ({}), variants: [{ value: 1, field: "missing" }] },
      ],
    });
    expectProtocolError(() => getSchema(Broken), "schema");
  });
});

describe("схема: ошибки", () => {
  it("нет схемы", () => {
    class Plain {}
    expectProtocolError(() => getSchema(Plain), "schema");
    expectProtocolError(() => encode(new Plain()), "schema");
  });

  it("декораторы без схемы не достаточны", () => {
    class Decorated extends ProtocolModel {
      public value = 0;
    }
    expectProtocolError(() => encode(new Decorated()), "schema");
  });

  it("дубликат имени поля", () => {
    class Broken {
      public value = 0;
    }
    defineProtocol(Broken, [
      { kind: "field", name: "value", type: "int32" },
      { kind: "field", name: "value", type: "string" },
    ]);
    expectProtocolError(() => getSchema(Broken), "schema");
  });

  it("неизвестный тип", () => {
    class Broken {
      public value = 0;
    }
    defineProtocol(Broken, { fields: { value: "any" as never } });
    expectProtocolError(() => encode(new Broken()), "schema");
  });

  it("неверное описание типа", () => {
    class Broken {
      public value = 0;
    }
    defineProtocol(Broken, { fields: { value: ["array"] as never } });
    expectProtocolError(() => getSchema(Broken), "schema");
  });

  it("схема применяется после первой ошибки", () => {
    class Late {
      public value = 0;
    }
    expectProtocolError(() => encode(new Late()), "schema");
    defineProtocol(Late, { fields: [{ name: "value", type: "int32" }] });
    const value = new Late();
    value.value = 1;
    expect(hex(encode(value))).toBe("02");
  });

  it("мусорные байты после сообщения", () => {
    const Model = model([{ name: "value", type: "int32" }]);
    expectProtocolError(() => decode(Model, bytesOf(0x02, 0xff)), "trailing");
  });
});

describe("символы", () => {
  it("PROTOCOL_SCHEMA — глобальный символ", () => {
    expect(PROTOCOL_SCHEMA).toBe(Symbol.for("silent.protocol.schema"));
  });

  it("SCHEMA_VERSION", () => {
    expect(SCHEMA_VERSION).toBe(1);
  });
});

describe("порядок полей", () => {
  it("сортирует по UTF-8, а не по объявлению", () => {
    class Order {
      public я = 1;
      public a = 2;
      public Z = 3;
    }
    defineProtocol(Order, {
      fields: [
        { name: "я", type: "int32" },
        { name: "a", type: "int32" },
        { name: "Z", type: "int32" },
      ],
    });
    const value = new Order();
    expect(hex(encode(value))).toBe("060402");
  });

  it("oneof сортируется по имени дискриминатора", () => {
    enum Mode {
      A = 1,
    }
    class Order {
      public a = 0;
      public mode: Mode = Mode.A;
      public on: null | undefined = null;
      public z = 0;
    }
    defineProtocol(Order, {
      fields: [
        { name: "z", type: "int32" },
        { name: "a", type: "int32" },
      ],
      oneofs: [
        {
          name: "mode",
          enum: () => Mode,
          variants: [{ value: Mode.A, field: "on", type: null }],
        },
      ],
    });
    const value = new Order();
    value.z = 1;
    value.a = 2;
    expect(hex(encode(value))).toBe("040102");
  });
});
