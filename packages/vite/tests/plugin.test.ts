import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { ConfigEnv, Plugin, ResolvedConfig, UserConfig } from "vite";
import { silent } from "../src/index.js";
import type { SilentOptions } from "../src/index.js";
import { matchesPattern } from "../src/options.js";
import {
  transform as nativeTransform,
  scan as nativeScan,
  scanFiles as nativeScanFiles,
} from "@ivlev-dev/silent-swc";

const transformMock = vi.mocked(nativeTransform);
const scanMock = vi.mocked(nativeScan);
const scanFilesMock = vi.mocked(nativeScanFiles);

vi.mock("@ivlev-dev/silent-swc", () => ({
  transform: vi.fn(() =>
    JSON.stringify({ code: "empty", map: null, diagnostics: [] }),
  ),
  scan: vi.fn(() => JSON.stringify({ interfaces: {}, values: {} })),
  scanFiles: vi.fn(() => JSON.stringify({ interfaces: {}, values: {} })),
  version: vi.fn(() => "test"),
}));

interface CallableHooks {
  config?: (
    config?: UserConfig,
    env?: ConfigEnv,
  ) => { define?: Record<string, string> } | undefined;
  buildStart?: () => Promise<void> | void;
  configResolved?: (config: ResolvedConfig) => void;
  transform?: (
    code: string,
    id: string,
    options?: { ssr?: boolean; inMap?: unknown },
  ) => Promise<unknown> | unknown;
  watchChange?: (id: string, change: { event: string }) => void | Promise<void>;
  handleHotUpdate?: (context: { file: string }) => void | Promise<void>;
}

const createPlugin = (options?: SilentOptions): CallableHooks =>
  silent(options) as unknown as CallableHooks;

const fileFor = (...segments: string[]): string =>
  path.resolve(process.cwd(), ...segments);

const cacheDirectories: string[] = [];

