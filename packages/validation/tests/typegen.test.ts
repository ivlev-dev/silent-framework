import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import ts from "typescript";
import { generateValidationBlocks } from "../src/typegen.js";
import type { ValidationBlock } from "../src/typegen.js";

const directory = mkdtempSync(join(tmpdir(), "silent-validation-typegen-"));

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

function programFor(source: string): { readonly sourceFile: ts.SourceFile; readonly checker: ts.TypeChecker } {
  const file = join(directory, `fixture-${Math.random().toString(36).slice(2)}.ts`);
  writeFileSync(file, source);
  const program = ts.createProgram([file], {
    strict: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
    skipLibCheck: true,
    noEmit: true,
  });
  const sourceFile = program.getSourceFile(file);
  if (sourceFile === undefined) {
    throw new Error("не удалось создать исходный файл");
  }
  return { sourceFile, checker: program.getTypeChecker() };
}

function blocksFor(source: string): readonly ValidationBlock[] {
  const { sourceFile, checker } = programFor(source);
  return generateValidationBlocks({
    sourceFile,
    checker,
    runtimeRef: (symbol) => symbol.getName(),
  });
}

function fieldsFor(source: string, index = 0): string {
  const blocks = blocksFor(source);
  expect(blocks.length).toBeGreaterThan(index);
  const code = blocks[index]!.code;
  const match = /\{ fields: \{(.*)\} \};/.exec(code);
  if (match === null || match[1] === undefined) {
    throw new Error(`не удалось разобрать блок: ${code}`);
  }
  return match[1].trim();
}

function applyBlocks(text: string, blocks: readonly ValidationBlock[]): string {
  let result = text;
  const ordered = [...blocks].sort((left, right) => right.position - left.position);
  for (const block of ordered) {
    result = `${result.slice(0, block.position)}${block.code}${result.slice(block.position)}`;
  }
  return result;
}

