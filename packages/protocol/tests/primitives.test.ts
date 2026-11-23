import { describe, expect, it } from "vitest";
import { decode, encode } from "../src/index.js";
import { box, bytesOf, expectProtocolError, hex } from "./helpers.js";

function roundtrip(type: Parameters<typeof box>[0], value: unknown): unknown {
  const Model = box(type);
  const instance = new Model();
  instance.value = value;
  return decode(Model, encode(instance)).value;
}

function encoded(type: Parameters<typeof box>[0], value: unknown): string {
  const Model = box(type);
  const instance = new Model();
  instance.value = value;
  return hex(encode(instance));
}

describe("примитивы: bool", () => {
  it("кодирует true и false", () => {
    expect(encoded("bool", true)).toBe("01");
    expect(encoded("bool", false)).toBe("00");
  });

  it("декодирует bool", () => {
    const Model = box("bool");
    expect(decode(Model, bytesOf(0x01)).value).toBe(true);
    expect(decode(Model, bytesOf(0x00)).value).toBe(false);
  });

  it("отклоняет неверное значение bool", () => {
    expectProtocolError(() => roundtrip("bool", 1), "value");
    expectProtocolError(() => decode(box("bool"), bytesOf(0x02)), "value");
  });

  it("обрезка bool", () => {
    expectProtocolError(() => decode(box("bool"), new Uint8Array()), "truncated");
  });
});

describe("примитивы: int32 и uint32", () => {
  it("кодирует zigzag int32", () => {
    expect(encoded("int32", 0)).toBe("00");
    expect(encoded("int32", -1)).toBe("01");
    expect(encoded("int32", 1)).toBe("02");
    expect(encoded("int32", -2)).toBe("03");
    expect(encoded("int32", 2147483647)).toBe("feffffff0f");
    expect(encoded("int32", -2147483648)).toBe("ffffffff0f");
  });

  it("кодирует varint uint32", () => {
    expect(encoded("uint32", 0)).toBe("00");
    expect(encoded("uint32", 1)).toBe("01");
    expect(encoded("uint32", 300)).toBe("ac02");
    expect(encoded("uint32", 4294967295)).toBe("ffffffff0f");
  });

  it("граничные значения int32/uint32", () => {
    expect(roundtrip("int32", -2147483648)).toBe(-2147483648);
    expect(roundtrip("int32", 2147483647)).toBe(2147483647);
    expect(roundtrip("uint32", 4294967295)).toBe(4294967295);
  });

  it("отклоняет выход за диапазон", () => {
    expectProtocolError(() => roundtrip("int32", 2147483648), "range");
    expectProtocolError(() => roundtrip("int32", -2147483649), "range");
    expectProtocolError(() => roundtrip("uint32", -1), "range");
    expectProtocolError(() => roundtrip("uint32", 4294967296), "range");
  });

  it("отклоняет дробное значение", () => {
    expectProtocolError(() => roundtrip("int32", 1.5), "value");
    expectProtocolError(() => roundtrip("uint32", 0.5), "value");
  });
});

describe("примитивы: int64 и uint64", () => {
  it("кодирует zigzag int64", () => {
    expect(encoded("int64", 0n)).toBe("00");
    expect(encoded("int64", -1n)).toBe("01");
    expect(encoded("int64", 1n)).toBe("02");
    expect(encoded("int64", 9223372036854775807n)).toBe("feffffffffffffffff01");
    expect(encoded("int64", -9223372036854775808n)).toBe("ffffffffffffffffff01");
  });

  it("кодирует varint uint64", () => {
    expect(encoded("uint64", 18446744073709551615n)).toBe("ffffffffffffffffff01");
  });

  it("граничные значения int64/uint64", () => {
    expect(roundtrip("int64", 9223372036854775807n)).toBe(9223372036854775807n);
    expect(roundtrip("int64", -9223372036854775808n)).toBe(-9223372036854775808n);
    expect(roundtrip("uint64", 18446744073709551615n)).toBe(18446744073709551615n);
  });

  it("требует bigint", () => {
    expectProtocolError(() => roundtrip("int64", 1), "value");
    expectProtocolError(() => roundtrip("uint64", 1), "value");
  });

  it("отклоняет выход за int64 и uint64", () => {
    expectProtocolError(() => roundtrip("int64", 9223372036854775808n), "range");
    expectProtocolError(() => roundtrip("int64", -9223372036854775809n), "range");
    expectProtocolError(() => roundtrip("uint64", -1n), "range");
    expectProtocolError(() => roundtrip("uint64", 18446744073709551616n), "range");
  });
});

