import { isAbsolute } from "node:path";

// Импорт с `from "...": клауза ограничена точкой с запятой, поэтому одна
// декларация не «съедает» следующую в коде без `;`.
const IMPORT_FROM = /\bimport\s+((?:(?!;)[\s\S])*?)\bfrom\s*(['"])([^'"]+)\2/g;
const SIDE_EFFECT_IMPORT = /\bimport\s*(?!type\b)(['"])([^'"]+)\1/g;

function isTypeOnlyClause(clause: string): boolean {
  const trimmed = clause.trim();
  if (/^type\s/.test(trimmed)) {
    return true;
  }
  // `import { type A, type B as C } from "..."`.
  const match = /^\{([\s\S]*)\}$/.exec(trimmed);
  if (match === null) {
    return false;
  }
  const specifiers = match[1]!
    .split(",")
    .map((specifier) => specifier.trim())
    .filter((specifier) => specifier.length > 0);
  return (
    specifiers.length > 0
    && specifiers.every((specifier) => /^type\s+/.test(specifier))
  );
}

/**
 * Возвращает модули, импортированные только как типы. Для них нельзя
 * генерировать runtime-импорт значения: если модуль не резолвится (bare-пакет,
 * алиас-тип), плагин подменяет его ссылкой на текущий модуль, и addon выдаёт
 * диагностику вместо импорта несуществующего экспорта.
 */
export function collectTypeOnlyImportSources(code: string): string[] {
  const typeSources = new Set<string>();
  const valueSources = new Set<string>();
  for (const match of code.matchAll(IMPORT_FROM)) {
    const clause = match[1] ?? "";
    const source = match[3]!;
    if (isTypeOnlyClause(clause)) {
      typeSources.add(source);
    } else {
      valueSources.add(source);
    }
  }
  for (const match of code.matchAll(SIDE_EFFECT_IMPORT)) {
    valueSources.add(match[2]!);
  }
  return [...typeSources].filter((source) => !valueSources.has(source));
}

/** Bare-спецификатор: не относительный, не абсолютный и не URL-подобный. */
export function isBareSpecifier(source: string): boolean {
  return !source.startsWith(".")
    && !isAbsolute(source)
    && !source.startsWith("/");
}
