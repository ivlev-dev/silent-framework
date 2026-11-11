import { readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { build } from "vite";

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

  const rows = results.map((result) => {
    const initial = collectInitialSize(result.app.root, result.app.outDir);
    return {
      app: result.app.name,
      "cold, ms": Math.round(mean(result.cold)).toLocaleString("ru-RU"),
      "warm, ms": Math.round(mean(result.warm)).toLocaleString("ru-RU"),
      "start JS, KB": (initial.js / 1024).toFixed(1),
      "start gzip, KB": (initial.gzip / 1024).toFixed(1),
      "all JS, KB": (
        collectSize(join(result.app.root, result.app.outDir), ".js") / 1024
      ).toFixed(1),
      "CSS, KB": (
        collectSize(join(result.app.root, result.app.outDir), ".css") / 1024
      ).toFixed(1),
    };
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
