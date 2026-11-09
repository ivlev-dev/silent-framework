import type { Plugin } from "vite";
import { loadSwc, nativeScan, nativeTransform } from "./native.js";
import type { SilentIndex } from "./native.js";
import { cleanModuleId, isInsideRoot, isSourceModule, isVirtualModule, matchesPattern, resolveOptions } from "./options.js";
import type { SilentOptions } from "./options.js";

const EMPTY_INDEX_JSON = JSON.stringify({ interfaces: {}, values: {} });

export { type SilentOptions };

export default silent;

export function silent(options: SilentOptions = {}): Plugin {
  const opts = resolveOptions(options);

  let cachedIndexJson: string | null = null;
  let indexPromise: Promise<string> | null = null;

  const ensureIndex = (): Promise<string> => {
    if (!opts.index) return Promise.resolve(EMPTY_INDEX_JSON);
    if (cachedIndexJson) return Promise.resolve(cachedIndexJson);
    if (!indexPromise) {
      indexPromise = loadSwc()
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
    indexPromise = null;
  };

  const buildOptionsJson = (): string =>
    JSON.stringify({
      swc: opts.swc,
      requirePreloader: opts.requirePreloader,
      runtime: opts.runtime,
      hmr: opts.hmr,
    });

  return {
    name: "silent",
    enforce: "pre",
    async buildStart() {
      await ensureIndex();
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
    async transform(code, id) {
      const moduleId = cleanModuleId(id);
      if (isVirtualModule(id) || isVirtualModule(moduleId)) return null;
      if (!matchesPattern(opts.include, moduleId)) return null;
      if (matchesPattern(opts.exclude, moduleId)) return null;
      if (!isInsideRoot(opts.root, moduleId)) return null;

      const swc = await loadSwc();
      const indexJson = await ensureIndex();
      const result = nativeTransform(
        swc,
        code,
        moduleId,
        buildOptionsJson(),
        indexJson,
      );

      const output = {
        code: result.code,
        map: result.map,
        warnings: result.diagnostics,
      };
      return output;
    },
  };
}
