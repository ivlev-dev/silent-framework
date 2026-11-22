import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import ts from "typescript";
import { validate } from "@ivlev-dev/silent-validation";
import { generateValidationBlocks, schemaHasClassRef } from "../src/typegen.js";
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
  types: ["node"],
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

function execute(applied: string, names: readonly string[]): Readonly<Record<string, unknown>> {
  const js = ts.transpileModule(applied, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      useDefineForClassFields: true,
    },
  }).outputText;
  const exports: Record<string, unknown> = {};
  const module = { exports };
  const assignments = names
    .map((name) => `${JSON.stringify(name)}: typeof ${name} === "undefined" ? undefined : ${name}`)
    .join(", ");
  const factory = new Function(
    "exports",
    "module",
    `${js}\nmodule.exports = Object.assign({}, module.exports, { ${assignments} });\n`,
  );
  factory(exports, module);
  const result: Record<string, unknown> = {};
  for (const name of names) {
    const value = module.exports[name];
    if (value === undefined) {
      throw new Error(`не удалось получить ${name} из выполненного модуля`);
    }
    result[name] = value;
  }
  return result;
}

function executeSource(source: string, names: readonly string[]): Readonly<Record<string, unknown>> {
  return execute(applyBlocks(source, blocksFor(source)), names);
}

function executeDefault(applied: string): unknown {
  const js = ts.transpileModule(applied, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      useDefineForClassFields: true,
    },
  }).outputText;
  const exports: Record<string, unknown> = {};
  const module = { exports };
  const factory = new Function("exports", "module", `${js}\n`);
  factory(exports, module);
  return module.exports.default;
}

function runtimeRefWithExpressionNames(symbol: ts.Symbol): string {
  for (const declaration of symbol.declarations ?? []) {
    if (!ts.isClassExpression(declaration) || declaration.name !== undefined) {
      continue;
    }
    const parent = declaration.parent;
    if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
      return parent.name.text;
    }
    if (ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) {
      return parent.name.text;
    }
    if (ts.isExportAssignment(parent)) {
      return "default";
    }
  }
  return runtimeRefName(symbol);
}

function executeWithRuntimeRef(
  source: string,
  names: readonly string[],
  runtimeRef: (symbol: ts.Symbol) => string,
): Readonly<Record<string, unknown>> {
  return execute(applyBlocks(source, blocksWithRuntimeRef(source, runtimeRef)), names);
}

function qualifiedName(symbol: ts.Symbol): string {
  const parts: string[] = [];
  let node: ts.Node | undefined = symbol.valueDeclaration ?? symbol.declarations?.[0];
  while (node !== undefined && !ts.isSourceFile(node)) {
    if (ts.isModuleDeclaration(node) && ts.isIdentifier(node.name)) {
      parts.unshift(node.name.text);
    } else if (
      (ts.isClassDeclaration(node) || ts.isClassExpression(node))
      && node.name !== undefined
    ) {
      parts.unshift(node.name.text);
    }
    node = node.parent;
  }
  return parts.length > 0 ? parts.join(".") : symbol.getName();
}

function blocksWithRuntimeRef(
  source: string,
  runtimeRef: (symbol: ts.Symbol) => string,
): readonly ValidationBlock[] {
  const { sourceFile, checker } = programFor(source);
  return generateValidationBlocks({ sourceFile, checker, runtimeRef });
}

function executeWithQualifiedRefs(
  source: string,
  names: readonly string[],
): Readonly<Record<string, unknown>> {
  const blocks = blocksWithRuntimeRef(source, qualifiedName);
  return execute(applyBlocks(source, blocks), names);
}

interface Constructed {
  new (): object;
}

