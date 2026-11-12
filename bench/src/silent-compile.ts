import { readFileSync } from "node:fs";
import { transform, type NativeTransformResult } from "@ivlev-dev/silent-swc";

const OPTIONS_JSON = JSON.stringify({ swc: {}, hmr: false });
const INDEX_JSON = JSON.stringify({ interfaces: {}, values: {} });

function optionsJson(ssr: boolean): string {
  return ssr ? JSON.stringify({ swc: {}, hmr: false, ssr: true }) : OPTIONS_JSON;
}

export function compileSilent(filename: string, ssr = false): string {
  const source = readFileSync(filename, "utf8");
  const raw = transform(source, filename, optionsJson(ssr), INDEX_JSON);
  const parsed: unknown = JSON.parse(raw);

  if (!isTransformResult(parsed)) {
    throw new Error("Silent не скомпилировал " + filename);
  }

  return parsed.code;
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
    Array.isArray(record.diagnostics) &&
    record.diagnostics.every((item) => typeof item === "string")
  );
}
