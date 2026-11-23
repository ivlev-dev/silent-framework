import { describe, expect, it } from "vitest";
import { decode, defineProtocol, encode } from "../src/index.js";
import { bytesOf, expectProtocolError, hex } from "./helpers.js";

class OneOptional {
  public extra: number | undefined = undefined;
  public name = "";
}

defineProtocol(OneOptional, {
  fields: [
    { name: "name", type: "string" },
    { name: "extra", type: "int32", optional: true },
  ],
});

class NineOptional {
  public o1: number | undefined = undefined;
  public o2: number | undefined = undefined;
  public o3: number | undefined = undefined;
  public o4: number | undefined = undefined;
  public o5: number | undefined = undefined;
  public o6: number | undefined = undefined;
  public o7: number | undefined = undefined;
  public o8: number | undefined = undefined;
  public o9: number | undefined = undefined;
}

defineProtocol(NineOptional, {
  fields: [
    { name: "o9", type: "int32", optional: true },
    { name: "o1", type: "int32", optional: true },
    { name: "o2", type: "int32", optional: true },
    { name: "o3", type: "int32", optional: true },
    { name: "o4", type: "int32", optional: true },
    { name: "o5", type: "int32", optional: true },
    { name: "o6", type: "int32", optional: true },
    { name: "o7", type: "int32", optional: true },
    { name: "o8", type: "int32", optional: true },
  ],
});

class NoOptional {
  public a = 0;
  public b = "";
}

defineProtocol(NoOptional, {
  fields: [
    { name: "a", type: "int32" },
    { name: "b", type: "string" },
  ],
});

describe("bitmap: 0 optional", () => {
  it("не пишет bitmap", () => {
    const value = new NoOptional();
    value.a = 1;
    value.b = "x";
    expect(hex(encode(value))).toBe("020178");
    const restored = decode(NoOptional, encode(value));
    expect(restored.a).toBe(1);
    expect(restored.b).toBe("x");
  });
});

describe("bitmap: 1 optional", () => {
  it("пишет байт bitmap и значение при наличии", () => {
    const value = new OneOptional();
    value.extra = 5;
    value.name = "a";
    expect(hex(encode(value))).toBe("010a0161");
    const restored = decode(OneOptional, encode(value));
    expect(restored.extra).toBe(5);
    expect(restored.name).toBe("a");
  });

  it("пропускает отсутствующее поле", () => {
    const value = new OneOptional();
    value.name = "a";
    expect(hex(encode(value))).toBe("000161");
    const restored = decode(OneOptional, encode(value));
    expect(restored.extra).toBeUndefined();
  });

  it("null считается отсутствием", () => {
    const value = new OneOptional();
    value.extra = null as unknown as number;
    value.name = "a";
    expect(hex(encode(value))).toBe("000161");
  });

  it("отсутствующий бит не читает значение", () => {
    const restored = decode(OneOptional, bytesOf(0x00, 0x01, 0x61));
    expect(restored.extra).toBeUndefined();
    expect(restored.name).toBe("a");
  });

  it("обрезка bitmap", () => {
    expectProtocolError(() => decode(OneOptional, new Uint8Array()), "truncated");
  });
});

describe("bitmap: 8 optional", () => {
  class Eight {
    public a: number | undefined = undefined;
    public b: number | undefined = undefined;
    public c: number | undefined = undefined;
    public d: number | undefined = undefined;
    public e: number | undefined = undefined;
    public f: number | undefined = undefined;
    public g: number | undefined = undefined;
    public h: number | undefined = undefined;
  }

  defineProtocol(Eight, {
    fields: [
      { name: "a", type: "int32", optional: true },
      { name: "b", type: "int32", optional: true },
      { name: "c", type: "int32", optional: true },
      { name: "d", type: "int32", optional: true },
      { name: "e", type: "int32", optional: true },
      { name: "f", type: "int32", optional: true },
      { name: "g", type: "int32", optional: true },
      { name: "h", type: "int32", optional: true },
    ],
  });

  it("8 present даёт ровно один байт FF", () => {
    const value = new Eight();
    value.a = 1;
    value.b = 2;
    value.c = 3;
    value.d = 4;
    value.e = 5;
    value.f = 6;
    value.g = 7;
    value.h = 8;
    expect(hex(encode(value))).toBe("ff020406080a0c0e10");
  });

  it("8 absent даёт один байт 00", () => {
    expect(hex(encode(new Eight()))).toBe("00");
  });

  it("только h даёт старший бит", () => {
    const value = new Eight();
    value.h = 1;
    expect(hex(encode(value))).toBe("8002");
  });
});

describe("bitmap: 9 optional", () => {
  function fill(value: NineOptional, count: number): void {
    for (let index = 1; index <= count; index += 1) {
      const key = `o${index}` as keyof NineOptional;
      value[key] = index;
    }
  }

  it("все 9 полей кодируются в порядке имён", () => {
    const value = new NineOptional();
    fill(value, 9);
    expect(hex(encode(value))).toBe("ff01020406080a0c0e1012");
    const restored = decode(NineOptional, encode(value));
    expect(restored.o1).toBe(1);
    expect(restored.o9).toBe(9);
  });

  it("только o1 даёт бит 0", () => {
    const value = new NineOptional();
    value.o1 = 7;
    expect(hex(encode(value))).toBe("01000e");
  });

  it("только o9 даёт бит 8", () => {
    const value = new NineOptional();
    value.o9 = 7;
    expect(hex(encode(value))).toBe("00010e");
  });

  it("пустая схема с 9 optional пишет 2 байта", () => {
    const value = new NineOptional();
    expect(hex(encode(value))).toBe("0000");
    const restored = decode(NineOptional, bytesOf(0x00, 0x00));
    expect(restored.o1).toBeUndefined();
    expect(restored.o9).toBeUndefined();
  });
});

class OuterBitmap {
  public inner: InnerBitmap | undefined = undefined;
  public title = "";
}

class InnerBitmap {
  public first: number | undefined = undefined;
  public second: number | undefined = undefined;
}

defineProtocol(InnerBitmap, {
  fields: [
    { name: "first", type: "int32", optional: true },
    { name: "second", type: "int32", optional: true },
  ],
});

defineProtocol(OuterBitmap, {
  fields: [
    { name: "inner", type: ["class", () => InnerBitmap], optional: true },
    { name: "title", type: "string" },
  ],
});

describe("вложенный bitmap", () => {
  it("вложенное сообщение имеет собственный bitmap", () => {
    const inner = new InnerBitmap();
    inner.second = 3;
    const value = new OuterBitmap();
    value.inner = inner;
    value.title = "t";
    expect(hex(encode(value))).toBe("0102060174");
    const restored = decode(OuterBitmap, encode(value));
    expect(restored.inner?.first).toBeUndefined();
    expect(restored.inner?.second).toBe(3);
    expect(restored.title).toBe("t");
  });

  it("отсутствующий вложенный объект не читается", () => {
    const value = new OuterBitmap();
    value.title = "t";
    expect(hex(encode(value))).toBe("000174");
  });
});
