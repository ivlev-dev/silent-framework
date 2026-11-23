import { describe, expect, it } from "vitest";
import {
  PROTOCOL_CODEC,
  ProtocolError,
  Reader,
  Writer,
  decode,
  defineProtocol,
  encode,
  readArray,
  readMap,
  readMessage,
  readOptionalArray,
  readSet,
  writeArray,
  writeMap,
  writeMessage,
  writeOptionalArray,
  writeSet,
  type SchemaInput,
  type StaticCodec,
} from "../src/index.js";
import { expectProtocolError, hex } from "./helpers.js";

function attach<T extends object>(ctor: new () => T, codec: StaticCodec<T>): void {
  Object.defineProperty(ctor, PROTOCOL_CODEC, {
    value: codec,
    enumerable: false,
    configurable: true,
    writable: true,
  });
}

function isAbsent(value: unknown): boolean {
  return value === undefined || value === null;
}

const Choice = { Number: 0, Text: 1 } as const;

class GenericLeaf {
  public code = 0;
  public name = "";
}

defineProtocol(GenericLeaf, {
  fields: [
    { name: "code", type: "int32" },
    { name: "name", type: "string" },
  ],
});

class StaticLeaf {
  public code = 0;
  public name = "";
}

attach(StaticLeaf, {
  write(value, writer) {
    writer.zigzag(value.code);
    writer.string(value.name);
  },
  read(reader, _context, path) {
    const target = new StaticLeaf();
    target.code = reader.zigzagNumber(`${path}.code`);
    target.name = reader.string(`${path}.name`);
    return target;
  },
});

function modelSchema(leaf: () => Function): SchemaInput {
  return {
    fields: [
      { name: "active", type: "bool" },
      { name: "count", type: "int32" },
      { name: "id", type: "int64" },
      { name: "leaf", type: ["optional", ["class", leaf]] },
      { name: "note", type: ["optional", "string"] },
      { name: "tags", type: ["array", "string"] },
    ],
    oneofs: [
      {
        name: "choice",
        enum: () => Choice,
        variants: [
          { value: Choice.Number, field: "num", type: "int32" },
          { value: Choice.Text, field: "text", type: "string" },
        ],
      },
    ],
  };
}

class GenericModel {
  public active = false;
  public choice: number = Choice.Number;
  public count = 0;
  public id = 0n;
  public leaf: GenericLeaf | undefined = undefined;
  public note: string | undefined = undefined;
  public tags: string[] = [];
  public num: number | undefined = undefined;
  public text: string | undefined = undefined;
}

defineProtocol(GenericModel, modelSchema(() => GenericLeaf));

class StaticModel {
  public active = false;
  public choice: number = Choice.Number;
  public count = 0;
  public id = 0n;
  public leaf: StaticLeaf | undefined = undefined;
  public note: string | undefined = undefined;
  public tags: string[] = [];
  public num: number | undefined = undefined;
  public text: string | undefined = undefined;
}

function writeChoice(value: StaticModel, writer: Writer, path: string): void {
  if (value.choice === Choice.Number) {
    const num = value.num;
    if (num === undefined || num === null) {
      throw new ProtocolError("oneof", "вариант num не имеет значения", `${path}.num`);
    }
    if (!isAbsent(value.text)) {
      throw new ProtocolError("oneof", "установлено более одного варианта oneof choice", `${path}.text`);
    }
    writer.varint(Choice.Number);
    writer.zigzag(num);
    return;
  }
  if (value.choice === Choice.Text) {
    const text = value.text;
    if (text === undefined || text === null) {
      throw new ProtocolError("oneof", "вариант text не имеет значения", `${path}.text`);
    }
    if (!isAbsent(value.num)) {
      throw new ProtocolError("oneof", "установлено более одного варианта oneof choice", `${path}.num`);
    }
    writer.varint(Choice.Text);
    writer.string(text);
    return;
  }
  throw new ProtocolError("unknown_enum", `неизвестное значение oneof ${value.choice}`, `${path}.choice`);
}

