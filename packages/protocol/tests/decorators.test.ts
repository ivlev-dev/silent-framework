import { describe, expect, it } from "vitest";
import {
  EpochMillis,
  Fixed32,
  Fixed64,
  Float32,
  Int32,
  Int64,
  OneOf,
  ProtocolModel,
  Uint32,
  Uint64,
  decode,
  defineProtocol,
  encode,
} from "../src/index.js";
import { bytesOf, expectProtocolError, hex } from "./helpers.js";

enum Kind {
  A = 1,
  B = 2,
  C = 3,
}

class Payload {
  public name = "";
}

defineProtocol(Payload, {
  fields: [{ name: "name", type: "string" }],
});

function payload(name: string): Payload {
  const value = new Payload();
  value.name = name;
  return value;
}

describe("декораторы: wire-типы", () => {
  it("@Int32", () => {
    class Wire {
      @Int32()
      public accessor value = 0;
    }
    defineProtocol(Wire, { fields: [{ name: "value", type: "float64" }] });
    const value = new Wire();
    value.value = -1;
    expect(hex(encode(value))).toBe("01");
    expect(decode(Wire, bytesOf(0x01)).value).toBe(-1);
  });

  it("@Uint32", () => {
    class Wire {
      @Uint32()
      public accessor value = 0;
    }
    defineProtocol(Wire, { fields: [{ name: "value", type: "float64" }] });
    const value = new Wire();
    value.value = 300;
    expect(hex(encode(value))).toBe("ac02");
    expect(decode(Wire, bytesOf(0xac, 0x02)).value).toBe(300);
  });

  it("@Float32", () => {
    class Wire {
      @Float32()
      public accessor value = 0;
    }
    defineProtocol(Wire, { fields: [{ name: "value", type: "float64" }] });
    const value = new Wire();
    value.value = 1.5;
    expect(hex(encode(value))).toBe("0000c03f");
    expect(decode(Wire, bytesOf(0x00, 0x00, 0xc0, 0x3f)).value).toBe(1.5);
  });

  it("@Fixed32", () => {
    class Wire {
      @Fixed32()
      public accessor value = 0;
    }
    defineProtocol(Wire, { fields: [{ name: "value", type: "float64" }] });
    const value = new Wire();
    value.value = 0x01020304;
    expect(hex(encode(value))).toBe("04030201");
    expect(decode(Wire, bytesOf(0x04, 0x03, 0x02, 0x01)).value).toBe(0x01020304);
  });

  it("@Fixed64 на number", () => {
    class Wire {
      @Fixed64()
      public accessor value = 0;
    }
    defineProtocol(Wire, { fields: [{ name: "value", type: "float64" }] });
    const value = new Wire();
    value.value = 0x010203040506;
    expect(hex(encode(value))).toBe("0605040302010000");
    expect(decode(Wire, bytesOf(0x06, 0x05, 0x04, 0x03, 0x02, 0x01, 0x00, 0x00)).value)
      .toBe(0x010203040506);
  });

  it("@Uint64 на bigint", () => {
    class Wire {
      @Uint64()
      public accessor value = 0n;
    }
    defineProtocol(Wire, { fields: [{ name: "value", type: "bigint" }] });
    const value = new Wire();
    value.value = 2n ** 63n;
    expect(hex(encode(value))).toBe("80808080808080808001");
    expect(decode(Wire, encode(value)).value).toBe(2n ** 63n);
  });

  it("@Uint64 на number", () => {
    class Wire {
      @Uint64()
      public accessor value = 0;
    }
    defineProtocol(Wire, { fields: [{ name: "value", type: "float64" }] });
    const value = new Wire();
    value.value = 300;
    expect(hex(encode(value))).toBe("ac02");
    expect(decode(Wire, encode(value)).value).toBe(300);
  });

  it("@Fixed64 на bigint", () => {
    class Wire {
      @Fixed64()
      public accessor value = 0n;
    }
    defineProtocol(Wire, { fields: [{ name: "value", type: "bigint" }] });
    const value = new Wire();
    value.value = 1n;
    expect(hex(encode(value))).toBe("0100000000000000");
    expect(decode(Wire, encode(value)).value).toBe(1n);
  });

  it("@Int64 на bigint", () => {
    class Wire {
      @Int64()
      public accessor value = 0n;
    }
    defineProtocol(Wire, { fields: [{ name: "value", type: "bigint" }] });
    const value = new Wire();
    value.value = -1n;
    expect(hex(encode(value))).toBe("01");
  });

  it("@Int64 на number — ошибка схемы", () => {
    class Wire {
      @Int64()
      public accessor value = 0;
    }
    defineProtocol(Wire, { fields: [{ name: "value", type: "float64" }] });
    const value = new Wire();
    expectProtocolError(() => encode(value), "schema");
  });

  it("@EpochMillis", () => {
    class Wire {
      @EpochMillis()
      public accessor value = 0;
    }
    defineProtocol(Wire, { fields: [{ name: "value", type: "float64" }] });
    const value = new Wire();
    value.value = 1000;
    expect(hex(encode(value))).toBe("d00f");
    expect(decode(Wire, bytesOf(0xd0, 0x0f)).value).toBe(1000);
  });

  it("схема из декораторов применяется при первом decode", () => {
    class Wire extends ProtocolModel {
      @Int32()
      public accessor value = 0;
    }
    defineProtocol(Wire, { fields: [{ name: "value", type: "float64" }] });
    const restored = decode(Wire, bytesOf(0x02));
    expect(restored.value).toBe(1);
  });
});