afterEach(() => {
  for (const directory of cacheDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

type TransformOutput = {
  code?: string;
  map?: string | null;
  warnings?: string[];
} | null;

beforeEach(() => {
  transformMock.mockReset();
  scanMock.mockReset();
  scanFilesMock.mockReset();
  transformMock.mockImplementation((source: string) =>
    JSON.stringify({
      code: `${source} /* compiled */`,
      map: null,
      diagnostics: [],
    }),
  );
  scanMock.mockImplementation(
    (root: string) =>
      JSON.stringify({
        interfaces: {
          [`${root}/types.ts#Store`]: [`${root}/memory-store.ts#MemoryStore`],
        },
        values: { [`${root}/types.ts`]: ["Store", "createStore"] },
      }),
  );
  scanFilesMock.mockImplementation(
    () => JSON.stringify({ interfaces: {}, values: {} }),
  );
  vi.unstubAllEnvs();
});

describe("silent()", () => {
  it("view: false отключает view-рантайм через define", () => {
    expect(createPlugin({ view: false }).config?.()).toEqual({
      define: { __SILENT_VIEW__: "false" },
      build: { modulePreload: { polyfill: false } },
    });
  });

  it("view: false не переопределяет modulePreload из конфига", () => {
    const plugin = createPlugin({ view: false });
    expect(
      plugin.config?.({ build: { modulePreload: { polyfill: true } } }),
    ).toEqual({ define: { __SILENT_VIEW__: "false" } });
    expect(plugin.config?.({ build: { modulePreload: false } })).toEqual({
      define: { __SILENT_VIEW__: "false" },
    });
  });

  it("клиентская сборка вырезает серверный код", () => {
    const plugin = createPlugin();
    expect(plugin.config?.({}, { command: "build", mode: "production" })).toEqual({
      define: { __SILENT_SERVER__: "false", __SILENT_DEV__: "false" },
    });
    expect(
      plugin.config?.({ build: { ssr: "src/entry-server.tsx" } }, {
        command: "build",
        mode: "production",
      }),
    ).toEqual({ define: { __SILENT_DEV__: "false" } });
    expect(plugin.config?.({}, { command: "serve", mode: "development" })).toEqual({
      define: { __SILENT_DEV__: "true" },
    });
  });

  it("define __SILENT_DEV__ включает dev-предупреждения только в serve", () => {
    const plugin = createPlugin();
    expect(plugin.config?.({}, { command: "build", mode: "production" })).toEqual({
      define: { __SILENT_SERVER__: "false", __SILENT_DEV__: "false" },
    });
    expect(
      plugin.config?.({ build: { ssr: "src/entry-server.tsx" } }, {
        command: "build",
        mode: "production",
      }),
    ).toEqual({ define: { __SILENT_DEV__: "false" } });
    expect(plugin.config?.({}, { command: "serve", mode: "development" })).toEqual({
      define: { __SILENT_DEV__: "true" },
    });
    expect(plugin.config?.({})).toBeUndefined();
  });

  it("hydrate: false вырезает клиентскую гидрацию через define", () => {
    expect(createPlugin({ hydrate: false }).config?.()).toEqual({
      define: { __SILENT_HYDRATE__: "false" },
    });
  });

  it("hydrate и view можно отключить вместе", () => {
    expect(createPlugin({ view: false, hydrate: false }).config?.()).toEqual({
      define: { __SILENT_HYDRATE__: "false", __SILENT_VIEW__: "false" },
      build: { modulePreload: { polyfill: false } },
    });
  });

  it("по умолчанию не задаёт define для view и hydrate", () => {
    expect(createPlugin().config?.()).toBeUndefined();
    expect(createPlugin({ hydrate: true }).config?.()).toBeUndefined();
  });

  it("по умолчанию не задаёт define для view", () => {
    expect(createPlugin().config?.()).toBeUndefined();
    expect(createPlugin({ view: true }).config?.()).toBeUndefined();
  });

  it("возвращает плагин с enforce: pre и именем silent", () => {
    const plugin: Plugin = silent();
    expect(plugin.name).toBe("silent");
    expect(plugin.enforce).toBe("pre");
  });

  it("buildStart лениво сканирует индекс и пишет его один раз", async () => {
    const plugin = createPlugin();
    expect(scanMock).not.toHaveBeenCalled();

    await plugin.buildStart?.();
    await plugin.buildStart?.();

    expect(scanMock).toHaveBeenCalledTimes(1);
    expect(scanMock).toHaveBeenCalledWith(process.cwd(), expect.any(String));
  });

  it("transform вызывает native transform и возвращает code и map", async () => {
    transformMock.mockImplementation((source: string) =>
      JSON.stringify({
        code: `${source} // out`,
        map: "map-string",
        diagnostics: [],
      }),
    );
    const plugin = createPlugin();
    await plugin.buildStart?.();

    const file = fileFor("src", "app.ts");
    const result = (await plugin.transform?.("const a = 1;", file)) as
      | TransformOutput
      | undefined;

    expect(transformMock).toHaveBeenCalledTimes(1);
    expect(transformMock).toHaveBeenCalledWith(
      "const a = 1;",
      file,
      expect.any(String),
      expect.any(String),
    );
    expect(result?.code).toBe("const a = 1; // out");
    expect(result?.map).toBe("map-string");
    expect(result?.warnings).toEqual([]);
  });

  it("кеш индекса: несколько transform не вызывают scan повторно", async () => {
    const plugin = createPlugin();
    await plugin.buildStart?.();
    await plugin.transform?.("one", fileFor("src", "a.ts"));
    await plugin.transform?.("two", fileFor("src", "b.ts"));

    expect(scanMock).toHaveBeenCalledTimes(1);
  });

  it("кеширует результат transform по содержимому в cacheDir", async () => {
    const cacheDir = mkdtempSync(path.join(tmpdir(), "silent-vite-cache-"));
    cacheDirectories.push(cacheDir);
    const plugin = createPlugin();
    plugin.configResolved?.({ cacheDir } as ResolvedConfig);
    await plugin.buildStart?.();

    const file = fileFor("src", "cached.ts");
    const first = await plugin.transform?.("const x = 1;", file);
    const second = await plugin.transform?.("const x = 1;", file);
    expect(transformMock).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);

    await plugin.transform?.("const x = 2;", file);
    expect(transformMock).toHaveBeenCalledTimes(2);
  });

  it("первый transform сканирует индекс, если buildStart не вызывался", async () => {
    const plugin = createPlugin();
    await plugin.transform?.("one", fileFor("src", "a.ts"));
    expect(scanMock).toHaveBeenCalledTimes(1);

    await plugin.transform?.("two", fileFor("src", "b.ts"));
    expect(scanMock).toHaveBeenCalledTimes(1);
  });

  it("передаёт alias и tsconfig paths в scan и transform", async () => {
    const project = mkdtempSync(path.join(tmpdir(), "silent-vite-alias-"));
    const cacheDir = mkdtempSync(path.join(tmpdir(), "silent-vite-cache-"));
    cacheDirectories.push(project, cacheDir);
    writeFileSync(
      path.join(project, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: { "@/*": ["src/*"] },
        },
      }),
    );

    const plugin = createPlugin({ root: project });
    plugin.configResolved?.({
      cacheDir,
      resolve: { alias: [{ find: "~lib", replacement: path.join(project, "lib") }] },
    } as unknown as ResolvedConfig);

    await plugin.buildStart?.();
    const scanOptions = JSON.parse(scanMock.mock.calls[0]?.[1] ?? "{}");
    expect(scanOptions.aliases).toEqual(
      expect.arrayContaining([
        { find: "~lib", replacement: path.join(project, "lib") },
        { find: "@/*", replacement: path.join(project, "src/*") },
      ]),
    );

    await plugin.transform?.("code", path.join(project, "src", "app.ts"));
    const transformOptions = JSON.parse(transformMock.mock.calls[0]?.[2] ?? "{}");
    expect(transformOptions.aliases).toEqual(scanOptions.aliases);
  });

  it("сохраняет Vite-алиасы после правки tsconfig.json", async () => {
    const project = mkdtempSync(path.join(tmpdir(), "silent-vite-alias-watch-"));
    const cacheDir = mkdtempSync(path.join(tmpdir(), "silent-vite-cache-"));
    cacheDirectories.push(project, cacheDir);
    const tsconfig = path.join(project, "tsconfig.json");
    writeFileSync(
      tsconfig,
      JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } },
      }),
    );

    const plugin = createPlugin({ root: project });
    plugin.configResolved?.({
      cacheDir,
      resolve: { alias: [{ find: "~lib", replacement: path.join(project, "lib") }] },
    } as unknown as ResolvedConfig);

    writeFileSync(
      tsconfig,
      JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "#app/*": ["app/*"] } },
      }),
    );
    plugin.watchChange?.(tsconfig, { event: "update" });

    await plugin.transform?.("code", path.join(project, "src", "app.ts"));

    const scanAliases = JSON.parse(scanMock.mock.calls[0]?.[1] ?? "{}").aliases;
    expect(scanAliases).toEqual(
      expect.arrayContaining([
        { find: "~lib", replacement: path.join(project, "lib") },
        { find: "#app/*", replacement: path.join(project, "app/*") },
      ]),
    );
    expect(scanAliases.map((rule: { find: string }) => rule.find)).not.toContain("@/*");

    const transformAliases = JSON.parse(transformMock.mock.calls[0]?.[2] ?? "{}").aliases;
    expect(transformAliases).toEqual(scanAliases);
  });

  it("пересобирает алиасы при изменении tsconfig.app.json", async () => {
    const project = mkdtempSync(path.join(tmpdir(), "silent-vite-alias-app-"));
    const cacheDir = mkdtempSync(path.join(tmpdir(), "silent-vite-cache-"));
    cacheDirectories.push(project, cacheDir);
    const tsconfigApp = path.join(project, "tsconfig.app.json");
    writeFileSync(
      tsconfigApp,
      JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } },
      }),
    );

    const plugin = createPlugin({ root: project });
    plugin.configResolved?.({
      cacheDir,
      resolve: { alias: [{ find: "~lib", replacement: path.join(project, "lib") }] },
    } as unknown as ResolvedConfig);

    writeFileSync(
      tsconfigApp,
      JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "@/*": ["app/*"] } },
      }),
    );
    plugin.watchChange?.(tsconfigApp, { event: "update" });

    await plugin.transform?.("code", path.join(project, "src", "app.ts"));

    const optionsJson = JSON.parse(transformMock.mock.calls[0]?.[2] ?? "{}");
    expect(optionsJson.aliases).toEqual(
      expect.arrayContaining([
        { find: "~lib", replacement: path.join(project, "lib") },
        { find: "@/*", replacement: path.join(project, "app/*") },
      ]),
    );
  });

  it("инкрементальный апдейт не перезаписывается полным сканом", async () => {
    const plugin = createPlugin();
    const file = fileFor("src", "other.ts");
    const root = process.cwd();

    scanMock.mockImplementation(() => JSON.stringify({ interfaces: {}, values: {} }));
    scanFilesMock.mockImplementation(
      () =>
        JSON.stringify({
          interfaces: {},
          values: { [`${root}/src/other`]: ["Late"] },
        }),
    );

    // Полный scan встаёт в очередь первым, инкрементальный — за ним.
    const full = plugin.buildStart?.();
    const incremental = plugin.watchChange?.(file, { event: "update" });
    await Promise.all([full, incremental]);

    await plugin.transform?.("code", fileFor("src", "app.ts"));

    const usedIndex = JSON.parse(transformMock.mock.calls.at(-1)?.[3] ?? "{}");
    expect(usedIndex.values[`${root}/src/other`]).toEqual(["Late"]);
    expect(scanMock).toHaveBeenCalledTimes(1);
    expect(scanFilesMock).toHaveBeenCalledTimes(1);
  });

  it("смена tsconfig вызывает полный scan, а не инкрементальный", async () => {
    const project = mkdtempSync(path.join(tmpdir(), "silent-vite-tsconfig-scan-"));
    const cacheDir = mkdtempSync(path.join(tmpdir(), "silent-vite-cache-"));
    cacheDirectories.push(project, cacheDir);
    const tsconfig = path.join(project, "tsconfig.json");
    writeFileSync(
      tsconfig,
      JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } },
      }),
    );

    const plugin = createPlugin({ root: project });
    plugin.configResolved?.({ cacheDir } as ResolvedConfig);
    await plugin.buildStart?.();
    expect(scanMock).toHaveBeenCalledTimes(1);

    writeFileSync(
      tsconfig,
      JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "@/*": ["app/*"] } },
      }),
    );
    await plugin.watchChange?.(tsconfig, { event: "update" });
    await plugin.transform?.("code", path.join(project, "src", "app.ts"));

    expect(scanMock).toHaveBeenCalledTimes(2);
    expect(scanFilesMock).not.toHaveBeenCalled();
    const aliases = JSON.parse(scanMock.mock.calls[1]?.[1] ?? "{}").aliases;
    expect(aliases).toEqual(
      expect.arrayContaining([
        { find: "@/*", replacement: path.join(project, "app/*") },
      ]),
    );
  });

  it("options JSON содержит swc, requirePreloader, runtime, hmr", async () => {
    const plugin = createPlugin({
      swc: { target: "es2015" },
      requirePreloader: true,
      runtime: "@custom/runtime",
      hmr: true,
    });

    await plugin.transform?.("code", fileFor("src", "app.ts"));

    const optionsJson = JSON.parse(transformMock.mock.calls[0]?.[2] ?? "{}");
    expect(optionsJson.swc).toEqual({ target: "es2015" });
    expect(optionsJson.requirePreloader).toBe(true);
    expect(optionsJson.runtime).toBe("@custom/runtime");
    expect(optionsJson.hmr).toBe(true);
  });

  it("options JSON содержит значения по умолчанию", async () => {
    const plugin = createPlugin();
    await plugin.transform?.("code", fileFor("src", "app.ts"));

    const optionsJson = JSON.parse(transformMock.mock.calls[0]?.[2] ?? "{}");
    expect(optionsJson.swc).toEqual({});
    expect(optionsJson.requirePreloader).toBe(false);
    expect(optionsJson.runtime).toBe("@ivlev-dev/silent-core");
    expect(optionsJson.hmr).toBe(true);
    expect(optionsJson.hydrate).toBe(true);
  });

  it("options JSON передаёт hydrate", async () => {
    const plugin = createPlugin({ hydrate: false });
    await plugin.transform?.("code", fileFor("src", "app.ts"));

    const optionsJson = JSON.parse(transformMock.mock.calls[0]?.[2] ?? "{}");
    expect(optionsJson.hydrate).toBe(false);
  });

  it("options JSON передаёт политику di", async () => {
    const byDefault = createPlugin();
    await byDefault.transform?.("code", fileFor("src", "a.ts"));
    expect(JSON.parse(transformMock.mock.calls[0]?.[2] ?? "{}").di).toBe("warn");

    transformMock.mockClear();
    const strict = createPlugin({ di: "error" });
    await strict.transform?.("code", fileFor("src", "b.ts"));
    expect(JSON.parse(transformMock.mock.calls[0]?.[2] ?? "{}").di).toBe("error");
  });

  it("не просит sourcemap, если Vite его не запросил", async () => {
    const cacheDir = mkdtempSync(path.join(tmpdir(), "silent-vite-map-off-"));
    cacheDirectories.push(cacheDir);
    const plugin = createPlugin();
    plugin.configResolved?.({
      cacheDir,
      command: "build",
      build: { sourcemap: false },
    } as unknown as ResolvedConfig);
    await plugin.transform?.("code", fileFor("src", "app.ts"));

    const optionsJson = JSON.parse(transformMock.mock.calls[0]?.[2] ?? "{}");
    expect(optionsJson.swc.sourceMaps).toBe(false);
  });

  it("оставляет sourcemap и явную настройку пользователя", async () => {
    const cacheDir = mkdtempSync(path.join(tmpdir(), "silent-vite-map-on-"));
    cacheDirectories.push(cacheDir);
    const plugin = createPlugin();
    plugin.configResolved?.({
      cacheDir,
      command: "build",
      build: { sourcemap: true },
    } as unknown as ResolvedConfig);
    await plugin.transform?.("code", fileFor("src", "app.ts"));
    expect(
      JSON.parse(transformMock.mock.calls[0]?.[2] ?? "{}").swc.sourceMaps,
    ).toBeUndefined();

    transformMock.mockClear();
    const explicit = createPlugin({ swc: { sourceMaps: true } });
    explicit.configResolved?.({
      cacheDir,
      command: "build",
      build: { sourcemap: false },
    } as unknown as ResolvedConfig);
    await explicit.transform?.("code", fileFor("src", "app.ts"));
    expect(
      JSON.parse(transformMock.mock.calls[0]?.[2] ?? "{}").swc.sourceMaps,
    ).toBe(true);
  });

  it("передаёт результат scan как indexJson", async () => {
    scanMock.mockImplementation(
      () =>
        JSON.stringify({
          interfaces: { "types.ts#Store": ["impl.ts#MemoryStore"] },
          values: { "types.ts": ["Store"] },
        }),
    );
    const plugin = createPlugin();
    await plugin.buildStart?.();
    await plugin.transform?.("code", fileFor("src", "app.ts"));

    const indexJson = JSON.parse(transformMock.mock.calls[0]?.[3] ?? "{}");
    expect(indexJson).toEqual({
      interfaces: { "types.ts#Store": ["impl.ts#MemoryStore"] },
      values: { "types.ts": ["Store"] },
    });
  });

  it("при index: false не сканирует и передаёт пустой индекс", async () => {
    const plugin = createPlugin({ index: false });
    await plugin.buildStart?.();
    await plugin.transform?.("code", fileFor("src", "app.ts"));

    expect(scanMock).not.toHaveBeenCalled();
    const indexJson = JSON.parse(transformMock.mock.calls[0]?.[3] ?? "{}");
    expect(indexJson).toEqual({ interfaces: {}, values: {} });
  });

  it("не трансформирует файлы вне include", async () => {
    const plugin = createPlugin();
    const result = (await plugin.transform?.(
      "body { color: red; }",
      fileFor("src", "styles.css"),
    )) as TransformOutput | undefined;

    expect(result).toBeNull();
    expect(transformMock).not.toHaveBeenCalled();
  });

  it("исключает файлы по exclude", async () => {
    const plugin = createPlugin({ exclude: /vendor/ });
    const result = (await plugin.transform?.(
      "code",
      fileFor("vendor", "lib.ts"),
    )) as TransformOutput | undefined;

    expect(result).toBeNull();
    expect(transformMock).not.toHaveBeenCalled();
  });

  it("не трогает файлы в node_modules по умолчанию", async () => {
    const plugin = createPlugin();
    const result = (await plugin.transform?.(
      "code",
      fileFor("node_modules", "pkg", "index.js"),
    )) as TransformOutput | undefined;

    expect(result).toBeNull();
    expect(transformMock).not.toHaveBeenCalled();
  });

  it("отбрасывает query и hash от module id", async () => {
    const plugin = createPlugin();
    const file = fileFor("src", "app.ts");

    await plugin.transform?.("one", `${file}?t=123#hash`);
    await plugin.transform?.("two", `${file}?raw query`);

    expect(transformMock).toHaveBeenCalledTimes(2);
    expect(transformMock.mock.calls[0]?.[1]).toBe(file);
    expect(transformMock.mock.calls[1]?.[1]).toBe(file);
  });

  it("не индексирует файлы из exclude", async () => {
    const root = process.cwd();
    scanMock.mockImplementation(
      () =>
        JSON.stringify({
          interfaces: {
            [`${root}/src/types#Store`]: [
              `${root}/src/vendor/store#FakeStore`,
              `${root}/src/memory-store#MemoryStore`,
            ],
          },
          values: {
            [`${root}/src/types`]: ["Store"],
            [`${root}/src/vendor/store`]: ["FakeStore"],
            [`${root}/src/memory-store`]: ["MemoryStore"],
          },
        }),
    );
    const plugin = createPlugin({ exclude: /vendor/ });
    await plugin.buildStart?.();
    await plugin.transform?.("code", fileFor("src", "app.ts"));

    const index = JSON.parse(transformMock.mock.calls.at(-1)?.[3] ?? "{}");
    expect(index.values[`${root}/src/vendor/store`]).toBeUndefined();
    expect(index.interfaces[`${root}/src/types#Store`]).toEqual([
      `${root}/src/memory-store#MemoryStore`,
    ]);
  });

  it("не сканирует исключённый файл инкрементально", async () => {
    const plugin = createPlugin({ exclude: /vendor/ });
    await plugin.buildStart?.();

    await plugin.watchChange?.(fileFor("vendor", "lib.ts"), { event: "update" });
    await plugin.transform?.("code", fileFor("src", "app.ts"));

    expect(scanFilesMock).not.toHaveBeenCalled();
  });

  it("берёт root из config.root, если опция не задана", async () => {
    const project = realpathSync.native(
      mkdtempSync(path.join(tmpdir(), "silent-vite-root-")),
    );
    const cacheDir = mkdtempSync(path.join(tmpdir(), "silent-vite-cache-"));
    cacheDirectories.push(project, cacheDir);
    mkdirSync(path.join(project, "src"), { recursive: true });

    const plugin = createPlugin();
    plugin.configResolved?.({
      root: project,
      cacheDir,
      command: "build",
    } as unknown as ResolvedConfig);

    await plugin.buildStart?.();
    await plugin.transform?.("code", path.join(project, "src", "app.ts"));

    expect(scanMock).toHaveBeenCalledWith(project, expect.any(String));
    expect(transformMock).toHaveBeenCalledWith(
      "code",
      path.join(project, "src", "app.ts"),
      expect.any(String),
      expect.any(String),
    );
  });

  it("явный root не перекрывается config.root", async () => {
    const explicit = realpathSync.native(
      mkdtempSync(path.join(tmpdir(), "silent-vite-root-explicit-")),
    );
    const configured = realpathSync.native(
      mkdtempSync(path.join(tmpdir(), "silent-vite-root-config-")),
    );
    const cacheDir = mkdtempSync(path.join(tmpdir(), "silent-vite-cache-"));
    cacheDirectories.push(explicit, configured, cacheDir);

    const plugin = createPlugin({ root: explicit });
    plugin.configResolved?.({
      root: configured,
      cacheDir,
      command: "build",
    } as unknown as ResolvedConfig);
    await plugin.buildStart?.();

    expect(scanMock).toHaveBeenCalledWith(explicit, expect.any(String));
  });

  it("scan: \"full\" не сканирует одно изменение дважды", async () => {
    const plugin = createPlugin({ scan: "full" });
    await plugin.buildStart?.();
    expect(scanMock).toHaveBeenCalledTimes(1);

    const file = fileFor("src", "types.ts");
    await plugin.watchChange?.(file, { event: "update" });
    await plugin.handleHotUpdate?.({ file });

    expect(scanMock).toHaveBeenCalledTimes(2);
    await plugin.transform?.("code", fileFor("src", "app.ts"));
    expect(scanMock).toHaveBeenCalledTimes(2);
  });

  it("инвалидирует кеш после пересборки нативного addon", async () => {
    const cacheDir = mkdtempSync(path.join(tmpdir(), "silent-vite-addon-"));
    cacheDirectories.push(cacheDir);
    const entry = createRequire(import.meta.url).resolve(
      "@ivlev-dev/silent-swc",
    );
    const nativeDirectory = path.join(path.dirname(entry), "native");
    const addonName = readdirSync(nativeDirectory).find((name) =>
      name.endsWith(".node"),
    );
    if (addonName === undefined) {
      return;
    }
    const addon = path.join(nativeDirectory, addonName);
    const original = statSync(addon);
    const file = fileFor("src", "addon-cache.ts");
    try {
      const plugin = createPlugin();
      plugin.configResolved?.({ cacheDir, command: "build" } as ResolvedConfig);
      await plugin.transform?.("const value = 1;", file);
      expect(transformMock).toHaveBeenCalledTimes(1);

      const rebuilt = new Date(original.mtimeMs + 10_000);
      utimesSync(addon, original.atime, rebuilt);

      await plugin.transform?.("const value = 1;", file);
      expect(transformMock).toHaveBeenCalledTimes(2);
    } finally {
      utimesSync(addon, original.atime, original.mtime);
    }
  });

  it("предупреждает о RegExp-алиасах и не роняет конфиг", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cacheDir = mkdtempSync(path.join(tmpdir(), "silent-vite-regexp-"));
    cacheDirectories.push(cacheDir);
    try {
      const plugin = createPlugin();
      plugin.configResolved?.({
        cacheDir,
        command: "build",
        resolve: { alias: [{ find: /^@\//, replacement: "/tmp/lib" }] },
      } as unknown as ResolvedConfig);

      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain("RegExp");
    } finally {
      warn.mockRestore();
    }
  });

  it("читает paths из унаследованного tsconfig", async () => {
    const project = mkdtempSync(path.join(tmpdir(), "silent-vite-extends-"));
    const cacheDir = mkdtempSync(path.join(tmpdir(), "silent-vite-cache-"));
    cacheDirectories.push(project, cacheDir);
    mkdirSync(path.join(project, "configs"), { recursive: true });
    writeFileSync(
      path.join(project, "configs", "base.json"),
      JSON.stringify({
        compilerOptions: { baseUrl: "..", paths: { "~/*": ["src/*"] } },
      }),
    );
    writeFileSync(
      path.join(project, "tsconfig.json"),
      JSON.stringify({ extends: "./configs/base" }),
    );

    const plugin = createPlugin({ root: project });
    plugin.configResolved?.({ cacheDir } as ResolvedConfig);
    await plugin.buildStart?.();

    const aliases = JSON.parse(scanMock.mock.calls[0]?.[1] ?? "{}").aliases;
    expect(aliases).toContainEqual({
      find: "~/*",
      replacement: path.join(project, "src", "*"),
    });
  });

  it("пропускает виртуальные модули", async () => {
    const plugin = createPlugin();
    const result1 = (await plugin.transform?.(
      "code",
      "\0virtual:module",
    )) as TransformOutput | undefined;
    const result2 = (await plugin.transform?.(
      "code",
      "virtual:module",
    )) as TransformOutput | undefined;

    expect(result1).toBeNull();
    expect(result2).toBeNull();
    expect(transformMock).not.toHaveBeenCalled();
  });

  it("пропускает файлы вне root", async () => {
    const plugin = createPlugin({ root: fileFor("projects", "app") });
    const result = (await plugin.transform?.(
      "code",
      fileFor("outside", "app.ts"),
    )) as TransformOutput | undefined;

    expect(result).toBeNull();
    expect(transformMock).not.toHaveBeenCalled();
  });

  it("трансформирует файлы внутри пользовательского root", async () => {
    scanMock.mockImplementation(
      () => JSON.stringify({ interfaces: {}, values: {} }),
    );
    const plugin = createPlugin({ root: fileFor("projects", "app") });
    await plugin.transform?.("code", fileFor("projects", "app", "src", "a.ts"));

    expect(transformMock).toHaveBeenCalledTimes(1);
    expect(transformMock.mock.calls[0]?.[1]).toBe(
      fileFor("projects", "app", "src", "a.ts"),
    );
  });

  it("трансформирует .js и .jsx файлы", async () => {
    const plugin = createPlugin();
    await plugin.buildStart?.();

    await plugin.transform?.("one", fileFor("src", "app.js"));
    await plugin.transform?.("two", fileFor("src", "app.jsx"));

    expect(transformMock).toHaveBeenCalledTimes(2);
  });

  it("нормализует RegExp с флагами g и y", async () => {
    const pluginG = createPlugin({ include: /\.(ts|js)$/g });
    const pluginY = createPlugin({ include: /\.(ts|js)$/y });
    const file = fileFor("src", "a.ts");

    await pluginG.transform?.("one", file);
    await pluginG.transform?.("two", file);
    await pluginY.transform?.("three", file);
    await pluginY.transform?.("four", file);

    expect(transformMock).toHaveBeenCalledTimes(4);
  });

  it("по умолчанию использует инкрементальный режим", async () => {
    const plugin = createPlugin();
    await plugin.buildStart?.();
    await plugin.watchChange?.(fileFor("src", "types.ts"), { event: "update" });

    expect(scanFilesMock).toHaveBeenCalledTimes(1);
    expect(scanMock).toHaveBeenCalledTimes(1);
  });

  it("scan: \"full\" на изменение выполняет полный scan без scanFiles", async () => {
    const plugin = createPlugin({ scan: "full" });
    await plugin.buildStart?.();
    expect(scanMock).toHaveBeenCalledTimes(1);

    await plugin.watchChange?.(fileFor("src", "types.ts"), { event: "update" });
    expect(scanMock).toHaveBeenCalledTimes(2);
    expect(scanFilesMock).not.toHaveBeenCalled();

    await plugin.transform?.("code", fileFor("src", "app.ts"));
    // Индекс уже пересобран изменением: transform не запускает ещё один scan.
    expect(scanMock).toHaveBeenCalledTimes(2);
  });

  it("SILENT_SCAN=full включает полный режим", async () => {
    vi.stubEnv("SILENT_SCAN", "full");
    const plugin = createPlugin();
    await plugin.buildStart?.();
    await plugin.watchChange?.(fileFor("src", "types.ts"), { event: "update" });

    expect(scanMock).toHaveBeenCalledTimes(2);
    expect(scanFilesMock).not.toHaveBeenCalled();
  });

  it("SILENT_SCAN_FULL=1 включает полный режим", async () => {
    vi.stubEnv("SILENT_SCAN_FULL", "1");
    const plugin = createPlugin();
    await plugin.buildStart?.();
    await plugin.watchChange?.(fileFor("src", "types.ts"), { event: "update" });

    expect(scanMock).toHaveBeenCalledTimes(2);
    expect(scanFilesMock).not.toHaveBeenCalled();
  });

  it("инкрементально обновляет индекс на watchChange для TS/JS и игнорирует .css", async () => {
    const plugin = createPlugin();
    await plugin.buildStart?.();
    await plugin.transform?.("one", fileFor("src", "a.ts"));
    expect(scanMock).toHaveBeenCalledTimes(1);

    const typesFile = fileFor("src", "types.ts");
    await plugin.watchChange?.(typesFile, { event: "update" });
    await plugin.transform?.("two", fileFor("src", "a.ts"));
    expect(scanMock).toHaveBeenCalledTimes(1);
    expect(scanFilesMock).toHaveBeenCalledTimes(1);
    expect(scanFilesMock).toHaveBeenCalledWith(
      process.cwd(),
      JSON.stringify([typesFile]),
      expect.any(String),
    );

    await plugin.watchChange?.(fileFor("src", "styles.css"), { event: "update" });
    await plugin.transform?.("three", fileFor("src", "a.ts"));
    expect(scanFilesMock).toHaveBeenCalledTimes(1);

    await plugin.watchChange?.(fileFor("src", "app.js"), { event: "update" });
    await plugin.transform?.("four", fileFor("src", "a.ts"));
    expect(scanFilesMock).toHaveBeenCalledTimes(2);
    expect(scanMock).toHaveBeenCalledTimes(1);
  });

  it("удаляет записи модуля при unlink без вызова scanFiles", async () => {
    const root = process.cwd();
    scanMock.mockImplementation(
      () =>
        JSON.stringify({
          interfaces: {
            [`${root}/src/types#Store`]: [`${root}/src/memory-store#MemoryStore`],
          },
          values: {
            [`${root}/src/types`]: ["Store"],
            [`${root}/src/memory-store`]: ["MemoryStore"],
          },
        }),
    );
    const plugin = createPlugin();
    await plugin.buildStart?.();

    await plugin.watchChange?.(fileFor("src", "types.ts"), { event: "delete" });
    await plugin.transform?.("code", fileFor("src", "app.ts"));

    expect(scanFilesMock).not.toHaveBeenCalled();
    const index = JSON.parse(transformMock.mock.calls.at(-1)?.[3] ?? "{}");
    expect(index.values[`${root}/src/types`]).toBeUndefined();
    // Реализация из другого модуля остаётся нетронутой: правка файла с
    // интерфейсом не должна обнулять чужие реализации.
    expect(index.interfaces[`${root}/src/types#Store`]).toEqual([
      `${root}/src/memory-store#MemoryStore`,
    ]);
    expect(index.values[`${root}/src/memory-store`]).toEqual(["MemoryStore"]);
  });

  it("при delete удаляет пустой токен интерфейса", async () => {
    const root = process.cwd();
    scanMock.mockImplementation(
      () =>
        JSON.stringify({
          interfaces: { [`${root}/src/types#Store`]: [] },
          values: { [`${root}/src/types`]: ["Store"] },
        }),
    );
    const plugin = createPlugin();
    await plugin.buildStart?.();

    await plugin.watchChange?.(fileFor("src", "types.ts"), { event: "delete" });
    await plugin.transform?.("code", fileFor("src", "app.ts"));

    const index = JSON.parse(transformMock.mock.calls.at(-1)?.[3] ?? "{}");
    expect(index.interfaces).toEqual({});
    expect(index.values).toEqual({});
  });

  it("при изменении файла с интерфейсом сохраняет токен с чужими реализациями", async () => {
    const root = process.cwd();
    scanMock.mockImplementation(
      () =>
        JSON.stringify({
          interfaces: {
            [`${root}/src/types#Store`]: [`${root}/src/memory-store#MemoryStore`],
          },
          values: {
            [`${root}/src/types`]: ["Store"],
            [`${root}/src/memory-store`]: ["MemoryStore"],
          },
        }),
    );
    scanFilesMock.mockImplementation(() => JSON.stringify({ interfaces: {}, values: {} }));
    const plugin = createPlugin();
    await plugin.buildStart?.();

    // types.ts больше не объявляет Store, но реализация в memory-store.ts
    // не пересканировалась — токен с ней должен остаться.
    await plugin.watchChange?.(fileFor("src", "types.ts"), { event: "update" });
    await plugin.transform?.("code", fileFor("src", "app.ts"));

    const index = JSON.parse(transformMock.mock.calls.at(-1)?.[3] ?? "{}");
    expect(index.interfaces[`${root}/src/types#Store`]).toEqual([
      `${root}/src/memory-store#MemoryStore`,
    ]);
  });

  it("добавляет записи модуля на событие create", async () => {
    const root = process.cwd();
    scanFilesMock.mockImplementation(
      () =>
        JSON.stringify({
          interfaces: {
            [`${root}/src/logger#Logger`]: [`${root}/src/console-logger#ConsoleLogger`],
          },
          values: { [`${root}/src/console-logger`]: ["ConsoleLogger"] },
        }),
    );
    const plugin = createPlugin();
    await plugin.buildStart?.();

    const file = fileFor("src", "console-logger.ts");
    await plugin.watchChange?.(file, { event: "create" });
    await plugin.transform?.("code", fileFor("src", "app.ts"));

    expect(scanFilesMock).toHaveBeenCalledWith(
      root,
      JSON.stringify([file]),
      expect.any(String),
    );
    const index = JSON.parse(transformMock.mock.calls.at(-1)?.[3] ?? "{}");
    expect(index.values[`${root}/src/console-logger`]).toEqual(["ConsoleLogger"]);
    expect(index.interfaces[`${root}/src/logger#Logger`]).toEqual([
      `${root}/src/console-logger#ConsoleLogger`,
    ]);
  });

  it("не инвалидирует индекс на watchChange для виртуальных модулей", async () => {
    const plugin = createPlugin();
    await plugin.buildStart?.();
    await plugin.transform?.("one", fileFor("src", "a.ts"));

    await plugin.watchChange?.("\0virtual:module", { event: "update" });
    await plugin.transform?.("two", fileFor("src", "a.ts"));
    expect(scanMock).toHaveBeenCalledTimes(1);
    expect(scanFilesMock).not.toHaveBeenCalled();
  });

  it("инкрементально обновляет индекс на handleHotUpdate", async () => {
    const plugin = createPlugin();
    await plugin.buildStart?.();
    await plugin.transform?.("one", fileFor("src", "a.ts"));

    const file = fileFor("src", "vm.ts");
    await plugin.handleHotUpdate?.({ file });
    await plugin.transform?.("two", fileFor("src", "a.ts"));

    expect(scanMock).toHaveBeenCalledTimes(1);
    expect(scanFilesMock).toHaveBeenCalledWith(
      process.cwd(),
      JSON.stringify([file]),
      expect.any(String),
    );
  });

  it("не инвалидирует кеш трансформаций, если индекс не изменился", async () => {
    const cacheDir = mkdtempSync(path.join(tmpdir(), "silent-vite-stable-index-"));
    cacheDirectories.push(cacheDir);
    const root = realpathSync.native(process.cwd());
    scanMock.mockImplementation(
      () =>
        JSON.stringify({
          interfaces: {},
          values: { [`${root}/src/types`]: ["Store"] },
        }),
    );
    scanFilesMock.mockImplementation(
      () =>
        JSON.stringify({
          interfaces: {},
          values: { [`${root}/src/types`]: ["Store"] },
        }),
    );
    const plugin = createPlugin();
    plugin.configResolved?.({ cacheDir } as ResolvedConfig);
    await plugin.buildStart?.();

    const file = fileFor("src", "types.ts");
    const code = "export type Store = { get(): string };";
    await plugin.transform?.(code, file);
    expect(transformMock).toHaveBeenCalledTimes(1);

    await plugin.watchChange?.(file, { event: "update" });
    await plugin.transform?.(code, file);

    expect(scanFilesMock).toHaveBeenCalledTimes(1);
    expect(transformMock).toHaveBeenCalledTimes(1);
  });

  it("бросает ошибку при невалидном JSON от native transform", async () => {
    transformMock.mockImplementationOnce(() => "not-json{");
    const plugin = createPlugin();
    await plugin.buildStart?.();

    await expect(
      plugin.transform?.("code", fileFor("src", "a.ts")),
    ).rejects.toThrow(/невалидный JSON[\s\S]*a\.ts/);
  });

  it("пробрасывает ошибки native transform как Error с filename", async () => {
    transformMock.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    const plugin = createPlugin();
    await plugin.buildStart?.();

    await expect(
      plugin.transform?.("code", fileFor("src", "a.ts")),
    ).rejects.toThrow(/a\.ts[\s\S]*boom/);
  });

  it("бросает понятную ошибку, если transform вернул неожиданную структуру", async () => {
    transformMock.mockImplementationOnce(() => JSON.stringify({ foo: 1 }));
    const plugin = createPlugin();

    await expect(
      plugin.transform?.("code", fileFor("src", "a.ts")),
    ).rejects.toThrow(/неожиданную структуру[\s\S]*a\.ts/);
  });

  it("охватывает mts/cjs и другие расширения", async () => {
    const plugin = createPlugin();
    await plugin.buildStart?.();

    await plugin.transform?.("one", fileFor("src", "a.mts"));
    await plugin.transform?.("two", fileFor("src", "b.cjs"));
    await plugin.transform?.("three", fileFor("src", "c.mjs"));
    await plugin.transform?.("four", fileFor("src", "d.cts"));

    expect(transformMock).toHaveBeenCalledTimes(4);
  });
});

