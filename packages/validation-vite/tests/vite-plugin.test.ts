import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import { setFlagsFromString } from "node:v8";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "vite";
import type { Plugin } from "vite";
import { validation } from "../src/vite.js";

interface TransformOutput {
  readonly code: string;
  readonly map: unknown;
}

type TransformHandler = (code: string, id: string) => TransformOutput | null;

interface TransformHooks {
  readonly transform?:
    | TransformHandler
    | { readonly order?: string; readonly handler: TransformHandler };
  readonly watchChange?: (id: string) => void;
}

const projects: string[] = [];

afterEach(() => {
  for (const directory of projects.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function writeValidationPackage(directory: string): void {
  const packageDirectory = path.join(
    directory,
    "node_modules",
    "@ivlev-dev",
    "silent-validation",
  );
  mkdirSync(path.join(packageDirectory, "dist"), { recursive: true });
  writeFileSync(
    path.join(packageDirectory, "package.json"),
    JSON.stringify(
      {
        name: "@ivlev-dev/silent-validation",
        version: "0.0.0",
        type: "module",
        exports: {
          ".": {
            types: "./dist/index.d.ts",
            import: "./dist/index.js",
          },
        },
      },
      null,
      2,
    ),
  );
  writeFileSync(
    path.join(packageDirectory, "dist", "model.d.ts"),
    "export declare class ValidationModel {}\n",
  );
  writeFileSync(
    path.join(packageDirectory, "dist", "index.d.ts"),
    'export { ValidationModel } from "./model.js";\n',
  );
  writeFileSync(
    path.join(packageDirectory, "dist", "model.js"),
    "export class ValidationModel {}\n",
  );
  writeFileSync(
    path.join(packageDirectory, "dist", "index.js"),
    'export { ValidationModel } from "./model.js";\n',
  );
}

function linkValidationPackage(directory: string): void {
  const packageDirectory = path.join(
    directory,
    "node_modules",
    "@ivlev-dev",
    "silent-validation",
  );
  mkdirSync(path.dirname(packageDirectory), { recursive: true });
  const source = path.resolve(import.meta.dirname, "../../validation");
  symlinkSync(source, packageDirectory, "dir");
}

function createProject(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "silent-validation-vite-"));
  projects.push(directory);
  writeValidationPackage(directory);
  writeFileSync(
    path.join(directory, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler",
          strict: true,
          experimentalDecorators: false,
          useDefineForClassFields: true,
          noEmit: true,
        },
        include: ["*.ts"],
      },
      null,
      2,
    ),
  );
  writeFileSync(
    path.join(directory, "base.ts"),
    [
      'import { ValidationModel } from "@ivlev-dev/silent-validation";',
      "",
      "export class Base extends ValidationModel {}",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(directory, "b.ts"),
    [
      'import { Base } from "./base";',
      "",
      "export class Address extends Base {",
      '  accessor street: string = "";',
      "}",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(directory, "a.ts"),
    [
      'import type { Address } from "./b";',
      'import { ValidationModel } from "@ivlev-dev/silent-validation";',
      "",
      "export enum Role {",
      '  Admin = "admin",',
      '  User = "user",',
      "}",
      "",
      "export class User extends ValidationModel {",
      '  accessor name: string = "";',
      "  accessor age: number = 0;",
      "  accessor role: Role = Role.User;",
      "  accessor address: Address | null = null;",
      "}",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(directory, "plain.ts"),
    'export const value: string = "x";\n',
  );
  writeFileSync(
    path.join(directory, "main.ts"),
    [
      'import { User } from "./a";',
      "",
      "const user = new User();",
      'user.name = "name";',
      "console.log(user);",
      "",
    ].join("\n"),
  );
  return directory;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getTransform(plugin: Plugin): TransformHandler {
  const hooks = plugin as unknown as TransformHooks;
  const transform = hooks.transform;
  if (typeof transform === "function") {
    return transform;
  }
  if (transform !== undefined && typeof transform.handler === "function") {
    return transform.handler;
  }
  throw new Error("Плагин validation() не предоставляет transform");
}

function getWatchChange(plugin: Plugin): (id: string) => void {
  const hooks = plugin as unknown as TransformHooks;
  const watchChange = hooks.watchChange;
  if (typeof watchChange !== "function") {
    throw new Error("Плагин validation() не предоставляет watchChange");
  }
  return watchChange;
}

function outputCode(result: unknown): string {
  const outputs = Array.isArray(result) ? (result as readonly unknown[]) : [result];
  const chunks: string[] = [];
  for (const output of outputs) {
    if (!isRecord(output) || !Array.isArray(output.output)) continue;
    for (const item of output.output) {
      if (!isRecord(item)) continue;
      if (item.type === "chunk" && typeof item.code === "string") {
        chunks.push(item.code);
      }
    }
  }
  return chunks.join("\n");
}

const buildProject = async (
  directory: string,
  plugins: readonly Plugin[],
  entry = "main.ts",
  target = "esnext",
): Promise<string> => {
  const result: unknown = await build({
    root: directory,
    configFile: false,
    logLevel: "silent",
    plugins: [...plugins],
    build: {
      write: false,
      minify: false,
      target,
      rollupOptions: {
        input: path.join(directory, entry),
      },
    },
  });
  return outputCode(result);
};

function parseDiagnostics(code: string): readonly ts.Diagnostic[] {
  const result = ts.transpileModule(code, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
    reportDiagnostics: true,
  });
  return result.diagnostics ?? [];
}

function forceGarbageCollection(): void {
  setFlagsFromString("--expose-gc");
  const gc = runInNewContext("gc") as (() => void) | undefined;
  gc?.();
  gc?.();
}

describe("validation()", () => {
  it("вставляет схему из типов и namespace-импорт внешнего класса", () => {
    const directory = createProject();
    const plugin = validation();
    const file = path.join(directory, "a.ts");
    const source = readFileSync(file, "utf8");
    const result = getTransform(plugin)(source, file);
    expect(result).not.toBeNull();
    const transformed = result as TransformOutput;
    expect(transformed.map).toBeTruthy();
    expect(transformed.code).toMatch(/Symbol\.for\(["']silent\.validation\.schema["']\)/);
    expect(transformed.code).toMatch(/["']name["']\s*:/);
    expect(transformed.code).toMatch(/["']role["']\s*:/);
    expect(transformed.code).toMatch(/["']number["']/);
    expect(transformed.code).toMatch(/["']enum["']/);
    expect(transformed.code).toMatch(
      /import \* as __silent_validation_\d+ from ["']\.\/b["'];/,
    );
    expect(transformed.code).toMatch(/__silent_validation_\d+\.Address/);
  });

  it("не генерирует схему для класса без базового ValidationModel", () => {
    const directory = createProject();
    writeFileSync(
      path.join(directory, "other.ts"),
      ["export class Other {", '  accessor value: string = "";', "}", ""].join("\n"),
    );
    const plugin = validation();
    const file = path.join(directory, "other.ts");
    const result = getTransform(plugin)(readFileSync(file, "utf8"), file);
    expect(result).toBeNull();
  });

  it("не меняет код файла без accessor-полей", () => {
    const directory = createProject();
    const plugin = validation();
    const file = path.join(directory, "plain.ts");
    const result = getTransform(plugin)(readFileSync(file, "utf8"), file);
    expect(result).toBeNull();
  });

  it("не дублирует импорты при повторном transform", () => {
    const directory = createProject();
    const plugin = validation();
    const file = path.join(directory, "a.ts");
    const source = readFileSync(file, "utf8");
    const transform = getTransform(plugin);
    const first = transform(source, file);
    const second = transform(source, file);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect((second as TransformOutput).code).toBe((first as TransformOutput).code);
    const imports = (first as TransformOutput).code.match(
      /import \* as __silent_validation_\d+ from ["']\.\/b["'];/g,
    );
    expect(imports).toHaveLength(1);
  });

  it("не генерирует схему для чужого класса ValidationModel при найденном символе пакета", () => {
    const directory = createProject();
    writeFileSync(
      path.join(directory, "foreign.ts"),
      [
        "class ValidationModel {}",
        "",
        "class ForeignBase extends ValidationModel {}",
        "",
        "export class ForeignChild extends ForeignBase {",
        '  accessor value: string = "";',
        "}",
        "",
      ].join("\n"),
    );
    const plugin = validation();
    const file = path.join(directory, "foreign.ts");
    const result = getTransform(plugin)(readFileSync(file, "utf8"), file);
    expect(result).toBeNull();
  });

  it("распознаёт базовый класс через алиас и namespace-импорт", () => {
    const directory = createProject();
    writeFileSync(
      path.join(directory, "alias.ts"),
      [
        'import { ValidationModel as Base } from "@ivlev-dev/silent-validation";',
        "",
        "export class Aliased extends Base {",
        "  accessor id: number = 0;",
        "}",
        "",
      ].join("\n"),
    );
    writeFileSync(
      path.join(directory, "namespace.ts"),
      [
        'import * as validation from "@ivlev-dev/silent-validation";',
        "",
        "export class Namespaced extends validation.ValidationModel {",
        "  accessor flag: boolean = false;",
        "}",
        "",
      ].join("\n"),
    );
    const plugin = validation();
    const transform = getTransform(plugin);
    const aliased = transform(
      readFileSync(path.join(directory, "alias.ts"), "utf8"),
      path.join(directory, "alias.ts"),
    ) as TransformOutput | null;
    const namespaced = transform(
      readFileSync(path.join(directory, "namespace.ts"), "utf8"),
      path.join(directory, "namespace.ts"),
    ) as TransformOutput | null;
    expect(aliased).not.toBeNull();
    expect(aliased?.code).toMatch(/["']id["']\s*:/);
    expect(namespaced).not.toBeNull();
    expect(namespaced?.code).toMatch(/["']flag["']\s*:/);
  });

  it("поддерживает default-экспорт, реэкспорт и type-only enum", () => {
    const directory = createProject();
    writeFileSync(
      path.join(directory, "inner.ts"),
      [
        "export default class DefaultInner {",
        "  accessor flag: boolean = false;",
        "}",
        "",
        "export class NamedInner {",
        "  accessor id: number = 0;",
        "}",
        "",
      ].join("\n"),
    );
    writeFileSync(
      path.join(directory, "barrel.ts"),
      'export { NamedInner as Reexported } from "./inner";\n',
    );
    writeFileSync(
      path.join(directory, "roles.ts"),
      [
        "export enum Status {",
        '  Active = "active",',
        '  Blocked = "blocked",',
        "}",
        "",
      ].join("\n"),
    );
    const file = path.join(directory, "holder.ts");
    writeFileSync(
      file,
      [
        'import DefaultInner from "./inner";',
        'import { Reexported } from "./barrel";',
        'import type { Status } from "./roles";',
        'import { ValidationModel } from "@ivlev-dev/silent-validation";',
        "",
        "export class Holder extends ValidationModel {",
        "  accessor defaulted: DefaultInner = new DefaultInner();",
        "  accessor reexported: Reexported = new Reexported();",
        '  accessor status: Status = "active" as Status;',
        "}",
        "",
      ].join("\n"),
    );
    const result = getTransform(validation())(readFileSync(file, "utf8"), file);
    expect(result).not.toBeNull();
    const code = (result as TransformOutput).code;
    expect(code).toMatch(/["']defaulted["']\s*:\s*\["class",\(\)=>DefaultInner\]/);
    expect(code).toMatch(/["']reexported["']\s*:\s*\["class",\(\)=>Reexported\]/);
    expect(code).toMatch(/\["enum",\["active","blocked"\]\]/);
    expect(code).not.toMatch(/__silent_validation_\d+/);
  });

  it("предупреждает о неподдерживаемом типе и бросает в strict-режиме", () => {
    const directory = createProject();
    const file = path.join(directory, "unsupported.ts");
    writeFileSync(
      file,
      [
        'import { ValidationModel } from "@ivlev-dev/silent-validation";',
        "",
        "export class Unsupported extends ValidationModel {",
        "  accessor data: unknown = undefined;",
        '  accessor name: string = "";',
        "}",
        "",
      ].join("\n"),
    );
    const source = readFileSync(file, "utf8");
    const transform = getTransform(validation());
    const warnings: string[] = [];
    const result = transform.call(
      { warn: (message: string) => warnings.push(message) },
      source,
      file,
    );
    expect(result).not.toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Unsupported.data");
    expect(warnings[0]).toContain("не поддерживается");
    expect((result as TransformOutput).code).toMatch(/["']name["']\s*:/);
    expect((result as TransformOutput).code).not.toMatch(/["']data["']\s*:/);

    const strictTransform = getTransform(validation({ strict: true }));
    expect(() => strictTransform(source, file)).toThrow(
      /Unsupported\.data: тип unknown не поддерживается/,
    );
  });

  it("использует fallback по имени, если символ пакета не найден", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "silent-validation-vite-"));
    projects.push(directory);
    writeFileSync(
      path.join(directory, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            module: "ESNext",
            moduleResolution: "Bundler",
            strict: true,
            experimentalDecorators: false,
            useDefineForClassFields: true,
            noEmit: true,
          },
          include: ["*.ts"],
        },
        null,
        2,
      ),
    );
    const file = path.join(directory, "local.ts");
    writeFileSync(
      file,
      [
        "class ValidationModel {}",
        "",
        "export class Local extends ValidationModel {",
        '  accessor value: string = "";',
        "}",
        "",
      ].join("\n"),
    );
    const result = getTransform(validation())(readFileSync(file, "utf8"), file);
    expect(result).not.toBeNull();
    expect((result as TransformOutput).code).toMatch(/["']value["']\s*:/);
  });

  it("добавляет метаданные в сборку Vite", async () => {
    const directory = createProject();
    const code = await buildProject(directory, [validation()]);
    expect(code).toMatch(/Symbol\.for\(["']silent\.validation\.schema["']\)/);
    expect(code).toMatch(/["']name["']\s*:/);
    expect(code).toMatch(/["']role["']\s*:/);
    expect(code).toMatch(/["']number["']/);
  });

  it("без плагина метаданных нет", async () => {
    const directory = createProject();
    const code = await buildProject(directory, []);
    expect(code).not.toMatch(/Symbol\.for\(["']silent\.validation\.schema["']\)/);
  });

  it("пропускает ?raw и не изменяет raw-модуль", async () => {
    const directory = createProject();
    writeFileSync(
      path.join(directory, "raw-model.ts"),
      [
        'import { ValidationModel } from "@ivlev-dev/silent-validation";',
        "",
        "export class RawModel extends ValidationModel {",
        '  accessor name: string = "";',
        "}",
        "",
      ].join("\n"),
    );
    writeFileSync(
      path.join(directory, "raw-main.ts"),
      [
        'import raw from "./raw-model.ts?raw";',
        "",
        "console.log(raw);",
        "",
      ].join("\n"),
    );
    const code = await buildProject(directory, [validation()], "raw-main.ts");
    expect(code).toContain("RawModel");
    expect(code).not.toMatch(/Symbol\.for\(["']silent\.validation\.schema["']\)/);
  });

  it("пропускает поле глобального ambient-класса без рантайма и предупреждает", () => {
    const directory = createProject();
    writeFileSync(
      path.join(directory, "types.d.ts"),
      ["declare class Money {", "  amount: number;", "}", ""].join("\n"),
    );
    const file = path.join(directory, "wallet.ts");
    writeFileSync(
      file,
      [
        'import { ValidationModel } from "@ivlev-dev/silent-validation";',
        "",
        "export class Wallet extends ValidationModel {",
        "  accessor money: Money = new Money();",
        '  accessor name: string = "";',
        "}",
        "",
      ].join("\n"),
    );
    const source = readFileSync(file, "utf8");
    const warnings: string[] = [];
    const result = getTransform(validation()).call(
      { warn: (message: string) => warnings.push(message) },
      source,
      file,
    );
    expect(result).not.toBeNull();
    const code = (result as TransformOutput).code;
    expect(code).toMatch(/["']name["']\s*:/);
    expect(code).not.toMatch(/["']money["']\s*:/);
    expect(code).not.toMatch(/\(\)=>Money/);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Wallet.money");
    expect(warnings[0]).toContain("недоступный в рантайме");
    const strictTransform = getTransform(validation({ strict: true }));
    expect(() => strictTransform(source, file)).toThrow(/Wallet\.money/);
  });

  it("резолвит глобальные типы из .ts без declaration-файла", () => {
    const directory = createProject();
    writeFileSync(
      path.join(directory, "globals.ts"),
      [
        "interface Money {",
        "  amount: number;",
        "}",
        "",
        "declare namespace Domain {",
        "  interface Point {",
        "    x: number;",
        "    y: number;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    const file = path.join(directory, "global-wallet.ts");
    writeFileSync(
      file,
      [
        'import { ValidationModel } from "@ivlev-dev/silent-validation";',
        "",
        "export class GlobalWallet extends ValidationModel {",
        "  accessor money: Money = { amount: 0 };",
        "  accessor point: Domain.Point = { x: 0, y: 0 };",
        "}",
        "",
      ].join("\n"),
    );
    const result = getTransform(validation())(readFileSync(file, "utf8"), file);
    expect(result).not.toBeNull();
    const code = (result as TransformOutput).code;
    expect(code).toMatch(/["']money["']\s*:\s*\["object",\{"amount":"number"\}\]/);
    expect(code).toMatch(/["']point["']\s*:\s*\["object",\{"x":"number","y":"number"\}\]/);
  });

  it("вырезает поле из declare global внутри модуля без global-ссылки", () => {
    const directory = createProject();
    writeFileSync(
      path.join(directory, "globals-module.ts"),
      [
        "export {};",
        "",
        "declare global {",
        "  class GlobalMoney {",
        "    amount: number;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    const file = path.join(directory, "global-holder.ts");
    writeFileSync(
      file,
      [
        'import { ValidationModel } from "@ivlev-dev/silent-validation";',
        "",
        "export class GlobalHolder extends ValidationModel {",
        "  accessor money: GlobalMoney = new GlobalMoney();",
        '  accessor name: string = "";',
        "}",
        "",
      ].join("\n"),
    );
    const source = readFileSync(file, "utf8");
    const warnings: string[] = [];
    const result = getTransform(validation()).call(
      { warn: (message: string) => warnings.push(message) },
      source,
      file,
    );
    expect(result).not.toBeNull();
    const code = (result as TransformOutput).code;
    expect(code).toMatch(/["']name["']\s*:/);
    expect(code).not.toMatch(/["']money["']\s*:/);
    expect(code).not.toMatch(/global\.GlobalMoney/);
    expect(code).not.toMatch(/import \* as __silent_validation_\d+ from ["']\.\/globals-module["']/);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("GlobalHolder.money");
  });

  it("добавляет импорт для ambient-модуля с рантаймом", () => {
    const directory = createProject();
    const runtimeDirectory = path.join(directory, "node_modules", "runtime-lib");
    mkdirSync(runtimeDirectory, { recursive: true });
    writeFileSync(
      path.join(runtimeDirectory, "package.json"),
      JSON.stringify({ name: "runtime-lib", type: "module", main: "index.js" }, null, 2),
    );
    writeFileSync(
      path.join(runtimeDirectory, "index.js"),
      "export class Money {}\n",
    );
    writeFileSync(
      path.join(directory, "types.d.ts"),
      [
        'declare module "runtime-lib" {',
        "  export class Money {",
        "    amount: number;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    const file = path.join(directory, "wallet.ts");
    writeFileSync(
      file,
      [
        'import type { Money } from "runtime-lib";',
        'import { ValidationModel } from "@ivlev-dev/silent-validation";',
        "",
        "export class Wallet extends ValidationModel {",
        "  accessor money: Money = null as unknown as Money;",
        "}",
        "",
      ].join("\n"),
    );
    const result = getTransform(validation())(readFileSync(file, "utf8"), file);
    expect(result).not.toBeNull();
    const code = (result as TransformOutput).code;
    expect(code).toMatch(/\["class",\(\)=>__silent_validation_\d+\.Money\]/);
    expect(code).toMatch(
      /import \* as __silent_validation_\d+ from ["']runtime-lib["'];/,
    );
  });

  it("находит рантайм для класса из отдельного пакета @types/<name>", () => {
    const directory = createProject();
    const typesDirectory = path.join(directory, "node_modules", "@types", "foo");
    mkdirSync(typesDirectory, { recursive: true });
    writeFileSync(
      path.join(typesDirectory, "index.d.ts"),
      "export declare class Foo {\n  value: string;\n}\n",
    );
    const runtimeDirectory = path.join(directory, "node_modules", "foo");
    mkdirSync(runtimeDirectory, { recursive: true });
    writeFileSync(
      path.join(runtimeDirectory, "package.json"),
      JSON.stringify({ name: "foo", type: "module", main: "index.js" }, null, 2),
    );
    writeFileSync(
      path.join(runtimeDirectory, "index.js"),
      "export class Foo {}\n",
    );
    const file = path.join(directory, "types-wallet.ts");
    writeFileSync(
      file,
      [
        'import type { Foo } from "foo";',
        'import { ValidationModel } from "@ivlev-dev/silent-validation";',
        "",
        "export class TypesWallet extends ValidationModel {",
        "  accessor foo: Foo = null as unknown as Foo;",
        "}",
        "",
      ].join("\n"),
    );
    const warnings: string[] = [];
    const result = getTransform(validation()).call(
      { warn: (message: string) => warnings.push(message) },
      readFileSync(file, "utf8"),
      file,
    );
    expect(result).not.toBeNull();
    const code = (result as TransformOutput).code;
    expect(code).toMatch(/\["class",\(\)=>__silent_validation_\d+\.Foo\]/);
    expect(code).toMatch(
      /import \* as __silent_validation_\d+ from ["']foo["'];/,
    );
    expect(warnings).toHaveLength(0);

    const source = readFileSync(file, "utf8");
    expect(() => getTransform(validation({ strict: true }))(source, file)).not.toThrow();
  });

  it("находит рантайм для scoped-класса из @types/scope__name", () => {
    const directory = createProject();
    const typesDirectory = path.join(directory, "node_modules", "@types", "scope__foo");
    mkdirSync(typesDirectory, { recursive: true });
    writeFileSync(
      path.join(typesDirectory, "index.d.ts"),
      "export declare class Foo {\n  value: string;\n}\n",
    );
    const runtimeDirectory = path.join(directory, "node_modules", "@scope", "foo");
    mkdirSync(runtimeDirectory, { recursive: true });
    writeFileSync(
      path.join(runtimeDirectory, "package.json"),
      JSON.stringify({ name: "@scope/foo", type: "module", main: "index.js" }, null, 2),
    );
    writeFileSync(
      path.join(runtimeDirectory, "index.js"),
      "export class Foo {}\n",
    );
    const file = path.join(directory, "scoped-types-wallet.ts");
    writeFileSync(
      file,
      [
        'import type { Foo } from "@scope/foo";',
        'import { ValidationModel } from "@ivlev-dev/silent-validation";',
        "",
        "export class ScopedTypesWallet extends ValidationModel {",
        "  accessor foo: Foo = null as unknown as Foo;",
        "}",
        "",
      ].join("\n"),
    );
    const warnings: string[] = [];
    const result = getTransform(validation()).call(
      { warn: (message: string) => warnings.push(message) },
      readFileSync(file, "utf8"),
      file,
    );
    expect(result).not.toBeNull();
    const code = (result as TransformOutput).code;
    expect(code).toMatch(/\["class",\(\)=>__silent_validation_\d+\.Foo\]/);
    expect(code).toMatch(
      /import \* as __silent_validation_\d+ from ["']@scope\/foo["'];/,
    );
    expect(warnings).toHaveLength(0);
  });

  it("не подставляет небезопасное строковое имя экспорта в код", () => {
    const directory = createProject();
    writeFileSync(
      path.join(directory, "string-export.ts"),
      ["class Remote {}", 'export { Remote as "remote-class" };', ""].join("\n"),
    );
    const file = path.join(directory, "string-export-holder.ts");
    writeFileSync(
      file,
      [
        'import type { "remote-class" as Remote } from "./string-export";',
        'import { ValidationModel } from "@ivlev-dev/silent-validation";',
        "",
        "export class StringExportHolder extends ValidationModel {",
        "  accessor remote: Remote = null as unknown as Remote;",
        '  accessor name: string = "";',
        "}",
        "",
      ].join("\n"),
    );
    const warnings: string[] = [];
    const result = getTransform(validation()).call(
      { warn: (message: string) => warnings.push(message) },
      readFileSync(file, "utf8"),
      file,
    );
    expect(result).not.toBeNull();
    const code = (result as TransformOutput).code;
    expect(code).not.toContain(".remote-class");
    expect(code).not.toMatch(/=>[^;\n]*remote-class/);
    expect(warnings.some((message) => message.includes("не является корректным идентификатором")))
      .toBe(true);
    expect(code).toMatch(/["']name["']\s*:/);
    const parsed = ts.createSourceFile(
      file,
      code,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const parseDiagnostics = (parsed as unknown as { parseDiagnostics?: readonly unknown[] })
      .parseDiagnostics;
    expect(parseDiagnostics ?? []).toEqual([]);
  });

  it("считает node:* рантайм-доступным ambient-модулем", () => {
    const directory = createProject();
    writeFileSync(
      path.join(directory, "types.d.ts"),
      [
        'declare module "node:events" {',
        "  export class EventEmitter {",
        "    on(): void;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    const file = path.join(directory, "emitter.ts");
    writeFileSync(
      file,
      [
        'import type { EventEmitter } from "node:events";',
        'import { ValidationModel } from "@ivlev-dev/silent-validation";',
        "",
        "export class Emitter extends ValidationModel {",
        "  accessor emitter: EventEmitter = new EventEmitter();",
        "}",
        "",
      ].join("\n"),
    );
    const result = getTransform(validation())(readFileSync(file, "utf8"), file);
    expect(result).not.toBeNull();
    const code = (result as TransformOutput).code;
    expect(code).toMatch(/\["class",\(\)=>__silent_validation_\d+\.EventEmitter\]/);
    expect(code).toMatch(
      /import \* as __silent_validation_\d+ from ["']node:events["'];/,
    );
  });

  it("не считает bare-имена только-префиксных builtin внешними модулями", () => {
    const directory = createProject();
    writeFileSync(
      path.join(directory, "types.d.ts"),
      [
        'declare module "test" {',
        "  export class TestConfig {",
        "    value: string;",
        "  }",
        "}",
        "",
        'declare module "sea" {',
        "  export class SeaConfig {",
        "    value: string;",
        "  }",
        "}",
        "",
        'declare module "sqlite" {',
        "  export class SqliteConfig {",
        "    value: string;",
        "  }",
        "}",
        "",
        'declare module "ffi" {',
        "  export class FfiConfig {",
        "    value: string;",
        "  }",
        "}",
        "",
        'declare module "node:test" {',
        "  export class NodeTestConfig {",
        "    value: string;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    const file = path.join(directory, "bare-builtins.ts");
    writeFileSync(
      file,
      [
        'import type { TestConfig } from "test";',
        'import type { SeaConfig } from "sea";',
        'import type { SqliteConfig } from "sqlite";',
        'import type { FfiConfig } from "ffi";',
        'import type { NodeTestConfig } from "node:test";',
        'import { ValidationModel } from "@ivlev-dev/silent-validation";',
        "",
        "export class BareBuiltins extends ValidationModel {",
        "  accessor test: TestConfig = null as unknown as TestConfig;",
        "  accessor sea: SeaConfig = null as unknown as SeaConfig;",
        "  accessor sqlite: SqliteConfig = null as unknown as SqliteConfig;",
        "  accessor ffi: FfiConfig = null as unknown as FfiConfig;",
        "  accessor nodeTest: NodeTestConfig = new NodeTestConfig();",
        '  accessor name: string = "";',
        "}",
        "",
      ].join("\n"),
    );
    const source = readFileSync(file, "utf8");
    const warnings: string[] = [];
    const result = getTransform(validation()).call(
      { warn: (message: string) => warnings.push(message) },
      source,
      file,
    );
    expect(result).not.toBeNull();
    const code = (result as TransformOutput).code;
    expect(code).toMatch(/["']name["']\s*:/);
    for (const field of ["test", "sea", "sqlite", "ffi"]) {
      expect(code).not.toMatch(new RegExp(`["']${field}["']\\s*:`));
    }
    expect(code).not.toMatch(/import \* as __silent_validation_\d+ from ["'](?:test|sea|sqlite|ffi)["']/);
    expect(code).toMatch(/["']nodeTest["']\s*:\s*\["class",\(\)=>__silent_validation_\d+\.NodeTestConfig\]/);
    expect(code).toMatch(/import \* as __silent_validation_\d+ from ["']node:test["']/);
    expect(warnings).toHaveLength(4);
  });

  it("пропускает поле из types-only модуля и предупреждает", async () => {
    const directory = createProject();
    writeFileSync(
      path.join(directory, "money.d.ts"),
      ["export declare class Money {", "  amount: number;", "}", ""].join("\n"),
    );
    const file = path.join(directory, "holder.ts");
    writeFileSync(
      file,
      [
        'import type { Money } from "./money";',
        'import { ValidationModel } from "@ivlev-dev/silent-validation";',
        "",
        "export class Holder extends ValidationModel {",
        "  accessor money: Money = null as unknown as Money;",
        '  accessor name: string = "";',
        "}",
        "",
      ].join("\n"),
    );
    const source = readFileSync(file, "utf8");
    const warnings: string[] = [];
    const result = getTransform(validation()).call(
      { warn: (message: string) => warnings.push(message) },
      source,
      file,
    );
    expect(result).not.toBeNull();
    const code = (result as TransformOutput).code;
    expect(code).toMatch(/["']name["']\s*:/);
    expect(code).not.toMatch(/["']money["']\s*:/);
    expect(code).not.toMatch(/import \* as __silent_validation_\d+ from ["']\.\/money["']/);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Holder.money");
    expect(warnings[0]).toContain("недоступный в рантайме");
    const strictTransform = getTransform(validation({ strict: true }));
    expect(() => strictTransform(source, file)).toThrow(/Holder\.money/);
    writeFileSync(
      path.join(directory, "main-holder.ts"),
      ['import { Holder } from "./holder";', "", "console.log(new Holder());", ""].join("\n"),
    );
    const built = await buildProject(directory, [validation()], "main-holder.ts");
    expect(built).toMatch(/["']name["']\s*:/);
  });

  it("не дублирует статический блок при повторном transform результата", () => {
    const directory = createProject();
    const plugin = validation();
    const file = path.join(directory, "a.ts");
    const source = readFileSync(file, "utf8");
    const transform = getTransform(plugin);
    const first = transform(source, file) as TransformOutput | null;
    expect(first).not.toBeNull();
    const second = transform((first as TransformOutput).code, file);
    expect(second).toBeNull();
  });

  it("два экземпляра плагина обрабатывают один и тот же модуль независимо", () => {
    const directory = createProject();
    const file = path.join(directory, "a.ts");
    const source = readFileSync(file, "utf8");
    const firstTransform = getTransform(validation());
    const secondTransform = getTransform(validation());
    const first = firstTransform(source, file) as TransformOutput | null;
    const second = secondTransform(source, file) as TransformOutput | null;
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second?.code).toBe(first?.code);
    const schemas = (first?.code.match(/Symbol\.for\(["']silent\.validation\.schema["']\)/g) ?? []);
    expect(schemas).toHaveLength(1);
    const chained = secondTransform((first as TransformOutput).code, file);
    expect(chained).toBeNull();
  });

  it("находит ValidationModel во второй копии пакета", () => {
    const directory = createProject();
    const nested = path.join(directory, "nested");
    writeValidationPackage(nested);
    const file = path.join(nested, "copy.ts");
    writeFileSync(
      file,
      [
        'import { ValidationModel } from "@ivlev-dev/silent-validation";',
        "",
        "export class Copy extends ValidationModel {",
        '  accessor value: string = "";',
        "}",
        "",
      ].join("\n"),
    );
    const result = getTransform(validation())(readFileSync(file, "utf8"), file);
    expect(result).not.toBeNull();
    expect((result as TransformOutput).code).toMatch(/["']value["']\s*:/);
  });

  it("строит квалифицированное имя класса из namespace", () => {
    const directory = createProject();
    const file = path.join(directory, "namespaced.ts");
    writeFileSync(
      file,
      [
        'import { ValidationModel } from "@ivlev-dev/silent-validation";',
        "",
        "export namespace Domain {",
        "  export class Item {",
        "    accessor id: number = 0;",
        "  }",
        "}",
        "",
        "export class Box extends ValidationModel {",
        "  accessor item: Domain.Item = new Domain.Item();",
        "}",
        "",
      ].join("\n"),
    );
    const result = getTransform(validation())(readFileSync(file, "utf8"), file);
    expect(result).not.toBeNull();
    expect((result as TransformOutput).code).toMatch(/\["class",\(\)=>Domain\.Item\]/);
  });

  it("сдвигает позиции, если код изменён до плагина", () => {
    const directory = createProject();
    const file = path.join(directory, "a.ts");
    const source = `// leading line\n${readFileSync(file, "utf8")}`;
    const result = getTransform(validation())(source, file);
    expect(result).not.toBeNull();
    const code = (result as TransformOutput).code;
    expect(code.startsWith("// leading line\n")).toBe(true);
    expect(code).toMatch(
      /import \* as __silent_validation_\d+ from ["']\.\/b["'];/,
    );
    expect(parseDiagnostics(code)).toHaveLength(0);
  });

  it("пропускает трансформацию при несовпадении кода с Program", () => {
    const directory = createProject();
    const file = path.join(directory, "a.ts");
    const source = readFileSync(file, "utf8").replace(
      "accessor age: number = 0;",
      "accessor years: number = 0;",
    );
    const warnings: string[] = [];
    const result = getTransform(validation()).call(
      { warn: (message: string) => warnings.push(message) },
      source,
      file,
    );
    expect(result).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("код изменён");
  });

  it("вставляет импорты после shebang и директив", () => {
    const directory = createProject();
    const file = path.join(directory, "directive.ts");
    writeFileSync(
      file,
      [
        "#!/usr/bin/env node",
        '"use client";',
        "",
        'import type { Address } from "./b";',
        'import { ValidationModel } from "@ivlev-dev/silent-validation";',
        "",
        "export class Directive extends ValidationModel {",
        "  accessor address: Address = null as unknown as Address;",
        "}",
        "",
      ].join("\n"),
    );
    const source = `\uFEFF${readFileSync(file, "utf8")}`;
    const result = getTransform(validation())(source, file);
    expect(result).not.toBeNull();
    const code = (result as TransformOutput).code;
    expect(code.startsWith('\uFEFF#!/usr/bin/env node\n"use client";')).toBe(true);
    const directiveIndex = code.indexOf('"use client";');
    const namespaceIndex = code.indexOf("import * as");
    const typeImportIndex = code.indexOf("import type");
    expect(namespaceIndex).toBeGreaterThan(directiveIndex);
    expect(namespaceIndex).toBeLessThan(typeImportIndex);
  });

  it("поддерживает .mts при расширенном include", () => {
    const directory = createProject();
    const file = path.join(directory, "module.mts");
    writeFileSync(
      file,
      [
        'import { ValidationModel } from "@ivlev-dev/silent-validation";',
        "",
        "export class ModuleClass extends ValidationModel {",
        '  accessor name: string = "";',
        "}",
        "",
      ].join("\n"),
    );
    const result = getTransform(validation({ include: /\.mts$/ }))(
      readFileSync(file, "utf8"),
      file,
    );
    expect(result).not.toBeNull();
    expect((result as TransformOutput).code).toMatch(/["']name["']\s*:/);
  });

  it("дедуплицирует предупреждения в рамках Program", () => {
    const directory = createProject();
    const file = path.join(directory, "warn.ts");
    writeFileSync(
      file,
      [
        'import { ValidationModel } from "@ivlev-dev/silent-validation";',
        "",
        "export class Warned extends ValidationModel {",
        "  accessor data: unknown = undefined;",
        '  accessor name: string = "";',
        "}",
        "",
      ].join("\n"),
    );
    const source = readFileSync(file, "utf8");
    const transform = getTransform(validation());
    const warnings: string[] = [];
    const context = { warn: (message: string) => warnings.push(message) };
    const first = transform.call(context, source, file);
    const second = transform.call(context, source, file);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(warnings).toHaveLength(1);
  });

  it("пересобирает Program после watchChange", () => {
    const directory = createProject();
    const plugin = validation();
    const transform = getTransform(plugin);
    const watchChange = getWatchChange(plugin);
    const file = path.join(directory, "a.ts");
    const source = readFileSync(file, "utf8");
    const first = transform(source, file);
    expect(first).not.toBeNull();
    expect((first as TransformOutput).code).not.toMatch(/["']years["']\s*:/);
    const updated = source.replace(
      "accessor age: number = 0;",
      "accessor age: number = 0;\n  accessor years: number = 0;",
    );
    writeFileSync(file, updated);
    watchChange(file);
    const second = transform(updated, file);
    expect(second).not.toBeNull();
    expect((second as TransformOutput).code).toMatch(/["']years["']\s*:/);
  });

  it("регистрирует type-only зависимости вне графа и инвалидирует их изменения", () => {
    const directory = createProject();
    writeFileSync(
      path.join(directory, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            module: "ESNext",
            moduleResolution: "Bundler",
            strict: true,
            experimentalDecorators: false,
            useDefineForClassFields: true,
            noEmit: true,
          },
          include: ["app", "types"],
        },
        null,
        2,
      ),
    );
    mkdirSync(path.join(directory, "app"), { recursive: true });
    mkdirSync(path.join(directory, "types"), { recursive: true });
    const shared = path.join(directory, "types", "shared.ts");
    writeFileSync(shared, ['export class Shared {', '  value: string = "";', "}", ""].join("\n"));
    const file = path.join(directory, "app", "model.ts");
    writeFileSync(
      file,
      [
        'import type { Shared } from "../types/shared";',
        'import { ValidationModel } from "@ivlev-dev/silent-validation";',
        "",
        "export class Model extends ValidationModel {",
        "  accessor shared: Shared = new Shared();",
        "}",
        "",
      ].join("\n"),
    );
    const plugin = validation();
    const transform = getTransform(plugin);
    const watchChange = getWatchChange(plugin);
    const source = readFileSync(file, "utf8");
    const watched: string[] = [];
    const first = transform.call(
      { warn: () => {}, addWatchFile: (id: string) => watched.push(id) },
      source,
      file,
    );
    expect(first).not.toBeNull();
    expect(watched).toContain(path.resolve(shared));
    expect(watched).toContain(path.resolve(path.join(directory, "tsconfig.json")));
    expect((first as TransformOutput).code).toMatch(
      /\["class",\(\)=>__silent_validation_\d+\.Shared\]/,
    );
    const repeated: string[] = [];
    expect(
      transform.call(
        { warn: () => {}, addWatchFile: (id: string) => repeated.push(id) },
        source,
        file,
      ),
    ).not.toBeNull();
    expect(repeated).toHaveLength(0);
    writeFileSync(shared, ["export interface Shared {", "  value: string;", "}", ""].join("\n"));
    watchChange(shared);
    const updated = transform.call(
      { warn: () => {}, addWatchFile: () => {} },
      source,
      file,
    );
    expect(updated).not.toBeNull();
    const code = (updated as TransformOutput).code;
    expect(code).toMatch(/["']shared["']\s*:\s*\["object",\{"value":"string"\}\]/);
    expect(code).not.toMatch(/__silent_validation_\d+\.Shared/);
  });

  it("генерирует схему для class expression", () => {
    const directory = createProject();
    const file = path.join(directory, "expression.ts");
    writeFileSync(
      file,
      [
        'import { ValidationModel } from "@ivlev-dev/silent-validation";',
        "",
        "const Expression = class extends ValidationModel {",
        '  accessor name: string = "";',
        "};",
        "",
        "export { Expression };",
        "",
      ].join("\n"),
    );
    const result = getTransform(validation())(readFileSync(file, "utf8"), file);
    expect(result).not.toBeNull();
    expect((result as TransformOutput).code).toMatch(/["']name["']\s*:/);
  });

  it("не проверяет поля классов, не являющихся потомками ValidationModel, в strict", () => {
    const directory = createProject();
    writeFileSync(
      path.join(directory, "types.d.ts"),
      ["declare class Money {", "  amount: number;", "}", ""].join("\n"),
    );
    const file = path.join(directory, "strict-scope.ts");
    writeFileSync(
      file,
      [
        'import { ValidationModel } from "@ivlev-dev/silent-validation";',
        "",
        "class Plain {",
        "  accessor money: Money = new Money();",
        "}",
        "",
        "export class Model extends ValidationModel {",
        '  accessor name: string = "";',
        "}",
        "",
        "export { Plain };",
        "",
      ].join("\n"),
    );
    const warnings: string[] = [];
    const holder: { value: TransformOutput | null } = { value: null };
    expect(() => {
      holder.value = getTransform(validation({ strict: true })).call(
        { warn: (message: string) => warnings.push(message) },
        readFileSync(file, "utf8"),
        file,
      );
    }).not.toThrow();
    expect(holder.value).not.toBeNull();
    expect((holder.value as TransformOutput).code).toMatch(/["']name["']\s*:/);
    expect(warnings).toHaveLength(0);
  });

  it("резолвит type-only реэкспорт через barrel к исходному модулю", () => {
    const directory = createProject();
    writeFileSync(
      path.join(directory, "inner.ts"),
      [
        "export class Inner {",
        "  accessor id: number = 0;",
        "}",
        "",
      ].join("\n"),
    );
    writeFileSync(
      path.join(directory, "barrel.ts"),
      'export type { Inner } from "./inner";\n',
    );
    const file = path.join(directory, "holder.ts");
    writeFileSync(
      file,
      [
        'import type { Inner } from "./barrel";',
        'import { ValidationModel } from "@ivlev-dev/silent-validation";',
        "",
        "export class Holder extends ValidationModel {",
        "  accessor inner: Inner | null = null;",
        "}",
        "",
      ].join("\n"),
    );
    const result = getTransform(validation())(readFileSync(file, "utf8"), file);
    expect(result).not.toBeNull();
    const code = (result as TransformOutput).code;
    expect(code).toMatch(/\["class",\(\)=>__silent_validation_\d+\.Inner\]/);
    expect(code).toMatch(/import \* as __silent_validation_\d+ from ["']\.\/inner["'];/);
    expect(code).not.toMatch(/import \* as __silent_validation_\d+ from ["']\.\/barrel["'];/);
  });

  it("определяет рантайм внешнего пакета по package.json при раздельных types и import", () => {
    const directory = createProject();
    const packageDirectory = path.join(directory, "node_modules", "typed-pkg");
    mkdirSync(path.join(packageDirectory, "dist", "types"), { recursive: true });
    writeFileSync(
      path.join(packageDirectory, "package.json"),
      JSON.stringify(
        {
          name: "typed-pkg",
          version: "0.0.0",
          type: "module",
          exports: {
            ".": {
              types: "./dist/types/index.d.ts",
              import: "./dist/index.js",
            },
          },
        },
        null,
        2,
      ),
    );
    writeFileSync(
      path.join(packageDirectory, "dist", "types", "index.d.ts"),
      "export declare class Remote {\n  value: string;\n}\n",
    );
    writeFileSync(
      path.join(packageDirectory, "dist", "index.js"),
      "export class Remote {}\n",
    );
    const file = path.join(directory, "remote-holder.ts");
    writeFileSync(
      file,
      [
        'import type { Remote } from "typed-pkg";',
        'import { ValidationModel } from "@ivlev-dev/silent-validation";',
        "",
        "export class RemoteHolder extends ValidationModel {",
        "  accessor remote: Remote | null = null;",
        "}",
        "",
      ].join("\n"),
    );
    const result = getTransform(validation())(readFileSync(file, "utf8"), file);
    expect(result).not.toBeNull();
    const code = (result as TransformOutput).code;
    expect(code).toMatch(/\["class",\(\)=>__silent_validation_\d+\.Remote\]/);
    expect(code).toMatch(/import \* as __silent_validation_\d+ from ["']typed-pkg["'];/);
  });

  it("не считает declaration-файлы пакета рантаймом", () => {
    const directory = createProject();
    const packageDirectory = path.join(directory, "node_modules", "declaration-only");
    mkdirSync(path.join(packageDirectory, "types"), { recursive: true });
    writeFileSync(
      path.join(packageDirectory, "package.json"),
      JSON.stringify(
        {
          name: "declaration-only",
          version: "0.0.0",
          type: "module",
          main: "./index.d.ts",
          exports: {
            ".": {
              types: "./types/index.d.ts",
              default: "./index.d.ts",
            },
          },
        },
        null,
        2,
      ),
    );
    writeFileSync(
      path.join(packageDirectory, "types", "index.d.ts"),
      "export declare class Remote {\n  value: string;\n}\n",
    );
    writeFileSync(
      path.join(packageDirectory, "index.d.ts"),
      'export { Remote } from "./types/index.js";\n',
    );
    const file = path.join(directory, "declaration-holder.ts");
    writeFileSync(
      file,
      [
        'import type { Remote } from "declaration-only";',
        'import { ValidationModel } from "@ivlev-dev/silent-validation";',
        "",
        "export class DeclarationHolder extends ValidationModel {",
        "  accessor remote: Remote = null as unknown as Remote;",
        '  accessor name: string = "";',
        "}",
        "",
      ].join("\n"),
    );
    const source = readFileSync(file, "utf8");
    const warnings: string[] = [];
    const result = getTransform(validation()).call(
      { warn: (message: string) => warnings.push(message) },
      source,
      file,
    );
    expect(result).not.toBeNull();
    const code = (result as TransformOutput).code;
    expect(code).toMatch(/["']name["']\s*:/);
    expect(code).not.toMatch(/["']remote["']\s*:/);
    expect(code).not.toMatch(/import \* as __silent_validation_\d+ from ["']declaration-only["']/);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("DeclarationHolder.remote");
  });

  it("генерирует схемы для остальных классов файла с ручной схемой", () => {
    const directory = createProject();
    const file = path.join(directory, "mixed.ts");
    writeFileSync(
      file,
      [
        'import { ValidationModel } from "@ivlev-dev/silent-validation";',
        "",
        "export class Manual extends ValidationModel {",
        '  accessor a: string = "";',
        "  static {",
        '    this[Symbol.for("silent.validation.schema")] = { version: 1, fields: { a: ["string"] } };',
        "  }",
        "}",
        "",
        "export class Second extends ValidationModel {",
        "  accessor b: number = 0;",
        "}",
        "",
        "export class Third extends ValidationModel {",
        "  accessor c: boolean = false;",
        "}",
        "",
      ].join("\n"),
    );
    const source = readFileSync(file, "utf8");
    const result = getTransform(validation())(source, file);
    expect(result).not.toBeNull();
    const code = (result as TransformOutput).code;
    expect(code.match(/Symbol\.for\(["']silent\.validation\.schema["']\)/g)).toHaveLength(3);
    expect(code).toMatch(/["']b["']\s*:/);
    expect(code).toMatch(/["']c["']\s*:/);
    expect(getTransform(validation())(code, file)).toBeNull();
  });

  it("сохраняет CRLF и удаляет мёртвые lazy-определения при вырезании поля", () => {
    const directory = createProject();
    writeFileSync(
      path.join(directory, "money.d.ts"),
      ["export declare class Money {", "  amount: number;", "}", ""].join("\n"),
    );
    const file = path.join(directory, "crlf.ts");
    const lines = [
      'import type { Address } from "./b";',
      'import type { Money } from "./money";',
      'import { ValidationModel } from "@ivlev-dev/silent-validation";',
      "",
      "interface Wrapper {",
      "  money: Money;",
      "  next: Wrapper | null;",
      "}",
      "",
      "export class Crlf extends ValidationModel {",
      "  accessor wrapper: Wrapper = null as unknown as Wrapper;",
      "  accessor address: Address | null = null;",
      '  accessor name: string = "";',
      "}",
      "",
    ];
    writeFileSync(file, lines.join("\r\n"));
    const warnings: string[] = [];
    const result = getTransform(validation()).call(
      { warn: (message: string) => warnings.push(message) },
      readFileSync(file, "utf8"),
      file,
    );
    expect(result).not.toBeNull();
    const code = (result as TransformOutput).code;
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Crlf.wrapper");
    expect(warnings[0]).toContain("недоступный в рантайме");
    expect(code).not.toMatch(/["']wrapper["']\s*:/);
    expect(code).not.toMatch(/\bconst lazy\d+ =/);
    expect(code).toMatch(/["']name["']\s*:/);
    expect(code).toMatch(/import \* as __silent_validation_\d+ from ["']\.\/b["'];\r\n/);
  });

  it("вырезает недоступное поле с вычисляемым ключом __proto__", () => {
    const directory = createProject();
    writeFileSync(
      path.join(directory, "money.d.ts"),
      ["export declare class Money {", "  amount: number;", "}", ""].join("\n"),
    );
    const file = path.join(directory, "proto.ts");
    writeFileSync(
      file,
      [
        'import type { Money } from "./money";',
        'import { ValidationModel } from "@ivlev-dev/silent-validation";',
        "",
        "export class Proto extends ValidationModel {",
        "  accessor __proto__: Money = null as unknown as Money;",
        '  accessor name: string = "";',
        "}",
        "",
      ].join("\n"),
    );
    const warnings: string[] = [];
    const result = getTransform(validation()).call(
      { warn: (message: string) => warnings.push(message) },
      readFileSync(file, "utf8"),
      file,
    );
    expect(result).not.toBeNull();
    const code = (result as TransformOutput).code;
    expect(warnings.some((message) => message.includes("Proto.__proto__"))).toBe(true);
    expect(code).not.toContain('["__proto__"]:');
    expect(code).toMatch(/["']name["']\s*:\s*"string"/);
  });

  it("оставляет Promise, Iterable, WeakMap и WeakSet и вырезает реально недоступные поля", () => {
    const directory = createProject();
    writeFileSync(
      path.join(directory, "money.d.ts"),
      ["export declare class Money {", "  amount: number;", "}", ""].join("\n"),
    );
    const file = path.join(directory, "containers.ts");
    writeFileSync(
      file,
      [
        'import type { Money } from "./money";',
        'import { ValidationModel } from "@ivlev-dev/silent-validation";',
        "",
        "export class Containers extends ValidationModel {",
        "  accessor promised: Promise<Money> = null as unknown as Promise<Money>;",
        "  accessor iterable: Iterable<Money> = null as unknown as Iterable<Money>;",
        "  accessor weakMap: WeakMap<object, Money> = new WeakMap();",
        "  accessor weakSet: WeakSet<Money> = new WeakSet();",
        "  accessor bytes: Uint8Array = new Uint8Array();",
        "  accessor direct: Money = null as unknown as Money;",
        "  accessor mapping: Map<string, Money> = new Map();",
        '  accessor name: string = "";',
        "}",
        "",
      ].join("\n"),
    );
    const source = readFileSync(file, "utf8");
    const warnings: string[] = [];
    const result = getTransform(validation()).call(
      { warn: (message: string) => warnings.push(message) },
      source,
      file,
    );
    expect(result).not.toBeNull();
    const code = (result as TransformOutput).code;
    expect(code).toMatch(/["']promised["']\s*:\s*"promise"/);
    expect(code).toMatch(/["']iterable["']\s*:\s*"iterable"/);
    expect(code).toMatch(/["']weakMap["']\s*:\s*"weakmap"/);
    expect(code).toMatch(/["']weakSet["']\s*:\s*"weakset"/);
    expect(code).toMatch(/["']bytes["']\s*:\s*"uint8array"/);
    expect(code).not.toMatch(/["']direct["']\s*:/);
    expect(code).not.toMatch(/["']mapping["']\s*:/);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain("Containers.direct");
    expect(warnings[1]).toContain("Containers.mapping");
    const strictTransform = getTransform(validation({ strict: true }));
    expect(() => strictTransform(source, file)).toThrow(/Containers\.direct/);
  });

  it("не падает на tsconfig без входных файлов", () => {
    const directory = createProject();
    writeFileSync(
      path.join(directory, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            module: "ESNext",
            moduleResolution: "Bundler",
            strict: true,
            noEmit: true,
          },
          include: ["missing/**/*.ts"],
        },
        null,
        2,
      ),
    );
    const file = path.join(directory, "a.ts");
    const result = getTransform(validation())(readFileSync(file, "utf8"), file);
    expect(result).not.toBeNull();
    expect((result as TransformOutput).code).toMatch(/["']name["']\s*:/);
  });

  it("исполняет собранный модуль и валидирует реальный экземпляр", async () => {
    const directory = createProject();
    rmSync(
      path.join(directory, "node_modules", "@ivlev-dev", "silent-validation"),
      { recursive: true, force: true },
    );
    linkValidationPackage(directory);
    const runtimeDirectory = path.join(directory, "node_modules", "runtime-lib");
    mkdirSync(runtimeDirectory, { recursive: true });
    writeFileSync(
      path.join(runtimeDirectory, "package.json"),
      JSON.stringify({ name: "runtime-lib", type: "module", main: "index.js" }, null, 2),
    );
    writeFileSync(
      path.join(runtimeDirectory, "index.js"),
      "export class Money {\n  constructor(amount) {\n    this.amount = amount;\n  }\n}\n",
    );
    writeFileSync(
      path.join(directory, "types.d.ts"),
      [
        'declare module "runtime-lib" {',
        "  export class Money {",
        "    constructor(amount: number);",
        "    amount: number;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    writeFileSync(
      path.join(directory, "executable-model.ts"),
      [
        'import type { Money } from "runtime-lib";',
        'import { ValidationModel } from "@ivlev-dev/silent-validation";',
        "",
        "export namespace Domain {",
        "  export class Item {",
        "    accessor id: number = 0;",
        "  }",
        "}",
        "",
        "export class User extends ValidationModel {",
        '  accessor name: string = "";',
        "  accessor item: Domain.Item = new Domain.Item();",
        "  accessor patch: Partial<Domain.Item> = {};",
        "  accessor money: Money = null as unknown as Money;",
        "  accessor promised: Promise<Money> = null as unknown as Promise<Money>;",
        "  accessor iterable: Iterable<Money> = null as unknown as Iterable<Money>;",
        "}",
        "",
      ].join("\n"),
    );
    writeFileSync(
      path.join(directory, "executable-main.ts"),
      [
        'import { validate } from "@ivlev-dev/silent-validation";',
        'import { Money } from "runtime-lib";',
        'import { Domain, User } from "./executable-model";',
        "",
        "const user = new User();",
        "user.money = new Money(5);",
        "const item = new Domain.Item();",
        "item.id = 7;",
        "user.item = item;",
        "user.patch = { id: 9 };",
        "user.promised = Promise.resolve(new Money(1));",
        "user.iterable = [new Money(2)];",
        "const good = validate(user);",
        "user.name = 123 as unknown as string;",
        "const bad = validate(user);",
        "(globalThis as unknown as { __silentResult?: unknown }).__silentResult = { good, bad };",
        "",
      ].join("\n"),
    );
    const code = await buildProject(directory, [validation()], "executable-main.ts");
    expect(code).toMatch(/["']promised["']\s*:\s*"promise"/);
    expect(code).toMatch(/["']iterable["']\s*:\s*"iterable"/);
    const lowered = ts.transpileModule(code, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    }).outputText;
    const bundleFile = path.join(directory, "executable-bundle.mjs");
    writeFileSync(bundleFile, lowered);
    await import(`${pathToFileURL(bundleFile).href}?v=${Date.now()}`);
    const loaded = (globalThis as {
      __silentResult?: {
        readonly good: { readonly valid: boolean; readonly errors: readonly unknown[] };
        readonly bad: { readonly valid: boolean; readonly errors: readonly unknown[] };
      };
    }).__silentResult;
    expect(loaded).toBeDefined();
    const result = loaded as NonNullable<typeof loaded>;
    expect(result.good.valid).toBe(true);
    expect(result.good.errors).toHaveLength(0);
    expect(result.bad.valid).toBe(false);
    expect(result.bad.errors.length).toBeGreaterThan(0);
  });

  it("исполняет схемы default-экспорта, ambient-модуля и ArrayLike", async () => {
    const directory = createProject();
    rmSync(
      path.join(directory, "node_modules", "@ivlev-dev", "silent-validation"),
      { recursive: true, force: true },
    );
    linkValidationPackage(directory);
    const runtimeDirectory = path.join(directory, "node_modules", "runtime-lib");
    mkdirSync(runtimeDirectory, { recursive: true });
    writeFileSync(
      path.join(runtimeDirectory, "package.json"),
      JSON.stringify({ name: "runtime-lib", type: "module", main: "index.js" }, null, 2),
    );
    writeFileSync(
      path.join(runtimeDirectory, "index.js"),
      "export class Money {\n  constructor(amount) {\n    this.amount = amount;\n  }\n}\n",
    );
    writeFileSync(
      path.join(directory, "types.d.ts"),
      [
        'declare module "runtime-lib" {',
        "  export class Money {",
        "    constructor(amount: number);",
        "    amount: number;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    writeFileSync(
      path.join(directory, "default-model.ts"),
      [
        'import { ValidationModel } from "@ivlev-dev/silent-validation";',
        "",
        "export default class DefaultModel extends ValidationModel {",
        '  accessor label: string = "";',
        "}",
        "",
      ].join("\n"),
    );
    writeFileSync(
      path.join(directory, "executable-shapes.ts"),
      [
        'import DefaultModel from "./default-model";',
        'import type { Money } from "runtime-lib";',
        'import { ValidationModel } from "@ivlev-dev/silent-validation";',
        "",
        "export class Shapes extends ValidationModel {",
        "  accessor child: DefaultModel = new DefaultModel();",
        "  accessor money: Money = null as unknown as Money;",
        "  accessor list: ArrayLike<string> = [];",
        "}",
        "",
      ].join("\n"),
    );
    writeFileSync(
      path.join(directory, "executable-shapes-main.ts"),
      [
        'import { validate } from "@ivlev-dev/silent-validation";',
        'import { Money } from "runtime-lib";',
        'import { Shapes } from "./executable-shapes";',
        "",
        "const model = new Shapes();",
        'model.child.label = "child";',
        "model.money = new Money(5);",
        "const schema = (Shapes as unknown as Record<symbol, { fields?: Record<string, unknown> }>)[",
        '  Symbol.for("silent.validation.schema")',
        "];",
        'const listSchema = schema?.fields?.["list"];',
        "const isArraySchema = (node: unknown): boolean => {",
        "  if (!Array.isArray(node)) return false;",
        '  if (node[0] === "array") return true;',
        '  if (node[0] === "union" && Array.isArray(node[1])) return node[1].some(isArraySchema);',
        "  return false;",
        "};",
        "const arrayLike = isArraySchema(listSchema);",
        'model.list = (arrayLike ? ["a"] : { 0: "a", length: 1 }) as ArrayLike<string>;',
        "const good = validate(model);",
        'model.list = (arrayLike ? [1] : { 0: 1, length: 1 }) as unknown as ArrayLike<string>;',
        "const bad = validate(model);",
        "(globalThis as unknown as { __silentShapes?: unknown }).__silentShapes = { good, bad };",
        "",
      ].join("\n"),
    );
    const code = await buildProject(directory, [validation()], "executable-shapes-main.ts");
    expect(code).toMatch(/["']child["']\s*:\s*\["class",\s*\(\)\s*=>\s*DefaultModel\]/);
    expect(code).toMatch(/["']money["']\s*:\s*\["class",\s*\(\)\s*=>\s*(?:__silent_validation_\d+\.)?Money\]/);
    expect(code).toMatch(/["']list["']\s*:/);
    const lowered = ts.transpileModule(code, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    }).outputText;
    const bundleFile = path.join(directory, "executable-shapes-bundle.mjs");
    writeFileSync(bundleFile, lowered);
    await import(`${pathToFileURL(bundleFile).href}?v=${Date.now()}`);
    const loaded = (globalThis as {
      __silentShapes?: {
        readonly good: { readonly valid: boolean; readonly errors: readonly unknown[] };
        readonly bad: { readonly valid: boolean; readonly errors: readonly unknown[] };
      };
    }).__silentShapes;
    expect(loaded).toBeDefined();
    const result = loaded as NonNullable<typeof loaded>;
    expect(result.good.valid).toBe(true);
    expect(result.good.errors).toHaveLength(0);
    expect(result.bad.valid).toBe(false);
    expect(result.bad.errors.length).toBeGreaterThan(0);
  });

  it("освобождает предыдущие Program и быстро пересобирает после изменения файла", () => {
    const directory = createProject();
    const plugin = validation();
    const transform = getTransform(plugin);
    const watchChange = getWatchChange(plugin);
    const file = path.join(directory, "a.ts");
    const base = readFileSync(file, "utf8");
    expect(transform(base, file)).not.toBeNull();
    forceGarbageCollection();
    const before = process.memoryUsage().heapUsed;
    const started = performance.now();
    for (let index = 0; index < 10; index += 1) {
      const updated = `${base}\n// rebuild ${index}\n`;
      writeFileSync(file, updated);
      watchChange(file);
      expect(transform(updated, file)).not.toBeNull();
    }
    const elapsed = performance.now() - started;
    forceGarbageCollection();
    const after = process.memoryUsage().heapUsed;
    const delta = after - before;
    console.log(
      `rebuild x10: heap +${(delta / 1024 / 1024).toFixed(2)} MB, ${
        (elapsed / 10).toFixed(1)
      } ms/rebuild`,
    );
    expect(delta).toBeLessThan(6 * 1024 * 1024);
    expect(elapsed / 10).toBeLessThan(2000);
  });
});
