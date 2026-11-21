import type { ConfigEnv, Plugin, ResolvedConfig, UserConfig } from "vite";
import { join } from "node:path";
import type { NativeTransformResult } from "@ivlev-dev/silent-swc";
import { loadSwc, nativeScan, nativeTransform } from "./native.js";
import { aliasesJson, mergeAliasRules, viteAliases, type AliasRule } from "./aliases.js";
import type { SilentIndex } from "./native.js";
import {
  cleanModuleId,
  isInsideRoot,
  isSourceModule,
  isTsconfigFile,
  isVirtualModule,
  matchesPattern,
  resolveOptions,
} from "./options.js";
import type { DiMode, SilentOptions } from "./options.js";
import {
  hashContent,
  pruneTransformCache,
  readTransformCache,
  transformCacheKey,
  writeTransformCache,
} from "./cache.js";

const EMPTY_INDEX_JSON = JSON.stringify({ interfaces: {}, values: {} });
const DI_MESSAGE_PREFIX = "[silent-vite] DI: ";
const SOURCE_MAP_WARNING =
  "[silent-vite] silent должен быть единственным pre-плагином: " +
  "входящая sourcemap (inMap) не учитывается, карта остаётся относительной входного файла.";

interface DiagnosticContext {
  warn: (message: string) => void;
}

export { type DiMode, type SilentOptions };

export default silent;

function reportDiagnostics(
  mode: DiMode,
  diagnostics: readonly string[],
  context: DiagnosticContext | undefined,
): void {
  if (diagnostics.length === 0 || mode === "allow") return;
  const messages = diagnostics.map((diagnostic) => `${DI_MESSAGE_PREFIX}${diagnostic}`);
  if (mode === "error") {
    throw new Error(messages.join("\n"));
  }
  for (const message of messages) {
    context?.warn(message);
  }
}

function readIncomingMap(options: unknown): unknown {
  if (typeof options !== "object" || options === null) return undefined;
  return (options as Record<string, unknown>).inMap;
}

