import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import ts from "typescript";
import { generateProtocolBlocks } from "../src/typegen.js";
import type { ProtocolBlock } from "../src/typegen.js";
import { createRuntimeRefResolver } from "../src/runtime-ref.js";

const directory = mkdtempSync(join(tmpdir(), "silent-protocol-codec-"));

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

const COMPILER_OPTIONS: ts.CompilerOptions = {
  strict: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
  types: ["node"],
  skipLibCheck: true,
  noEmit: true,
  experimentalDecorators: false,
  useDefineForClassFields: true,
};

const DECLARATIONS = `
function Int32(): any { return () => {}; }
function OneOf(value: unknown): any { return () => {}; }
`;

function projectFor(source: string): {
  readonly sourceFile: ts.SourceFile;
  readonly checker: ts.TypeChecker;
} {
  const root = mkdtempSync(join(directory, "case-"));
  const file = join(root, "main.ts");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source);
  const program = ts.createProgram([file], COMPILER_OPTIONS);
  const sourceFile = program.getSourceFile(file);
  if (sourceFile === undefined) throw new Error("не удалось создать исходный файл");
  return { sourceFile, checker: program.getTypeChecker() };
}

function blocksFor(source: string): readonly ProtocolBlock[] {
  const { sourceFile, checker } = projectFor(source);
  const resolver = createRuntimeRefResolver(sourceFile, checker, COMPILER_OPTIONS);
  return generateProtocolBlocks({
    sourceFile,
    checker,
    runtimeRef: resolver.runtimeRef,
  });
}

function blockNamed(source: string, className: string): ProtocolBlock {
  const block = blocksFor(source).find((entry) => entry.className === className);
  if (block === undefined) throw new Error(`кодек ${className} не сгенерирован`);
  return block;
}

function assertSyntax(source: string, blocks: readonly ProtocolBlock[]): void {
  let result = source;
  const ordered = [...blocks].sort((left, right) => right.position - left.position);
  for (const block of ordered) {
    result = `${result.slice(0, block.position)}${block.code}${result.slice(block.position)}`;
  }
  const transpiled = ts.transpileModule(result, {
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      useDefineForClassFields: true,
    },
  });
  const errors = (transpiled.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  expect(
    errors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")),
  ).toEqual([]);
}

function expectCodec(block: ProtocolBlock): void {
  expect(block.code).toContain('Symbol.for("silent.protocol.codec")');
  expect(block.code).toContain("write(value, writer, context, path) {");
  expect(block.code).toContain("read(reader, context, path) {");
}

describe("codec: примитивы и нативные типы", () => {
  it("генерирует wire-вызовы для примитивов, Date, bigint и typed arrays", () => {
    const source = `
${DECLARATIONS}
class Primitives {
  public active: boolean = false;
  public ratio: number = 0;
  @Int32() public score: number = 0;
  public name: string = "";
  public id: bigint = 0n;
  public createdAt: Date = new Date();
  public bytes: Uint8Array = new Uint8Array();
  public buffer: ArrayBuffer = new ArrayBuffer(0);
  public view: Uint16Array = new Uint16Array();
}
`;
    const block = blockNamed(source, "Primitives");
    expectCodec(block);
    expect(block.code).toContain('writer.bool(value["active"]);');
    expect(block.code).toContain('writer.float64(value["ratio"]);');
    expect(block.code).toContain('writer.zigzag(value["score"]);');
    expect(block.code).toContain('writer.string(value["name"]);');
    expect(block.code).toContain('writer.zigzag(value["id"]);');
    expect(block.code).toContain('writer.zigzag(value["createdAt"].getTime());');
    expect(block.code).toContain('writer.bytes(value["bytes"]);');
    expect(block.code).toContain('writer.bytes(new Uint8Array(value["buffer"]));');
    expect(block.code).toContain(
      'writer.bytes(new Uint8Array(value["view"].buffer, value["view"].byteOffset, value["view"].byteLength));',
    );
    expect(block.code).toContain('reader.bool(path, ".active")');
    expect(block.code).toContain('reader.float64(path, ".ratio")');
    expect(block.code).toContain('reader.zigzagNumber(path, ".score")');
    expect(block.code).toContain('reader.zigzag(path, ".id")');
    expect(block.code).toContain('new Date(reader.zigzagNumber(path, ".createdAt"))');
    expect(block.code).toContain('reader.bytes(path, ".bytes")');
    expect(block.helpers).toEqual([]);
    assertSyntax(source, blocksFor(source));
  });
});

