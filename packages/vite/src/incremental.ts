import { realpathSync } from "node:fs";
import * as path from "node:path";
import type { SilentIndex } from "./native.js";

const SOURCE_EXTENSIONS = new Set([
  "ts",
  "tsx",
  "mts",
  "cts",
  "js",
  "jsx",
  "mjs",
  "cjs",
]);

function toPosix(value: string): string {
  return value.replace(/\\/g, "/");
}

/**
 * Канонизирует путь так же, как `fs::canonicalize` в нативном сканере.
 * Для уже удалённого файла берётся realpath родительского каталога.
 */
export function canonicalizePath(file: string): string {
  const absolute = path.resolve(file);
  try {
    return toPosix(realpathSync.native(absolute));
  } catch {
    try {
      return toPosix(
        path.join(realpathSync.native(path.dirname(absolute)), path.basename(absolute)),
      );
    } catch {
      return toPosix(absolute);
    }
  }
}

function stripSourceExtension(file: string): string {
  const slash = file.lastIndexOf("/");
  const dot = file.lastIndexOf(".");
  if (dot > slash && SOURCE_EXTENSIONS.has(file.slice(dot + 1))) {
    return file.slice(0, dot);
  }
  return file;
}

/** Ключ `values` в индексе: канонический путь модуля без расширения. */
export function modulePathOfFile(file: string): string {
  return stripSourceExtension(canonicalizePath(file));
}

/**
 * Ключи, под которыми файл мог попасть в индекс: канонический и лексический.
 * Второй страхует от расхождений на симлинках и при удалении файла.
 */
export function modulePathCandidates(file: string): string[] {
  return [
    ...new Set([
      modulePathOfFile(file),
      stripSourceExtension(toPosix(path.resolve(file))),
    ]),
  ];
}

function moduleOfToken(token: string): string {
  const separator = token.lastIndexOf("#");
  return separator === -1 ? token : token.slice(0, separator);
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * Удаляет из индекса всё, что модуль внёс сам: `values[module]` и его
 * реализации в токенах интерфейсов.
 *
 * Токены `module#Interface`, объявленные этим модулем, не удаляются целиком:
 * реализации в них принадлежат другим файлам, которые не сканировались.
 * Устаревший токен исчезнет, когда обновится последний файл-реализация.
 */
export function removeModuleFromIndex(index: SilentIndex, file: string): boolean {
  const keys = new Set(modulePathCandidates(file));
  let changed = false;

  for (const key of keys) {
    if (Object.hasOwn(index.values, key)) {
      delete index.values[key];
      changed = true;
    }
  }

  for (const [token, implementations] of Object.entries(index.interfaces)) {
    const kept = implementations.filter(
      (implementation) => !keys.has(moduleOfToken(implementation)),
    );
    if (kept.length === implementations.length) continue;
    changed = true;
    if (kept.length === 0) {
      delete index.interfaces[token];
    } else {
      index.interfaces[token] = kept;
    }
  }

  return changed;
}

/** Сливает индекс, полученный для набора файлов, в полный индекс. */
export function mergeIndexDelta(index: SilentIndex, delta: SilentIndex): boolean {
  let changed = false;

  for (const [module, names] of Object.entries(delta.values)) {
    const previous = index.values[module];
    if (previous !== undefined && sameList(previous, names)) continue;
    index.values[module] = names;
    changed = true;
  }

  for (const [token, implementations] of Object.entries(delta.interfaces)) {
    const previous = index.interfaces[token];
    if (previous === undefined) {
      index.interfaces[token] = [...implementations];
      changed = true;
      continue;
    }
    const merged = [...previous];
    for (const implementation of implementations) {
      if (!merged.includes(implementation)) merged.push(implementation);
    }
    if (merged.length === previous.length) continue;
    index.interfaces[token] = merged;
    changed = true;
  }

  return changed;
}

/**
 * Снимок только тех записей индекса, которые относятся к модулю. Позволяет
 * дешево понять, изменилось ли содержимое после remove+merge, не сортируя и не
 * сериализуя весь индекс.
 */
export function moduleFingerprint(index: SilentIndex, file: string): string {
  const keys = new Set(modulePathCandidates(file));
  const values: Array<[string, string[] | null]> = [];
  for (const key of [...keys].sort()) {
    const names = index.values[key];
    values.push([key, names === undefined ? null : [...names].sort()]);
  }

  const interfaces: Array<[string, string[]]> = [];
  for (const token of Object.keys(index.interfaces).sort()) {
    const implementations = index.interfaces[token]!;
    if (keys.has(moduleOfToken(token))) {
      interfaces.push([token, [...implementations].sort()]);
      continue;
    }
    const related = implementations
      .filter((implementation) => keys.has(moduleOfToken(implementation)))
      .sort();
    if (related.length > 0) interfaces.push([token, related]);
  }

  return JSON.stringify({ values, interfaces });
}

function sortRecord(record: Record<string, string[]>): Record<string, string[]> {
  const sorted: Record<string, string[]> = {};
  for (const key of Object.keys(record).sort()) {
    sorted[key] = [...record[key]!].sort();
  }
  return sorted;
}

/**
 * Детерминированное представление индекса: порядок ключей и элементов не влияет
 * на хеш, поэтому неизменившийся по содержимому индекс не инвалидирует кеш
 * трансформаций (инкрементальный merge может переставить реализации).
 */
export function stableIndexJson(index: SilentIndex): string {
  return JSON.stringify({
    interfaces: sortRecord(index.interfaces),
    values: sortRecord(index.values),
  });
}