describe("примитивы: float32 и float64", () => {
  it("кодирует float32 little-endian", () => {
    expect(encoded("float32", 1.5)).toBe("0000c03f");
    expect(encoded("float32", -0)).toBe("00000080");
  });

  it("кодирует float64 little-endian", () => {
    expect(encoded("float64", 1.5)).toBe("000000000000f83f");
    expect(encoded("float64", 0)).toBe("0000000000000000");
  });

  it("сохраняет точность float64", () => {
    expect(roundtrip("float64", 0.1)).toBe(0.1);
    expect(roundtrip("float64", Number.MAX_VALUE)).toBe(Number.MAX_VALUE);
    expect(roundtrip("float64", Number.MIN_VALUE)).toBe(Number.MIN_VALUE);
  });

  it("округляет float32", () => {
    expect(roundtrip("float32", 0.1)).toBe(Math.fround(0.1));
  });

  it("поддерживает NaN и Infinity", () => {
    expect(Number.isNaN(roundtrip("float64", Number.NaN))).toBe(true);
    expect(Number.isNaN(roundtrip("float32", Number.NaN))).toBe(true);
    expect(roundtrip("float64", Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
    expect(roundtrip("float64", Number.NEGATIVE_INFINITY)).toBe(Number.NEGATIVE_INFINITY);
    expect(roundtrip("float32", Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
  });

  it("требует number", () => {
    expectProtocolError(() => roundtrip("float64", "1"), "value");
  });
});

describe("примитивы: fixed32 и fixed64", () => {
  it("кодирует fixed32 little-endian", () => {
    expect(encoded("fixed32", 0x01020304)).toBe("04030201");
    expect(encoded("fixed32", 0)).toBe("00000000");
  });

  it("кодирует fixed64 little-endian", () => {
    expect(encoded("fixed64", 0x0102030405060708n)).toBe("0807060504030201");
  });

  it("границы fixed32", () => {
    expect(roundtrip("fixed32", 0xffffffff)).toBe(0xffffffff);
    expectProtocolError(() => roundtrip("fixed32", 0x100000000), "range");
    expectProtocolError(() => roundtrip("fixed32", -1), "range");
  });

  it("границы fixed64", () => {
    expect(roundtrip("fixed64", 18446744073709551615n)).toBe(18446744073709551615n);
    expectProtocolError(() => roundtrip("fixed64", 18446744073709551616n), "range");
  });
});

describe("примитивы: string и bytes", () => {
  it("кодирует строку с длиной", () => {
    expect(encoded("string", "abc")).toBe("03616263");
    expect(encoded("string", "")).toBe("00");
  });

  it("кодирует UTF-8", () => {
    expect(encoded("string", "привет")).toBe("0c d0bfd180d0b8d0b2d0b5d182".replace(/ /g, ""));
  });

  it("кодирует bytes с длиной", () => {
    expect(encoded("bytes", bytesOf(1, 2, 3))).toBe("03010203");
    expect(encoded("bytes", new Uint8Array())).toBe("00");
  });

  it("декодирует bytes как view без копирования", () => {
    const Model = box("bytes");
    const input = bytesOf(0x01, 0xaa);
    const value = decode(Model, input).value;
    expect(value).toBeInstanceOf(Uint8Array);
    const view = value as Uint8Array;
    expect([...view]).toEqual([0xaa]);
    expect(view.buffer).toBe(input.buffer);
    expect(view.byteOffset).toBe(1);
  });

  it("поддерживает ArrayBuffer", () => {
    const buffer = new ArrayBuffer(2);
    new Uint8Array(buffer).set([7, 8]);
    expect(encoded("bytes", buffer)).toBe("020708");
  });

  it("отклоняет строку с неверной длиной", () => {
    expectProtocolError(() => decode(box("string"), bytesOf(0x05, 0x61)), "truncated");
  });

  it("требует строку", () => {
    expectProtocolError(() => roundtrip("string", 1), "value");
  });
});

describe("примитивы: date, bigint и epochMillis", () => {
  it("кодирует Date как zigzag epoch ms", () => {
    expect(encoded("date", new Date(0))).toBe("00");
    expect(encoded("date", new Date(1000))).toBe("d00f");
    expect(encoded("date", new Date(-1))).toBe("01");
  });

  it("roundtrip Date", () => {
    const date = new Date("2024-02-29T12:34:56.789Z");
    const restored = roundtrip("date", date);
    expect(restored).toBeInstanceOf(Date);
    expect((restored as Date).getTime()).toBe(date.getTime());
  });

  it("отклоняет Invalid Date", () => {
    expectProtocolError(() => roundtrip("date", new Date(Number.NaN)), "range");
  });

  it("bigint по умолчанию int64 zigzag", () => {
    expect(encoded("bigint", -1n)).toBe("01");
    expect(encoded("bigint", 1n)).toBe("02");
  });

  it("epochMillis кодирует number", () => {
    expect(encoded("epochMillis", 1000)).toBe("d00f");
    expect(roundtrip("epochMillis", 1700000000000)).toBe(1700000000000);
  });

  it("literal занимает ноль байт", () => {
    expect(encoded(["literal", 42], 42)).toBe("");
    expect(roundtrip(["literal", "ok"], "ok")).toBe("ok");
    expectProtocolError(() => roundtrip(["literal", 42], 41), "value");
  });
});
