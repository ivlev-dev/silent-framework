#!/usr/bin/env node
/**
 * Precompiled-сборка `@ivlev-dev/silent-dnd`.
 *
 * Vite-плагин `silent()` не трансформирует `node_modules`, поэтому TSX
 * библиотеки должен быть скомпилирован в шаблонный runtime до публикации.
 * Сборка повторяет модель `@ivlev-dev/silent-ui`: SWC-компиляция исходников
 * с `hydrate: true` + `tsc --emitDeclarationOnly` для деклараций.
 */
import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { scan, transform } from "@ivlev-dev/silent-swc";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = join(packageRoot, "src");
const distRoot = join(packageRoot, "dist");
const repoRoot = resolve(packageRoot, "..", "..");
const ALIAS_OPTIONS = JSON.stringify({ aliases: [] });
const LOG_PREFIX = "[dnd:build]";

/** Опции совпадают с `packages/vite/src/index.ts`: jsc + sourceMaps, без HMR. */
function optionsJsonFor(file) {
  return JSON.stringify({
    swc: {
      jsc: {
        target: "es2022",
        parser: { syntax: "typescript", tsx: file.endsWith(".tsx") },
      },
      sourceMaps: true,
    },
    hmr: false,
    // Пакет должен одинаково работать и при SSR, и при клиентской гидрации.
    ssr: true,
    hydrate: true,
    // У пакета нет DI-классов: `allow` не даёт ложной диагностике на обычных
    // параметрах конструктора (например, `VirtualizerOptions`) ломать сборку.
    // Реальный индекс ниже нужен, чтобы типы не превращались в value-импорты.
    di: "allow",
    aliases: [],
  });
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(absolute)));
    } else if (entry.isFile()) {
      files.push(absolute);
    }
  }
  return files;
}

function fail(message) {
  console.error(`${LOG_PREFIX} ${message}`);
  process.exit(1);
}

function toPosix(value) {
  return value.split(sep).join("/");
}

