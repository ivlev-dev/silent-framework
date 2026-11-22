import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { Alias } from "vite";
import { isTsconfigName } from "./options.js";

export type AliasWarning = (message: string) => void;

export interface AliasRule {
  readonly find: string;
  readonly replacement: string;
}

function stripJsonComments(input: string): string {
  let output = "";
  let index = 0;
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;
  while (index < input.length) {
    const char = input[index]!;
    const next = input[index + 1];
    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
        output += char;
      }
      index += 1;
      continue;
    }
    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }
    if (inString) {
      output += char;
      if (char === "\\") {
        output += next ?? "";
        index += 2;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      index += 1;
      continue;
    }
    if (char === '"') {
      inString = true;
      output += char;
      index += 1;
      continue;
    }
    if (char === "/" && next === "/") {
      inLineComment = true;
      index += 2;
      continue;
    }
    if (char === "/" && next === "*") {
      inBlockComment = true;
      index += 2;
      continue;
    }
    output += char;
    index += 1;
  }
  return output.replace(/,(\s*[}\]])/g, "$1");
}

function readJsonc(file: string): Record<string, unknown> | null {
  try {
    const raw = readFileSync(file, "utf8");
    const parsed: unknown = JSON.parse(stripJsonComments(raw));
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const PREFERRED_TSCONFIG_NAMES = [
  "tsconfig.json",
  "tsconfig.app.json",
  "tsconfig.base.json",
  "tsconfig.node.json",
];

function tsconfigCandidates(root: string): string[] {
  let entries: string[] = [];
  try {
    entries = readdirSync(root);
  } catch {
    entries = [];
  }
  const extra = entries
    .filter((name) => isTsconfigName(name) && !PREFERRED_TSCONFIG_NAMES.includes(name))
    .sort();
  return [...PREFERRED_TSCONFIG_NAMES, ...extra].map((name) => join(root, name));
}

interface TsconfigState {
  paths: Record<string, unknown> | null;
  pathsOrigin: string | null;
  baseUrl: string | null;
}

function emptyTsconfigState(): TsconfigState {
  return { paths: null, pathsOrigin: null, baseUrl: null };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function existingConfigFile(base: string): string | null {
  const candidates = base.endsWith(".json")
    ? [base]
    : [base, `${base}.json`, join(base, "tsconfig.json")];
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate) && statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      continue;
    }
  }
  return null;
}

function resolveExtendsSpecifier(spec: string, fromDirectory: string): string | null {
  if (spec.startsWith(".") || isAbsolute(spec)) {
    return existingConfigFile(
      isAbsolute(spec) ? spec : resolve(fromDirectory, spec),
    );
  }
  try {
    const require = createRequire(join(fromDirectory, "__silent_tsconfig__.json"));
    const resolved = require.resolve(spec);
    if (resolved.endsWith(".json")) {
      return resolved;
    }
    const asConfig = existingConfigFile(resolved);
    if (asConfig !== null) {
      return asConfig;
    }
  } catch {
    // Резолвер Node не нашёл пакет — пробуем вручную пройти node_modules.
  }
  let directory = fromDirectory;
  for (;;) {
    const found = existingConfigFile(join(directory, "node_modules", spec));
    if (found !== null) {
      return found;
    }
    const parent = dirname(directory);
    if (parent === directory) {
      return null;
    }
    directory = parent;
  }
}

function mergeState(base: TsconfigState, override: TsconfigState): TsconfigState {
  return {
    paths: override.paths ?? base.paths,
    pathsOrigin: override.paths !== null ? override.pathsOrigin : base.pathsOrigin,
    baseUrl: override.baseUrl ?? base.baseUrl,
  };
}

/**
 * Разворачивает цепочку `extends` (строка или массив, включая пакетные
 * конфиги) и объединяет compilerOptions по правилам TypeScript: дочерний
 * конфиг перекрывает родительский, `paths` не мержатся, а заменяются целиком.
 */
