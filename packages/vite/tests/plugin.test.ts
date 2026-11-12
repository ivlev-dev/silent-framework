import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { Plugin, ResolvedConfig } from "vite";
import { silent } from "../src/index.js";
import type { SilentOptions } from "../src/index.js";
import { transform as nativeTransform, scan as nativeScan } from "@ivlev-dev/silent-swc";

const transformMock = vi.mocked(nativeTransform);
const scanMock = vi.mocked(nativeScan);

vi.mock("@ivlev-dev/silent-swc", () => ({
  transform: vi.fn(() =>
    JSON.stringify({ code: "empty", map: null, diagnostics: [] }),
  ),
  scan: vi.fn(() => JSON.stringify({ interfaces: {}, values: {} })),
  version: vi.fn(() => "test"),
}));

interface CallableHooks {
  config?: () => { define?: Record<string, string> } | undefined;
  buildStart?: () => Promise<void> | void;
  configResolved?: (config: ResolvedConfig) => void;
  transform?: (code: string, id: string) => Promise<unknown> | unknown;
  watchChange?: (id: string, change: { event: string }) => void;
  handleHotUpdate?: (context: { file: string }) => void;
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
      define: { __SILENT_SERVER__: "false" },
    });
    expect(
      plugin.config?.({ build: { ssr: "src/entry-server.tsx" } }, {
        command: "build",
        mode: "production",
      }),
    ).toBeUndefined();
    expect(plugin.config?.({}, { command: "serve", mode: "development" })).toBeUndefined();
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
    expect(scanMock).toHaveBeenCalledWith(process.cwd());
  });

  it("transform вызывает native transform и возвращает code, map, warnings", async () => {
    transformMock.mockImplementation((source: string) =>
      JSON.stringify({
        code: `${source} // out`,
        map: "map-string",
        diagnostics: ["warn1", "warn2"],
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
    expect(result?.warnings).toEqual(["warn1", "warn2"]);
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

  it("инвалидирует индекс на watchChange для TS/JS и для .css не делает этого", async () => {
    const plugin = createPlugin();
    await plugin.buildStart?.();
    await plugin.transform?.("one", fileFor("src", "a.ts"));

    plugin.watchChange?.(fileFor("src", "types.ts"), { event: "update" });
    await plugin.transform?.("two", fileFor("src", "a.ts"));
    expect(scanMock).toHaveBeenCalledTimes(2);

    plugin.watchChange?.(fileFor("src", "styles.css"), { event: "update" });
    await plugin.transform?.("three", fileFor("src", "a.ts"));
    expect(scanMock).toHaveBeenCalledTimes(2);

    plugin.watchChange?.(fileFor("src", "app.js"), { event: "update" });
    await plugin.transform?.("four", fileFor("src", "a.ts"));
    expect(scanMock).toHaveBeenCalledTimes(3);
  });

  it("не инвалидирует индекс на watchChange для виртуальных модулей", async () => {
    const plugin = createPlugin();
    await plugin.buildStart?.();
    await plugin.transform?.("one", fileFor("src", "a.ts"));

    plugin.watchChange?.("\0virtual:module", { event: "update" });
    await plugin.transform?.("two", fileFor("src", "a.ts"));
    expect(scanMock).toHaveBeenCalledTimes(1);
  });

  it("инвалидирует индекс на handleHotUpdate", async () => {
    const plugin = createPlugin();
    await plugin.buildStart?.();
    await plugin.transform?.("one", fileFor("src", "a.ts"));

    plugin.handleHotUpdate?.({ file: fileFor("src", "vm.ts") });
    await plugin.transform?.("two", fileFor("src", "a.ts"));

    expect(scanMock).toHaveBeenCalledTimes(2);
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
