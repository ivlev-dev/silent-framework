import * as path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Plugin } from "vite";
import { silent } from "../src/index.js";
import { scan as nativeScan } from "@ivlev-dev/silent-swc";

// Addon старой версии: нет экспорта scanFiles.
vi.mock("@ivlev-dev/silent-swc", () => ({
  transform: vi.fn(() =>
    JSON.stringify({ code: "empty", map: null, diagnostics: [] }),
  ),
  scan: vi.fn(() => JSON.stringify({ interfaces: {}, values: {} })),
  version: vi.fn(() => "test"),
}));

const scanMock = vi.mocked(nativeScan);

interface Hooks {
  buildStart?: () => Promise<void> | void;
  watchChange?: (id: string, change: { event: string }) => void | Promise<void>;
  transform?: (code: string, id: string) => Promise<unknown> | unknown;
}

const createPlugin = (): Hooks => silent() as unknown as Hooks;

const fileFor = (...segments: string[]): string =>
  path.resolve(process.cwd(), ...segments);

describe("инкрементальный скан без scanFiles", () => {
  beforeEach(() => {
    scanMock.mockReset();
    scanMock.mockImplementation(
      () => JSON.stringify({ interfaces: {}, values: {} }),
    );
  });

  it("откатывается на полный scan, если addon не экспортирует scanFiles", async () => {
    const plugin = createPlugin();
    await plugin.buildStart?.();
    expect(scanMock).toHaveBeenCalledTimes(1);

    await plugin.watchChange?.(fileFor("src", "types.ts"), { event: "update" });
    await plugin.transform?.("code", fileFor("src", "app.ts"));

    expect(scanMock).toHaveBeenCalledTimes(2);
  });
});
