import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { ResolvedConfig } from "vite";
import { silent } from "../src/index.js";
import type { SilentOptions } from "../src/index.js";

interface CallableHooks {
  buildStart?: () => Promise<void> | void;
  configResolved?: (config: ResolvedConfig) => void;
  transform?: (
    code: string,
    id: string,
    options?: { ssr?: boolean; inMap?: unknown },
  ) => Promise<unknown> | unknown;
}

const createPlugin = (options?: SilentOptions): CallableHooks =>
  silent(options) as unknown as CallableHooks;

const projectRoots: string[] = [];
const cacheDirectories: string[] = [];

function createProject(): string {
  const root = mkdtempSync(path.join(tmpdir(), "silent-vite-di-real-"));
  projectRoots.push(root);
  mkdirSync(path.join(root, "src"), { recursive: true });
  writeFileSync(
    path.join(root, "src", "types.ts"),
    [
      "export interface Store { get(): string }",
      'export class MemoryStore implements Store { get() { return ""; } }',
      'export class ApiStore implements Store { get() { return ""; } }',
      "",
    ].join("\n"),
  );
  return root;
}

function createCache(): string {
  const cacheDir = mkdtempSync(path.join(tmpdir(), "silent-vite-di-cache-real-"));
  cacheDirectories.push(cacheDir);
  return cacheDir;
}

function serviceFile(root: string): string {
  return path.join(root, "src", "service.ts");
}

const SERVICE_SOURCE = [
  'import type { Store } from "./types";',
  "export class Service {",
  "  constructor(private readonly store: Store) {}",
  "}",
  "",
].join("\n");

async function start(plugin: CallableHooks, cacheDir: string): Promise<void> {
  plugin.configResolved?.({
    cacheDir,
    command: "build",
    build: { sourcemap: false },
    resolve: { alias: [] },
    root: process.cwd(),
  } as unknown as ResolvedConfig);
  await plugin.buildStart?.();
}

afterAll(() => {
  for (const directory of [...projectRoots, ...cacheDirectories]) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("di с реальным native addon", () => {
  it("warn вызывает warning и не ломает transform", async () => {
    const root = createProject();
    const plugin = createPlugin({ root, di: "warn" });
    await start(plugin, createCache());

    const warn = vi.fn();
    const result = (await plugin.transform?.call(
      { warn },
      SERVICE_SOURCE,
      serviceFile(root),
    )) as { code: string } | undefined;

    expect(warn).toHaveBeenCalled();
    const messages = warn.mock.calls.map((call) => String(call[0]));
    expect(
      messages.some(
        (message) =>
          message.includes("[silent-vite] DI:") &&
          message.includes("несколько реализаций"),
      ),
      messages.join("\n"),
    ).toBe(true);
    expect(result?.code).toContain("class Service");
  });

  it("error падает с понятным сообщением", async () => {
    const root = createProject();
    const plugin = createPlugin({ root, di: "error" });
    await start(plugin, createCache());

    await expect(
      plugin.transform?.(SERVICE_SOURCE, serviceFile(root)),
    ).rejects.toThrow(/несколько реализаций/);
  });

  it("allow молчит и компилирует без фабрики", async () => {
    const root = createProject();
    const plugin = createPlugin({ root, di: "allow" });
    await start(plugin, createCache());

    const warn = vi.fn();
    const result = (await plugin.transform?.call(
      { warn },
      SERVICE_SOURCE,
      serviceFile(root),
    )) as { code: string } | undefined;

    expect(warn).not.toHaveBeenCalled();
    expect(result?.code).toContain("class Service");
    expect(result?.code).not.toContain("silent.di.create");
  });
});
