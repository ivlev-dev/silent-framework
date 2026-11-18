import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import ts from "typescript";
import { validate } from "@ivlev-dev/silent-validation";
import { generateValidationBlocks } from "../src/typegen.js";
import type { ValidationBlock } from "../src/typegen.js";

const directory = mkdtempSync(join(tmpdir(), "silent-validation-typegen-"));

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

const COMPILER_OPTIONS: ts.CompilerOptions = {
  strict: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
  skipLibCheck: true,
  noEmit: true,
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
  const match = /\{ version: 1, fields: \{(.*)\} \};/.exec(code);
  if (match === null || match[1] === undefined) {
    throw new Error(`не удалось разобрать блок: ${code}`);
  }
  return match[1].trim();
}

function runtimeRefName(symbol: ts.Symbol): string {
  for (const declaration of symbol.declarations ?? []) {
    if (
      (ts.isClassDeclaration(declaration) || ts.isClassExpression(declaration))
      && declaration.name !== undefined
    ) {
      return declaration.name.text;
    }
  }
  return symbol.getName();
}

function projectFieldsFor(
  files: Readonly<Record<string, string>>,
  entry: string,
  index = 0,
): string {
  const { sourceFile, checker } = projectFor(files, entry);
  const blocks = generateValidationBlocks({
    sourceFile,
    checker,
    runtimeRef: runtimeRefName,
  });
  expect(blocks.length).toBeGreaterThan(index);
  const code = blocks[index]!.code;
  const match = /\{ version: 1, fields: \{(.*)\} \};/.exec(code);
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
  accessor readonlyMap: ReadonlyMap<string, number> = new Map();
  accessor readonlySet: ReadonlySet<string> = new Set();
  accessor weakMap: WeakMap<object, Date> = new WeakMap();
  accessor weakSet: WeakSet<object> = new WeakSet();
  accessor promise: Promise<string> = Promise.resolve("");
}
`);
    expect(fields).toBe(
      '"tags": ["array","string"], "readonlyTags": ["array","number"], '
      + '"tuple": ["tuple",["string",null]], "record": ["record","boolean"], '
      + '"dictionary": ["record","date"], "map": ["mapof","string","number"], '
      + '"set": ["setof","string"], "readonlyMap": ["mapof","string","number"], '
      + '"readonlySet": ["setof","string"], "weakMap": "weakmap", '
      + '"weakSet": "weakset", "promise": "promise"',
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
      + '    this[Symbol.for("silent.validation.schema")] = { version: 1, fields: { "email": "string" } };\n'
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
      + '      this[Symbol.for("silent.validation.schema")] = { version: 1, fields: { "size": "number" } };\n'
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

  it("поддерживает отрицательные и bigint-литералы", () => {
    const fields = fieldsFor(`
