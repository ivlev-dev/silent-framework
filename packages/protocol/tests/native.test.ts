import { describe, expect, it } from "vitest";
import { decode, defineProtocol, encode, type TypeSchema } from "../src/index.js";
import { box, expectProtocolError, hex } from "./helpers.js";

function encodeBytes(value: unknown): string {
  const Model = box("bytes");
  const instance = new Model();
  instance.value = value;
  return hex(encode(instance));
}

describe("нативные типы: Date", () => {
  class Stamped {
    public at: Date = new Date(0);
  }

  defineProtocol(Stamped, {
    fields: [{ name: "at", type: "date" }],
  });

  it("roundtrip Date", () => {
    const value = new Stamped();
    value.at = new Date(1700000000123);
    const restored = decode(Stamped, encode(value));
    expect(restored.at).toBeInstanceOf(Date);
    expect(restored.at.getTime()).toBe(1700000000123);
  });

  it("Invalid Date — ошибка", () => {
    const value = new Stamped();
    value.at = new Date("invalid");
    expectProtocolError(() => encode(value), "range");
  });

  it("требует Date", () => {
    const value = new Stamped();
    (value as unknown as { at: unknown }).at = 5;
    expectProtocolError(() => encode(value), "value");
  });
});

describe("нативные типы: bigint", () => {
  class Big {
    public value = 0n;
  }

  defineProtocol(Big, { fields: [{ name: "value", type: "bigint" }] });

  it("roundtrip bigint", () => {
    const value = new Big();
    value.value = -1234567890123456789n;
    const restored = decode(Big, encode(value));
    expect(restored.value).toBe(-1234567890123456789n);
  });

  it("выход за int64", () => {
    const value = new Big();
    value.value = 2n ** 63n;
    expectProtocolError(() => encode(value), "range");
  });
});

describe("нативные типы: bytes", () => {
  it("Uint8Array", () => {
    expect(encodeBytes(new Uint8Array([1, 2, 3]))).toBe("03010203");
    expect(encodeBytes(new Uint8Array())).toBe("00");
  });

  it("ArrayBuffer", () => {
    const buffer = new ArrayBuffer(3);
    new Uint8Array(buffer).set([9, 8, 7]);
    expect(encodeBytes(buffer)).toBe("03090807");
  });

  it("Int8Array", () => {
    expect(encodeBytes(new Int8Array([-1, 2]))).toBe("02ff02");
  });

  it("Uint8ClampedArray", () => {
    expect(encodeBytes(new Uint8ClampedArray([255, 0]))).toBe("02ff00");
  });

  it("Int16Array little-endian", () => {
    expect(encodeBytes(new Int16Array([1, -2, 300]))).toBe("060100feff2c01");
  });

  it("Uint16Array little-endian", () => {
    expect(encodeBytes(new Uint16Array([0x0102, 0x0304]))).toBe("0402010403");
  });

  it("Int32Array little-endian", () => {
    expect(encodeBytes(new Int32Array([0x01020304]))).toBe("0404030201");
  });

  it("Uint32Array little-endian", () => {
    expect(encodeBytes(new Uint32Array([0xffffffff]))).toBe("04ffffffff");
  });

  it("Float32Array little-endian", () => {
    expect(encodeBytes(new Float32Array([1.5]))).toBe("040000c03f");
  });

  it("Float64Array little-endian", () => {
    expect(encodeBytes(new Float64Array([1.5]))).toBe("08000000000000f83f");
  });

  it("BigInt64Array little-endian", () => {
    expect(encodeBytes(new BigInt64Array([-1n]))).toBe("08ffffffffffffffff");
  });

  it("BigUint64Array little-endian", () => {
    expect(encodeBytes(new BigUint64Array([1n]))).toBe("080100000000000000");
  });

  it("DataView", () => {
    const buffer = new ArrayBuffer(2);
    new Uint8Array(buffer).set([4, 5]);
    expect(encodeBytes(new DataView(buffer))).toBe("020405");
  });

  it("декодирует bytes как Uint8Array", () => {
    const Model = box("bytes");
    const restored = decode(Model, new Uint8Array([0x02, 0x01, 0x02])).value;
    expect(restored).toBeInstanceOf(Uint8Array);
    expect([...(restored as Uint8Array)]).toEqual([1, 2]);
  });

  it("отклоняет неподдерживаемые объекты", () => {
    expectProtocolError(() => encodeBytes(/x/), "value");
    expectProtocolError(() => encodeBytes(new URL("https://example.com")), "value");
  });
});

describe("нативные типы: number по умолчанию float64", () => {
  class Float {
    public value = 0;
  }

  defineProtocol(Float, { fields: [{ name: "value", type: "float64" }] });

  it("кодирует 8 байт", () => {
    const value = new Float();
    value.value = 1.5;
    expect(hex(encode(value))).toBe("000000000000f83f");
  });

  it("roundtrip", () => {
    const value = new Float();
    value.value = Math.PI;
    expect(decode(Float, encode(value)).value).toBe(Math.PI);
  });
});

describe("ошибки схемы для нативных типов", () => {
  it("неизвестный тип", () => {
    const Model = box("regexp" as TypeSchema);
    const instance = new Model();
    instance.value = /x/;
    expectProtocolError(() => encode(instance), "schema");
  });

  it("weakmap не поддерживается", () => {
    const Model = box("any" as TypeSchema);
    const instance = new Model();
    instance.value = new WeakMap();
    expectProtocolError(() => encode(instance), "schema");
  });
});