describe("codec: optional и bitmap", () => {
  it("пишет bitmap в начале сообщения и восстанавливает отсутствующие поля", () => {
    const source = `
class OptionalFields {
  public count: number | null = null;
  public name?: string;
}
`;
    const block = blockNamed(source, "OptionalFields");
    expectCodec(block);
    expect(block.code).toContain(
      'writer.bitmapMask((value["count"] !== undefined && value["count"] !== null ? 1 : 0) | (value["name"] !== undefined && value["name"] !== null ? 2 : 0), 2);',
    );
    expect(block.code).toContain("const bits = reader.bitmapMask(2, path);");
    expect(block.code).toContain("if ((bits & 1) !== 0) {");
    expect(block.code).toContain('value["count"] = undefined;');
    expect(block.code).toContain("if ((bits & 2) !== 0) {");
    expect(block.code).toContain('value["name"] = undefined;');
    assertSyntax(source, blocksFor(source));
  });

  it("генерирует bitmap для optional-элементов массива", () => {
    const source = `
class OptionalList {
  public values: Array<string | null> = [];
}
`;
    const block = blockNamed(source, "OptionalList");
    expect(block.code).toContain("__silent_protocol_writeOptionalArray(value[\"values\"]");
    expect(block.code).toContain(
      '__silent_protocol_readOptionalArray(reader, context, path, (index) => reader.string(path, ".values", index), ".values")',
    );
    expect(block.helpers).toEqual([
      "writeOptionalArray",
      "readOptionalArray",
    ]);
    assertSyntax(source, blocksFor(source));
  });

  it("переключается на массив битов при более 32 optional-полях", () => {
    const fields = Array.from(
      { length: 33 },
      (_, index) => `  public enabled${index}: string | null = null;`,
    ).join("\n");
    const source = `
class WideOptional {
${fields}
}
`;
    const block = blockNamed(source, "WideOptional");
    expect(block.code).toContain("writer.bitmap([");
    expect(block.code).toContain("const bits = reader.bitmap(33, path);");
    expect(block.code).toContain("if (bits[0] === true) {");
    expect(block.code).not.toContain("writer.bitmapMask");
    assertSyntax(source, blocksFor(source));
  });
});

describe("codec: вложенные классы и коллекции", () => {
  it("использует writeMessage/readMessage для вложенных классов", () => {
    const source = `
class Inner {
  public value: string = "";
}
class Outer {
  public inner: Inner = new Inner();
  public items: Inner[] = [];
}
`;
    const block = blockNamed(source, "Outer");
    expect(block.code).toContain(
      '__silent_protocol_writeMessage(Inner, value["inner"], writer, context, path + ".inner");',
    );
    expect(block.code).toContain(
      'value["inner"] = __silent_protocol_readMessage(Inner, reader, context, path + ".inner");',
    );
    expect(block.code).toContain("__silent_protocol_writeArray(value[\"items\"]");
    expect(block.code).toContain(
      '__silent_protocol_readArray(reader, context, path, (index) => __silent_protocol_readMessage(Inner, reader, context, path + ".items" + "[" + index + "]"), ".items")',
    );
    expect(block.helpers).toEqual([
      "writeMessage",
      "readMessage",
      "writeArray",
      "readArray",
    ]);
    assertSyntax(source, blocksFor(source));
  });

  it("сортирует Map/Set через sortKey", () => {
    const source = `
class Collections {
  public byName: Map<string, number> = new Map();
  public byFlag: Map<boolean, string> = new Map();
  public names: Set<string> = new Set();
  public dates: Set<Date> = new Set();
}
`;
    const block = blockNamed(source, "Collections");
    expect(block.code).toContain(
      '__silent_protocol_writeMap(value["byName"], writer, context, path + ".byName", (key) => key, (key) => {',
    );
    expect(block.code).toContain(
      '__silent_protocol_writeMap(value["byFlag"], writer, context, path + ".byFlag", (key) => (key ? 1 : 0), (key) => {',
    );
    expect(block.code).toContain(
      '__silent_protocol_writeSet(value["names"], writer, context, path + ".names", (entryValue) => entryValue',
    );
    expect(block.code).toContain(
      '__silent_protocol_writeSet(value["dates"], writer, context, path + ".dates", (entryValue) => entryValue.getTime()',
    );
    expect(block.code).toContain(
      '__silent_protocol_readMap(reader, context, path + ".byName", () => reader.string(path + ".byName" + ".keys")',
    );
    expect(block.code).toContain(
      '__silent_protocol_readSet(reader, context, path + ".names", () => reader.string(path + ".names" + "[]"))',
    );
    assertSyntax(source, blocksFor(source));
  });

  it("кодирует кортеж inline и bitmap для optional-слотов", () => {
    const source = `
class TupleModel {
  public tuple: [string, number?, boolean?] = ["", undefined, undefined];
}
`;
    const block = blockNamed(source, "TupleModel");
    expect(block.code).toContain('writer.bitmapMask((value["tuple"][1] !== undefined && value["tuple"][1] !== null ? 1 : 0) | (value["tuple"][2] !== undefined && value["tuple"][2] !== null ? 2 : 0), 2);');
    expect(block.code).toContain('context.enter(value["tuple"], path + ".tuple");');
    expect(block.code).toContain("const __tuple0 = new Array(3);");
    expect(block.code).toContain('const __tuple0Bits = reader.bitmapMask(2, path + ".tuple");');
    expect(block.code).toContain("if ((__tuple0Bits & 1) !== 0) {");
    expect(block.code).toContain("__tuple0[1] = undefined;");
    assertSyntax(source, blocksFor(source));
  });
});

