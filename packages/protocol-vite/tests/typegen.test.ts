import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import { afterAll, describe, expect, it } from "vitest";
import ts from "typescript";
import { generateProtocolBlocks } from "../src/typegen.js";
import type { ProtocolBlock } from "../src/typegen.js";
import { createRuntimeRefResolver } from "../src/runtime-ref.js";

const directory = mkdtempSync(join(tmpdir(), "silent-protocol-typegen-"));

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

interface Fixture {
  readonly sourceFile: ts.SourceFile;
  readonly checker: ts.TypeChecker;
}

function projectFor(
  files: Readonly<Record<string, string>>,
  entry: string,
): Fixture {
  const root = mkdtempSync(join(directory, "case-"));
  for (const [name, content] of Object.entries(files)) {
    const file = join(root, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  const file = join(root, entry);
  const program = ts.createProgram([file], COMPILER_OPTIONS);
  const sourceFile = program.getSourceFile(file);
  if (sourceFile === undefined) {
    throw new Error("не удалось создать исходный файл");
  }
  return { sourceFile, checker: program.getTypeChecker() };
}

function programFor(source: string): Fixture {
  return projectFor({ "main.ts": source }, "main.ts");
}

function blocksFor(
  source: string,
  options: { readonly strict?: boolean; readonly diagnostics?: (message: string) => void } = {},
): readonly ProtocolBlock[] {
  const { sourceFile, checker } = programFor(source);
  const resolver = createRuntimeRefResolver(sourceFile, checker, COMPILER_OPTIONS);
  return generateProtocolBlocks({
    sourceFile,
    checker,
    runtimeRef: resolver.runtimeRef,
    strict: options.strict ?? false,
    diagnostics: options.diagnostics,
  });
}

function blockFor(source: string): ProtocolBlock {
  const blocks = blocksFor(source);
  const block = blocks.at(-1);
  if (block === undefined) {
    throw new Error("схема не сгенерирована");
  }
  return block;
}

function applyBlocks(text: string, blocks: readonly ProtocolBlock[]): string {
  let result = text;
  const ordered = [...blocks].sort((left, right) => right.position - left.position);
  for (const block of ordered) {
    result = `${result.slice(0, block.position)}${block.code}${result.slice(block.position)}`;
  }
  return result;
}

interface ExportedModule {
  readonly exports: Record<string, unknown>;
}

function execute(source: string, blocks: readonly ProtocolBlock[]): ExportedModule {
  const applied = applyBlocks(source, blocks);
  const names = [...new Set(blocks.map((block) => block.className))]
    .filter((name) => /^[A-Za-z_$][\w$]*$/.test(name));
  const exportsCode = names
    .map((name) => `if (typeof ${name} !== "undefined") module.exports[${JSON.stringify(name)}] = ${name};`)
    .join("\n");
  const js = `${ts.transpileModule(applied, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      experimentalDecorators: false,
      useDefineForClassFields: true,
    },
  }).outputText}\n${exportsCode}`;
  const module = { exports: {} as Record<string, unknown> };
  runInNewContext(js, {
    module,
    exports: module.exports,
    require: () => ({}),
    console,
    Symbol,
    TextEncoder,
    Date,
    Map,
    Set,
    Uint8Array,
    BigInt,
    Object,
    Error,
  });
  return { exports: module.exports };
}

function schemaOf(exported: Record<string, unknown>, name: string): Record<string, unknown> {
  const ctor = exported[name];
  if (typeof ctor !== "function") {
    throw new Error(`экспорт ${name} не является классом`);
  }
  const schema = (ctor as unknown as Record<symbol, unknown>)[Symbol.for("silent.protocol.schema")];
  if (typeof schema !== "object" || schema === null) {
    throw new Error(`у класса ${name} нет схемы`);
  }
  return schema as Record<string, unknown>;
}

function fieldsByName(schema: Record<string, unknown>): Map<string, Record<string, unknown>> {
  const fields = schema["fields"];
  if (!Array.isArray(fields)) throw new Error("нет fields");
  const result = new Map<string, Record<string, unknown>>();
  for (const entry of fields) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    if (record["kind"] !== "field") continue;
    result.set(record["name"] as string, record);
  }
  return result;
}

const DECLARATIONS = `
function Int32(): any { return () => {}; }
function Uint32(): any { return () => {}; }
function Float32(): any { return () => {}; }
function Fixed32(): any { return () => {}; }
function Fixed64(): any { return () => {}; }
function Uint64(): any { return () => {}; }
function Int64(): any { return () => {}; }
function EpochMillis(): any { return () => {}; }
function OneOf(value: unknown): any { return () => {}; }
`;

describe("generateProtocolBlocks: типы", () => {
  it("сериализует примитивы, декораторы и нативные типы", () => {
    const source = `
${DECLARATIONS}
enum Role { Admin = "admin", User = "user" }

class Sample {
  public accessor name: string = "";
  public accessor age: number = 0;
  @Int32() public accessor score: number = 0;
  @Uint64() public accessor id: bigint = 0n;
  public accessor active: boolean = false;
  public accessor created: Date = new Date();
  @EpochMillis() public accessor ts: number = 0;
  public accessor bytes: Uint8Array = new Uint8Array();
  public accessor buffer: ArrayBuffer = new ArrayBuffer(0);
  public accessor map: Map<string, number> = new Map();
  public accessor set: Set<string> = new Set();
  public accessor record: Record<string, number> = {};
  public accessor list: string[] = [];
  public accessor tuple: [string, number] = ["", 0];
  public accessor maybe: string | null = null;
  public accessor role: Role = Role.User;
  public accessor kind: "a" | "b" = "a";
}
`;
    const block = blockFor(source);
    expect(block.className).toBe("Sample");
    expect(block.fields.map((field) => field.name)).toEqual([
      "active",
      "age",
      "buffer",
      "bytes",
      "created",
      "id",
      "kind",
      "list",
      "map",
      "maybe",
      "name",
      "record",
      "role",
      "score",
      "set",
      "ts",
      "tuple",
    ]);
    const schema = schemaOf(execute(source, blocksFor(source)).exports, "Sample");
    const fields = fieldsByName(schema);
    expect(fields.get("name")?.["type"]).toBe("string");
    expect(fields.get("age")?.["type"]).toBe("float64");
    expect(fields.get("score")?.["type"]).toBe("int32");
    expect(fields.get("id")?.["type"]).toBe("uint64");
    expect(fields.get("active")?.["type"]).toBe("bool");
    expect(fields.get("created")?.["type"]).toBe("date");
    expect(fields.get("ts")?.["type"]).toBe("date");
    expect(fields.get("bytes")?.["type"]).toBe("bytes");
    expect(fields.get("buffer")?.["type"]).toBe("bytes");
    expect(fields.get("map")?.["type"]).toEqual(["map", "string", "float64"]);
    expect(fields.get("set")?.["type"]).toEqual(["set", "string"]);
    expect(fields.get("record")?.["type"]).toEqual(["map", "string", "float64"]);
    expect(fields.get("list")?.["type"]).toEqual(["array", "string"]);
    expect(fields.get("tuple")?.["type"]).toEqual(["tuple", ["string", "float64"]]);
    expect(fields.get("maybe")?.["type"]).toBe("string");
    expect(fields.get("maybe")?.["optional"]).toBe(true);
    expect(fields.get("role")?.["type"]).toEqual(["enum", ["admin", "user"]]);
    expect(fields.get("kind")?.["type"]).toEqual(["enum", ["a", "b"]]);
  });

  it("разворачивает type-алиасы нативных типов", () => {
    const source = `
type AliasMap = Map<string, number>;
type AliasRecord = Record<string, number>;
type AliasDate = Date;
type AliasList = string[];

class Aliases {
  public accessor map: AliasMap = new Map();
  public accessor record: AliasRecord = {};
  public accessor date: AliasDate = new Date();
  public accessor list: AliasList = [];
  public accessor readonlyList: ReadonlyArray<string> = [];
  public accessor readonlyTuple: readonly [string, number] = ["", 0];
}
`;
    const schema = schemaOf(execute(source, blocksFor(source)).exports, "Aliases");
    const fields = fieldsByName(schema);
    expect(fields.get("map")?.["type"]).toEqual(["map", "string", "float64"]);
    expect(fields.get("record")?.["type"]).toEqual(["map", "string", "float64"]);
    expect(fields.get("date")?.["type"]).toBe("date");
    expect(fields.get("list")?.["type"]).toEqual(["array", "string"]);
    expect(fields.get("readonlyList")?.["type"]).toEqual(["array", "string"]);
    expect(fields.get("readonlyTuple")?.["type"]).toEqual([
      "tuple",
      ["string", "float64"],
    ]);
  });

  it("сортирует поля по UTF-8 байтам", () => {
    const source = `
class Sorted {
  public accessor "я": string = "";
  public accessor "a": string = "";
  public accessor "Б": string = "";
}
`;
    const block = blockFor(source);
    expect(block.fields.map((field) => field.name)).toEqual(["a", "Б", "я"]);
  });

  it("поддерживает вложенные optional-элементы массива и кортежа", () => {
    const source = `
class Sample {
  public accessor list: Array<string | null> = [];
  public accessor tuple: [string, number?] = ["", 0];
}
`;
    const schema = schemaOf(execute(source, blocksFor(source)).exports, "Sample");
    const fields = fieldsByName(schema);
    expect(fields.get("list")?.["type"]).toEqual(["array", ["optional", "string"]]);
    expect(fields.get("tuple")?.["type"]).toEqual(["tuple", ["string", ["optional", "float64"]]]);
  });

  it("поддерживает литералы, кортежи и вложенные классы", () => {
    const source = `
class Payload {
  public accessor value: string = "";
}

class Holder {
  public accessor payload: Payload = new Payload();
  public accessor flag: true = true;
}
`;
    const block = blockFor(source);
    const compiled = execute(source, blocksFor(source));
    const holder = schemaOf(compiled.exports, "Holder");
    const fields = fieldsByName(holder);
    expect(fields.get("flag")?.["type"]).toEqual(["literal", true]);
    const classType = fields.get("payload")?.["type"];
    expect(Array.isArray(classType)).toBe(true);
    if (!Array.isArray(classType)) throw new Error("ожидался ClassType");
    expect(classType[0]).toBe("class");
    const factory = classType[1];
    expect(typeof factory).toBe("function");
    if (typeof factory !== "function") throw new Error("ожидался конструктор");
    expect((factory as () => unknown)()).toBe(compiled.exports["Payload"]);
    expect(block.oneofs).toEqual([]);
  });
});

describe("generateProtocolBlocks: наследование", () => {
  it("объединяет поля базы и потомка, переопределяет по имени и сортирует", () => {
    const source = `
class Base {
  public accessor b: string = "";
  public accessor a: number = 0;
}

class Child extends Base {
  public accessor c: boolean = false;
  public accessor a: number = 1;
}
`;
    const block = blockFor(source);
    expect(block.fields.map((field) => field.name)).toEqual(["a", "b", "c"]);
    const schema = schemaOf(execute(source, blocksFor(source)).exports, "Child");
    const fields = fieldsByName(schema);
    expect(fields.get("a")?.["type"]).toBe("float64");
    expect(fields.get("b")?.["type"]).toBe("string");
    expect(fields.get("c")?.["type"]).toBe("bool");
  });

  it("наследует поля базового класса из другого файла", () => {
    const files = {
      "base.ts": `
export class Base {
  public accessor b: string = "";
  public accessor a: number = 0;
}
`,
      "child.ts": `
import { Base } from "./base";

export class Child extends Base {
  public accessor c: boolean = false;
  public accessor a: number = 1;
}
`,
    };
    const { sourceFile, checker } = projectFor(files, "child.ts");
    const resolver = createRuntimeRefResolver(sourceFile, checker, COMPILER_OPTIONS);
    const blocks = generateProtocolBlocks({
      sourceFile,
      checker,
      runtimeRef: resolver.runtimeRef,
    });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.fields.map((field) => field.name)).toEqual(["a", "b", "c"]);
  });

  it("включает declare-поля и поля без инициализатора", () => {
    const source = `
class Sample {
  declare name: string;
  public count!: number;
  public accessor active: boolean = false;
}
`;
    const block = blockFor(source);
    expect(block.fields.map((field) => field.name)).toEqual(["active", "count", "name"]);
  });
});

