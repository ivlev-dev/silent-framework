import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
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

const buildProject = async (directory: string, plugins: readonly Plugin[]): Promise<string> => {
  const result: unknown = await build({
    root: directory,
    configFile: false,
    logLevel: "silent",
    plugins: [...plugins],
    build: {
      write: false,
      minify: false,
      target: "esnext",
      rollupOptions: {
        input: path.join(directory, "main.ts"),
      },
    },
  });
  return outputCode(result);
};

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
});
