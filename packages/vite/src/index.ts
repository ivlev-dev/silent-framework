import type { ConfigEnv, Plugin, ResolvedConfig, UserConfig } from "vite";
import { join } from "node:path";
import type { NativeTransformResult } from "@ivlev-dev/silent-swc";
import { loadSwc, nativeScan, nativeScanFiles, nativeTransform } from "./native.js";
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
  mergeIndexDelta,
  moduleFingerprint,
  pruneEmptyInterfaceTokens,
  removeModuleFromIndex,
  stableIndexJson,
} from "./incremental.js";
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

  let cachedIndex: SilentIndex | null = null;
  let cachedIndexJson: string | null = null;
  let cachedIndexHash: string | null = null;
  let indexPromise: Promise<string> | null = null;
  let fullRefreshPromise: Promise<void> | null = null;
  let indexGeneration = 0;
  // Операции с индексом сериализованы: инкрементальный апдейт и полный scan
  // не могут перезаписать результат друг друга.
  let indexQueue: Promise<void> = Promise.resolve();
  let queuedIndexTasks = 0;
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

  const enqueueIndexTask = <T>(task: () => Promise<T> | T): Promise<T> => {
    queuedIndexTasks += 1;
    const run = indexQueue.then(task, task);
    const settle = (): void => {
      queuedIndexTasks -= 1;
    };
    indexQueue = run.then(settle, settle);
    return run;
  };

  const cacheIndex = (index: SilentIndex): string => {
    cachedIndex = index;
    cachedIndexJson = JSON.stringify(index);
    cachedIndexHash = null;
    return cachedIndexJson;
  };

  const startFullScan = (): Promise<string> => {
    if (indexPromise) return indexPromise;
    const pending = enqueueIndexTask(async () => {
      const swc = await getSwc();
      if (cachedIndexJson !== null) return cachedIndexJson;
      const generation = indexGeneration;
      const index: SilentIndex = nativeScan(swc, opts.root, aliasOptionsJson);
      // Скан синхронный, поэтому поколение измениться не может; проверка
      // оставлена страховкой от будущих асинхронных реализаций сканера.
      if (generation !== indexGeneration) {
        return cachedIndexJson ?? JSON.stringify(index);
      }
      return cacheIndex(index);
    });
    indexPromise = pending;
    const forgetPending = (): void => {
      if (indexPromise === pending) indexPromise = null;
    };
    void pending.then(forgetPending, forgetPending);
    return pending;
  };

  const ensureIndex = async (): Promise<string> => {
    if (!opts.index) return EMPTY_INDEX_JSON;
    if (queuedIndexTasks > 0) {
      await indexQueue;
      if (cachedIndexJson !== null) return cachedIndexJson;
    }
    if (cachedIndexJson !== null) return cachedIndexJson;
    return startFullScan();
  };

  const invalidateIndex = (): void => {
    indexGeneration += 1;
    cachedIndex = null;
    cachedIndexJson = null;
    cachedIndexHash = null;
    indexPromise = null;
  };

  const indexHashOf = (indexJson: string): string => {
    if (cachedIndex === null || cachedIndexJson !== indexJson) {
      return hashContent(indexJson);
    }
    cachedIndexHash ??= hashContent(stableIndexJson(cachedIndex));
    return cachedIndexHash;
  };

  /**
   * Режим `scan: "full"`: инвалидирует индекс и тут же запускает полный scan.
   * Повторные вызовы во время уже запланированного скана переиспользуют его —
   * задача всё равно читает актуальное состояние файловой системы.
   */
  const refreshFullIndex = (): Promise<void> => {
    const reuse = fullRefreshPromise !== null && cachedIndexJson === null;
    invalidateIndex();
    if (reuse) return fullRefreshPromise!;
    const pending = startFullScan().then(() => undefined);
    fullRefreshPromise = pending;
    const forget = (): void => {
      if (fullRefreshPromise === pending) fullRefreshPromise = null;
    };
    void pending.then(forget, forget);
    return pending;
  };

  const scheduleFullRefresh = (): Promise<void> =>
    refreshFullIndex().catch(() => {
      invalidateIndex();
    });

  /**
   * Инкрементальное обновление индекса для одного файла. Если индекс ещё не
   * построен или уже инвалидирован, обновление пропускается: полный scan
   * увидит актуальное состояние файловой системы.
   */
  const refreshModuleIndex = (
    id: string,
    event: "create" | "update" | "delete",
  ): Promise<void> => {
    if (!opts.index) return Promise.resolve();
    const file = cleanModuleId(id);
    if (
      isVirtualModule(file)
      || !isSourceModule(file)
      || !isInsideRoot(opts.root, file)
    ) {
      return Promise.resolve();
    }
    return enqueueIndexTask(async () => {
      const generation = indexGeneration;
      const swc = await getSwc();
      if (generation !== indexGeneration) return;
      if (cachedIndex === null) return;
      const before = moduleFingerprint(cachedIndex, file);
      removeModuleFromIndex(cachedIndex, file);
      if (event !== "delete") {
        const delta = nativeScanFiles(swc, opts.root, [file], aliasOptionsJson);
        if (delta === null) {
          // Addon без scanFiles: безопасный откат на полный scan.
          invalidateIndex();
          return;
        }
        mergeIndexDelta(cachedIndex, delta);
      }
      pruneEmptyInterfaceTokens(cachedIndex, file);
      const after = moduleFingerprint(cachedIndex, file);
      if (after === before) return;
      cachedIndexJson = JSON.stringify(cachedIndex);
      // Хеш пересчитается лениво при следующем transform по детерминированному
      // представлению; изменившийся индекс инвалидирует кеш как и раньше.
      cachedIndexHash = null;
    });
  };

  const scheduleModuleRefresh = (
    id: string,
    event: "create" | "update" | "delete",
  ): Promise<void> =>
    refreshModuleIndex(id, event).catch(() => {
      // Ошибка нативного скана: следующий ensureIndex пересоберёт индекс целиком.
      invalidateIndex();
    });

  const refreshSourceChange = (
    id: string,
    event: "create" | "update" | "delete",
  ): Promise<void> => {
    if (!opts.index) return Promise.resolve();
    if (opts.scan === "full") return scheduleFullRefresh();
    return scheduleModuleRefresh(id, event);
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
    watchChange(id, change) {
      if (isTsconfigFile(opts.root, id)) {
        // tsconfig paths перечитываются, Vite-алиасы берутся из снимка.
        rebuildAliases();
        if (opts.index && opts.scan === "full") {
          return scheduleFullRefresh();
        }
        invalidateIndex();
        return;
      }
      if (isSourceModule(id) && !isVirtualModule(id)) {
        return refreshSourceChange(id, change.event);
      }
      return;
    },
    handleHotUpdate({ file }) {
      if (isSourceModule(file) && !isVirtualModule(file)) {
        if (opts.scan === "full") {
          // Полный scan выполнит watchChange/следующий ensureIndex.
          invalidateIndex();
          return;
        }
        return refreshSourceChange(file, "update");
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
