import type { NativeTransformResult } from "@ivlev-dev/silent-swc";

export interface SilentIndex {
  interfaces: Record<string, string[]>;
  values: Record<string, string[]>;
}

type SwcModule = typeof import("@ivlev-dev/silent-swc");

let swcPromise: Promise<SwcModule> | null = null;

export function loadSwc(): Promise<SwcModule> {
  if (!swcPromise) {
    swcPromise = import("@ivlev-dev/silent-swc").catch((error: unknown) => {
      swcPromise = null;
      const reason = describeError(error);
      throw new Error(
        [
          "@ivlev-dev/silent-vite: не удалось загрузить нативный addon @ivlev-dev/silent-swc.",
          "Соберите нативный addon перед использованием плагина:",
          "  pnpm --filter @ivlev-dev/silent-swc build",
          `Причина: ${reason}`,
        ].join("\n"),
      );
    });
  }
  return swcPromise;
}

export function nativeTransform(
  swc: SwcModule,
  source: string,
  filename: string,
  optionsJson: string,
  indexJson: string,
): NativeTransformResult {
  let raw: string;
  try {
    raw = swc.transform(source, filename, optionsJson, indexJson);
  } catch (error) {
    throw new Error(
      `@ivlev-dev/silent-vite: transform упал для ${filename}:\n${describeError(error)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `@ivlev-dev/silent-vite: @ivlev-dev/silent-swc transform вернул невалидный JSON для ${filename}: ${describeError(error)}`,
    );
  }

  if (!isTransformResult(parsed)) {
    throw new Error(
      `@ivlev-dev/silent-vite: @ivlev-dev/silent-swc transform вернул неожиданную структуру для ${filename}: ${truncate(raw)}`,
    );
  }

  return parsed;
}

export function nativeScan(swc: SwcModule, root: string, optionsJson: string): SilentIndex {
  let raw: string;
  try {
    raw = swc.scan(root, optionsJson);
  } catch (error) {
    throw new Error(
      `@ivlev-dev/silent-vite: scan упал для root ${root}:\n${describeError(error)}`,
    );
  }

  return parseIndex(raw, "scan", `для root ${root}`);
}

/**
 * Инкрементальный скан перечисленных файлов. `null` означает, что нативный
 * addon не экспортирует `scanFiles` — вызывающий код обязан откатиться на
 * полный `scan`.
 */
export function nativeScanFiles(
  swc: SwcModule,
  root: string,
  files: readonly string[],
  optionsJson: string,
): SilentIndex | null {
  const scanFiles = swc.scanFiles;
  if (typeof scanFiles !== "function") return null;

  let raw: string;
  try {
    raw = scanFiles(root, JSON.stringify(files), optionsJson);
  } catch (error) {
    throw new Error(
      `@ivlev-dev/silent-vite: scanFiles упал для ${files.join(", ")}:\n${describeError(error)}`,
    );
  }

  return parseIndex(raw, "scanFiles", `для ${files.join(", ")}`);
}

function parseIndex(raw: string, operation: string, target: string): SilentIndex {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `@ivlev-dev/silent-vite: @ivlev-dev/silent-swc ${operation} вернул невалидный JSON ${target}: ${describeError(error)}`,
    );
  }

  if (!isSilentIndex(parsed)) {
    throw new Error(
      `@ivlev-dev/silent-vite: @ivlev-dev/silent-swc ${operation} вернул неожиданную структуру ${target}`,
    );
  }

  return parsed;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isTransformResult(value: unknown): value is NativeTransformResult {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.code !== "string") return false;
  if (typeof record.map !== "string" && record.map !== null) return false;
  if (!Array.isArray(record.diagnostics)) return false;
  return record.diagnostics.every((item) => typeof item === "string");
}

function isSilentIndex(value: unknown): value is SilentIndex {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return isRecordOfLists(record.interfaces) && isRecordOfLists(record.values);
}

function isRecordOfLists(
  value: unknown,
): value is Record<string, string[]> {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return Object.values(record).every(
    (item) =>
      Array.isArray(item) && item.every((entry) => typeof entry === "string"),
  );
}

function truncate(value: string): string {
  return value.length > 200 ? `${value.slice(0, 200)}…` : value;
}