function readChoice(target: StaticModel, reader: Reader, path: string): void {
  const raw = reader.varintNumber(`${path}.choice`, 0xffffffff);
  if (raw > 0x7fffffff) {
    throw new ProtocolError("unknown_enum", "значение oneof вне uint32", `${path}.choice`);
  }
  target.choice = raw;
  target.num = undefined;
  target.text = undefined;
  if (raw === Choice.Number) {
    target.num = reader.zigzagNumber(`${path}.num`);
    return;
  }
  if (raw === Choice.Text) {
    target.text = reader.string(`${path}.text`);
    return;
  }
  throw new ProtocolError("unknown_enum", `неизвестное значение oneof ${raw}`, `${path}.choice`);
}

attach(StaticModel, {
  write(value, writer, context, path) {
    writer.bitmap([!isAbsent(value.leaf), !isAbsent(value.note)]);
    writer.bool(value.active);
    writeChoice(value, writer, path);
    writer.zigzag(value.count);
    writer.zigzag(value.id);
    const leaf = value.leaf;
    if (leaf !== undefined && leaf !== null) {
      writeMessage(StaticLeaf, leaf, writer, context, `${path}.leaf`);
    }
    const note = value.note;
    if (note !== undefined && note !== null) {
      writer.string(note);
    }
    writeArray(value.tags, writer, context, `${path}.tags`, (tag) => {
      writer.string(tag);
    });
  },
  read(reader, context, path) {
    const target = new StaticModel();
    const bits = reader.bitmap(2, path);
    const active = reader.byte(`${path}.active`);
    if (active !== 0 && active !== 1) {
      throw new ProtocolError("value", "bool должен быть 0 или 1", `${path}.active`);
    }
    target.active = active === 1;
    readChoice(target, reader, path);
    target.count = reader.zigzagNumber(`${path}.count`);
    target.id = reader.zigzag(`${path}.id`);
    target.leaf = bits[0] === true
      ? readMessage(StaticLeaf, reader, context, `${path}.leaf`)
      : undefined;
    target.note = bits[1] === true ? reader.string(`${path}.note`) : undefined;
    target.tags = readArray(reader, context, `${path}.tags`, () => reader.string(`${path}.tags`));
    return target;
  },
});

class MixedModel {
  public active = false;
  public choice: number = Choice.Number;
  public count = 0;
  public id = 0n;
  public leaf: StaticLeaf | undefined = undefined;
  public note: string | undefined = undefined;
  public tags: string[] = [];
  public num: number | undefined = undefined;
  public text: string | undefined = undefined;
}

defineProtocol(MixedModel, modelSchema(() => StaticLeaf));

class GenericHolder {
  public leaf: GenericLeaf | undefined = undefined;
  public value = 0;
}

defineProtocol(GenericHolder, {
  fields: [
    { name: "leaf", type: ["optional", ["class", () => GenericLeaf]] },
    { name: "value", type: "int32" },
  ],
});

class StaticHolder {
  public leaf: GenericLeaf | undefined = undefined;
  public value = 0;
}

attach(StaticHolder, {
  write(value, writer, context, path) {
    writer.bitmap([!isAbsent(value.leaf)]);
    const leaf = value.leaf;
    if (leaf !== undefined && leaf !== null) {
      writeMessage(GenericLeaf, leaf, writer, context, `${path}.leaf`);
    }
    writer.zigzag(value.value);
  },
  read(reader, context, path) {
    const target = new StaticHolder();
    const bits = reader.bitmap(1, path);
    target.leaf = bits[0] === true
      ? readMessage(GenericLeaf, reader, context, `${path}.leaf`)
      : undefined;
    target.value = reader.zigzagNumber(`${path}.value`);
    return target;
  },
});