function stripSourceMapComment(code) {
  return code.replace(/\n?\/\/# sourceMappingURL=.*$/u, "");
}

async function compileSources(files, indexJson) {
  let compiled = 0;
  for (const file of files) {
    const relativePath = toPosix(relative(sourceRoot, file));
    const outputPath = join(distRoot, relativePath).replace(/\.tsx?$/u, ".js");
    const source = await readFile(file, "utf8");
    let raw;
    try {
      raw = transform(source, file, optionsJsonFor(file), indexJson);
    } catch (error) {
      fail(`transform упал для ${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const result = JSON.parse(raw);
    if (!Array.isArray(result.diagnostics) || result.diagnostics.length > 0) {
      fail(`диагностика для ${relativePath}:\n${(result.diagnostics ?? []).join("\n")}`);
    }
    if (typeof result.code !== "string") {
      fail(`transform не вернул code для ${relativePath}`);
    }
    await mkdir(dirname(outputPath), { recursive: true });
    let code = stripSourceMapComment(result.code);
    if (typeof result.map === "string" && result.map.length > 0) {
      const mapName = `${relativePath.split("/").pop().replace(/\.tsx?$/u, ".js")}.map`;
      const mapPath = `${outputPath}.map`;
      const parsedMap = JSON.parse(result.map);
      parsedMap.file = mapName;
      if (Array.isArray(parsedMap.sources)) {
        parsedMap.sources = parsedMap.sources.map((entry) => {
          const absolute = resolve(dirname(file), entry);
          return toPosix(relative(dirname(outputPath), absolute));
        });
      }
      await writeFile(mapPath, `${JSON.stringify(parsedMap)}\n`);
      code = `${code.trimEnd()}\n//# sourceMappingURL=${mapName}\n`;
    } else {
      code = `${code.trimEnd()}\n`;
    }
    await writeFile(outputPath, code);
    compiled += 1;
  }
  return compiled;
}

const JSX_CALL = /\b(?:jsxs?|jsxDEV)\s*\(/u;
const CREATE_ELEMENT = /\bcreateElement\s*\(/u;
const SSR_ONLY = /\bssrRaw\s*\(/u;
// Трансформер добавляет value-импорт с именем `_Type1`, когда не смог
// отличить тип от значения (пустой DI-индекс). Такой импорт падает в рантайме.
const SPURIOUS_TYPE_IMPORT = /\bas\s+_[A-Z][A-Za-z0-9_$]*\d\b/u;
const RUNTIME_MARKERS = ["template(", "templateHoles(", "component("];

/** Компоненты должны быть скомпилированы в шаблонный runtime, а не в `jsx()`. */
async function verifyCompiled(files) {
  const problems = [];
  for (const source of files) {
    const relativePath = toPosix(relative(sourceRoot, source)).replace(/\.tsx?$/u, ".js");
    const absolute = join(distRoot, relativePath);
    const code = await readFile(absolute, "utf8");
    if (JSX_CALL.test(code)) {
      problems.push(`${relativePath}: остались вызовы jsx()/jsxs()`);
    }
    if (CREATE_ELEMENT.test(code)) {
      problems.push(`${relativePath}: остался React.createElement()/createElement() из JSX`);
    }
    // `ssrRaw()` работает только при серверном рендеринге: такой модуль
    // упал бы при клиентской гидрации, поэтому в общий dist он не годится.
    if (SSR_ONLY.test(code)) {
      problems.push(`${relativePath}: остался ssrRaw() — модуль не гидрируется на клиенте`);
    }
    if (SPURIOUS_TYPE_IMPORT.test(code)) {
      problems.push(`${relativePath}: тип превратился в value-импорт (_TypeN) — проверьте DI-индекс`);
    }
    if (source.endsWith(".tsx") && !RUNTIME_MARKERS.some((marker) => code.includes(marker))) {
      problems.push(`${relativePath}: нет template()/templateHoles()/component() — компонент не скомпилирован`);
    }
  }
  if (problems.length > 0) {
    fail(`проверка dist не прошла:\n${problems.join("\n")}`);
  }
}

function tscBinary() {
  const candidates = [
    join(packageRoot, "node_modules", ".bin", "tsc"),
    join(repoRoot, "node_modules", ".bin", "tsc"),
    join(repoRoot, "node_modules", "typescript", "bin", "tsc"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function emitDeclarations() {
  const binary = tscBinary();
  const args = ["--emitDeclarationOnly", "-p", "tsconfig.json"];
  try {
    if (binary !== null && !binary.endsWith(".js")) {
      execFileSync(binary, args, { cwd: packageRoot, stdio: "inherit" });
      return;
    }
    if (binary !== null) {
      execFileSync(process.execPath, [binary, ...args], { cwd: packageRoot, stdio: "inherit" });
      return;
    }
    execFileSync("pnpm", ["exec", "tsc", ...args], { cwd: packageRoot, stdio: "inherit" });
  } catch (error) {
    fail(`tsc не собрал декларации: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main() {
  await rm(distRoot, { recursive: true, force: true });
  // composite-проект кеширует состояние в .tsbuildinfo: после удаления dist
  // без этого файла tsc решит, что всё уже собрано, и ничего не эмитит.
  await rm(join(packageRoot, ".tsbuildinfo"), { force: true });
  const files = await walk(sourceRoot);
  const codeFiles = files.filter((file) => /\.(?:ts|tsx)$/u.test(file) && !file.endsWith(".d.ts"));
  if (codeFiles.length === 0) {
    fail(`в ${sourceRoot} нет TypeScript-исходников`);
  }

  const compiled = await compileSources(codeFiles, scan(sourceRoot, ALIAS_OPTIONS));
  await verifyCompiled(codeFiles);
  emitDeclarations();

  console.log(`${LOG_PREFIX} ok: ${compiled} модулей`);
}

await main();
