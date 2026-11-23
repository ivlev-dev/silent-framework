import { describe, expect, it } from "vitest";
import { decode, defineProtocol, encode } from "../src/index.js";
import { bytesOf, expectProtocolError, hex } from "./helpers.js";

class Inner {
  public value = 0;
}

defineProtocol(Inner, {
  fields: [{ name: "value", type: "int32" }],
});

class Outer {
  public inner: Inner | undefined = undefined;
  public title = "";
}

defineProtocol(Outer, {
  fields: [
    { name: "inner", type: ["class", () => Inner] },
    { name: "title", type: "string" },
  ],
});

class Pair {
  public first: Inner | undefined = undefined;
  public second: Inner | undefined = undefined;
}

defineProtocol(Pair, {
  fields: [
    { name: "first", type: ["class", () => Inner] },
    { name: "second", type: ["class", () => Inner] },
  ],
});

class Node {
  public next: Node | undefined = undefined;
  public value = 0;
}

defineProtocol(Node, {
  fields: [
    { name: "next", type: ["optional", ["class", () => Node]] },
    { name: "value", type: "int32" },
  ],
});

class Bag {
  public items: Bag[] = [];
}

defineProtocol(Bag, {
  fields: [{ name: "items", type: ["array", ["class", () => Bag]] }],
});

function inner(value: number): Inner {
  const instance = new Inner();
  instance.value = value;
  return instance;
}

function chain(length: number): Node {
  let head: Node | undefined;
  for (let index = length - 1; index >= 0; index -= 1) {
    const node = new Node();
    node.value = index;
    node.next = head;
    head = node;
  }
  if (head === undefined) throw new Error("empty chain");
  return head;
}

describe("вложенные сообщения", () => {
  it("кодирует класс без префикса длины", () => {
    const value = new Outer();
    value.inner = inner(1);
    value.title = "t";
    expect(hex(encode(value))).toBe("020174");
    const restored = decode(Outer, encode(value));
    expect(restored.inner?.value).toBe(1);
    expect(restored.title).toBe("t");
  });

  it("границы вложенных значений определяются схемой", () => {
    const value = new Outer();
    value.inner = inner(-2);
    value.title = "abc";
    const restored = decode(Outer, encode(value));
    expect(restored.inner?.value).toBe(-2);
    expect(restored.title).toBe("abc");
  });

  it("два вложенных поля одного класса", () => {
    const value = new Pair();
    value.first = inner(1);
    value.second = inner(2);
    expect(hex(encode(value))).toBe("0204");
    const restored = decode(Pair, encode(value));
    expect(restored.first?.value).toBe(1);
    expect(restored.second?.value).toBe(2);
  });

  it("разделяемая ссылка не считается циклом", () => {
    const shared = inner(5);
    const value = new Pair();
    value.first = shared;
    value.second = shared;
    const restored = decode(Pair, encode(value));
    expect(restored.first?.value).toBe(5);
    expect(restored.second?.value).toBe(5);
    expect(restored.first).not.toBe(restored.second);
  });

  it("рекурсивное сообщение", () => {
    const restored = decode(Node, encode(chain(5)));
    const values: number[] = [];
    let current: Node | undefined = restored;
    while (current !== undefined) {
      values.push(current.value);
      current = current.next;
    }
    expect(values).toEqual([0, 1, 2, 3, 4]);
  });

  it("цикл объекта — ошибка", () => {
    const node = new Node();
    node.next = node;
    expectProtocolError(() => encode(node), "cycle");
  });

  it("цикл через массив — ошибка", () => {
    const bag = new Bag();
    bag.items = [bag];
    expectProtocolError(() => encode(bag), "cycle");
  });

  it("цикл через map — ошибка", () => {
    class MapBag {
      public items = new Map<string, MapBag>();
    }
    defineProtocol(MapBag, {
      fields: [{ name: "items", type: ["map", "string", ["class", () => MapBag]] }],
    });
    const bag = new MapBag();
    bag.items.set("self", bag);
    expectProtocolError(() => encode(bag), "cycle");
  });

  it("цикл через set — ошибка", () => {
    class SetBag {
      public items = new Set<SetBag>();
    }
    defineProtocol(SetBag, {
      fields: [{ name: "items", type: ["set", ["class", () => SetBag]] }],
    });
    const bag = new SetBag();
    bag.items.add(bag);
    expectProtocolError(() => encode(bag), "cycle");
  });
});