function populateGeneric(model: GenericModel, choice: number): void {
  model.active = true;
  model.choice = choice;
  model.count = -7;
  model.id = 42n;
  model.note = "hello";
  model.tags = ["zeta", "alpha"];
  if (choice === Choice.Number) {
    model.num = 9;
    model.text = undefined;
  } else {
    model.num = undefined;
    model.text = "picked";
  }
  const leaf = new GenericLeaf();
  leaf.code = 3;
  leaf.name = "leaf";
  model.leaf = leaf;
}

function populateStatic(model: StaticModel, choice: number): void {
  model.active = true;
  model.choice = choice;
  model.count = -7;
  model.id = 42n;
  model.note = "hello";
  model.tags = ["zeta", "alpha"];
  if (choice === Choice.Number) {
    model.num = 9;
    model.text = undefined;
  } else {
    model.num = undefined;
    model.text = "picked";
  }
  const leaf = new StaticLeaf();
  leaf.code = 3;
  leaf.name = "leaf";
  model.leaf = leaf;
}

function populateMixed(model: MixedModel, choice: number): void {
  model.active = true;
  model.choice = choice;
  model.count = -7;
  model.id = 42n;
  model.note = "hello";
  model.tags = ["zeta", "alpha"];
  if (choice === Choice.Number) {
    model.num = 9;
    model.text = undefined;
  } else {
    model.num = undefined;
    model.text = "picked";
  }
  const leaf = new StaticLeaf();
  leaf.code = 3;
  leaf.name = "leaf";
  model.leaf = leaf;
}

describe("статический кодек", () => {
  it("байты совпадают с generic для варианта num", () => {
    const generic = new GenericModel();
    populateGeneric(generic, Choice.Number);
    const statik = new StaticModel();
    populateStatic(statik, Choice.Number);
    expect(hex(encode(statik))).toBe(hex(encode(generic)));
  });

  it("байты совпадают с generic для варианта text", () => {
    const generic = new GenericModel();
    populateGeneric(generic, Choice.Text);
    const statik = new StaticModel();
    populateStatic(statik, Choice.Text);
    expect(hex(encode(statik))).toBe(hex(encode(generic)));
  });

  it("байты совпадают с generic без optional-полей", () => {
    const generic = new GenericModel();
    populateGeneric(generic, Choice.Number);
    generic.leaf = undefined;
    generic.note = undefined;
    const statik = new StaticModel();
    populateStatic(statik, Choice.Number);
    statik.leaf = undefined;
    statik.note = undefined;
    expect(hex(encode(statik))).toBe(hex(encode(generic)));
  });

  it("decode и roundtrip статического корня", () => {
    const statik = new StaticModel();
    populateStatic(statik, Choice.Number);
    const restored = decode(StaticModel, encode(statik));
    expect(restored.active).toBe(true);
    expect(restored.choice).toBe(Choice.Number);
    expect(restored.count).toBe(-7);
    expect(restored.id).toBe(42n);
    expect(restored.note).toBe("hello");
    expect(restored.tags).toEqual(["zeta", "alpha"]);
    expect(restored.num).toBe(9);
    expect(restored.text).toBeUndefined();
    expect(restored.leaf).toBeInstanceOf(StaticLeaf);
    expect(restored.leaf?.code).toBe(3);
    expect(restored.leaf?.name).toBe("leaf");
  });

  it("decode варианта text", () => {
    const statik = new StaticModel();
    populateStatic(statik, Choice.Text);
    const restored = decode(StaticModel, encode(statik));
    expect(restored.choice).toBe(Choice.Text);
    expect(restored.text).toBe("picked");
    expect(restored.num).toBeUndefined();
  });

  it("generic-родитель диспетчеризует статическое вложенное поле", () => {
    const generic = new GenericModel();
    populateGeneric(generic, Choice.Number);
    const mixed = new MixedModel();
    populateMixed(mixed, Choice.Number);
    expect(hex(encode(mixed))).toBe(hex(encode(generic)));
    const restored = decode(MixedModel, encode(generic));
    expect(restored.leaf).toBeInstanceOf(StaticLeaf);
    expect(restored.leaf?.name).toBe("leaf");
  });

  it("статический родитель диспетчеризует generic вложенное поле", () => {
    const generic = new GenericHolder();
    generic.value = 5;
    const genericLeaf = new GenericLeaf();
    genericLeaf.code = 4;
    genericLeaf.name = "generic";
    generic.leaf = genericLeaf;
    const statik = new StaticHolder();
    statik.value = 5;
    statik.leaf = genericLeaf;
    expect(hex(encode(statik))).toBe(hex(encode(generic)));
    const restored = decode(StaticHolder, encode(generic));
    expect(restored.leaf).toBeInstanceOf(GenericLeaf);
    expect(restored.leaf?.name).toBe("generic");
  });

  it("статический кодек имеет приоритет над схемой", () => {
    class Priority {
      public value = 0;
    }
    defineProtocol(Priority, { fields: [{ name: "value", type: "int32" }] });
    attach(Priority, {
      write(value, writer) {
        writer.zigzag(value.value + 1);
      },
      read(reader, _context, path) {
        const target = new Priority();
        target.value = reader.zigzagNumber(`${path}.value`);
        return target;
      },
    });
    const value = new Priority();
    value.value = 1;
    const expected = new Writer(16);
    expected.zigzag(2);
    expect(hex(encode(value))).toBe(hex(expected.finish()));
    expect(decode(Priority, encode(value)).value).toBe(2);
  });

  it("неверная форма статического кодека отклоняется", () => {
    class Broken {
      public value = 0;
    }
    Object.defineProperty(Broken, PROTOCOL_CODEC, {
      value: { write: () => undefined },
      enumerable: false,
      configurable: true,
      writable: true,
    });
    const value = new Broken();
    expectProtocolError(() => encode(value), "schema");
  });
});