class Numbers {
  accessor negative: -1 = -1;
  accessor bigNegative: -10n = -10n;
}
`);
    expect(fields).toBe('"negative": ["literal",-1], "bigNegative": "bigint"');
  });

  it("сериализует классы из импорта, реэкспорта и default-экспорта", () => {
    const fields = projectFieldsFor(
      {
        "inner.ts": "export class Imported {\n  accessor id: number = 0;\n}\n",
        "default.ts": "export default class DefaultInner {\n  accessor flag: boolean = false;\n}\n",
        "c.ts": 'export class Reexported {\n  accessor name: string = "";\n}\n',
        "barrel.ts": 'export { Reexported } from "./c";\n',
        "main.ts": [
          'import { Imported } from "./inner";',
          'import DefaultInner from "./default";',
          'import { Reexported } from "./barrel";',
          "",
          "class Holder {",
          "  accessor imported: Imported = new Imported();",
          "  accessor defaulted: DefaultInner = new DefaultInner();",
          "  accessor reexported: Reexported = new Reexported();",
          "}",
          "",
        ].join("\n"),
      },
      "main.ts",
    );
    expect(fields).toBe(
      '"imported": ["class",()=>Imported], '
      + '"defaulted": ["class",()=>DefaultInner], '
      + '"reexported": ["class",()=>Reexported]',
    );
  });

  it("читает значения enum из type-only импорта", () => {
    const fields = projectFieldsFor(
      {
        "roles.ts": [
          "export enum Role {",
          '  Admin = "admin",',
          '  User = "user",',
          "}",
          "",
          "export enum Level {",
          "  Low = 1,",
          "  High = 2,",
          "}",
          "",
        ].join("\n"),
        "main.ts": [
          'import type { Level, Role } from "./roles";',
          "",
          "class Holder {",
          '  accessor role: Role = "admin" as Role;',
          "  accessor level: Level = 1 as Level;",
          "}",
          "",
        ].join("\n"),
      },
      "main.ts",
    );
    expect(fields).toBe(
      '"role": ["enum",["admin","user"]], "level": ["enum",[1,2]]',
    );
  });

  it("сообщает о неподдерживаемом типе поля и продолжает генерацию", () => {
    const messages: string[] = [];
    const { sourceFile, checker } = programFor(`
class Unsupported {
  accessor data: unknown = undefined;
  accessor ok: string = "";
}
`);
    const blocks = generateValidationBlocks({
      sourceFile,
      checker,
      runtimeRef: (symbol) => symbol.getName(),
      diagnostics: (message) => messages.push(message),
    });
    expect(blocks).toHaveLength(1);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("Unsupported.data");
    expect(messages[0]).toContain("не поддерживается");
    expect(blocks[0]!.code).toContain('"ok": "string"');
    expect(blocks[0]!.code).not.toContain('"data"');
  });

  it("бросает ошибку в strict-режиме", () => {
    const { sourceFile, checker } = programFor(`
class Unsupported {
  accessor data: unknown = undefined;
}
`);
    expect(() => generateValidationBlocks({
      sourceFile,
      checker,
      runtimeRef: (symbol) => symbol.getName(),
      strict: true,
    })).toThrow(/Unsupported\.data: тип unknown не поддерживается/);
  });

  it("диагностирует generic, template, conditional и mapped типы", () => {
    const messages: string[] = [];
    const { sourceFile, checker } = programFor(`
type Wrap<T> = T extends string ? { value: T } : never;
type Keys<T> = { [K in keyof T]: T[K] };
type Indexed<T, K extends keyof T> = T[K];

