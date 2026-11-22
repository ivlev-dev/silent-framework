import * as path from "node:path";
import { TRANSFORM_CACHE_LIMIT } from "./cache.js";

export type DiMode = "allow" | "warn" | "error";
export type ScanMode = "incremental" | "full";

export interface SilentOptions {
  include?: RegExp;
  exclude?: RegExp;
  root?: string;
  swc?: Record<string, unknown>;
  requirePreloader?: boolean;
  runtime?: string;
  hmr?: boolean;
  index?: boolean;
  scan?: ScanMode;
  view?: boolean;
  hydrate?: boolean;
  di?: DiMode;
  cacheLimit?: number;
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
  scan: ScanMode;
  view: boolean;
  hydrate: boolean;
  di: DiMode;
  cacheLimit: number;
}

export const SOURCE_EXTENSIONS = [
  "ts",
  "tsx",
  "mts",
  "cts",
  "js",
  "jsx",
  "mjs",
  "cjs",
] as const;

export const DEFAULT_INCLUDE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
export const DEFAULT_EXCLUDE = /node_modules/;
export const DEFAULT_RUNTIME = "@ivlev-dev/silent-core";
export const DEFAULT_DI: DiMode = "warn";
export const DEFAULT_SCAN: ScanMode = "incremental";

function normalizeCacheLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) {
    return TRANSFORM_CACHE_LIMIT;
  }
  return Math.floor(value);
}

function isScanMode(value: string | undefined): value is ScanMode {
  return value === "incremental" || value === "full";
}

/**
 * Аварийный режим через окружение: `SILENT_SCAN=full` или `SILENT_SCAN_FULL=1`.
 * Env имеет приоритет над опцией, чтобы можно было оперативно отключить
 * инкрементальный скан без правки конфига.
 */
function envScanMode(): ScanMode | undefined {
  if (process.env.SILENT_SCAN_FULL === "1") return "full";
  const value = process.env.SILENT_SCAN?.trim().toLowerCase();
  return isScanMode(value) ? value : undefined;
}

function resolveScanMode(value: ScanMode | undefined): ScanMode {
  return envScanMode() ?? (value !== undefined && isScanMode(value) ? value : DEFAULT_SCAN);
}

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
    scan: resolveScanMode(options.scan),
    view: options.view ?? true,
    hydrate: options.hydrate ?? true,
    di: options.di ?? DEFAULT_DI,
    cacheLimit: normalizeCacheLimit(options.cacheLimit),
  };
}

// Скомпилированные копии шаблонов без флагов g/y: создаются один раз на RegExp.
const normalizedPatterns = new WeakMap<RegExp, RegExp>();

export function matchesPattern(pattern: RegExp, value: string): boolean {
  let normalized = normalizedPatterns.get(pattern);
  if (normalized === undefined) {
    normalized = new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ""));
    normalizedPatterns.set(pattern, normalized);
  }
  return normalized.test(value);
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
