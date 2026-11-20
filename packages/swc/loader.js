import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const NATIVE_PACKAGE_PREFIX = "@ivlev-dev/silent-swc-";
const BUILD_HINT = "pnpm --filter @ivlev-dev/silent-swc build";

/**
 * Определяет libc по отчёту процесса: наличие glibcVersionRuntime означает gnu.
 * @param {unknown} report
 * @returns {"gnu" | "musl"}
 */
export function detectLibc(report) {
  const header = typeof report === "object" && report !== null ? report.header : undefined;
  const glibc = typeof header === "object" && header !== null ? header.glibcVersionRuntime : undefined;
  return typeof glibc === "string" && glibc.length > 0 ? "gnu" : "musl";
}

/**
 * Возвращает тройки в порядке приоритета. Для musl fallback на gnu добавляется
 * только при явном `allowGnuFallback` (env `SILENT_SWC_ALLOW_GNU_FALLBACK=1`).
 * @param {{ platform: string, arch: string, libc?: "gnu" | "musl", allowGnuFallback?: boolean }} options
 * @returns {string[]}
 */
export function resolveNativeTriples({
  platform,
  arch,
  libc = "gnu",
  allowGnuFallback = false,
}) {
  if (platform === "linux") {
    const triple = `linux-${arch}-${libc}`;
    return libc === "musl" && allowGnuFallback ? [triple, `linux-${arch}-gnu`] : [triple];
  }
  if (platform === "win32") {
    return [`win32-${arch}-msvc`];
  }
  return [`${platform}-${arch}`];
}

/**
 * @param {string} triple
 * @returns {string}
 */
export function nativePackageName(triple) {
  return `${NATIVE_PACKAGE_PREFIX}${triple}`;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isNativeModule(value) {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = /** @type {Record<string, unknown>} */ (value);
  return (
    typeof record.transform === "function"
    && typeof record.scan === "function"
    && typeof record.version === "function"
  );
}

function asNativeModule(value) {
  if (isNativeModule(value)) {
    return value;
  }
  if (typeof value === "object" && value !== null) {
    const fallback = /** @type {Record<string, unknown>} */ (value).default;
    if (isNativeModule(fallback)) {
      return fallback;
    }
  }
  return null;
}

function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}

function localArtifact(directory, triples) {
  if (!existsSync(directory)) {
    return { artifact: null, reason: `каталог ${directory} не найден` };
  }
  let files;
  try {
    files = readdirSync(directory).filter((name) => name.endsWith(".node"));
  } catch (error) {
    return { artifact: null, reason: `не удалось прочитать ${directory}: ${describeError(error)}` };
  }
  const preferred = [];
  for (const triple of triples) {
    preferred.push(
      `silent-swc.${triple}.node`,
      `index.${triple}.node`,
      `silent-node.${triple}.node`,
    );
  }
  preferred.push("silent-swc.node");
  const exact = preferred.find((name) => files.includes(name));
  if (exact !== undefined) {
    return { artifact: join(directory, exact), reason: null };
  }
  const matched = files.find((name) =>
    triples.some((triple) => name.includes(triple) || name.includes(triple.toUpperCase())),
  );
  if (matched !== undefined) {
    return { artifact: join(directory, matched), reason: null };
  }
  return {
    artifact: null,
    reason: files.length === 0
      ? `в ${directory} нет собранных .node файлов`
      : `в ${directory} нет артефакта для ${triples.join(", ")}`,
  };
}

/**
 * @param {readonly string[]} triples
 * @param {readonly string[]} reasons
 * @returns {Error}
 */
export function nativeLoadError(triples, reasons) {
  const lines = [
    "@ivlev-dev/silent-swc: не удалось загрузить нативный addon.",
    `Ожидаемые пакеты: ${triples.map(nativePackageName).join(", ") || "(тройка не определена)"}.`,
    `Соберите нативный addon: \`${BUILD_HINT}\`.`,
  ];
  // Подсказка про fallback уместна, только если gnu даже не пробовали.
  if (triples.length === 1 && triples[0].endsWith("-musl")) {
    lines.push(
      "Для musl сборка gnu не используется: разрешить fallback можно только явно через SILENT_SWC_ALLOW_GNU_FALLBACK=1.",
    );
  }
  if (reasons.length > 0) {
    lines.push(`Причины: ${reasons.join("; ")}.`);
  }
  return new Error(lines.join("\n"));
}

/**
 * Загружает нативный addon: сначала платформенный пакет, затем локальную сборку.
 * Не кеширует неудачи — повторный вызов снова пробует загрузку (успешный
 * `require` кешируется самим Node).
 * @param {{ requireModule: (name: string) => unknown, nativeDirectory: string, triples: readonly string[] }} options
 */
export function loadNative({ requireModule, nativeDirectory, triples }) {
  const reasons = [];
  for (const triple of triples) {
    const name = nativePackageName(triple);
    try {
      const loaded = asNativeModule(requireModule(name));
      if (loaded !== null) {
        return loaded;
      }
      reasons.push(`${name}: модуль не экспортирует transform/scan/version`);
    } catch (error) {
      reasons.push(`${name}: ${describeError(error)}`);
    }
  }

  const local = localArtifact(nativeDirectory, triples);
  if (local.artifact === null) {
    if (local.reason !== null) {
      reasons.push(local.reason);
    }
    throw nativeLoadError(triples, reasons);
  }
  try {
    const loaded = asNativeModule(requireModule(local.artifact));
    if (loaded !== null) {
      return loaded;
    }
    reasons.push(`${local.artifact}: модуль не экспортирует transform/scan/version`);
  } catch (error) {
    reasons.push(`${local.artifact}: ${describeError(error)}`);
  }
  throw nativeLoadError(triples, reasons);
}
