import type { ConfigEnv, Plugin, ResolvedConfig, UserConfig } from "vite";
import { join } from "node:path";
import { loadSwc, nativeScan, nativeTransform } from "./native.js";
import type { SilentIndex } from "./native.js";
import { cleanModuleId, isInsideRoot, isSourceModule, isVirtualModule, matchesPattern, resolveOptions } from "./options.js";
import type { SilentOptions } from "./options.js";
import {
  hashContent,
  pruneTransformCache,
  readTransformCache,
  transformCacheKey,
  writeTransformCache,
} from "./cache.js";

const EMPTY_INDEX_JSON = JSON.stringify({ interfaces: {}, values: {} });

export { type SilentOptions };

export default silent;

export function silent(options: SilentOptions = {}): Plugin {
  const opts = resolveOptions(options);

  const buildOptionsJson = (ssr: boolean): string =>
    JSON.stringify({
      swc: opts.swc,
      requirePreloader: opts.requirePreloader,
      runtime: opts.runtime,
      hmr: opts.hmr,
      ssr,
    });
  const optionsJson = buildOptionsJson(false);
  const ssrOptionsJson = buildOptionsJson(true);

  let cachedIndexJson: string | null = null;
  let cachedIndexHash: string | null = null;
  let indexPromise: Promise<string> | null = null;
  let swcPromise: ReturnType<typeof loadSwc> | null = null;
  let cacheDirectory: string | null = null;
  let transformVersion: string | null = null;

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
    if (cachedIndexJson) return Promise.resolve(cachedIndexJson);
    if (!indexPromise) {
      indexPromise = getSwc()
        .then((swc) => {
          const index: SilentIndex = nativeScan(swc, opts.root);
          const json = JSON.stringify(index);
          cachedIndexJson = json;
          return json;
        })
        .catch((error: unknown) => {
          indexPromise = null;
          throw error;
        });
    }
    return indexPromise;
  };

  const invalidateIndex = (): void => {
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
      if (cacheDirectory !== null) {
        pruneTransformCache(cacheDirectory);
      }
    },
    configResolved(config: ResolvedConfig) {
      cacheDirectory = join(config.cacheDir, "silent-transform");
    },
    watchChange(id) {
      if (isSourceModule(id) && !isVirtualModule(id)) {
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

      const swc = await getSwc();
      const indexJson = await ensureIndex();
      const callOptionsJson =
        transformOptions?.ssr === true ? ssrOptionsJson : optionsJson;
      const cacheEnabled =
        cacheDirectory !== null && process.env.SILENT_TRANSFORM_CACHE !== "off";
      const directory = cacheEnabled ? cacheDirectory : null;
      if (directory === null) {
        const result = nativeTransform(swc, code, moduleId, callOptionsJson, indexJson);
        return {
          code: result.code,
          map: result.map,
          warnings: result.diagnostics,
        };
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
        return {
          code: cached.code,
          map: cached.map,
          warnings: cached.diagnostics,
        };
      }
      const result = nativeTransform(swc, code, moduleId, callOptionsJson, indexJson);
      writeTransformCache(directory, key, result);
      return {
        code: result.code,
        map: result.map,
        warnings: result.diagnostics,
      };
    },
  };
}