class Generic<T, K extends keyof T> {
  accessor value: T = null as unknown as T;
  accessor template: \`id-\${string}\` = "id-1";
  accessor conditional: Wrap<T> = null as unknown as Wrap<T>;
  accessor mapped: Keys<T> = null as unknown as Keys<T>;
  accessor indexed: Indexed<T, K> = null as unknown as Indexed<T, K>;
}
`);
    const blocks = generateValidationBlocks({
      sourceFile,
      checker,
      runtimeRef: (symbol) => symbol.getName(),
      diagnostics: (message) => messages.push(message),
    });
    expect(blocks).toHaveLength(0);
    expect(messages).toHaveLength(5);
    expect(messages.join("\n")).toContain("Generic.value");
    expect(messages.join("\n")).toContain("Generic.template");
    expect(messages.join("\n")).toContain("Generic.conditional");
    expect(messages.join("\n")).toContain("Generic.mapped");
    expect(messages.join("\n")).toContain("Generic.indexed");
  });

  it("генерирует lazy-узлы для рекурсивных интерфейсов", () => {
    const blocks = blocksFor(`
interface LinkedNode {
  value: string;
  next: LinkedNode | null;
}

class Tree {
  accessor head: LinkedNode | null = null;
  accessor nodes: LinkedNode[] = [];
}
`);
    expect(blocks).toHaveLength(1);
    const code = blocks[0]!.code;
    const node = '["object",{"value":"string","next":["lazy",()=>lazy0]}]';
    expect(code).toContain(`"head": ["nullable",${node}]`);
    expect(code).toContain(`"nodes": ["array",${node}]`);
    expect(code).toContain(`const lazy0 = ["nullable",${node}];`);
    expect(code.match(/const lazy0/g)).toHaveLength(1);
  });

  it("закрывает взаимную рекурсию интерфейсов", () => {
    const code = blocksFor(`
interface A {
  name: string;
  b: B | null;
}

interface B {
  count: number;
  a: A | null;
}

class Mutual {
  accessor root: A = { name: "", b: null };
}
`)[0]!.code;
    expect(code).toContain('const lazy0 = ');
    expect(code).toContain('["lazy",()=>lazy0]');
  });

  it("не обрезает вложенные интерфейсы на глубине больше четырёх", () => {
    const fields = fieldsFor(`
interface L5 { value: string }
interface L4 { child: L5 }
interface L3 { child: L4 }
interface L2 { child: L3 }
interface L1 { child: L2 }
interface L0 { child: L1 }

class Deep {
  accessor root: L0 = null as unknown as L0;
}
`);
    expect(fields).toBe(
      '"root": ["object",{"child":["object",{"child":["object",{"child":["object",'
      + '{"child":["object",{"child":["object",{"value":"string"}]}]}]}]}]}]',
    );
  });

  it("сериализует rest-кортежи", () => {
    const fields = fieldsFor(`
class Tuples {
  accessor rest: [string, number, ...boolean[]] = ["", 0];
  accessor optionalRest: [string, number?, ...boolean[]] = [""];
  accessor readonlyRest: readonly [string, ...number[]] = [""];
}
`);
    expect(fields).toBe(
      '"rest": ["tuple",["string","number"],"boolean"], '
      + '"optionalRest": ["tuple",["string",null],"boolean"], '
      + '"readonlyRest": ["tuple",["string"],"number"]',
    );
  });

  it("не ломает обычные и readonly-кортежи", () => {
    const fields = fieldsFor(`
class Plain {
  accessor tuple: [string, number?] = [""];
  accessor readonlyTuple: readonly [string, number] = ["", 0];
}
`);
    expect(fields).toBe(
      '"tuple": ["tuple",["string",null]], "readonlyTuple": ["tuple",["string","number"]]',
    );
  });

  it("не зацикливается на рекурсивных union и массивах", () => {
    const code = blocksFor(`
type Nested = string | Nested[];

class Recursive {
  accessor nested: Nested = "";
}
`)[0]!.code;
    expect(code).toContain('"nested": ["union",["string",["array",["lazy",()=>lazy0]]]]');
    expect(code).toContain('const lazy0 = ["union",["string",["array",["lazy",()=>lazy0]]]];');
  });

  it("не зацикливается на рекурсивном JSON-типе", () => {
    const code = blocksFor(`
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

class JsonHolder {
  accessor value: Json = null;
}
`)[0]!.code;
    expect(code).toContain('["array",["lazy",()=>lazy0]]');
    expect(code).toContain('["record",["lazy",()=>lazy0]]');
    expect(code).toContain('const lazy0 = ');
    expect(code.match(/lazy0/g)!.length).toBeGreaterThan(2);
  });

  it("разворачивает типы глубже шести уровней", () => {
    const fields = fieldsFor(`
interface L7 { value: string }
interface L6 { child: L7 }
interface L5 { child: L6 }
interface L4 { child: L5 }
interface L3 { child: L4 }
interface L2 { child: L3 }
interface L1 { child: L2 }
interface L0 { child: L1 }

class DeepEnough {
  accessor root: L0 = null as unknown as L0;
}
`);
    expect(fields.match(/\["object"/g)).toHaveLength(8);
    expect(fields).toContain('"value":"string"');
  });

  it("не зацикливается на взаимной рекурсии через массивы", () => {
    const code = blocksFor(`
interface A {
  items: B[];
}

interface B {
  items: A[];
}

class MutualArrays {
  accessor root: A = { items: [] };
}
`)[0]!.code;
    expect(code).toContain('["lazy",()=>lazy0]');
    expect(code).toContain('const lazy0 = ');
    expect(code.match(/const lazy0/g)).toHaveLength(1);
  });

  it("сохраняет boolean в union с одним не-boolean членом", () => {
    const fields = fieldsFor(`
class Flags {
  accessor boolString: boolean | string = "";
  accessor boolNumber: boolean | number = 0;
  accessor boolLiteral: boolean | "a" = "a";
  accessor bothLiterals: true | false | "a" = "a";
}
`);
    expect(fields).toBe(
      '"boolString": ["union",["boolean","string"]], '
      + '"boolNumber": ["union",["boolean","number"]], '
      + '"boolLiteral": ["union",["boolean",["literal","a"]]], '
      + '"bothLiterals": ["union",["boolean",["literal","a"]]]',
    );
  });

  it("не подменяет пользовательские классы встроенными типами", () => {
    const fields = fieldsFor(`
export {};

class Date { }
class Map<K, V> { }
class Array<T> { }
class Error { }
class Promise<T> { }
class CustomError extends Error { }

class Shadowed {
  accessor date: Date = null as unknown as Date;
  accessor map: Map<string, number> = null as unknown as Map<string, number>;
  accessor list: Array<string> = null as unknown as Array<string>;
  accessor failure: Error = null as unknown as Error;
  accessor promise: Promise<string> = null as unknown as Promise<string>;
  accessor custom: CustomError = null as unknown as CustomError;
  accessor record: Record<string, string> = {};
}
`);
    expect(fields).toBe(
      '"date": ["class",()=>Date], "map": ["class",()=>Map], '
      + '"list": ["class",()=>Array], "failure": ["class",()=>Error], '
      + '"promise": ["class",()=>Promise], "custom": ["class",()=>CustomError], '
      + '"record": ["record","string"]',
    );
  });

  it("не подменяет пользовательский Record встроенным типом", () => {
    const fields = fieldsFor(`
export {};

type Record<K, V> = { key: K; value: V };

class RecordHolder {
  accessor pair: Record<string, number> = { key: "", value: 0 };
}
`);
    expect(fields).toBe('"pair": ["object",{"key":"string","value":"number"}]');
  });

  it("не сериализует структурно интерфейсы из lib.dom", () => {
    const fields = fieldsFor(`
class DomHolder {
  accessor event: Event = null as unknown as Event;
  accessor node: Node = null as unknown as Node;
  accessor rawElement: Element = null as unknown as Element;
  accessor element: HTMLElement = null as unknown as HTMLElement;
  accessor form: FormData = null as unknown as FormData;
}
`);
    expect(fields).toBe(
      '"event": "object", "node": "object", "rawElement": "object", '
      + '"element": "object", "form": "object"',
    );
  });

  it("пропускает well-known symbol-свойства", () => {
    const fields = fieldsFor(`
interface IterableContainer {
  size: number;
  [Symbol.iterator](): Iterator<number>;
}

class Symbols {
  accessor container: IterableContainer = null as unknown as IterableContainer;
}
`);
    expect(fields).toBe('"container": ["object",{"size":"number"}]');
  });

  it("не создаёт невыполнимую схему для вычисляемого enum", () => {
    const messages: string[] = [];
    const { sourceFile, checker } = programFor(`
const seed = Date.now();

enum Dynamic {
  A = seed,
  B = seed + 1,
}

class DynamicHolder {
  accessor value: Dynamic = 0 as Dynamic;
  accessor ok: string = "";
}
`);
    const blocks = generateValidationBlocks({
      sourceFile,
      checker,
      runtimeRef: (symbol) => symbol.getName(),
      diagnostics: (message) => messages.push(message),
    });
    expect(blocks).toHaveLength(1);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("DynamicHolder.value");
    expect(blocks[0]!.code).toContain('"ok": "string"');
    expect(blocks[0]!.code).not.toContain('"value"');
  });

  it("исполняет примитивы weakmap и weakset рантаймом", () => {
    const fields = fieldsFor(`
class WeakCollections {
  accessor weakMap: WeakMap<object, Date> = new WeakMap();
  accessor weakSet: WeakSet<object> = new WeakSet();
}
`);
    expect(fields).toBe('"weakMap": "weakmap", "weakSet": "weakset"');
    const schema = new Function(`return ({ ${fields} });`)() as Readonly<Record<string, unknown>>;
    const key = Symbol.for("silent.validation.schema");
    class Holder {
      weakMap: WeakMap<object, Date> = new WeakMap();
      weakSet: WeakSet<object> = new WeakSet();
    }
    (Holder as unknown as Record<symbol, unknown>)[key] = { version: 1, fields: schema };
    expect(validate(new Holder()).valid).toBe(true);
  });

  it("диагностирует неподдерживаемые вложенные поля", () => {
    const messages: string[] = [];
    const { sourceFile, checker } = programFor(`
interface Broken {
  value: string;
  bad: unknown;
}

class Outer {
  accessor data: Broken = null as unknown as Broken;
}
`);
    const blocks = generateValidationBlocks({
      sourceFile,
      checker,
      runtimeRef: (symbol) => symbol.getName(),
      diagnostics: (message) => messages.push(message),
    });
    expect(blocks).toHaveLength(1);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("Outer.data.bad");
    expect(blocks[0]!.code).toContain('"data": ["object",{"value":"string"}]');
  });

  it("генерирует схему для class expression", () => {
    const source = "export const Inline = class {\n  accessor n: number = 0;\n};\n";
    const blocks = blocksFor(source);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.code).toContain('"n": "number"');
    expect(applyBlocks(source, blocks)).toContain("static {");
  });

  it("учитывает index signature вместе с именованными свойствами", () => {
    const fields = fieldsFor(`
interface Dictionary {
  a: string;
  [key: string]: string;
}

interface Loose {
  a: string;
  [key: string]: unknown;
}

class Indexed {
  accessor dictionary: Dictionary = { a: "" };
  accessor loose: Loose = { a: "" };
}
`);
    expect(fields).toBe(
      '"dictionary": ["intersection",[["object",{"a":"string"}],["record","string"]]], '
      + '"loose": ["object",{"a":"string"}]',
    );
  });

  it("достраивает узлы, усечённые по глубине", () => {
    const depth = 70;
    const lines: string[] = [];
    for (let index = depth - 1; index >= 0; index -= 1) {
      lines.push(
        index === depth - 1
          ? `interface L${index} { value: string }`
          : `interface L${index} { child: L${index + 1} }`,
      );
    }
    lines.push("class VeryDeep {");
    lines.push("  accessor root: L0 = null as unknown as L0;");
    lines.push("}");
    const code = blocksFor(lines.join("\n"))[0]!.code;
    expect(code).toContain('"value":"string"');
    expect(code).not.toMatch(/const lazy(\d+) = \["lazy",\(\)=>lazy\1\]/);
  });

  it("сохраняет CRLF в вставляемом блоке", () => {
    const source = 'class Crlf {\r\n  accessor name: string = "";\r\n}\r\n';
    const blocks = blocksFor(source);
    expect(blocks).toHaveLength(1);
    expect(applyBlocks(source, blocks)).toBe(
      "class Crlf {\r\n"
      + '  accessor name: string = "";\r\n'
      + "  static {\r\n"
      + '    this[Symbol.for("silent.validation.schema")] = { version: 1, fields: { "name": "string" } };\r\n'
      + "  }\r\n"
      + "}\r\n",
    );
  });
});
