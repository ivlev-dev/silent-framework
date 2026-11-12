import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { NativeTransformResult } from "@ivlev-dev/silent-swc";

const CACHE_FORMAT = "silent-transform-v1";
export const TRANSFORM_CACHE_LIMIT = 1024;

export function hashContent(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function transformCacheKey(parts: readonly string[]): string {
  const hash = createHash("sha256");
  hash.update(CACHE_FORMAT);
  for (const part of parts) {
    hash.update("\0");
    hash.update(part);
  }
  return hash.digest("hex");
}

function isTransformResult(value: unknown): value is NativeTransformResult {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.code !== "string") {
    return false;
  }
  if (typeof record.map !== "string" && record.map !== null) {
    return false;
  }
  return (
    Array.isArray(record.diagnostics)
    && record.diagnostics.every((item) => typeof item === "string")
  );
}

export function readTransformCache(
  directory: string,
  key: string,
): NativeTransformResult | null {
  const file = join(directory, `${key}.json`);
  if (!existsSync(file)) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    return isTransformResult(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeTransformCache(
  directory: string,
  key: string,
  result: NativeTransformResult,
): void {
  try {
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, `${key}.json`), JSON.stringify(result));
  } catch {
    return;
  }
}

export function pruneTransformCache(
  directory: string,
  limit = TRANSFORM_CACHE_LIMIT,
): void {
  if (!existsSync(directory)) {
    return;
  }
  let names: string[];
  try {
    names = readdirSync(directory);
  } catch {
    return;
  }
  const entries: { path: string; mtime: number }[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) {
      continue;
    }
    const path = join(directory, name);
    try {
      entries.push({ path, mtime: statSync(path).mtimeMs });
    } catch {
      continue;
    }
  }
  if (entries.length <= limit) {
    return;
  }
  entries.sort((left, right) => left.mtime - right.mtime);
  const excess = entries.length - limit;
  for (let index = 0; index < excess; index += 1) {
    try {
      rmSync(entries[index]!.path, { force: true });
    } catch {
      continue;
    }
  }
}
