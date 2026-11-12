import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function resolveBenchJsonPath(): string | null {
  const args = process.argv;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) {
      continue;
    }
    if (arg === "--json") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new Error("--json требует путь к файлу");
      }
      return value;
    }
    if (arg.startsWith("--json=")) {
      const value = arg.slice("--json=".length);
      if (value === "") {
        throw new Error("--json требует путь к файлу");
      }
      return value;
    }
  }
  const value = process.env["SILENT_BENCH_JSON"];
  return value === undefined || value === "" ? null : value;
}

export function writeBenchJson(path: string | null, value: unknown): void {
  if (path === null) {
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