class Node {
  public next: Node | undefined = undefined;
  public value = 0;
}

attach(Node, {
  write(value, writer, context, path) {
    writer.bitmap([!isAbsent(value.next)]);
    const next = value.next;
    if (next !== undefined && next !== null) {
      writeMessage(Node, next, writer, context, `${path}.next`);
    }
    writer.zigzag(value.value);
  },
  read(reader, context, path) {
    const target = new Node();
    const bits = reader.bitmap(1, path);
    target.next = bits[0] === true
      ? readMessage(Node, reader, context, `${path}.next`)
      : undefined;
    target.value = reader.zigzagNumber(`${path}.value`);
    return target;
  },
});

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

describe("статический кодек: ошибки и лимиты", () => {
  it("цикл объекта — ошибка", () => {
    const node = new Node();
    node.next = node;
    expectProtocolError(() => encode(node), "cycle");
  });

  it("лимит глубины на encode", () => {
    expect(() => encode(chain(10))).not.toThrow();
    expectProtocolError(() => encode(chain(300)), "depth");
    expectProtocolError(() => encode(chain(10), { maxDepth: 3 }), "depth");
    expect(() => encode(chain(10), { maxDepth: 64 })).not.toThrow();
  });

  it("лимит глубины на decode", () => {
    const bytes = encode(chain(300), { maxDepth: 1000 });
    expectProtocolError(() => decode(Node, bytes), "depth");
    expect(decode(Node, bytes, { maxDepth: 1000 }).value).toBe(0);
  });

  it("обрезка и лишние байты", () => {
    expectProtocolError(() => decode(Node, new Uint8Array([0x01])), "truncated");
    const bytes = encode(chain(1));
    const extra = new Uint8Array(bytes.length + 1);
    extra.set(bytes);
    extra[bytes.length] = 0xff;
    expectProtocolError(() => decode(Node, extra), "trailing");
    expect(decode(Node, extra, { allowTrailing: true }).value).toBe(0);
  });

  it("лимит размера", () => {
    const node = new Node();
    node.value = 100;
    const bytes = encode(node);
    expectProtocolError(() => encode(node, { maxSize: 1 }), "size");
    expectProtocolError(() => decode(Node, bytes, { maxSize: 1 }), "size");
  });
});