function collectTsconfigState(
  file: string,
  seen: Set<string>,
): TsconfigState {
  if (seen.has(file)) {
    return emptyTsconfigState();
  }
  seen.add(file);
  const config = readJsonc(file);
  if (config === null) {
    return emptyTsconfigState();
  }

  let state = emptyTsconfigState();
  const extendsValue = config["extends"];
  const specs = typeof extendsValue === "string"
    ? [extendsValue]
    : Array.isArray(extendsValue)
      ? extendsValue.filter((value): value is string => typeof value === "string")
      : [];
  for (const spec of specs) {
    const resolved = resolveExtendsSpecifier(spec, dirname(file));
    if (resolved === null) {
      continue;
    }
    state = mergeState(state, collectTsconfigState(resolved, seen));
  }

  const options = config["compilerOptions"];
  if (!isRecord(options)) {
    return state;
  }
  if (typeof options["baseUrl"] === "string") {
    state.baseUrl = resolve(dirname(file), options["baseUrl"]);
  }
  if (isRecord(options["paths"])) {
    state.paths = options["paths"];
    state.pathsOrigin = dirname(file);
  }
  return state;
}

function stateToAliases(state: TsconfigState, configFile: string): AliasRule[] {
  if (state.paths === null) {
    return [];
  }
  const base = state.baseUrl ?? state.pathsOrigin ?? dirname(configFile);
  const rules: AliasRule[] = [];
  for (const [find, targets] of Object.entries(state.paths)) {
    if (!Array.isArray(targets) || targets.length === 0) {
      continue;
    }
    const target = targets[0];
    if (typeof target !== "string") {
      continue;
    }
    rules.push({
      find: find.endsWith("*") ? find : `${find}*`,
      replacement: resolve(base, target),
    });
  }
  return rules;
}

export function readTsconfigAliases(root: string): AliasRule[] {
  for (const candidate of tsconfigCandidates(root)) {
    if (!existsSync(candidate)) {
      continue;
    }
    const state = collectTsconfigState(candidate, new Set());
    const rules = stateToAliases(state, candidate);
    if (rules.length > 0) {
      return rules;
    }
  }
  return [];
}

export function viteAliases(
  aliases: readonly Alias[],
  root: string,
  warn?: AliasWarning,
): AliasRule[] {
  const rules: AliasRule[] = [];
  for (const alias of aliases) {
    if (typeof alias.find !== "string" || typeof alias.replacement !== "string") {
      warn?.(
        "правило resolve.alias с RegExp find не поддерживается нативным "
          + `резолвером и пропущено: ${String(alias.find)}`,
      );
      continue;
    }
    rules.push({
      find: alias.find,
      replacement: isAbsolute(alias.replacement)
        ? alias.replacement
        : resolve(root, alias.replacement),
    });
  }
  return rules;
}

function applyAliasRule(rule: AliasRule, source: string): boolean {
  const star = rule.find.indexOf("*");
  if (star === -1) {
    return source === rule.find;
  }
  const prefix = rule.find.slice(0, star);
  const suffix = rule.find.slice(star + 1);
  return source.length >= prefix.length + suffix.length
    && source.startsWith(prefix)
    && source.endsWith(suffix);
}

/** Совпадает ли импорт с уже известным правилом алиаса. */
export function aliasMatchesSource(
  source: string,
  rules: readonly AliasRule[],
): boolean {
  return rules.some((rule) => applyAliasRule(rule, source));
}

export function mergeAliases(
  fromVite: readonly Alias[],
  root: string,
): AliasRule[] {
  return mergeAliasRules(viteAliases(fromVite, root), root);
}

/**
 * Объединяет уже нормализованные правила Vite-алиасов со свежими
 * `compilerOptions.paths` из tsconfig. Позволяет пересобрать правила после
 * правки tsconfig, не теряя алиасы из `resolve.alias`.
 */
export function mergeAliasRules(
  viteRules: readonly AliasRule[],
  root: string,
): AliasRule[] {
  const rules = [...viteRules];
  const seen = new Set(rules.map((rule) => rule.find));
  for (const rule of readTsconfigAliases(root)) {
    if (!seen.has(rule.find)) {
      rules.push(rule);
    }
  }
  return rules;
}

export function aliasesJson(rules: readonly AliasRule[]): string {
  return JSON.stringify({ aliases: rules });
}