describe("лимит глубины", () => {
  it("по умолчанию 256", () => {
    expect(() => encode(chain(10))).not.toThrow();
    expectProtocolError(() => encode(chain(300)), "depth");
  });

  it("настраивается на encode", () => {
    expectProtocolError(() => encode(chain(10), { maxDepth: 3 }), "depth");
    expect(() => encode(chain(10), { maxDepth: 64 })).not.toThrow();
  });

  it("настраивается на decode", () => {
    const bytes = encode(chain(300), { maxDepth: 1000 });
    expectProtocolError(() => decode(Node, bytes), "depth");
    const restored = decode(Node, bytes, { maxDepth: 1000 });
    expect(restored.value).toBe(0);
  });
});

describe("лишние байты и обрезка", () => {
  it("лишние байты — ошибка", () => {
    const bytes = encode(inner(1));
    const extra = new Uint8Array(bytes.length + 1);
    extra.set(bytes);
    extra[bytes.length] = 0xff;
    expectProtocolError(() => decode(Inner, extra), "trailing");
  });

  it("allowTrailing разрешает лишние байты", () => {
    const bytes = encode(inner(1));
    const extra = new Uint8Array(bytes.length + 1);
    extra.set(bytes);
    extra[bytes.length] = 0xff;
    const restored = decode(Inner, extra, { allowTrailing: true });
    expect(restored.value).toBe(1);
  });

  it("обрезка вложенного сообщения", () => {
    expectProtocolError(() => decode(Node, bytesOf(0x01)), "truncated");
  });

  it("неверный varint", () => {
    const Model = class Model {
      public value = 0;
    };
    defineProtocol(Model, { fields: [{ name: "value", type: "int32" }] });
    expectProtocolError(
      () => decode(Model, new Uint8Array(10).fill(0x80)),
      "invalid_varint",
    );
  });

  it("слишком длинный varint", () => {
    const Model = class Model {
      public value = 0;
    };
    defineProtocol(Model, { fields: [{ name: "value", type: "int32" }] });
    expectProtocolError(
      () => decode(Model, new Uint8Array(11).fill(0x80)),
      "invalid_varint",
    );
  });

  it("varint больше 64 бит", () => {
    const Int32Model = class Model {
      public value = 0;
    };
    defineProtocol(Int32Model, { fields: [{ name: "value", type: "int32" }] });
    const overflow = new Uint8Array(10).fill(0x80);
    overflow[9] = 0x02;
    expectProtocolError(() => decode(Int32Model, overflow), "invalid_varint");

    const Int64Model = class Model {
      public value = 0n;
    };
    defineProtocol(Int64Model, { fields: [{ name: "value", type: "int64" }] });
    expectProtocolError(() => decode(Int64Model, overflow), "invalid_varint");
  });
});

describe("лимит размера", () => {
  class Text {
    public value = "";
  }

  defineProtocol(Text, { fields: [{ name: "value", type: "string" }] });

  it("encode отклоняет большое сообщение", () => {
    const value = new Text();
    value.value = "x".repeat(100);
    expect(hex(encode(value)).length).toBeGreaterThan(100);
    expectProtocolError(() => encode(value, { maxSize: 10 }), "size");
  });

  it("decode отклоняет большое сообщение", () => {
    const value = new Text();
    value.value = "hello";
    const bytes = encode(value);
    expect(bytes.length).toBeGreaterThan(1);
    expectProtocolError(() => decode(Text, bytes, { maxSize: 1 }), "size");
  });

  it("отклоняет неверный лимит", () => {
    expectProtocolError(() => encode(new Text(), { maxSize: 0 }), "schema");
    expectProtocolError(() => decode(Text, new Uint8Array(), { maxDepth: -1 }), "schema");
  });
});