describe("декораторы: oneof", () => {
  class Event extends ProtocolModel {
    public accessor kind: Kind = Kind.A;

    @OneOf(Kind.A)
    public accessor a: Payload | undefined = undefined;

    @OneOf(Kind.B)
    public accessor b: Payload | undefined = undefined;

    @OneOf(Kind.C)
    public accessor c: null | undefined = undefined;
  }

  defineProtocol(Event, {
    fields: [],
    oneofs: [
      {
        name: "kind",
        enum: () => Kind,
        variants: [
          { value: Kind.A, field: "a", type: ["class", () => Payload] },
          { value: Kind.B, field: "b", type: ["class", () => Payload] },
          { value: Kind.C, field: "c", type: null },
        ],
      },
    ],
  });

  it("кодирует вариант из декоратора", () => {
    const event = new Event();
    event.kind = Kind.A;
    event.a = payload("x");
    expect(hex(encode(event))).toBe("010178");
  });

  it("декодирует до первого экземпляра", () => {
    const event = decode(Event, bytesOf(0x01, 0x01, 0x78));
    expect(event.kind).toBe(Kind.A);
    expect(event.a?.name).toBe("x");
    expect(event.b).toBeUndefined();
  });

  it("unit-вариант", () => {
    const event = new Event();
    event.kind = Kind.C;
    expect(hex(encode(event))).toBe("03");
  });

  it("несовпадение @OneOf и схемы", () => {
    class Broken {
      public accessor kind: Kind = Kind.A;

      @OneOf(Kind.B)
      public accessor a: Payload | undefined = undefined;
    }
    defineProtocol(Broken, {
      fields: [],
      oneofs: [
        {
          name: "kind",
          enum: () => Kind,
          variants: [{ value: Kind.A, field: "a", type: ["class", () => Payload] }],
        },
      ],
    });
    const value = new Broken();
    value.a = payload("x");
    expectProtocolError(() => encode(value), "schema");
  });

  it("декоратор без описания в схеме игнорируется", () => {
    class Partial {
      public accessor kind: Kind = Kind.A;
      public accessor name = "";

      @OneOf(Kind.A)
      public accessor a: Payload | undefined = undefined;
    }
    defineProtocol(Partial, { fields: [{ name: "name", type: "string" }] });
    const value = new Partial();
    value.name = "n";
    expect(hex(encode(value))).toBe("016e");
  });
});
