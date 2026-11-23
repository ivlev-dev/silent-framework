import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "vite";
import { protocol } from "../src/vite.js";

const projects: string[] = [];
const runtime = pathToFileURL(
  path.resolve(import.meta.dirname, "../../protocol/src/index.ts"),
).href;

afterEach(() => {
  for (const directory of projects.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("protocol() + runtime", () => {
  it("кодирует и декодирует класс со сгенерированной схемой", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "silent-protocol-runtime-"));
    projects.push(directory);
    writeFileSync(
      path.join(directory, "tsconfig.json"),
      JSON.stringify({
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
      }),
    );
    writeFileSync(
      path.join(directory, "model.ts"),
      [
        "export class Point {",
        "  public x: number = 0;",
        "  public y: number = 0;",
        "}",
        "",
        "export class User {",
        '  public name: string = "";',
        "  public point: Point = new Point();",
        "  public alias: string | undefined = undefined;",
        "}",
        "",
      ].join("\n"),
    );
    writeFileSync(
      path.join(directory, "main.ts"),
      [
        `import { decode, encode } from ${JSON.stringify(runtime)};`,
        'import { User } from "./model";',
        "",
        "export function run(): { hex: string; name: string; x: number; alias: string | undefined } {",
        "  const user = new User();",
        '  user.name = "Ivan";',
        "  user.point.x = 1.5;",
        "  user.point.y = 2.5;",
        '  user.alias = "и";',
        "  const bytes = encode(user);",
        '  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");',
        "  const back = decode(User, bytes);",
        "  return { hex, name: back.name, x: back.point.x, alias: back.alias };",
        "}",
        "",
      ].join("\n"),
    );
    await build({
      root: directory,
      configFile: false,
      logLevel: "silent",
      resolve: {
        alias: {
          "@ivlev-dev/silent-protocol": path.resolve(
            import.meta.dirname,
            "../../protocol/src/index.ts",
          ),
        },
      },
      plugins: [protocol()],
      build: {
        write: true,
        minify: false,
        target: "esnext",
        outDir: path.join(directory, "dist"),
        emptyOutDir: true,
        lib: {
          entry: path.join(directory, "main.ts"),
          formats: ["es"],
          fileName: "main",
        },
      },
    });
    const bundle = await import(
      `${pathToFileURL(path.join(directory, "dist", "main.mjs")).href}?v=${Date.now()}`
    ) as { run: () => { hex: string; name: string; x: number; alias: string | undefined } };
    const result = bundle.run();
    expect(result.hex).toBe(
      "0102d0b8" + "044976616e" + "000000000000f83f" + "0000000000000440",
    );
    expect(result).toEqual({ hex: result.hex, name: "Ivan", x: 1.5, alias: "и" });
  });
});
