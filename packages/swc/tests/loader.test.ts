import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  detectLibc,
  isNativeModule,
  loadNative,
  nativeLoadError,
  nativePackageName,
  resolveNativeTriples,
} from "../loader.js";

const nativeModule = {
  transform: () => "{}",
  scan: () => "{}",
  version: () => "test",
};

const directories: string[] = [];

function tempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "silent-swc-loader-"));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const moduleNotFound = (name: string): Error => {
  const error = new Error(`Cannot find module '${name}'`) as Error & { code?: string };
  error.code = "MODULE_NOT_FOUND";
  return error;
};

describe("resolveNativeTriples", () => {
  it("для musl использует musl-тройку без fallback по умолчанию", () => {
    expect(
      resolveNativeTriples({ platform: "linux", arch: "x64", libc: "musl" }),
    ).toEqual(["linux-x64-musl"]);
  });

  it("добавляет gnu-fallback только при явном разрешении", () => {
    expect(
      resolveNativeTriples({
        platform: "linux",
        arch: "arm64",
        libc: "musl",
        allowGnuFallback: true,
      }),
    ).toEqual(["linux-arm64-musl", "linux-arm64-gnu"]);
    expect(
      resolveNativeTriples({ platform: "linux", arch: "arm64", libc: "gnu" }),
    ).toEqual(["linux-arm64-gnu"]);
  });

  it("мапит win32 и darwin", () => {
    expect(resolveNativeTriples({ platform: "win32", arch: "x64" })).toEqual([
      "win32-x64-msvc",
    ]);
    expect(resolveNativeTriples({ platform: "darwin", arch: "arm64" })).toEqual([
      "darwin-arm64",
    ]);
  });

  it("определяет libc по отчёту процесса", () => {
    expect(detectLibc({ header: { glibcVersionRuntime: "2.31" } })).toBe("gnu");
    expect(detectLibc({ header: {} })).toBe("musl");
    expect(detectLibc(undefined)).toBe("musl");
  });
});

describe("loadNative", () => {
  it("загружает платформенный пакет", () => {
    const requireModule = vi.fn(() => nativeModule);
    const triple = nativePackageName("linux-x64-musl");

    const loaded = loadNative({
      requireModule,
      nativeDirectory: tempDirectory(),
      triples: ["linux-x64-musl"],
    });

    expect(loaded).toBe(nativeModule);
    expect(requireModule).toHaveBeenCalledWith(triple);
  });

  it("не пробует gnu, если musl-пакет найден", () => {
    const requireModule = vi.fn(() => nativeModule);
    loadNative({
      requireModule,
      nativeDirectory: tempDirectory(),
      triples: ["linux-x64-musl", "linux-x64-gnu"],
    });

    expect(requireModule.mock.calls.map((call) => call[0])).toEqual([
      nativePackageName("linux-x64-musl"),
    ]);
  });

  it("падает с ожидаемыми пакетами и подсказкой сборки", () => {
    const requireModule = vi.fn((name: string) => {
      throw moduleNotFound(name);
    });

    let message = "";
    try {
      loadNative({
        requireModule,
        nativeDirectory: tempDirectory(),
        triples: ["linux-x64-musl"],
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("@ivlev-dev/silent-swc-linux-x64-musl");
    expect(message).toContain("pnpm --filter @ivlev-dev/silent-swc build");
    expect(message).toContain("SILENT_SWC_ALLOW_GNU_FALLBACK=1");
    expect(message).toContain("Cannot find module");
  });

  it("переходит к следующей тройке после неудачи", () => {
    const requireModule = vi.fn((name: string) => {
      if (name.endsWith("-gnu")) return nativeModule;
      throw moduleNotFound(name);
    });

    const loaded = loadNative({
      requireModule,
      nativeDirectory: tempDirectory(),
      triples: ["linux-x64-musl", "linux-x64-gnu"],
    });

    expect(loaded).toBe(nativeModule);
    expect(requireModule.mock.calls.map((call) => call[0])).toEqual([
      nativePackageName("linux-x64-musl"),
      nativePackageName("linux-x64-gnu"),
    ]);
  });

  it("загружает локальную сборку из native", () => {
    const directory = tempDirectory();
    const artifact = join(directory, "index.linux-x64-musl.node");
    writeFileSync(artifact, "");
    const requireModule = vi.fn((name: string) => {
      if (name === artifact) return nativeModule;
      throw moduleNotFound(name);
    });

    const loaded = loadNative({
      requireModule,
      nativeDirectory: directory,
      triples: ["linux-x64-musl"],
    });

    expect(loaded).toBe(nativeModule);
    expect(requireModule).toHaveBeenCalledWith(artifact);
  });

  it("отвергает модуль без transform/scan/version", () => {
    expect(isNativeModule({ transform: () => "{}" })).toBe(false);
    expect(isNativeModule(null)).toBe(false);
    expect(isNativeModule(nativeModule)).toBe(true);
    expect(nativeLoadError(["win32-x64-msvc"], []).message).toContain(
      "@ivlev-dev/silent-swc-win32-x64-msvc",
    );
  });
});
