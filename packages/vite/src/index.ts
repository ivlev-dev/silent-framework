import type { ConfigEnv, Plugin, ResolvedConfig, UserConfig } from "vite";
import { join, resolve } from "node:path";
import type { NativeTransformResult } from "@ivlev-dev/silent-swc";
import {
  loadSwc,
  nativeAddonFingerprint,
  nativeScan,
  nativeScanFiles,
  nativeTransform,
} from "./native.js";
import {
  aliasMatchesSource,
  aliasesJson,
  mergeAliasRules,
  viteAliases,
  type AliasRule,
} from "./aliases.js";
import type { SilentIndex } from "./native.js";
import {
  cleanModuleId,
  isInsideRoot,
  isSourceModule,
  isTsconfigFile,
  isVirtualModule,
  matchesPattern,
  resolveOptions,
  SOURCE_EXTENSIONS,
} from "./options.js";
import type { DiMode, SilentOptions } from "./options.js";
import {
  filterIndexModules,
  mergeIndexDelta,
  moduleFingerprint,
  modulePathOfFile,
  pruneEmptyInterfaceTokens,
  removeModuleFromIndex,
  stableIndexJson,
} from "./incremental.js";
import {
  hashContent,
  PLUGIN_VERSION,
  pruneTransformCache,
  readTransformCache,
  transformCacheKey,
  writeTransformCache,
} from "./cache.js";
import { collectTypeOnlyImportSources, isBareSpecifier } from "./type-imports.js";

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

