import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pluginPath = join(root, "packages", "validation-vite", "dist", "index.js");
const DEFAULT_FILES = 120;
const ROUNDS = 3;

if (!existsSync(pluginPath)) {
  console.error(
    "bench:validation-build: нет packages/validation-vite/dist — сначала запусти pnpm --filter @ivlev-dev/silent-validation-vite build",
  );
  process.exit(2);
}

function readFileCount() {
  let value = process.env.SILENT_BENCH_FILES;
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--files") {
      value = args[index + 1];
      index += 1;
    } else if (arg.startsWith("--files=")) {
      value = arg.slice("--files=".length);
    }
  }
  const count = Number(value ?? DEFAULT_FILES);
  if (!Number.isInteger(count) || count <= 0) {
    console.error(
      "bench:validation-build: --files (или SILENT_BENCH_FILES) должен быть положительным целым числом",
    );
    process.exit(2);
  }
  return count;
}

function modelSource(name, index) {
  return [
    'import { ValidationModel } from "../validation-model.js";',
    "",
    `class Address${index} {`,
    '  public accessor city: string = "";',
    "}",
    "",
    `export class ${name} extends ValidationModel {`,
    "  public accessor id: number = 0;",
    '  public accessor name: string = "";',
    '  public accessor email: string = "";',
    "  public accessor active: boolean = false;",
    "  public accessor tags: string[] = [];",
    `  public accessor address: Address${index} = new Address${index}();`,
    "}",
    "",
  ].join("\n");
}

function writeProject(directory, count) {
  mkdirSync(join(directory, "src", "models"), { recursive: true });
  writeFileSync(
    join(directory, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler",
          strict: true,
          experimentalDecorators: false,
          useDefineForClassFields: true,
          skipLibCheck: true,
          noEmit: true,
        },
        include: ["src"],
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(directory, "src", "validation-model.ts"),
    "export class ValidationModel {}\n",
  );
  const imports = [];
  const instances = [];
  for (let index = 0; index < count; index += 1) {
    const name = `Model${String(index).padStart(3, "0")}`;
    const file = `model-${String(index).padStart(3, "0")}`;
    writeFileSync(
      join(directory, "src", "models", `${file}.ts`),
      modelSource(name, index),
    );
    imports.push(`import { ${name} } from "./models/${file}.js";`);
    instances.push(`  new ${name}(),`);
  }
  writeFileSync(
    join(directory, "src", "main.ts"),
    `${imports.join("\n")}\n\nconst models = [\n${instances.join("\n")}\n];\n\nconsole.log(models.length);\n`,
  );
}

async function measure(label, run) {
  const samples = [];
  for (let round = 0; round < ROUNDS; round += 1) {
    const start = performance.now();
    await run();
    samples.push(performance.now() - start);
  }
  samples.sort((left, right) => left - right);
  const median = samples[Math.floor(ROUNDS / 2)];
  const best = samples[0];
  console.log(
    `${label.padEnd(16)} ${median.toFixed(1).padStart(8)} ms  (лучший ${best.toFixed(1)} ms)`,
  );
}

const count = readFileCount();
const directory = mkdtempSync(join(tmpdir(), "silent-bench-validation-build-"));

try {
  writeProject(directory, count);
  const { build } = await import("vite");
  const { validation } = await import(pathToFileURL(pluginPath).href);

  const runBuild = (plugins) =>
    build({
      root: directory,
      configFile: false,
      logLevel: "silent",
      plugins,
      build: {
        write: false,
        minify: false,
        target: "esnext",
        rollupOptions: { input: join(directory, "src", "main.ts") },
      },
    });

  await runBuild([]);
  await runBuild([validation()]);

  console.log(
    `bench:validation-build: ${count} файлов, медиана из ${ROUNDS} (cold — новый экземпляр плагина)`,
  );

  await measure("baseline cold", () => runBuild([]));
  await measure("validation cold", () => runBuild([validation()]));
  await measure("baseline warm", () => runBuild([]));

  const warmPlugin = validation();
  await runBuild([warmPlugin]);
  await measure("validation warm", () => runBuild([warmPlugin]));
} catch (error) {
  console.error(
    `bench:validation-build: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
} finally {
  rmSync(directory, { recursive: true, force: true });
}