class GenericCollections {
  public flags: (string | undefined)[] = [];
  public scores = new Map<string, number>();
  public tag = "";
  public weights = new Set<number>();
}

defineProtocol(GenericCollections, {
  fields: [
    { name: "flags", type: ["array", ["optional", "string"]] },
    { name: "scores", type: ["map", "string", "int32"] },
    { name: "tag", type: "string" },
    { name: "weights", type: ["set", "int32"] },
  ],
});

class StaticCollections {
  public flags: (string | undefined)[] = [];
  public scores = new Map<string, number>();
  public tag = "";
  public weights = new Set<number>();
}

attach(StaticCollections, {
  write(value, writer, context, path) {
    writeOptionalArray(value.flags, writer, context, `${path}.flags`, (flag) => {
      writer.string(flag);
    });
    writeMap(
      value.scores,
      writer,
      context,
      `${path}.scores`,
      (key) => key,
      (key) => writer.string(key),
      (score) => writer.zigzag(score),
    );
    writer.string(value.tag);
    writeSet(
      value.weights,
      writer,
      context,
      `${path}.weights`,
      (weight) => weight,
      (weight) => writer.zigzag(weight),
    );
  },
  read(reader, context, path) {
    const target = new StaticCollections();
    target.flags = readOptionalArray(
      reader,
      context,
      `${path}.flags`,
      () => reader.string(`${path}.flags`),
    );
    target.scores = readMap(
      reader,
      context,
      `${path}.scores`,
      () => reader.string(`${path}.scores`),
      () => reader.zigzagNumber(`${path}.scores`),
    );
    target.tag = reader.string(`${path}.tag`);
    target.weights = readSet(
      reader,
      context,
      `${path}.weights`,
      () => reader.zigzagNumber(`${path}.weights`),
    );
    return target;
  },
});

function populateCollections(
  model: GenericCollections | StaticCollections,
): void {
  model.flags = ["first", undefined, "third"];
  model.scores.set("zulu", 1);
  model.scores.set("alpha", 2);
  model.scores.set("mike", 3);
  model.tag = "collections";
  model.weights.add(30);
  model.weights.add(10);
  model.weights.add(20);
}

describe("статический кодек: коллекции", () => {
  it("байты совпадают с generic", () => {
    const generic = new GenericCollections();
    populateCollections(generic);
    const statik = new StaticCollections();
    populateCollections(statik);
    expect(hex(encode(statik))).toBe(hex(encode(generic)));
  });

  it("roundtrip коллекций", () => {
    const statik = new StaticCollections();
    populateCollections(statik);
    const restored = decode(StaticCollections, encode(statik));
    expect(restored.flags).toEqual(["first", undefined, "third"]);
    expect([...restored.scores.keys()]).toEqual(["alpha", "mike", "zulu"]);
    expect(restored.scores.get("alpha")).toBe(2);
    expect(restored.tag).toBe("collections");
    expect([...restored.weights]).toEqual([10, 20, 30]);
  });

  it("цикл через map в статическом кодеке", () => {
    class MapBag {
      public items = new Map<string, MapBag>();
    }
    attach(MapBag, {
      write(value, writer, context, path) {
        writeMap(
          value.items,
          writer,
          context,
          `${path}.items`,
          (key) => key,
          (key) => writer.string(key),
          (item) => writeMessage(MapBag, item, writer, context, `${path}.items`),
        );
      },
      read(reader, context, path) {
        const target = new MapBag();
        target.items = readMap(
          reader,
          context,
          `${path}.items`,
          () => reader.string(`${path}.items`),
          () => readMessage(MapBag, reader, context, `${path}.items`),
        );
        return target;
      },
    });
    const bag = new MapBag();
    bag.items.set("self", bag);
    expectProtocolError(() => encode(bag), "cycle");
  });
});
