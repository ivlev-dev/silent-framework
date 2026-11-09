import type { NativeTransformResult } from "@ivlev98/silent-swc";

export interface SilentIndex {
  interfaces: Record<string, string[]>;
  values: Record<string, string[]>;
}

type SwcModule = typeof import("@ivlev98/silent-swc");

let swcPromise: Promise<SwcModule> | null = null;

export function loadSwc(): Promise<SwcModule> {
  if (!swcPromise) {
    swcPromise = import("@ivlev98/silent-swc").catch((error: unknown) => {
      swcPromise = null;
      const reason = describeError(error);
      throw new Error(
        [
          "@ivlev98/silent-vite: не удалось загрузить нативный addon @ivlev98/silent-swc.",
          "Соберите нативный addon перед использованием плагина:",
          "  pnpm --filter @ivlev98/silent-swc build",
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
      `@ivlev98/silent-vite: transform упал для ${filename}:\n${describeError(error)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `@ivlev98/silent-vite: @ivlev98/silent-swc transform вернул невалидный JSON для ${filename}: ${describeError(error)}`,
    );
  }

  if (!isTransformResult(parsed)) {
    throw new Error(
      `@ivlev98/silent-vite: @ivlev98/silent-swc transform вернул неожиданную структуру для ${filename}: ${truncate(raw)}`,
    );
  }

  return parsed;
}

export function nativeScan(swc: SwcModule, root: string): SilentIndex {
  let raw: string;
  try {
    raw = swc.scan(root);
  } catch (error) {
    throw new Error(
      `@ivlev98/silent-vite: scan упал для root ${root}:\n${describeError(error)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `@ivlev98/silent-vite: @ivlev98/silent-swc scan вернул невалидный JSON для root ${root}: ${describeError(error)}`,
    );
  }

  if (!isSilentIndex(parsed)) {
    throw new Error(
      `@ivlev98/silent-vite: @ivlev98/silent-swc scan вернул неожиданную структуру для root ${root}`,
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
