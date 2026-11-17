import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { Alias } from "vite";

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

function tsconfigCandidates(root: string): string[] {
  return [
    join(root, "tsconfig.json"),
    join(root, "tsconfig.app.json"),
    join(root, "tsconfig.base.json"),
  ];
}

export function readTsconfigAliases(root: string): AliasRule[] {
  for (const candidate of tsconfigCandidates(root)) {
    if (!existsSync(candidate)) {
      continue;
    }
    const config = readJsonc(candidate);
    if (config === null) {
      continue;
    }
    const options = config["compilerOptions"];
    if (typeof options !== "object" || options === null) {
      continue;
    }
    const record = options as Record<string, unknown>;
    const paths = record["paths"];
    if (typeof paths !== "object" || paths === null) {
      continue;
    }
    const baseUrl =
      typeof record["baseUrl"] === "string" ? record["baseUrl"] : ".";
    const base = resolve(dirname(candidate), baseUrl);
    const rules: AliasRule[] = [];
    for (const [find, targets] of Object.entries(paths as Record<string, unknown>)) {
      if (!Array.isArray(targets) || targets.length === 0) {
        continue;
      }
      const target = targets[0];
      if (typeof target !== "string") {
        continue;
      }
      rules.push({
        find: find.endsWith("*") ? find : `${find}*`,
        replacement: join(base, target),
      });
    }
    if (rules.length > 0) {
      return rules;
    }
  }
  return [];
}

export function viteAliases(aliases: readonly Alias[], root: string): AliasRule[] {
  const rules: AliasRule[] = [];
  for (const alias of aliases) {
    if (typeof alias.find !== "string" || typeof alias.replacement !== "string") {
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

export function mergeAliases(
  fromVite: readonly Alias[],
  root: string,
): AliasRule[] {
  const rules = [...viteAliases(fromVite, root)];
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