function entity(
  ctor: unknown,
  values: Readonly<Record<string, unknown>>,
): object {
  const instance = new (ctor as Constructed)();
  Object.assign(instance, values);
  return instance;
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
      + '"tuple": ["tuple",["string",["optional","number"]]], "record": ["record","boolean"], '
      + '"dictionary": ["record","date"], "map": ["mapof","string","number"], '
      + '"set": ["setof","string"], "readonlyMap": ["mapof","string","number"], '
      + '"readonlySet": ["setof","string"], "weakMap": "weakmap", '
      + '"weakSet": "weakset", "promise": "promise"',
    );
  });

  it("сериализует Record с литеральными ключами как object", () => {
    const fields = fieldsFor(`
class RecordKeys {
  accessor statuses: Record<"draft" | "published", number> = { draft: 0, published: 0 };
  accessor single: Record<"only", string> = { only: "" };
  accessor numeric: Record<1 | 2, boolean> = { 1: true, 2: false };
  accessor dynamic: Record<string, number> = {};
  accessor numericDynamic: Record<number, number> = {};
}
`);
    expect(fields).toBe(
      '"statuses": ["object",{"draft":"number","published":"number"}], '
      + '"single": ["object",{"only":"string"}], '
      + '"numeric": ["object",{"1":"boolean","2":"boolean"}], '
      + '"dynamic": ["record","number"], "numericDynamic": ["record","number"]',
    );
  });

  it("валидирует Record с литеральными ключами как объект с обязательными полями", () => {
    const source = `
class KeyedRecord {
  accessor statuses: Record<"draft" | "published", number> = { draft: 0, published: 0 };
}
`;
    const { KeyedRecord } = executeSource(source, ["KeyedRecord"]);
    expect(validate(entity(KeyedRecord, {
      statuses: { draft: 1, published: 2 },
    })).valid).toBe(true);
    expect(validate(entity(KeyedRecord, {
      statuses: { draft: 1 },
    })).valid).toBe(false);
    expect(validate(entity(KeyedRecord, {
      statuses: { draft: 1, published: "x" },
    })).valid).toBe(false);
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
      + '"optionalRest": ["tuple",["string",["optional","number"]],"boolean"], '
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
      '"tuple": ["tuple",["string",["optional","number"]]], "readonlyTuple": ["tuple",["string","number"]]',
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

  it("не читает встроенные имена из прототипа", () => {
    const fields = fieldsFor(`
class Proto {
  accessor value: Object["valueOf"] = Object.prototype.valueOf;
  accessor text: Object["toString"] = Object.prototype.toString;
  accessor ctor: Object["constructor"] = Object;
}
`);
    expect(fields).not.toContain("undefined");
    expect(fields).toContain('"value": "function"');
    expect(fields).toContain('"text": "function"');
  });

  it("сериализует Buffer как uint8array без структурного разворота", () => {
    const fields = fieldsFor(`
class BufferHolder {
  accessor data: Buffer = Buffer.from("");
}
`);
    expect(fields).toBe('"data": "uint8array"');
  });

  it("сериализует класс с базой Uint8Array как uint8array", () => {
    const fields = fieldsFor(`
class Bytes extends Uint8Array {}
class BytesHolder {
  accessor data: Bytes = new Bytes();
}
`, 0);
    expect(fields).toBe('"data": "uint8array"');
  });

  it("сериализует Partial структурно с optional-полями", () => {
    const fields = fieldsFor(`
class PartialHolder {
  accessor data: Partial<{ a: string; b: number }> = {};
}
`);
    expect(fields).toBe('"data": ["object",{"a":["optional","string"],"b":["optional","number"]}]');
  });

  it("сериализует lib-утилиты структурно, а не как object", () => {
    const fields = fieldsFor(`
class Utilities {
  accessor picked: Pick<{ a: string; b: number }, "a"> = { a: "" };
  accessor omitted: Omit<{ a: string; b: number }, "a"> = { b: 0 };
  accessor required: Required<{ a?: string }> = { a: "" };
  accessor readonly: Readonly<{ a: string }> = { a: "" };
  accessor list: ArrayLike<string> = [];
  accessor thenable: PromiseLike<string> = Promise.resolve("");
  accessor generator: Generator<number> = (function* () {})();
  accessor iterator: IterableIterator<number> = [][Symbol.iterator]();
}
`);
    expect(fields).toContain('"picked": ["object",{"a":"string"}]');
    expect(fields).toContain('"omitted": ["object",{"b":"number"}]');
    expect(fields).toContain('"required": ["object",{"a":"string"}]');
    expect(fields).toContain('"readonly": ["object",{"a":"string"}]');
    expect(fields).toContain('"list": ["union",[["array","string"],["object",{"length":"number"}]]]');
    expect(fields).not.toContain('"thenable": "object"');
    expect(fields).not.toContain('"generator": "object"');
    expect(fields).not.toContain('"iterator": "object"');
  });

  it("не помечает Promise, Iterable и Weak-коллекции с недоступным классом", () => {
    const blocks = blocksWithRuntimeRef(`
class Money {
  accessor amount: number = 0;
}

class Wallet {
  accessor direct: Money = new Money();
  accessor promised: Promise<Money> = Promise.resolve(new Money());
  accessor iterable: Iterable<Money> = [];
  accessor weak: WeakMap<Money, string> = new WeakMap();
  accessor weakSet: WeakSet<Money> = new WeakSet();
  accessor mapped: Map<string, Money> = new Map();
}
`, (symbol) => (symbol.getName() === "Money" ? "undefined" : symbol.getName()));
    const wallet = blocks.find((block) => block.fields?.has("direct") === true);
    expect(wallet).toBeDefined();
    const unavailable = new Set(wallet!.unavailableFields ?? []);
    expect(unavailable.has("direct")).toBe(true);
    expect(unavailable.has("mapped")).toBe(true);
    expect(unavailable.has("promised")).toBe(false);
    expect(unavailable.has("iterable")).toBe(false);
    expect(unavailable.has("weak")).toBe(false);
    expect(unavailable.has("weakSet")).toBe(false);
    expect(schemaHasClassRef(wallet!.fields!.get("direct")!)).toBe(true);
    expect(schemaHasClassRef(wallet!.fields!.get("promised")!)).toBe(false);
  });

  it("не создаёт дублирующиеся record-ветки intersection", () => {
    const fields = fieldsFor(`
interface A {
  [key: string]: string;
}

interface B {
  [key: string]: string;
}

class Records {
  accessor value: A & B = {};
}
`);
    expect(fields).toBe('"value": ["record","string"]');
  });

  it("диагностирует symbol-свойства и не-Identifier accessor'ы", () => {
    const messages: string[] = [];
    const { sourceFile, checker } = programFor(`
const key = Symbol("key");

interface Tagged {
  [key]: string;
  label: string;
}

class Hidden {
  accessor [key]: string = "";
  accessor "a-b": number = 0;
  accessor ok: string = "";
  accessor tagged: Tagged = { label: "" };
}
`);
    const blocks = generateValidationBlocks({
      sourceFile,
      checker,
      runtimeRef: (symbol) => symbol.getName(),
      diagnostics: (message) => messages.push(message),
    });
    expect(blocks[0]!.code).toContain('"ok": "string"');
    expect(messages.some((message) => message.includes("Hidden.[key]") && message.includes("пропущено"))).toBe(true);
    expect(messages.some((message) => message.includes("Hidden.a-b") && message.includes("пропущено"))).toBe(true);
    expect(messages.some((message) => message.includes("символьное свойство"))).toBe(true);
  });

  it("бросает ошибку на не-Identifier accessor в strict-режиме", () => {
    const { sourceFile, checker } = programFor(`
const key = Symbol("key");
class StrictHidden {
  accessor [key]: string = "";
}
`);
    expect(() => generateValidationBlocks({
      sourceFile,
      checker,
      runtimeRef: (symbol) => symbol.getName(),
      strict: true,
    })).toThrow(/StrictHidden\.\[key\].*пропущено/);
  });

  it("деградирует контейнеры с unknown, не теряя поле", () => {
    const fields = fieldsFor(`
class Unknowns {
  accessor mapped: Map<string, unknown> = new Map();
  accessor set: Set<unknown> = new Set();
  accessor list: Array<unknown> = [];
  accessor record: Record<string, unknown> = {};
}
`);
    expect(fields).toBe(
      '"mapped": "map", "set": "set", '
      + '"list": ["array",["union",["string","number","boolean","bigint","symbol","object","function","undefined","null"]]], '
      + '"record": ["record",["union",["string","number","boolean","bigint","symbol","object","function","undefined","null"]]]',
    );
  });

  it("диагностирует generic-элементы контейнеров в обычном режиме", () => {
    const messages: string[] = [];
    const { sourceFile, checker } = programFor(`
class Generic<T> {
  accessor list: T[] = [];
  accessor set: Set<T> = new Set();
  accessor map: Map<string, T> = new Map();
  accessor record: Record<string, T> = {};
}
`);
    const blocks = generateValidationBlocks({
      sourceFile,
      checker,
      runtimeRef: (symbol) => symbol.getName(),
      diagnostics: (message) => messages.push(message),
    });
    expect(blocks).toHaveLength(1);
    expect(messages).toHaveLength(4);
    expect(messages.every((message) => message.includes("тип T не поддерживается"))).toBe(true);
    expect(messages.map((message) => message.match(/Generic\.(\w+):/)?.[1]))
      .toEqual(["list", "set", "map", "record"]);
    const code = blocks[0]!.code;
    expect(code).toContain('"list": ["array",');
    expect(code).toContain('"set": "set"');
    expect(code).toContain('"map": "map"');
    expect(code).toContain('"record": ["record",["union",');
  });

  it.each([
    ["list", "accessor list: T[] = [];", "Generic.list"],
    ["set", "accessor set: Set<T> = new Set();", "Generic.set"],
    ["map", "accessor map: Map<string, T> = new Map();", "Generic.map"],
    ["record", "accessor record: Record<string, T> = {};", "Generic.record"],
  ])("бросает ошибку в strict-режиме для generic-контейнера %s", (_name, member, path) => {
    const { sourceFile, checker } = programFor(`
class Generic<T> {
  ${member}
}
`);
    expect(() => generateValidationBlocks({
      sourceFile,
      checker,
      runtimeRef: (symbol) => symbol.getName(),
      strict: true,
    })).toThrow(new RegExp(`${path}: тип T не поддерживается`));
  });

  it("заменяет небезопасную ссылку на класс на undefined с диагностикой", () => {
    const messages: string[] = [];
    const { sourceFile, checker } = programFor(`
class Money {}
class Wallet {
  accessor money: Money = new Money();
  accessor name: string = "";
}
`);
    const blocks = generateValidationBlocks({
      sourceFile,
      checker,
      runtimeRef: () => "alias.a-b",
      diagnostics: (message) => messages.push(message),
    });
    expect(blocks).toHaveLength(1);
    expect(messages.some((message) => message.includes("не является корректным идентификатором"))).toBe(true);
    expect(blocks[0]!.code).toContain('"money": ["class",()=>undefined]');
    expect(blocks[0]!.code).toContain('"name": "string"');
    expect(blocks[0]!.code).not.toContain("alias.a-b");
  });

  it("превращает числовой index signature в record", () => {
    const fields = fieldsFor(`
interface NumericIndex {
  [index: number]: string;
}

class NumericIndexHolder {
  accessor value: NumericIndex = {};
}
`);
    expect(fields).toBe('"value": ["record","string"]');
  });

  it("исполняет сгенерированную схему для lazy-рекурсии", () => {
    const { Tree } = executeSource(`
interface LinkedNode {
  value: string;
  next: LinkedNode | null;
}

class Tree {
  accessor head: LinkedNode | null = null;
}
`, ["Tree"]);
    const valid = entity(Tree, {
      head: { value: "a", next: { value: "b", next: null } },
    });
    expect(validate(valid).valid).toBe(true);
    const invalid = entity(Tree, {
      head: { value: "a", next: { value: 1, next: null } },
    });
    expect(validate(invalid).valid).toBe(false);
  });

  it("исполняет сгенерированную схему для union", () => {
    const { Flags } = executeSource(`
class Flags {
  accessor id: string | number = "";
}
`, ["Flags"]);
    expect(validate(entity(Flags, { id: "x" })).valid).toBe(true);
    expect(validate(entity(Flags, { id: 1 })).valid).toBe(true);
    expect(validate(entity(Flags, { id: true })).valid).toBe(false);
  });

  it("исполняет сгенерированную схему для optional-кортежа", () => {
    const source = `
class Box {
  accessor pair: [string, number?] = ["a"];
  accessor rest: [string, number?, ...boolean[]] = ["a"];
}
`;
    const blocks = blocksWithRuntimeRef(source, (symbol) => symbol.getName());
    const pair = blocks[0]!.fields?.get("pair");
    const rest = blocks[0]!.fields?.get("rest");
    expect(pair?.kind).toBe("tuple");
    expect(rest?.kind).toBe("tuple");
    if (pair?.kind === "tuple") {
      expect(pair.elements[1]).toEqual({ kind: "optional", inner: { kind: "primitive", name: "number" } });
    }
    if (rest?.kind === "tuple") {
      expect(rest.elements[1]).toEqual({ kind: "optional", inner: { kind: "primitive", name: "number" } });
      expect(rest.rest).toEqual({ kind: "primitive", name: "boolean" });
    }
    const { Box } = executeSource(source, ["Box"]);
    expect(validate(entity(Box, { pair: ["a", 1], rest: ["a", 1, true] })).valid).toBe(true);
    expect(validate(entity(Box, { pair: ["a", "bad"] })).valid).toBe(false);
  });

  it("исполняет сгенерированную схему для Partial", () => {
    const { PartialProfile } = executeSource(`
class PartialProfile {
  accessor data: Partial<{ a: string; b: number }> = {};
}
`, ["PartialProfile"]);
    expect(validate(entity(PartialProfile, { data: { a: "x" } })).valid).toBe(true);
    expect(validate(entity(PartialProfile, { data: { b: 1 } })).valid).toBe(true);
    expect(validate(entity(PartialProfile, { data: { a: 1 } })).valid).toBe(false);
  });

  it("исполняет сгенерированную схему для class expression", () => {
    const { Inline } = executeSource(
      "const Inline = class {\n  accessor n: number = 0;\n};\n",
      ["Inline"],
    );
    expect(validate(entity(Inline, { n: 1 })).valid).toBe(true);
    expect(validate(entity(Inline, { n: "x" })).valid).toBe(false);
  });

  it("генерирует схему для анонимного default export и class expression", () => {
    const defaultSource = [
      "class ValidationModel {}",
      "export default class extends ValidationModel {",
      '  accessor name: string = "";',
      "}",
      "",
    ].join("\n");
    const defaultBlocks = blocksFor(defaultSource);
    expect(defaultBlocks).toHaveLength(1);
    expect(defaultBlocks[0]!.className).toBe("default");
    expect(defaultBlocks[0]!.code).toContain('"name": "string"');
    const Anonymous = executeDefault(applyBlocks(defaultSource, defaultBlocks)) as Constructed;
    expect(validate(entity(Anonymous, { name: "x" })).valid).toBe(true);
    expect(validate(entity(Anonymous, { name: 1 })).valid).toBe(false);

    const propertySource = [
      "const container = {",
      "  User: class {",
      "    accessor age: number = 0;",
      "  },",
      "};",
      "",
    ].join("\n");
    const propertyBlocks = blocksFor(propertySource);
    expect(propertyBlocks).toHaveLength(1);
    expect(propertyBlocks[0]!.className).toBe("User");
    expect(propertyBlocks[0]!.code).toContain('"age": "number"');
    const { container } = executeSource(propertySource, ["container"]);
    const User = (container as { readonly User: unknown }).User;
    expect(validate(entity(User, { age: 1 })).valid).toBe(true);
    expect(validate(entity(User, { age: "x" })).valid).toBe(false);

    const arraySource = "const classes = [class {\n  accessor size: number = 0;\n}];\n";
    const arrayBlocks = blocksFor(arraySource);
    expect(arrayBlocks).toHaveLength(1);
    expect(arrayBlocks[0]!.className).toBe("class");
    expect(arrayBlocks[0]!.code).toContain('"size": "number"');
    const { classes } = executeSource(arraySource, ["classes"]);
    const Inline = (classes as readonly unknown[])[0];
    expect(validate(entity(Inline, { size: 1 })).valid).toBe(true);
    expect(validate(entity(Inline, { size: "x" })).valid).toBe(false);
  });

  it("исполняет схему для InstanceType анонимного класса", () => {
    const source = [
      "const AnonymousClass = class {",
      "  accessor id: number = 0;",
      "};",
      "",
      "class Holder {",
      "  accessor item: InstanceType<typeof AnonymousClass> = new AnonymousClass();",
      "}",
      "",
    ].join("\n");
    const { AnonymousClass, Holder } = executeWithRuntimeRef(
      source,
      ["AnonymousClass", "Holder"],
      runtimeRefWithExpressionNames,
    );
    expect(validate(entity(Holder, { item: entity(AnonymousClass, { id: 1 }) })).valid).toBe(true);
    expect(validate(entity(Holder, { item: {} })).valid).toBe(false);
  });

  it("не создаёт невыполнимую схему для ArrayLike", () => {
    const source = [
      "class ArrayLikeHolder {",
      "  accessor list: ArrayLike<string> = [];",
      "  accessor numeric: { length: number; [index: number]: string } = { length: 0 };",
      "}",
      "",
    ].join("\n");
    const fields = fieldsFor(source);
    expect(fields).toBe(
      '"list": ["union",[["array","string"],["object",{"length":"number"}]]], '
      + '"numeric": ["object",{"length":"number"}]',
    );
    const { ArrayLikeHolder } = executeSource(source, ["ArrayLikeHolder"]);
    expect(validate(entity(ArrayLikeHolder, {
      list: ["a", "b"],
      numeric: { 0: "a", length: 1 },
    })).valid).toBe(true);
    expect(validate(entity(ArrayLikeHolder, {
      list: { 0: "a", length: 1 },
      numeric: { length: 1 },
    })).valid).toBe(true);
    const invalidElement = validate(entity(ArrayLikeHolder, {
      list: ["a", 2],
      numeric: { 0: "a", length: 1 },
    }));
    expect(invalidElement.valid).toBe(false);
    expect(invalidElement.errors.some((error) => error.field === "length")).toBe(false);
    expect(validate(entity(ArrayLikeHolder, {
      list: [],
      numeric: { length: "x" },
    })).valid).toBe(false);
  });

  it("не разворачивает интерфейсы с DOM и стандартными базами", () => {
    const fields = fieldsFor(`
interface MyEl extends HTMLElement { extra: string }
interface MyDate extends Date { extra: string }
interface MyMap extends Map<string, number> { extra: string }
class BaseHolder {
  accessor el: MyEl = null as unknown as MyEl;
  accessor date: MyDate = null as unknown as MyDate;
  accessor map: MyMap = null as unknown as MyMap;
}
`);
    expect(fields).toBe('"el": "object", "date": "date", "map": "map"');
    expect(fields.length).toBeLessThan(200);
  });

  it("сериализует классы из @types/node как class", () => {
    const fields = projectFieldsFor(
      {
        "main.ts": [
          'import type { Stats } from "node:fs";',
          'import type { EventEmitter } from "node:events";',
          "",
          "class NodeHolder {",
          "  accessor stats: Stats = null as unknown as Stats;",
          "  accessor emitter: EventEmitter = null as unknown as EventEmitter;",
          "}",
          "",
        ].join("\n"),
      },
      "main.ts",
    );
    expect(fields).toBe('"stats": ["class",()=>Stats], "emitter": ["class",()=>EventEmitter]');
  });

  it("не добавляет глобальные сегменты для declare global и declare class", () => {
    const { sourceFile, checker } = programFor(`
declare global {
  class GlobalThing {
    accessor value: string;
  }
}

declare class AmbientThing {}

export {};

class GlobalHolder {
  accessor thing: GlobalThing = null as unknown as GlobalThing;
  accessor ambient: AmbientThing = null as unknown as AmbientThing;
  accessor name: string = "";
}
`);
    const blocks = generateValidationBlocks({
      sourceFile,
      checker,
      runtimeRef: (symbol) => symbol.getName(),
    });
    expect(blocks).toHaveLength(1);
    const block = blocks[0]!;
    expect(block.className).toBe("GlobalHolder");
    expect(block.code).not.toContain("global.");
    expect(block.code).toContain('"name": "string"');
    expect(block.code).toContain('"thing": ["class",()=>undefined]');
    expect(block.code).toContain('"ambient": ["class",()=>undefined]');
    expect(block.unavailableFields).toEqual(["thing", "ambient"]);
  });

  it("сохраняет поле __proto__ в схеме и исполняет его", () => {
    const source = [
      "interface ProtoShape {",
      "  __proto__: string;",
      "  name: string;",
      "}",
      "",
      "class ProtoHolder {",
      '  accessor __proto__: string = "";',
      '  accessor data: ProtoShape = { ["__proto__"]: "x", name: "" };',
      "}",
      "",
    ].join("\n");
    const blocks = blocksFor(source);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.code).toContain('["__proto__"]: "string"');
    expect(blocks[0]!.code).toContain('["object",{["__proto__"]:"string","name":"string"}]');
    const { ProtoHolder } = executeSource(source, ["ProtoHolder"]);
    const valid = entity(ProtoHolder, { name: "n" });
    Object.defineProperty(valid, "__proto__", {
      value: "x",
      enumerable: true,
      configurable: true,
      writable: true,
    });
    expect(validate(valid).valid).toBe(true);
    const invalid = entity(ProtoHolder, { name: "n" });
    Object.defineProperty(invalid, "__proto__", {
      value: 1,
      enumerable: true,
      configurable: true,
      writable: true,
    });
    expect(validate(invalid).valid).toBe(false);
  });

  it("исполняет сгенерированную схему с namespace-ссылкой", () => {
    const { Wallet, Models } = executeWithQualifiedRefs(`
namespace Models {
  export class Money {
    accessor amount: number = 0;
  }
}

class Wallet {
  accessor money: Models.Money = new Models.Money();
}
`, ["Wallet", "Models"]);
    const { Money } = Models as { readonly Money: unknown };
    const valid = entity(Wallet, { money: entity(Money, { amount: 1 }) });
    expect(validate(valid).valid).toBe(true);
    const invalid = entity(Wallet, { money: {} });
    expect(validate(invalid).valid).toBe(false);
  });

  it("сохраняет CRLF и не оставляет мёртвые lazy-определения", () => {
    const source = "interface CrlfNode {\r\n  value: string;\r\n  next: CrlfNode | null;\r\n}\r\n\r\nclass CrlfLazy {\r\n  accessor root: CrlfNode | null = null;\r\n}\r\n";
    const blocks = blocksFor(source);
    expect(blocks).toHaveLength(1);
    const applied = applyBlocks(source, blocks);
    expect(applied).toContain("\r\n    const lazy0 = ");
    expect(applied.replace(/\r\n/g, "")).not.toContain("\n");
    expect(applied.match(/const lazy0/g)).toHaveLength(1);
    const names = new Set([...applied.matchAll(/\blazy\d+\b/g)].map((match) => match[0]));
    for (const name of names) {
      expect(applied.split(name).length - 1).toBeGreaterThan(1);
    }
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