describe("generateValidationBlocks", () => {
  it("сериализует примитивы и пропускает any/unknown", () => {
    const fields = fieldsFor(`
class Primitives {
  accessor text: string = "";
  accessor count: number = 0;
  accessor flag: boolean = false;
  accessor big: bigint = 0n;
  accessor key: symbol = Symbol("key");
  accessor raw: object = {};
  accessor pair: [string, number] = ["", 0];
  accessor callback: () => void = () => {};
  accessor empty: void = undefined;
  accessor nothing: never = (() => { throw new Error("x"); })();
  accessor absent: undefined = undefined;
  accessor nil: null = null;
  accessor anyValue: any = 1;
  accessor unknownValue: unknown = 1;
}
`);
    expect(fields).toBe(
      '"text": "string", "count": "number", "flag": "boolean", "big": "bigint", "key": "symbol", '
      + '"raw": "object", "pair": ["tuple",["string","number"]], "callback": "function", '
      + '"empty": "void", "nothing": "never", "absent": "undefined", "nil": "null"',
    );
  });

  it("разворачивает литералы и union-типы", () => {
    const fields = fieldsFor(`
class Shapes {
  accessor only: "ready" = "ready";
  accessor code: 42 = 42;
  accessor positive: true = true;
  accessor maybe: string | undefined = undefined;
  accessor nullable: number | null = null;
  accessor both: boolean | null | undefined = undefined;
  accessor either: string | number = "";
  accessor mixed: "a" | 42 | true = "a";
}
`);
    expect(fields).toBe(
      '"only": ["literal","ready"], "code": ["literal",42], "positive": ["literal",true], '
      + '"maybe": ["optional","string"], "nullable": ["nullable","number"], '
      + '"both": ["optional",["nullable","boolean"]], '
      + '"either": ["union",["string","number"]], '
      + '"mixed": ["union",[["literal",true],["literal",42],["literal","a"]]]',
    );
  });

  it("извлекает значения строковых и числовых enum", () => {
    const fields = fieldsFor(`
enum Role {
  Admin = "admin",
  User = "user",
}

enum Level {
  Low = 1,
  High = 2,
}

class Account {
  accessor role: Role = Role.Admin;
  accessor level: Level = Level.Low;
  accessor roles: Role[] = [];
}
`);
    expect(fields).toBe(
      '"role": ["enum",["admin","user"]], "level": ["enum",[1,2]], '
      + '"roles": ["array",["enum",["admin","user"]]]',
    );
  });

  it("поддерживает массивы, кортежи и коллекции", () => {
    const fields = fieldsFor(`
class Collections {
  accessor tags: string[] = [];
  accessor readonlyTags: readonly number[] = [];
  accessor tuple: [string, number?] = ["a"];
  accessor record: Record<string, boolean> = {};
  accessor dictionary: { [key: string]: Date } = {};
  accessor map: Map<string, number> = new Map();
  accessor set: Set<string> = new Set();
  accessor weakMap: WeakMap<object, Date> = new WeakMap();
  accessor weakSet: WeakSet<object> = new WeakSet();
  accessor promise: Promise<string> = Promise.resolve("");
}
`);
    expect(fields).toBe(
      '"tags": ["array","string"], "readonlyTags": ["array","number"], '
      + '"tuple": ["tuple",["string",null]], "record": ["record","boolean"], '
      + '"dictionary": ["record","date"], "map": ["mapof","string","number"], '
      + '"set": ["setof","string"], "weakMap": ["mapof","object","date"], '
      + '"weakSet": ["setof","object"], "promise": "promise"',
    );
  });

  it("распознаёт встроенные классы и вложенные классы", () => {
    const fields = fieldsFor(`
class Inner {
  accessor id: number = 0;
}

class Outer {
  accessor inner: Inner = new Inner();
  accessor date: Date = new Date();
  accessor pattern: RegExp = /x/;
  accessor failure: TypeError = new TypeError("x");
  accessor buffer: ArrayBuffer = new ArrayBuffer(1);
  accessor bytes: Uint8Array = new Uint8Array();
  accessor link: URL = new URL("https://example.com");
  accessor query: URLSearchParams = new URLSearchParams();
  accessor iterator: Iterator<string> = [][Symbol.iterator]();
  accessor asyncIterator: AsyncIterator<string> = (async function* () {})();
}
`, 1);
    expect(fields).toBe(
      '"inner": ["class",()=>Inner], "date": "date", "pattern": "regexp", "failure": "error", '
      + '"buffer": "arraybuffer", "bytes": "uint8array", "link": "url", "query": "urlsearchparams", '
      + '"iterator": "iterator", "asyncIterator": "asynciterator"',
    );
  });

  it("разворачивает интерфейсы и псевдонимы типов", () => {
    const fields = fieldsFor(`
interface Profile {
  name: string;
  age?: number;
}

type Meta = { active: boolean };

class Holder {
  accessor profile: Profile = { name: "" };
  accessor meta: Meta = { active: true };
  accessor profiles: Profile[] = [];
}
`);
    expect(fields).toBe(
      '"profile": ["object",{"name":"string","age":["optional","number"]}], '
      + '"meta": ["object",{"active":"boolean"}], '
      + '"profiles": ["array",["object",{"name":"string","age":["optional","number"]}]]',
    );
  });

  it("объединяет объектные ветки intersection", () => {
    const fields = fieldsFor(`
interface Left {
  a: string;
}

interface Right {
  b: number;
}

class Combined {
  accessor merged: Left & Right = { a: "", b: 0 };
}
`);
    expect(fields).toBe('"merged": ["object",{"a":"string","b":"number"}]');
  });

  it("учитывает только собственные auto accessor-поля", () => {
    const fields = fieldsFor(`
class Fields {
  accessor kept: string = "";
  value: number = 0;
  static accessor counted: number = 0;
  accessor #secret: number = 0;
  accessor untyped = "text";
  accessor anyValue: any = 1;
}
`);
    expect(fields).toBe('"kept": "string"');
  });

  it("не создаёт блок для класса без подходящих полей", () => {
    expect(blocksFor(`
class Empty {
  accessor anyValue: any = 1;
  accessor unknownValue: unknown = 1;
  value: string = "";
}
`)).toHaveLength(0);
  });

  it("вставляет блок перед закрывающей скобкой класса", () => {
    const source = `class Simple {\n  accessor email: string = "";\n}\n`;
    const blocks = blocksFor(source);
    expect(blocks).toHaveLength(1);
    const block = blocks[0]!;
    expect(block.position).toBe(source.indexOf("}"));
    expect(applyBlocks(source, blocks)).toBe(
      "class Simple {\n"
      + '  accessor email: string = "";\n'
      + "  static {\n"
      + '    this[Symbol.for("silent.validation.schema")] = { fields: { "email": "string" } };\n'
      + "  }\n"
      + "}\n",
    );
  });

  it("сохраняет отступ вложенного класса", () => {
    const source = `function factory() {\n  class Nested {\n    accessor size: number = 0;\n  }\n  return Nested;\n}\n`;
    const applied = applyBlocks(source, blocksFor(source));
    expect(applied).toBe(
      "function factory() {\n"
      + "  class Nested {\n"
      + "    accessor size: number = 0;\n"
      + "    static {\n"
      + '      this[Symbol.for("silent.validation.schema")] = { fields: { "size": "number" } };\n'
      + "    }\n"
      + "  }\n"
      + "  return Nested;\n"
      + "}\n",
    );
  });

  it("не дублирует блок при повторной генерации", () => {
    const source = `class Repeat {\n  accessor name: string = "";\n}\n`;
    const first = blocksFor(source);
    expect(first).toHaveLength(1);
    const applied = applyBlocks(source, first);
    expect(blocksFor(applied)).toHaveLength(0);
    expect(applied.match(/silent\.validation\.schema/g)).toHaveLength(1);
  });

  it("генерирует блок для каждого класса", () => {
    const source = `class First {\n  accessor a: string = "";\n}\n\nclass Second {\n  accessor b: number = 0;\n}\n`;
    const blocks = blocksFor(source);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.position).toBeLessThan(blocks[1]!.position);
    const applied = applyBlocks(source, blocks);
    expect(applied).toContain('"a": "string"');
    expect(applied).toContain('"b": "number"');
  });
});
