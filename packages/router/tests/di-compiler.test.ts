import { describe, expect, it } from "vitest";
import { transform } from "@ivlev-dev/silent-swc";

interface TransformOutput {
  readonly code: string;
  readonly map: string | null;
  readonly diagnostics: readonly string[];
}

function compile(
  source: string,
  filename: string,
  interfaces: Record<string, string[]>,
): TransformOutput {
  const index = JSON.stringify({ interfaces, values: {} });
  return JSON.parse(transform(source, filename, "{}", index)) as TransformOutput;
}

describe("DI compiler index", () => {
  it("подставляет Router как единственную реализацию IRouter", () => {
    const result = compile(
      [
        'import type { IRouter } from "./router.js";',
        "export class PageVM {",
        "  constructor(private readonly router: IRouter) {}",
        '  open(): Promise<void> { return this.router.push("/"); }',
        "}",
      ].join("\n"),
      "/proj/src/page.vm.ts",
      {
        "/proj/src/router#IRouter": ["/proj/src/router#Router"],
      },
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("silent.di.create");
    expect(result.code).toContain("resolve(Router)");
    expect(result.code).toMatch(/from "\.\/router(?:\.js)?"/);
  });

  it("сохраняет IRouter value-токен из пакета", () => {
    const result = compile(
      [
        'import type { IRouter } from "@ivlev-dev/silent-router";',
        "export class PageVM {",
        "  constructor(private readonly router: IRouter) {}",
        "}",
      ].join("\n"),
      "/proj/src/page.vm.ts",
      {},
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toMatch(/resolve\(_[A-Za-z0-9]*IRouter[A-Za-z0-9]*\)/);
    expect(result.code).toContain("@ivlev-dev/silent-router");
  });
});