export function silent(options: SilentOptions = {}): Plugin {
  const opts = resolveOptions(options);

  let aliasRules: AliasRule[] = [];
  let aliasOptionsJson = aliasesJson([]);
  let viteAliasSnapshot: AliasRule[] = [];

  let cachedIndexJson: string | null = null;
  let cachedIndexHash: string | null = null;
  let indexPromise: Promise<string> | null = null;
  let indexGeneration = 0;
  let swcPromise: ReturnType<typeof loadSwc> | null = null;
  let cacheDirectory: string | null = null;
  let transformVersion: string | null = null;
  let warnedIncomingMap = false;

  const buildOptionsJson = (ssr: boolean): string =>
    JSON.stringify({
      swc: opts.swc,
      requirePreloader: opts.requirePreloader,
      runtime: opts.runtime,
      hmr: opts.hmr,
      ssr,
      hydrate: opts.hydrate,
      aliases: aliasRules,
    });

  // Пересобирает правила из снимка Vite-алиасов и актуальных tsconfig paths.
  const rebuildAliases = (): void => {
    aliasRules = mergeAliasRules(viteAliasSnapshot, opts.root);
    aliasOptionsJson = aliasesJson(aliasRules);
  };

  const getSwc = (): ReturnType<typeof loadSwc> => {
    if (!swcPromise) {
      swcPromise = loadSwc().catch((error: unknown) => {
        swcPromise = null;
        throw error;
      });
    }
    return swcPromise;
  };

  const ensureIndex = (): Promise<string> => {
    if (!opts.index) return Promise.resolve(EMPTY_INDEX_JSON);
    if (cachedIndexJson !== null) return Promise.resolve(cachedIndexJson);
    if (indexPromise) return indexPromise;
    const generation = ++indexGeneration;
    const pending: Promise<string> = getSwc().then((swc) => {
      const index: SilentIndex = nativeScan(swc, opts.root, aliasOptionsJson);
      const json = JSON.stringify(index);
      if (generation === indexGeneration) {
        cachedIndexJson = json;
      }
      return json;
    });
    indexPromise = pending;
    const forgetPending = (): void => {
      if (indexPromise === pending) indexPromise = null;
    };
    void pending.then(forgetPending, forgetPending);
    return pending;
  };

  const invalidateIndex = (): void => {
    indexGeneration += 1;
    cachedIndexJson = null;
    cachedIndexHash = null;
    indexPromise = null;
  };

  const indexHashOf = (indexJson: string): string => {
    cachedIndexHash ??= hashContent(indexJson);
    return cachedIndexHash;
  };

  return {
    name: "silent",
    enforce: "pre",
    config(config: UserConfig = {}, env?: ConfigEnv): UserConfig | undefined {
      const define: Record<string, string> = {};
      if (!opts.view) {
        define.__SILENT_VIEW__ = "false";
      }
      if (!opts.hydrate) {
        define.__SILENT_HYDRATE__ = "false";
      }
      if (env?.command === "build") {
        // В production-бандле dev-предупреждения реактивности не нужны.
        define.__SILENT_DEV__ = "false";
      } else if (env?.command === "serve") {
        define.__SILENT_DEV__ = "true";
      }
      if (env?.command === "build" && !config.build?.ssr) {
        define.__SILENT_SERVER__ = "false";
      }
      const result: UserConfig = {};
      if (Object.keys(define).length > 0) {
        result.define = define;
      }
      if (!opts.view && config.build?.modulePreload === undefined) {
        result.build = { modulePreload: { polyfill: false } };
      }
      return Object.keys(result).length === 0 ? undefined : result;
    },
    async buildStart() {
      await ensureIndex();
      const directory = cacheDirectory;
      if (directory !== null) {
        // Prune не должен задерживать старт: тысячи statSync на большом кеше.
        const timer = setTimeout(() => {
          pruneTransformCache(directory, opts.cacheLimit);
        }, 0);
        timer.unref();
      }
    },
    configResolved(config: ResolvedConfig) {
      cacheDirectory = join(config.cacheDir, "silent-transform");
      viteAliasSnapshot = viteAliases(config.resolve?.alias ?? [], opts.root);
      rebuildAliases();
      invalidateIndex();
    },
    watchChange(id) {
      if (isSourceModule(id) && !isVirtualModule(id)) {
        invalidateIndex();
      }
      if (isTsconfigFile(opts.root, id)) {
        // tsconfig paths перечитываются, Vite-алиасы берутся из снимка.
        rebuildAliases();
        invalidateIndex();
      }
    },
    handleHotUpdate({ file }) {
      if (isSourceModule(file) && !isVirtualModule(file)) {
        invalidateIndex();
      }
    },
    async transform(code, id, transformOptions) {
      const moduleId = cleanModuleId(id);
      if (isVirtualModule(id) || isVirtualModule(moduleId)) return null;
      if (!matchesPattern(opts.include, moduleId)) return null;
      if (matchesPattern(opts.exclude, moduleId)) return null;
      if (!isInsideRoot(opts.root, moduleId)) return null;

      const pluginContext: DiagnosticContext | undefined =
        typeof this?.warn === "function"
          ? { warn: (message: string): void => { this.warn(message); } }
          : undefined;
      const incomingMap = readIncomingMap(transformOptions);
      const hasIncomingMap = incomingMap !== undefined && incomingMap !== null;
      if (!warnedIncomingMap && hasIncomingMap) {
        warnedIncomingMap = true;
        if (pluginContext) {
          pluginContext.warn(SOURCE_MAP_WARNING);
        } else {
          console.warn(SOURCE_MAP_WARNING);
        }
      }
      const emit = (result: NativeTransformResult): {
        code: string;
        map: string | null;
        warnings: string[];
      } => {
        reportDiagnostics(opts.di, result.diagnostics, pluginContext);
        return { code: result.code, map: result.map, warnings: [] };
      };

      const swc = await getSwc();
      const indexJson = await ensureIndex();
      const callOptionsJson = buildOptionsJson(transformOptions?.ssr === true);
      const cacheEnabled =
        cacheDirectory !== null && process.env.SILENT_TRANSFORM_CACHE !== "off";
      const directory = cacheEnabled ? cacheDirectory : null;
      if (directory === null) {
        return emit(nativeTransform(swc, code, moduleId, callOptionsJson, indexJson));
      }
      transformVersion ??= swc.version();
      const key = transformCacheKey([
        transformVersion,
        moduleId,
        callOptionsJson,
        indexHashOf(indexJson),
        code,
      ]);
      const cached = readTransformCache(directory, key);
      if (cached !== null) {
        return emit(cached);
      }
      const result = nativeTransform(swc, code, moduleId, callOptionsJson, indexJson);
      writeTransformCache(directory, key, result);
      return emit(result);
    },
  };
}