describe("generateProtocolBlocks: oneof", () => {
  const payloads = `
enum Kind { Created = 1, Updated = 2, Deleted = 3 }

class CreatedPayload {
  public accessor id: string = "";
}

class UpdatedPayload {
  public accessor value: number = 0;
}
`;

  it("строит oneof из декораторов @OneOf", () => {
    const source = `
${DECLARATIONS}
${payloads}
class Event {
  public accessor kind: Kind = Kind.Created;
  public accessor name: string = "";
  @OneOf(Kind.Created) public accessor created: CreatedPayload | null = null;
  @OneOf(Kind.Updated) public accessor updated?: UpdatedPayload;
  @OneOf(Kind.Deleted) public accessor deleted: null = null;
}
`;
    const blocks = blocksFor(source);
    const block = blocks.at(-1);
    if (block === undefined) throw new Error("схема Event не сгенерирована");
    expect(block.oneofs).toHaveLength(1);
    const oneof = block.oneofs[0]!;
    expect(oneof.name).toBe("kind");
    expect(oneof.enumReference).toBe("Kind");
    expect(oneof.variants.map((variant) => variant.value)).toEqual([1, 2, 3]);
    expect(oneof.variants.map((variant) => variant.field)).toEqual([
      "created",
      "updated",
      "deleted",
    ]);
    expect(oneof.variants[2]?.type).toEqual({ kind: "literal", value: null });
    expect(block.fields.map((field) => field.name)).toEqual(["name"]);
    const schema = schemaOf(execute(source, blocks).exports, "Event");
    const fields = schema["fields"];
    if (!Array.isArray(fields)) throw new Error("нет fields");
    expect(fields.map((entry) => (entry as Record<string, unknown>)["kind"])).toEqual([
      "oneof",
      "field",
    ]);
    expect(fields.map((entry) => (entry as Record<string, unknown>)["name"])).toEqual([
      "kind",
      "name",
    ]);
    const oneofs = schema["oneofs"];
    expect(Array.isArray(oneofs)).toBe(true);
    expect((oneofs as readonly unknown[]).length).toBe(1);
  });

  it("использует соглашение «имя поля = lowerCamel имени члена enum»", () => {
    const source = `
enum Status { Active = 0, Blocked = 1 }

class Conventional {
  public accessor status: Status = Status.Active;
  public accessor active?: string;
  public accessor blocked?: number;
}
`;
    const block = blockFor(source);
    expect(block.oneofs).toHaveLength(1);
    expect(block.oneofs[0]?.variants.map((variant) => variant.field)).toEqual([
      "active",
      "blocked",
    ]);
    expect(block.fields).toEqual([]);
  });

  it("диагностирует повторяющиеся значения, неверные варианты и нечисловые enum", () => {
    const messages: string[] = [];
    const duplicate = `
${DECLARATIONS}
enum Kind { Created = 1, Updated = 2 }
class Duplicate {
  public accessor kind: Kind = Kind.Created;
  @OneOf(Kind.Created) public accessor first?: string;
  @OneOf(Kind.Created) public accessor second?: string;
}
`;
    const duplicateBlocks = blocksFor(duplicate, { diagnostics: (message) => messages.push(message) });
    expect(duplicateBlocks.some((block) => block.className === "Duplicate")).toBe(false);
    expect(messages.some((message) => message.includes("встречается у полей"))).toBe(true);
    expect(() => blocksFor(duplicate, { strict: true })).toThrow(/встречается у полей/);

    messages.length = 0;
    const orphan = `
${DECLARATIONS}
class Orphan {
  @OneOf(1) public accessor value?: string;
}
`;
    blocksFor(orphan, { diagnostics: (message) => messages.push(message) });
    expect(messages.some((message) => message.includes("не найдено ни в одном enum-дискриминаторе")))
      .toBe(true);

    messages.length = 0;
    const stringEnum = `
${DECLARATIONS}
enum Kind { Created = "created", Updated = "updated" }
class StringEnum {
  public accessor kind: Kind = Kind.Created;
  @OneOf(Kind.Created) public accessor created?: string;
}
`;
    blocksFor(stringEnum, { diagnostics: (message) => messages.push(message) });
    expect(messages.some((message) => message.includes("числовые значения enum"))).toBe(true);
  });
});

