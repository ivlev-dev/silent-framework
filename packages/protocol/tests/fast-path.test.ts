import { describe, expect, it } from "vitest";
import {
  DecodeContext,
  Reader,
  Writer,
  decode,
  encode,
  pathWith,
  readArray,
  readOptionalArray,
} from "../src/index.js";
import { expectProtocolError, hex, model } from "./helpers.js";

function maskOf(bits: readonly boolean[]): number {
  let mask = 0;
  for (let index = 0; index < bits.length; index += 1) {
    if (bits[index] === true) mask |= 1 << index;
  }
  return mask;
}

describe("bitmapMask", () => {
  it("совпадает с bitmap для всех длин до 32", () => {
    for (let count = 0; count <= 32; count += 1) {
      const bits = Array.from({ length: count }, (_, index) => index % 3 === 1);
      const expected = new Writer(64);
      expected.bitmap(bits);
      const actual = new Writer(64);
      actual.bitmapMask(maskOf(bits), count);
      expect(hex(actual.finish())).toBe(hex(expected.finish()));
    }
  });

  it("читает те же биты, что bitmap", () => {
    const bits = [true, false, true, true, false, false, true, false, true];
    const writer = new Writer(64);
    writer.bitmap(bits);
    const bytes = writer.finish();
    const reader = new Reader(bytes, 64);
    const mask = reader.bitmapMask(bits.length, "root");
    expect(reader.offset).toBe(bytes.length);
    for (let index = 0; index < bits.length; index += 1) {
      expect((mask & (1 << index)) !== 0).toBe(bits[index]);
    }
  });

  it("отклоняет больше 32 бит", () => {
    const writer = new Writer(64);
    expectProtocolError(() => writer.bitmapMask(0, 33), "value");
    const reader = new Reader(new Uint8Array([0]), 64);
    expectProtocolError(() => reader.bitmapMask(33, "root"), "value");
  });

  it("generic-кодек переключается на массив битов после 32 optional-полей", () => {
    const fields = Array.from(
      { length: 33 },
      (_, index) => ({ name: `field${index}`, type: "string" as const, optional: true }),
    );
    const Ctor = model(fields);
    const value = new Ctor();
    value["field0"] = "first";
    value["field32"] = "last";
    const restored = decode(Ctor, encode(value)) as Record<string, unknown>;
    expect(restored["field0"]).toBe("first");
    expect(restored["field32"]).toBe("last");
    expect(restored["field16"]).toBeUndefined();
  });
});

describe("переиспользование Writer и Reader", () => {
  it("finish не разделяет буфер с Writer", () => {
    const writer = new Writer(64);
    writer.string("first");
    const first = writer.finish();
    const snapshot = hex(first);
    writer.reset(64);
    writer.string("second-message");
    expect(hex(first)).toBe(snapshot);
    expect(hex(writer.finish())).not.toBe(snapshot);
  });

  it("reset очищает длину и лимит", () => {
    const writer = new Writer(16);
    writer.varint(7);
    writer.reset(4);
    expect(writer.size).toBe(0);
    writer.byte(1);
    writer.byte(2);
    writer.byte(3);
    writer.byte(4);
    expect(writer.size).toBe(4);
    expectProtocolError(() => writer.byte(5), "size");
  });

  it("reset и release Reader сбрасывают позицию", () => {
    const reader = new Reader(new Uint8Array([1, 2, 3]), 8);
    expect(reader.byte("root")).toBe(1);
    reader.reset(new Uint8Array([4, 5]), 8);
    expect(reader.offset).toBe(0);
    expect(reader.byte("root")).toBe(4);
    reader.release();
    expect(reader.offset).toBe(0);
    expect(reader.remaining).toBe(0);
  });
});

describe("ленивые пути ошибок", () => {
  it("собирает путь из части и индекса только при ошибке", () => {
    expect(pathWith("Root")).toBe("Root");
    expect(pathWith("Root", ".name")).toBe("Root.name");
    expect(pathWith("Root", 4)).toBe("Root[4]");
    expect(pathWith("Root", ".items", 2)).toBe("Root.items[2]");

    const reader = new Reader(new Uint8Array(0), 16);
    const error = expectProtocolError(() => reader.float64("Root", ".value", 3), "truncated");
    expect(error.path).toBe("Root.value[3]");
  });

  it("передаёт часть массива в readArray", () => {
    const reader = new Reader(new Uint8Array([1, 0x80]), 16);
    const context = new DecodeContext(8);
    const error = expectProtocolError(
      () => readArray(reader, context, "Root", (index) => reader.string("Root", ".items", index), ".items"),
      "truncated",
    );
    expect(error.path).toBe("Root.items[0]");
  });

  it("передаёт часть массива в readOptionalArray", () => {
    const reader = new Reader(new Uint8Array([1, 1, 0x80]), 16);
    const context = new DecodeContext(8);
    const error = expectProtocolError(
      () => readOptionalArray(reader, context, "Root", (index) => reader.string("Root", ".items", index), ".items"),
      "truncated",
    );
    expect(error.path).toBe("Root.items[0]");
  });
});