function isDeclarationId(id: string): boolean {
  return /\.d\.[cm]?ts(?:$|[?#])/.test(id);
}

export function silent(options: SilentOptions = {}): Plugin {
  const opts = resolveOptions(options);
  // Пользовательский root важнее config.root; иначе берём root из Vite.
  const rootExplicit = options.root !== undefined;

  let aliasRules: AliasRule[] = [];
  let aliasOptionsJson = aliasesJson([]);
  let viteAliasSnapshot: AliasRule[] = [];

  let cachedIndex: SilentIndex | null = null;
  let cachedIndexJson: string | null = null;
  let cachedIndexHash: string | null = null;
  let indexPromise: Promise<string> | null = null;
  let fullRefreshPromise: Promise<void> | null = null;
  let lastFullRefreshKey: string | null = null;
  let lastFullRefreshAt = 0;
  let indexGeneration = 0;
  // Операции с индексом сериализованы: инкрементальный апдейт и полный scan
  // не могут перезаписать результат друг друга.
  let indexQueue: Promise<void> = Promise.resolve();
  let queuedIndexTasks = 0;
  let swcPromise: ReturnType<typeof loadSwc> | null = null;
  let cacheDirectory: string | null = null;
  let transformVersion: string | null = null;
  let warnedIncomingMap = false;
  // null — конфиг ещё не разрешён, оставляем решение addon'у (sourcemap по умолчанию).
  let sourceMapsEnabled: boolean | null = null;

  const buildOptionsJson = (
    ssr: boolean,
    extraAliases: readonly AliasRule[] = [],
  ): string => {
    const swc = { ...opts.swc } as Record<string, unknown>;
    if (swc.sourceMaps === undefined && sourceMapsEnabled === false) {
      swc.sourceMaps = false;
    }
    return JSON.stringify({
      swc,
      requirePreloader: opts.requirePreloader,
      runtime: opts.runtime,
      hmr: opts.hmr,
      ssr,
      hydrate: opts.hydrate,
      aliases: extraAliases.length === 0
        ? aliasRules
        : [...aliasRules, ...extraAliases],
      di: opts.di,
    });
  };

  // Пересобирает правила из снимка Vite-алиасов и актуальных tsconfig paths.
  const rebuildAliases = (): void => {
    aliasRules = mergeAliasRules(viteAliasSnapshot, opts.root);
    aliasOptionsJson = aliasesJson(aliasRules);
  };

  /**
   * Индекс хранит пути без расширения, поэтому проверяем ключ в вариантах
   * всех поддерживаемых расширений — так include/exclude трансформации
   * применяются и к DI-скану.
   */
  const isIndexedModule = (modulePath: string): boolean => {
    const candidates = [
      modulePath,
      ...SOURCE_EXTENSIONS.map((extension) => `${modulePath}.${extension}`),
    ];
    if (!candidates.some((candidate) => matchesPattern(opts.include, candidate))) {
      return false;
    }
    return !candidates.some((candidate) => matchesPattern(opts.exclude, candidate));
  };

  /**
   * Type-only импорты из модулей, которые addon не сможет разрешить (bare
   * пакеты без runtime-файла), получают ссылку на текущий модуль: runtime-импорт
   * значения не генерируется, вместо него появляется DI-диагностика.
   */
  const typeOnlyAliasesFor = async (
    moduleId: string,
    code: string,
    resolveImport?: (source: string) => Promise<string | null>,
  ): Promise<AliasRule[]> => {
    if (!code.includes("import")) return [];
    const sources = collectTypeOnlyImportSources(code);
    if (sources.length === 0) return [];
    const modulePath = modulePathOfFile(moduleId);
    const rules: AliasRule[] = [];
    for (const source of sources) {
      if (!isBareSpecifier(source)) continue;
      if (aliasMatchesSource(source, aliasRules)) continue;
      if (rules.some((rule) => rule.find === source)) continue;
      if (resolveImport !== undefined) {
        const resolved = await resolveImport(source);
        // Установленный runtime-модуль резолвится в JS: type-only имя могло
        // быть реэкспортировано как значение, поэтому отдаём решение addon'у.
        if (resolved !== null && !isDeclarationId(resolved)) continue;
      }
      rules.push({ find: source, replacement: modulePath });
    }
    return rules;
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
      filterIndexModules(index, isIndexedModule);
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
   * Режим `scan: "full"`: инвалидирует индекс и запускает полный scan.
   * Повторный запрос с тем же ключом (watchChange + handleHotUpdate на одно
   * изменение) переиспользует уже запланированный или только что
   * завершившийся скан, поэтому файл не сканируется дважды.
   */
  const FULL_REFRESH_DEDUPE_MS = 250;

  const requestFullRefresh = (key: string): Promise<void> => {
    const now = Date.now();
    const duplicate =
      key === lastFullRefreshKey
      && now - lastFullRefreshAt < FULL_REFRESH_DEDUPE_MS;
    if (duplicate) {
      if (fullRefreshPromise !== null) {
        return fullRefreshPromise.catch(() => {
          invalidateIndex();
        });
      }
      if (cachedIndexJson !== null) return Promise.resolve();
    }
    lastFullRefreshKey = key;
    lastFullRefreshAt = now;
    const reuse = fullRefreshPromise !== null && cachedIndexJson === null;
    invalidateIndex();
    if (reuse) return fullRefreshPromise!;
    const pending = startFullScan().then(() => undefined);
    fullRefreshPromise = pending;
    const forget = (): void => {
      if (fullRefreshPromise === pending) fullRefreshPromise = null;
    };
    void pending.then(forget, forget);
    return pending.catch(() => {
      invalidateIndex();
    });
  };

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
      || !matchesPattern(opts.include, file)
      || matchesPattern(opts.exclude, file)
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
        filterIndexModules(delta, isIndexedModule);
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
    const file = cleanModuleId(id);
    if (
      !matchesPattern(opts.include, file)
      || matchesPattern(opts.exclude, file)
    ) {
      return Promise.resolve();
    }
    if (opts.scan === "full") return requestFullRefresh(`source:${file}`);
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
      sourceMapsEnabled =
        config.command === "serve" || Boolean(config.build?.sourcemap);
      const configuredRoot =
        typeof config.root === "string" && config.root.length > 0
          ? resolve(config.root)
          : null;
      if (!rootExplicit && configuredRoot !== null && configuredRoot !== opts.root) {
        opts.root = configuredRoot;
      }
      const logger = (
        config as unknown as {
          logger?: { warn?: (message: string) => void };
        }
      ).logger;
      const warnAlias = (message: string): void => {
        const text = `[silent-vite] ${message}`;
        if (typeof logger?.warn === "function") {
          logger.warn(text);
        } else {
          console.warn(text);
        }
      };
      viteAliasSnapshot = viteAliases(
        config.resolve?.alias ?? [],
        opts.root,
        warnAlias,
      );
      rebuildAliases();
      invalidateIndex();
    },
    watchChange(id, change) {
      if (isTsconfigFile(opts.root, id)) {
        // tsconfig paths перечитываются, Vite-алиасы берутся из снимка.
        rebuildAliases();
        if (opts.index && opts.scan === "full") {
          return requestFullRefresh(`tsconfig:${cleanModuleId(id)}`);
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
        // В full-режиме ключ совпадает с watchChange: одно изменение
        // не запускает полный scan дважды.
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
      const resolveImport =
        typeof this?.resolve === "function"
          ? async (source: string): Promise<string | null> => {
              try {
                const resolved = await this.resolve(source, moduleId, {
                  skipSelf: true,
                });
                return resolved?.id ?? null;
              } catch {
                return null;
              }
            }
          : undefined;
      const callOptionsJson = buildOptionsJson(
        transformOptions?.ssr === true,
        await typeOnlyAliasesFor(moduleId, code, resolveImport),
      );
      const cacheEnabled =
        cacheDirectory !== null && process.env.SILENT_TRANSFORM_CACHE !== "off";
      const directory = cacheEnabled ? cacheDirectory : null;
      if (directory === null) {
        return emit(nativeTransform(swc, code, moduleId, callOptionsJson, indexJson));
      }
      transformVersion ??= `${PLUGIN_VERSION}:${swc.version()}`;
      // Fingerprint пересчитывается на каждый transform: пересборка addon
      // инвалидирует кеш даже без перезапуска dev-сервера.
      const key = transformCacheKey([
        transformVersion,
        nativeAddonFingerprint(),
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
      writeTransformCache(directory, key, result, opts.cacheLimit);
      return emit(result);
    },
  };
}