describe("codec: oneof и литералы", () => {
  it("генерирует switch по дискриминатору и проверку единственного варианта", () => {
    const source = `
${DECLARATIONS}
enum Kind { Created = 1, Updated = 2, Deleted = 3 }
class Payload {
  public text: string = "";
}
class Event {
  public kind: Kind = Kind.Created;
  @OneOf(Kind.Created) public created?: Payload;
  @OneOf(Kind.Updated) public updated?: string;
  @OneOf(Kind.Deleted) public deleted?: null;
}
`;
    const block = blockNamed(source, "Event");
    expectCodec(block);
    expect(block.code).toContain('switch (value["kind"]) {');
    expect(block.code).toContain("case 1: {");
    expect(block.code).toContain("case 2: {");
    expect(block.code).toContain("case 3: {");
    expect(block.code).toContain('throw new __silent_protocol_ProtocolError("oneof"');
    expect(block.code).toContain('throw new __silent_protocol_ProtocolError("unknown_enum"');
    expect(block.code).toContain('value["created"] = undefined;');
    expect(block.code).toContain('const __oneof0 = reader.varintNumber(path + ".kind", 0x7fffffff);');
    expect(block.code).toContain('value["created"] = __silent_protocol_readMessage(Payload, reader, context, path + ".created");');
    expect(block.code).toContain('value["deleted"] = null;');
    expect(block.code).toContain("writer.varint(3);");
    expect(block.helpers).toContain("ProtocolError");
    assertSyntax(source, blocksFor(source));
  });

  it("кодирует литералы нулевой длины и проверяет значение", () => {
    const source = `
class LiteralModel {
  public flag: true = true;
}
`;
    const block = blockNamed(source, "LiteralModel");
    expect(block.code).toContain('if (!Object.is(value["flag"], true)) {');
    expect(block.code).toContain('value["flag"] = true;');
    expect(block.helpers).toEqual(["ProtocolError"]);
    assertSyntax(source, blocksFor(source));
  });
});

describe("codec: fallback и идемпотентность", () => {
  it("кодирует Record через каноническую Map", () => {
    const source = `
class RecordModel {
  public meta: Record<string, number> = {};
  public name: string = "";
}
`;
    const block = blockNamed(source, "RecordModel");
    expect(block.code).toContain('Symbol.for("silent.protocol.codec")');
    expect(block.code).toContain(
      'const __record0 = value["meta"] instanceof Map ? value["meta"] : new Map(Object.entries(value["meta"]));',
    );
    expect(block.code).toContain('__silent_protocol_writeMap(__record0, writer, context, path + ".meta"');
    expect(block.code).toContain('value["meta"] = __silent_protocol_readMap(reader, context, path + ".meta"');
    assertSyntax(source, blocksFor(source));
  });

  it("оставляет схему без кодека для Map с optional-значениями", () => {
    const source = `
class OptionalMap {
  public values: Map<string, number | null> = new Map();
}
`;
    const block = blockNamed(source, "OptionalMap");
    expect(block.code).toContain('Symbol.for("silent.protocol.schema")');
    expect(block.code).not.toContain('Symbol.for("silent.protocol.codec")');
    assertSyntax(source, blocksFor(source));
  });

  it("оставляет схему без кодека для Set<bigint>", () => {
    const source = `
class BigIntSet {
  public values: Set<bigint> = new Set();
}
`;
    const block = blockNamed(source, "BigIntSet");
    expect(block.code).toContain('Symbol.for("silent.protocol.schema")');
    expect(block.code).not.toContain('Symbol.for("silent.protocol.codec")');
    assertSyntax(source, blocksFor(source));
  });

  it("не дублирует статический блок при повторной генерации", () => {
    const source = `
class Ready {
  public name: string = "";
  static {
    this[Symbol.for("silent.protocol.codec")] = { write() {}, read() { return new Ready(); } };
    this[Symbol.for("silent.protocol.schema")] = { version: 1, fields: [], oneofs: [] };
  }
}
`;
    expect(blocksFor(source)).toEqual([]);
  });
});
