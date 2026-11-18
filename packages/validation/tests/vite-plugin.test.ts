import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

function createProject(): string {
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
  writeFileSync(
    path.join(directory, "base.ts"),
    ["export class ValidationModel {}", ""].join("\n"),
  );
  writeFileSync(
    path.join(directory, "b.ts"),
    [
      'import { ValidationModel } from "./base";',
      "",
      "export class Address extends ValidationModel {",
      '  accessor street: string = "";',
      "}",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(directory, "a.ts"),
    [
      'import type { Address } from "./b";',
      'import { ValidationModel } from "./base";',
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
