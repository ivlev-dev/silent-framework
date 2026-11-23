import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "vite";
import type { Plugin } from "vite";
import { protocol } from "../src/vite.js";

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

function getTransform(plugin: Plugin): TransformHandler {
  const hooks = plugin as unknown as TransformHooks;
  const transform = hooks.transform;
  if (typeof transform === "function") return transform;
  if (transform !== undefined && typeof transform.handler === "function") {
    return transform.handler;
  }
  throw new Error("Плагин protocol() не предоставляет transform");
}

function writeProjectFiles(directory: string): void {
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
    path.join(directory, "decorators.ts"),
    [
      "export function Int32(): any { return () => {}; }",
      "export function Uint64(): any { return () => {}; }",
      "export function EpochMillis(): any { return () => {}; }",
      "export function OneOf(value: unknown): any { return () => {}; }",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(directory, "b.ts"),
    ["export class Address {", '  public street: string = "";', "}", ""].join("\n"),
  );
  writeFileSync(
    path.join(directory, "a.ts"),
    [
      'import type { Address } from "./b";',
      "",
      "export enum Role {",
      '  Admin = "admin",',
      '  User = "user",',
      "}",
      "",
      "export enum Kind {",
      "  Created = 1,",
      "  Updated = 2,",
      "}",
      "",
      "export class User {",
      '  public name: string = "";',
      "  public age: number = 0;",
      "  public role: Role = Role.User;",
      "  public address: Address | null = null;",
      "}",
      "",
      "export class Event {",
      "  public kind: Kind = Kind.Created;",
      '  public name: string = "";',
      "  public created?: string;",
      "  public updated?: number;",
      "}",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(directory, "kinds.ts"),
    ["export enum Kind { Created = 1, Updated = 2 }", ""].join("\n"),
  );
  writeFileSync(
    path.join(directory, "decorated.ts"),
    [
      'import { Int32 } from "./decorators";',
      "",
      "export class Decorated {",
      "  @Int32() public score: number = 0;",
      '  public name: string = "";',
      "}",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(directory, "main.ts"),
    [
      'import { Address } from "./b";',
      'import { Event, User } from "./a";',
      "",
      "export { Address, Event, User };",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(directory, "plain.ts"),
    'export const value: string = "x";\n',
  );
}

function createProject(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "silent-protocol-vite-"));
  projects.push(directory);
  writeProjectFiles(directory);
  return directory;
}

const buildProject = async (directory: string, plugins: readonly Plugin[], entry = "main.ts"): Promise<void> => {
  await build({
    root: directory,
    configFile: false,
    logLevel: "silent",
    plugins: [...plugins],
    resolve: {
      alias: {
        "@ivlev-dev/silent-protocol": path.resolve(
          import.meta.dirname,
          "../../protocol/src/index.ts",
        ),
      },
    },
    build: {
      write: true,
      minify: false,
      target: "esnext",
      outDir: path.join(directory, "dist"),
      emptyOutDir: true,
      lib: {
        entry: path.join(directory, entry),
        formats: ["es"],
        fileName: "main",
      },
    },
  });
};

const importBundle = async (directory: string): Promise<Record<string, unknown>> => {
  const url = `${pathToFileURL(path.join(directory, "dist", "main.mjs")).href}?v=${Date.now()}`;
  return await import(url) as Record<string, unknown>;
};

describe("protocol()", () => {
  it("вставляет схему и namespace-импорт для type-only класса", () => {
    const directory = createProject();
    const file = path.join(directory, "a.ts");
    const result = getTransform(protocol())(readFileSync(file, "utf8"), file);
    expect(result).not.toBeNull();
    const code = (result as TransformOutput).code;
    expect(code).toMatch(/Symbol\.for\(["']silent\.protocol\.schema["']\)/);
    expect(code).toMatch(/version: 1/);
    expect(code).toMatch(/name: "name"/);
    expect(code).toMatch(/\["class",\(\)=>__silent_protocol_\d+\.Address\]/);
    expect(code).toMatch(/import \* as __silent_protocol_\d+ from ["']\.\/b["'];/);
    expect(code).toMatch(/import \{ [^}]*writeMessage as __silent_protocol_writeMessage[^}]*\} from ["']@ivlev-dev\/silent-protocol["'];/);
    expect(code).toMatch(/oneofs: \[/);
  });

  it("читает декораторы wire-типа из AST", () => {
    const directory = createProject();
    const file = path.join(directory, "decorated.ts");
    const result = getTransform(protocol())(readFileSync(file, "utf8"), file);
    expect(result).not.toBeNull();
    expect((result as TransformOutput).code).toMatch(/name: "score", type: "int32"/);
  });

  it("импортирует enum-дискриминатор для type-only импорта", () => {
    const directory = createProject();
    const file = path.join(directory, "enum-holder.ts");
    writeFileSync(
      file,
      [
        'import type { Kind } from "./kinds";',
        "",
        "export class EnumHolder {",
        "  public kind: Kind = 1 as Kind;",
        "  public created?: string;",
        "  public updated?: number;",
        "}",
        "",
      ].join("\n"),
    );
    const result = getTransform(protocol())(readFileSync(file, "utf8"), file);
    expect(result).not.toBeNull();
    const code = (result as TransformOutput).code;
    expect(code).toMatch(/enum: \(\) => __silent_protocol_\d+\.Kind/);
    expect(code).toMatch(/import \* as __silent_protocol_\d+ from ["']\.\/kinds["'];/);
  });

  it("пропускает поле глобального ambient-класса без рантайма", () => {
    const directory = createProject();
    writeFileSync(
      path.join(directory, "types.d.ts"),
      ["declare class Money {", "  amount: number;", "}", ""].join("\n"),
    );
    const file = path.join(directory, "wallet.ts");
    writeFileSync(
      file,
      [
        "export class Wallet {",
        "  public money: Money = null as unknown as Money;",
        '  public name: string = "";',
        "}",
        "",
      ].join("\n"),
    );
    const warnings: string[] = [];
    const result = getTransform(protocol()).call(
      { warn: (message: string) => warnings.push(message) },
      readFileSync(file, "utf8"),
      file,
    );
    expect(result).not.toBeNull();
    const code = (result as TransformOutput).code;
    expect(code).toMatch(/name: "name"/);
    expect(code).not.toMatch(/name: "money"/);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Wallet.money");
    expect(warnings[0]).toContain("рантайм");
  });

  it("не меняет файл без классов с полями", () => {
    const directory = createProject();
    const plugin = protocol();
    const file = path.join(directory, "plain.ts");
    const result = getTransform(plugin)(readFileSync(file, "utf8"), file);
    expect(result).toBeNull();
  });

  it("идемпотентен при повторном transform", () => {
    const directory = createProject();
    const plugin = protocol();
    const file = path.join(directory, "a.ts");
    const source = readFileSync(file, "utf8");
    const transform = getTransform(plugin);
    const first = transform(source, file);
    const second = transform(source, file);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect((second as TransformOutput).code).toBe((first as TransformOutput).code);
    expect(transform((first as TransformOutput).code, file)).toBeNull();
    const schemas = (first as TransformOutput).code.match(
      /Symbol\.for\(["']silent\.protocol\.schema["']\)/g,
    );
    expect(schemas).toHaveLength(2);
    const codecs = (first as TransformOutput).code.match(
      /Symbol\.for\(["']silent\.protocol\.codec["']\)/g,
    );
    expect(codecs).toHaveLength(2);
    const helperImports = (first as TransformOutput).code.match(
      /from ["']@ivlev-dev\/silent-protocol["'];/g,
    );
    expect(helperImports).toHaveLength(1);
  });

  it("пропускает ?raw, ?url и .d.ts", () => {
    const directory = createProject();
    const plugin = protocol();
    const transform = getTransform(plugin);
    const file = path.join(directory, "a.ts");
    const source = readFileSync(file, "utf8");
    expect(transform(source, `${file}?raw`)).toBeNull();
    expect(transform(source, `${file}?url`)).toBeNull();
    expect(transform("export declare class Thing { value: string; }", path.join(directory, "x.d.ts")))
      .toBeNull();
  });

  it("предупреждает о неподдерживаемом типе и бросает в strict", () => {
    const directory = createProject();
    const file = path.join(directory, "unsupported.ts");
    writeFileSync(
      file,
      [
        "export class Unsupported {",
        "  public data: unknown = undefined;",
        '  public name: string = "";',
        "}",
        "",
      ].join("\n"),
    );
    const source = readFileSync(file, "utf8");
    const warnings: string[] = [];
    const result = getTransform(protocol()).call(
      { warn: (message: string) => warnings.push(message) },
      source,
      file,
    );
    expect(result).not.toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Unsupported.data");
    expect((result as TransformOutput).code).toMatch(/name: "name"/);
    expect((result as TransformOutput).code).not.toMatch(/name: "data"/);
    expect(() => getTransform(protocol({ strict: true }))(source, file)).toThrow(
      /Unsupported\.data/,
    );
  });

  it("поддерживает oneof, default export, namespace и class expression", () => {
    const directory = createProject();
    const file = path.join(directory, "events.ts");
    writeFileSync(
      file,
      [
        'import { OneOf } from "./decorators";',
        "",
        "export enum Kind { Created = 1, Updated = 2 }",
        "",
        "export namespace Domain {",
        "  export class Item {",
        "    public id: number = 0;",
        "  }",
        "}",
        "",
        "const Expr = class {",
        '  public x: string = "";',
        "};",
        "",
        "export default class Event {",
        "  public kind: Kind = Kind.Created;",
        "  @OneOf(Kind.Created) public created?: string;",
        "  @OneOf(Kind.Updated) public updated?: number;",
        "  public item: Domain.Item = new Domain.Item();",
        "}",
        "",
      ].join("\n"),
    );
    const result = getTransform(protocol())(readFileSync(file, "utf8"), file);
    expect(result).not.toBeNull();
    const code = (result as TransformOutput).code;
    expect(code).toMatch(/kind: "oneof", name: "kind", enum: \(\) => Kind/);
    expect(code).toMatch(/value: 1, field: "created"/);
    expect(code).toMatch(/value: 2, field: "updated"/);
    expect(code).toMatch(/\["class",\(\)=>Domain\.Item\]/);
    expect(code).toMatch(/oneofs: \[/);
  });

  it("собирает схему в Vite и отдаёт её из бандла", async () => {
    const directory = createProject();
    await buildProject(directory, [protocol()]);
    const module = await importBundle(directory);
    const user = module["User"];
    expect(typeof user).toBe("function");
    if (typeof user !== "function") throw new Error("User не класс");
    const schema = (user as unknown as Record<symbol, unknown>)[
      Symbol.for("silent.protocol.schema")
    ] as Record<string, unknown> | undefined;
    expect(schema).toBeDefined();
    expect(schema?.["version"]).toBe(1);
    const fields = schema?.["fields"];
    if (!Array.isArray(fields)) throw new Error("нет fields");
    const names = fields
      .filter((entry) => typeof entry === "object" && entry !== null)
      .map((entry) => (entry as Record<string, unknown>)["name"]);
    expect(names).toEqual(["address", "age", "name", "role"]);
    const address = fields.find(
      (entry) => typeof entry === "object" && entry !== null
        && (entry as Record<string, unknown>)["name"] === "address",
    ) as Record<string, unknown>;
    const type = address["type"];
    expect(Array.isArray(type)).toBe(true);
    if (!Array.isArray(type)) throw new Error("ожидался ClassType");
    expect((type[1] as () => unknown)()).toBe(module["Address"]);
    expect(address["optional"]).toBe(true);
  });

  it("без плагина схемы нет", async () => {
    const directory = createProject();
    await buildProject(directory, []);
    const module = await importBundle(directory);
    const user = module["User"];
    if (typeof user !== "function") throw new Error("User не класс");
    expect((user as unknown as Record<symbol, unknown>)[Symbol.for("silent.protocol.schema")])
      .toBeUndefined();
  });

  it("не изменяет raw-модуль при сборке", async () => {
    const directory = createProject();
    writeFileSync(
      path.join(directory, "raw-main.ts"),
      ['import raw from "./a.ts?raw";', "", "export const text = raw;", ""].join("\n"),
    );
    await buildProject(directory, [protocol()], "raw-main.ts");
    const module = await importBundle(directory);
    expect(typeof module["text"]).toBe("string");
    expect(module["text"]).not.toMatch(/Symbol\.for\(["']silent\.protocol\.schema["']\)/);
  });

  it("пересобирает Program после изменения файла", () => {
    const directory = createProject();
    const plugin = protocol();
    const transform = getTransform(plugin);
    const file = path.join(directory, "a.ts");
    const first = transform(readFileSync(file, "utf8"), file);
    expect(first).not.toBeNull();
    const updated = readFileSync(file, "utf8").replace(
      '  public age: number = 0;',
      '  public age: number = 0;\n  public extra: boolean = false;',
    );
    writeFileSync(file, updated);
    const hooks = plugin as unknown as TransformHooks;
    hooks.watchChange?.(file);
    const second = transform(updated, file);
    expect(second).not.toBeNull();
    expect((second as TransformOutput).code).toMatch(/name: "extra"/);
  });
});
