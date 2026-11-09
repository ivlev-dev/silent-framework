import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scan, transform } from "../index.js";

function parse(code: string) {
  return JSON.parse(code) as {
    code: string;
    map: string | null;
    diagnostics: string[];
  };
}

describe("@ivlev98/silent-swc", () => {
  it("транслирует JSX в шаблонный runtime", () => {
    const result = parse(
      transform(
        "const el = <div class=\"x\"><span>{name}</span></div>;",
        "/tmp/view.tsx",
        "{}",
        "{}",
      ),
    );
    expect(result.code).toContain("_$templateHoles");
    expect(result.code).toContain("silent-hole-0");
    expect(result.code).toContain("_$insert");
    expect(result.map).not.toBeNull();
  });

  it("сканирует интерфейсы и value-экспорты", () => {
    const root = mkdtempSync(join(tmpdir(), "silent-scan-"));
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(
      join(root, "src", "types.ts"),
      "export interface Store { get(key: string): string }\n",
    );
    writeFileSync(
      join(root, "src", "memory.ts"),
      "import type { Store } from './types';\nexport class MemoryStore implements Store { get() { return ''; } }\n",
    );
    const index = JSON.parse(scan(root)) as {
      interfaces: Record<string, string[]>;
      values: Record<string, string[]>;
    };
    const key = `${root}/src/types#Store`;
    expect(index.interfaces[key]).toEqual([`${root}/src/memory#MemoryStore`]);
    expect(index.values[`${root}/src/types`]).toBeUndefined();
    expect(index.values[`${root}/src/memory`]).toContain("MemoryStore");
  });

  it("требует preloader при включённой опции", () => {
    const source =
      "import type { CounterVM } from './counter.vm';\nexport function Counter(this: { vm: CounterVM }, props: { count: number }) { return <span>{this.vm.count}</span>; }";
    expect(() =>
      transform(
        source,
        "/tmp/counter.tsx",
        JSON.stringify({ requirePreloader: true }),
        "{}",
      ),
    ).toThrow();
  });

  it("возвращает ошибку для интерфейса без реализации", () => {
    expect(() =>
      transform(
        "import type { Missing } from './missing';\nexport class Service { constructor(private value: Missing) {} }",
        "/tmp/service.ts",
        "{}",
        JSON.stringify({
          interfaces: { "/tmp/missing#Missing": [] },
          values: {},
        }),
      ),
    ).toThrow();
  });
});