describe("входящая sourcemap", () => {
  it("предупреждает один раз на инстанс, если задан inMap", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const plugin = createPlugin();
      const file = fileFor("src", "map.ts");
      await plugin.transform?.("code", file, { inMap: { version: 3 } });
      await plugin.transform?.("code", file, { inMap: { version: 3 } });
      await plugin.transform?.("code", file);

      expect(warn).toHaveBeenCalledTimes(1);
      const message = String(warn.mock.calls[0]?.[0]);
      expect(message).toContain("единственным pre-плагином");
      expect(message).toContain("sourcemap");
    } finally {
      warn.mockRestore();
    }
  });

  it("молчит без входящей sourcemap в dev и build", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cacheDir = mkdtempSync(path.join(tmpdir(), "silent-vite-sourcemap-"));
    cacheDirectories.push(cacheDir);
    try {
      const dev = createPlugin();
      dev.configResolved?.({ cacheDir, command: "serve" } as unknown as ResolvedConfig);
      await dev.transform?.("code", fileFor("src", "dev.ts"));
      expect(warn).not.toHaveBeenCalled();

      const build = createPlugin();
      build.configResolved?.({ cacheDir, command: "build" } as unknown as ResolvedConfig);
      await build.transform?.("code", fileFor("src", "build.ts"));
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe("кеш трансформаций", () => {
  it("удаляет лишние записи по cacheLimit, не задерживая buildStart", async () => {
    const cacheDir = mkdtempSync(path.join(tmpdir(), "silent-vite-cache-limit-"));
    cacheDirectories.push(cacheDir);
    const directory = path.join(cacheDir, "silent-transform");
    mkdirSync(directory, { recursive: true });
    for (let index = 0; index < 3; index += 1) {
      const file = path.join(directory, `key-${index}.json`);
      writeFileSync(
        file,
        JSON.stringify({ code: "ok", map: null, diagnostics: [] }),
      );
      const time = new Date(Date.now() - (3 - index) * 1000);
      utimesSync(file, time, time);
    }

    const plugin = createPlugin({ cacheLimit: 2 });
    plugin.configResolved?.({ cacheDir, command: "build" } as unknown as ResolvedConfig);
    await plugin.buildStart?.();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const names = readdirSync(directory)
      .filter((name) => name.endsWith(".json"))
      .sort();
    expect(names).toEqual(["key-1.json", "key-2.json"]);
  });
});

describe("matchesPattern", () => {
  it("компилирует шаблон один раз на объект RegExp", () => {
    const pattern = /\.ts$/;
    let sourceReads = 0;
    Object.defineProperty(pattern, "source", {
      get: () => {
        sourceReads += 1;
        return "\\.ts$";
      },
    });

    expect(matchesPattern(pattern, "a.ts")).toBe(true);
    expect(matchesPattern(pattern, "b.ts")).toBe(true);
    expect(matchesPattern(pattern, "c.css")).toBe(false);

    expect(sourceReads).toBe(1);
    expect(pattern.lastIndex).toBe(0);
  });

  it("не зависит от lastIndex при флагах g и y", () => {
    const global = /a/g;
    const sticky = /a/y;

    expect(matchesPattern(global, "a")).toBe(true);
    expect(matchesPattern(global, "a")).toBe(true);
    expect(matchesPattern(sticky, "a")).toBe(true);
    expect(matchesPattern(sticky, "a")).toBe(true);
  });
});

describe("режим di", () => {
  const diagnostics = [
    "для интерфейса Store не найдено реализации",
    "найдено несколько реализаций для интерфейса Store: MemoryStore, ApiStore",
  ];

  const mockDiagnostics = (): void => {
    transformMock.mockImplementation((source: string) =>
      JSON.stringify({
        code: `${source} // out`,
        map: null,
        diagnostics,
      }),
    );
  };

  it("по умолчанию di: \"warn\" вызывает warn и не дублирует диагностики в warnings", async () => {
    mockDiagnostics();
    const plugin = createPlugin();
    await plugin.buildStart?.();

    const warn = vi.fn();
    const result = (await plugin.transform?.call(
      { warn },
      "code",
      fileFor("src", "di.ts"),
    )) as TransformOutput | undefined;

    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0]?.[0]).toBe(
      "[silent-vite] DI: для интерфейса Store не найдено реализации",
    );
    expect(warn.mock.calls[1]?.[0]).toBe(
      "[silent-vite] DI: найдено несколько реализаций для интерфейса Store: MemoryStore, ApiStore",
    );
    expect(result?.code).toBe("code // out");
    expect(result?.warnings).toEqual([]);
  });

  it("di: \"error\" падает с текстом диагностики и именем зависимости", async () => {
    mockDiagnostics();
    const plugin = createPlugin({ di: "error" });
    await plugin.buildStart?.();

    await expect(
      plugin.transform?.("code", fileFor("src", "di.ts")),
    ).rejects.toThrow(
      /\[silent-vite\] DI: .*Store.*не найдено реализации[\s\S]*несколько реализаций/,
    );
  });

  it("di: \"error\" не падает без диагностик", async () => {
    const plugin = createPlugin({ di: "error" });
    const result = (await plugin.transform?.(
      "code",
      fileFor("src", "clean.ts"),
    )) as TransformOutput | undefined;

    expect(result?.code).toBe("code /* compiled */");
  });

  it("di: \"allow\" игнорирует диагностики", async () => {
    mockDiagnostics();
    const plugin = createPlugin({ di: "allow" });
    await plugin.buildStart?.();

    const warn = vi.fn();
    const result = (await plugin.transform?.call(
      { warn },
      "code",
      fileFor("src", "di.ts"),
    )) as TransformOutput | undefined;

    expect(warn).not.toHaveBeenCalled();
    expect(result?.code).toBe("code // out");
    expect(result?.warnings).toEqual([]);
  });

  it("di: \"error\" применяется и на cache hit", async () => {
    mockDiagnostics();
    const cacheDir = mkdtempSync(path.join(tmpdir(), "silent-vite-di-cache-"));
    cacheDirectories.push(cacheDir);
    const plugin = createPlugin({ di: "error" });
    plugin.configResolved?.({ cacheDir } as ResolvedConfig);
    await plugin.buildStart?.();

    const file = fileFor("src", "cached-di.ts");
    await expect(plugin.transform?.("const x = 1;", file)).rejects.toThrow(
      /\[silent-vite\] DI: /,
    );
    await expect(plugin.transform?.("const x = 1;", file)).rejects.toThrow(
      /несколько реализаций/,
    );
    expect(transformMock).toHaveBeenCalledTimes(1);
  });

  it("di: \"warn\" применяется и на cache hit", async () => {
    mockDiagnostics();
    const cacheDir = mkdtempSync(path.join(tmpdir(), "silent-vite-di-cache-"));
    cacheDirectories.push(cacheDir);
    const plugin = createPlugin({ di: "warn" });
    plugin.configResolved?.({ cacheDir } as ResolvedConfig);
    await plugin.buildStart?.();

    const file = fileFor("src", "cached-warn.ts");
    const firstWarn = vi.fn();
    const secondWarn = vi.fn();
    await plugin.transform?.call({ warn: firstWarn }, "const x = 1;", file);
    await plugin.transform?.call({ warn: secondWarn }, "const x = 1;", file);

    expect(transformMock).toHaveBeenCalledTimes(1);
    expect(firstWarn).toHaveBeenCalledTimes(2);
    expect(secondWarn).toHaveBeenCalledTimes(2);
  });
});
