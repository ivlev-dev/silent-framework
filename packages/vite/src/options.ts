import * as path from "node:path";

export type DiMode = "allow" | "warn" | "error";

export interface SilentOptions {
  include?: RegExp;
  exclude?: RegExp;
  root?: string;
  swc?: Record<string, unknown>;
  requirePreloader?: boolean;
  runtime?: string;
  hmr?: boolean;
  index?: boolean;
  view?: boolean;
  hydrate?: boolean;
  di?: DiMode;
}

export interface ResolvedOptions {
  include: RegExp;
  exclude: RegExp;
  root: string;
  swc: Record<string, unknown>;
  requirePreloader: boolean;
  runtime: string;
  hmr: boolean;
  index: boolean;
  view: boolean;
  hydrate: boolean;
  di: DiMode;
}

export const DEFAULT_INCLUDE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
export const DEFAULT_EXCLUDE = /node_modules/;
export const DEFAULT_RUNTIME = "@ivlev-dev/silent-core";
export const DEFAULT_DI: DiMode = "warn";

export function resolveOptions(options: SilentOptions = {}): ResolvedOptions {
  return {
    include: options.include ?? DEFAULT_INCLUDE,
    exclude: options.exclude ?? DEFAULT_EXCLUDE,
    root: path.resolve(options.root ?? process.cwd()),
    swc: options.swc ?? {},
    requirePreloader: options.requirePreloader ?? false,
    runtime: options.runtime ?? DEFAULT_RUNTIME,
    hmr: options.hmr ?? true,
    index: options.index ?? true,
    view: options.view ?? true,
    hydrate: options.hydrate ?? true,
    di: options.di ?? DEFAULT_DI,
  };
}

export function matchesPattern(pattern: RegExp, value: string): boolean {
  const flags = pattern.flags.replace(/[gy]/g, "");
  return new RegExp(pattern.source, flags).test(value);
}

export function cleanModuleId(id: string): string {
  return id.split("?")[0]?.split("#")[0] ?? "";
}

export function isVirtualModule(id: string): boolean {
  return id.includes("\0") || id.startsWith("virtual:");
}

export function isInsideRoot(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function isSourceModule(id: string): boolean {
  return DEFAULT_INCLUDE.test(cleanModuleId(id));
}

const TSCONFIG_NAME = /^tsconfig(\..+)?\.json$/;

/** Имя файла — любой `tsconfig*.json` (`tsconfig.json`, `tsconfig.app.json`, …). */
export function isTsconfigName(name: string): boolean {
  return TSCONFIG_NAME.test(name);
}

/** Изменение tsconfig внутри root требует пересборки правил алиасов. */
export function isTsconfigFile(root: string, id: string): boolean {
  const file = cleanModuleId(id);
  if (!isTsconfigName(path.basename(file))) return false;
  const absolute = path.isAbsolute(file) ? file : path.resolve(root, file);
  return isInsideRoot(root, absolute);
}