describe("generateProtocolBlocks: диагностика", () => {
  it("пропускает неподдерживаемые типы и бросает в strict", () => {
    const source = `
class Bad {
  public accessor data: unknown = undefined;
  public accessor callback: () => void = () => {};
  public accessor name: string = "";
}
`;
    const messages: string[] = [];
    const block = blockFor(source);
    expect(block.fields.map((field) => field.name)).toEqual(["name"]);
    const withDiagnostics = blocksFor(source, { diagnostics: (message) => messages.push(message) });
    expect(withDiagnostics.at(-1)?.fields.map((field) => field.name)).toEqual(["name"]);
    expect(messages.some((message) => message.includes("Bad.data"))).toBe(true);
    expect(messages.some((message) => message.includes("Bad.callback"))).toBe(true);
    expect(() => blocksFor(source, { strict: true })).toThrow(/Bad\.data/);
  });

  it("распознаёт декоратор через импорт-алиас", () => {
    const files = {
      "decorators.ts": "export function Int32(): any { return () => {}; }\n",
      "main.ts": `
import { Int32 as I32 } from "./decorators";

class Aliased {
  @I32() public accessor score: number = 0;
}
`,
    };
    const { sourceFile, checker } = projectFor(files, "main.ts");
    const resolver = createRuntimeRefResolver(sourceFile, checker, COMPILER_OPTIONS);
    const blocks = generateProtocolBlocks({
      sourceFile,
      checker,
      runtimeRef: resolver.runtimeRef,
    });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.fields[0]?.type).toEqual({ kind: "primitive", name: "int32" });
  });

  it("диагностирует @Int64 на number", () => {
    const source = `
${DECLARATIONS}
class Numbers {
  @Int64() public accessor value: number = 0;
  public accessor name: string = "";
}
`;
    const messages: string[] = [];
    const blocks = blocksFor(source, { diagnostics: (message) => messages.push(message) });
    const block = blocks.at(-1);
    expect(block?.fields.map((field) => field.name)).toEqual(["name"]);
    expect(messages.some((message) => message.includes("@Int64 на number"))).toBe(true);
    expect(() => blocksFor(source, { strict: true })).toThrow(/@Int64 на number/);
  });

  it("идемпотентен: класс с готовой схемой пропускается", () => {
    const source = `
class Ready {
  public accessor name: string = "";
  static {
    this[Symbol.for("silent.protocol.schema")] = { version: 1, fields: [], oneofs: [] };
  }
}
`;
    expect(blocksFor(source)).toEqual([]);
  });
});

describe("generateProtocolBlocks: классы", () => {
  it("поддерживает namespace, class expression и default export", () => {
    const source = `
export namespace Domain {
  export class Item {
    public accessor id: number = 0;
  }
}

const Expr = class {
  public accessor x: string = "";
};

export default class Default {
  public accessor item: Domain.Item = new Domain.Item();
}
`;
    const { sourceFile, checker } = programFor(source);
    const resolver = createRuntimeRefResolver(sourceFile, checker, COMPILER_OPTIONS);
    const blocks = generateProtocolBlocks({
      sourceFile,
      checker,
      runtimeRef: resolver.runtimeRef,
    });
    const compiled = execute(source, blocks);
    const schema = schemaOf(compiled.exports, "Default");
    const fields = fieldsByName(schema);
    const itemType = fields.get("item")?.["type"];
    if (!Array.isArray(itemType)) throw new Error("ожидался ClassType");
    expect((itemType[1] as () => unknown)()).toBe(
      (compiled.exports["Domain"] as Record<string, unknown>)["Item"],
    );
  });
});
