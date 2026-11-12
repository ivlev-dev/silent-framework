import { readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { build } from "vite";
import { resolveBenchJsonPath, round2, writeBenchJson } from "./cli";

interface BuildApp {
  readonly name: string;
  readonly root: string;
  readonly configFile: string;
  readonly outDir: string;
}

interface AppTimings {
  readonly app: BuildApp;
  readonly cold: readonly number[];
  readonly warm: readonly number[];
}

interface BuildMetrics {
  readonly coldMs: number;
  readonly warmMs: number;
  readonly startJsKb: number;
  readonly startGzipKb: number;
  readonly allJsKb: number;
}

const RUNS = 3;
const benchRoot = join(import.meta.dirname, "..");

const silentRoot = join(benchRoot, "build", "silent");
const solidRoot = join(benchRoot, "build", "solid");

const APPS: readonly BuildApp[] = [
  {
    name: "silent",
    root: silentRoot,
    configFile: "vite.config.ts",
    outDir: "dist",
  },
  {
    name: "silent+vm",
    root: silentRoot,
    configFile: "vite.vm.config.ts",
    outDir: "dist-vm",
  },
  {
    name: "solid",
    root: solidRoot,
    configFile: "vite.config.ts",
    outDir: "dist",
  },
];

function clearArtifacts(root: string, outDir: string): void {
  rmSync(join(root, outDir), { recursive: true, force: true });
  rmSync(join(root, "node_modules", ".vite"), { recursive: true, force: true });
  rmSync(join(root, "node_modules", ".vite-temp"), {
    recursive: true,
    force: true,
  });
}

async function runBuild(root: string, configFile: string): Promise<number> {
  const start = performance.now();
  await build({
    root,
    configFile: join(root, configFile),
    logLevel: "silent",
  });
  return performance.now() - start;
}

function collectSize(directory: string, extension: string): number {
  let total = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      total += collectSize(path, extension);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(extension)) {
      total += statSync(path).size;
    }
  }
  return total;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function collectInitialSize(root: string, outDir: string): { js: number; gzip: number } {
  const html = readFileSync(join(root, outDir, "index.html"), "utf8");
  const files = new Set<string>();
  for (const match of html.matchAll(/(?:src|href)="([^"]+\.js)"/g)) {
    const file = match[1];
    if (file !== undefined) files.add(file.replace(/^\//, ""));
  }
  let js = 0;
  let gzip = 0;
  for (const file of files) {
    const path = join(root, outDir, file);
    const content = readFileSync(path);
    js += content.length;
    gzip += gzipSync(content).length;
  }
  return { js, gzip };
}

function metricKey(name: string): string {
  return name === "silent+vm" ? "silentVm" : name;
}

function readMetric(
  metrics: ReadonlyMap<string, BuildMetrics>,
  key: string,
): BuildMetrics {
  const value = metrics.get(key);
  if (value === undefined) {
    throw new Error(`Нет метрик сборки для ${key}`);
  }
  return value;
}

function jsonMetric(value: BuildMetrics): BuildMetrics {
  return {
    coldMs: round2(value.coldMs),
    warmMs: round2(value.warmMs),
    startJsKb: round2(value.startJsKb),
    startGzipKb: round2(value.startGzipKb),
    allJsKb: round2(value.allJsKb),
  };
}

async function main(): Promise<void> {
  const results: AppTimings[] = [];

  for (const app of APPS) {
    const cold: number[] = [];
    const warm: number[] = [];

    for (let run = 0; run < RUNS; run += 1) {
      clearArtifacts(app.root, app.outDir);
      cold.push(await runBuild(app.root, app.configFile));
    }

    for (let run = 0; run < RUNS; run += 1) {
      warm.push(await runBuild(app.root, app.configFile));
    }

    results.push({ app, cold, warm });
  }

  const metrics = new Map<string, BuildMetrics>();
  const rows = results.map((result) => {
    const initial = collectInitialSize(result.app.root, result.app.outDir);
    const allJs = collectSize(
      join(result.app.root, result.app.outDir),
      ".js",
    );
    const values: BuildMetrics = {
      coldMs: mean(result.cold),
      warmMs: mean(result.warm),
      startJsKb: initial.js / 1024,
      startGzipKb: initial.gzip / 1024,
      allJsKb: allJs / 1024,
    };
    metrics.set(metricKey(result.app.name), values);
    return {
      app: result.app.name,
      "cold, ms": Math.round(values.coldMs).toLocaleString("ru-RU"),
      "warm, ms": Math.round(values.warmMs).toLocaleString("ru-RU"),
      "start JS, KB": values.startJsKb.toFixed(1),
      "start gzip, KB": values.startGzipKb.toFixed(1),
      "all JS, KB": values.allJsKb.toFixed(1),
      "CSS, KB": (
        collectSize(join(result.app.root, result.app.outDir), ".css") / 1024
      ).toFixed(1),
    };
  });

  writeBenchJson(resolveBenchJsonPath(), {
    app: "build",
    silent: jsonMetric(readMetric(metrics, "silent")),
    silentVm: jsonMetric(readMetric(metrics, "silentVm")),
    solid: jsonMetric(readMetric(metrics, "solid")),
  });

  console.log(
    `Сборка Vite: ${RUNS} cold + ${RUNS} warm прогонов, средние значения`,
  );
  console.log(
    `Node.js ${process.version}, CPU: ${cpus()[0]?.model ?? "unknown"}`,
  );
  console.table(rows);
}

await main();
