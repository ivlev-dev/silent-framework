import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { ResolvedConfig } from "vite";
import { silent } from "../src/index.js";
import {
  collectTypeOnlyImportSources,
  isBareSpecifier,
} from "../src/type-imports.js";

interface CallablePlugin {
  buildStart?: () => Promise<void> | void;
  configResolved?: (config: ResolvedConfig) => void;
  transform?: (
    this: {
      warn: (message: string) => void;
      resolve?: (
        source: string,
        importer: string,
        options?: { skipSelf?: boolean },
      ) => Promise<{ id: string } | null>;
    },
    code: string,
    id: string,
  ) => Promise<{ code: string; warnings: string[] } | null> | { code: string } | null;
}

const root = mkdtempSync(join(tmpdir(), "silent-type-only-"));
const cacheDir = mkdtempSync(join(tmpdir(), "silent-type-only-cache-"));
mkdirSync(join(root, "src"), { recursive: true });
writeFileSync(
  join(root, "src", "types.ts"),
  "export interface Store { get(): string }\n",
);
writeFileSync(
  join(root, "src", "memory-store.ts"),
  [
    "import type { Store } from './types';",
    "export class MemoryStore implements Store {",
    "  get(): string { return 'memory'; }",
    "}",
  ].join("\n"),
);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(cacheDir, { recursive: true, force: true });
});

describe("type-only импорты", () => {
  it("распознаёт только type-only источники", () => {
    const code = [
      'import type { A } from "types-a";',
      'import { type B } from "types-b";',
      'import { value, type C } from "mixed";',
      'import { runtime } from "runtime";',
      'import "side-effect";',
      'import type { D } from "./local";',
    ].join("\n");

    expect(collectTypeOnlyImportSources(code)).toEqual([
      "types-a",
      "types-b",
      "./local",
    ]);
  });

  it("не считает относительные импорты bare-спецификаторами", () => {
    expect(isBareSpecifier("./local")).toBe(false);
    expect(isBareSpecifier("../local")).toBe(false);
    expect(isBareSpecifier("/absolute")).toBe(false);
    expect(isBareSpecifier("pkg")).toBe(true);
    expect(isBareSpecifier("@scope/pkg")).toBe(true);
  });

  it("не генерирует runtime-импорт для type-only bare-пакета", async () => {
    const plugin = silent({ root, di: "warn" }) as unknown as CallablePlugin;
    plugin.configResolved?.({
      root,
      cacheDir,
      command: "serve",
    } as unknown as ResolvedConfig);
    await plugin.buildStart?.();

    const warn = vi.fn();
    const result = await plugin.transform?.call(
      { warn },
      [
        'import type { Missing } from "missing-value-package";',
        "export class Probe {",
        "  constructor(private readonly dep: Missing) {}",
        "}",
      ].join("\n"),
      join(root, "src", "probe.ts"),
    );

    expect(result?.code).not.toContain("missing-value-package");
    expect(result?.code).not.toContain("silent.di.create");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("не найдено реализации"),
    );
  });

  it("оставляет type-only импорт установленного runtime-пакета addon'у", async () => {
    const plugin = silent({ root, di: "warn" }) as unknown as CallablePlugin;
    plugin.configResolved?.({
      root,
      cacheDir,
      command: "serve",
    } as unknown as ResolvedConfig);
    await plugin.buildStart?.();

    const resolve = vi.fn(async () => ({ id: "/vendor/installed/index.js" }));
    const result = await plugin.transform?.call(
      { warn: vi.fn(), resolve },
      [
        'import type { RuntimeValue } from "installed-package";',
        "export class InstalledProbe {",
        "  constructor(private readonly dep: RuntimeValue) {}",
        "}",
      ].join("\n"),
      join(root, "src", "installed-probe.ts"),
    );

    expect(resolve).toHaveBeenCalledWith(
      "installed-package",
      join(root, "src", "installed-probe.ts"),
      { skipSelf: true },
    );
    expect(result?.code).toContain("installed-package");
  });

  it("обрабатывает inline type-спецификаторы", async () => {
    const plugin = silent({ root, di: "warn" }) as unknown as CallablePlugin;
    plugin.configResolved?.({
      root,
      cacheDir,
      command: "serve",
    } as unknown as ResolvedConfig);
    await plugin.buildStart?.();

    const warn = vi.fn();
    const result = await plugin.transform?.call(
      { warn },
      [
        'import { type Missing } from "missing-inline-package";',
        "export class InlineProbe {",
        "  constructor(private readonly dep: Missing) {}",
        "}",
      ].join("\n"),
      join(root, "src", "inline-probe.ts"),
    );

    expect(result?.code).not.toContain("missing-inline-package");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("не найдено реализации"),
    );
  });
});
