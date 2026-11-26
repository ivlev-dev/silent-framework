#!/usr/bin/env node
/**
 * Precompiled-сборка `@ivlev-dev/silent-ui`.
 *
 * Пакет поставляется в `dist` уже скомпилированным `@ivlev-dev/silent-swc`:
 * Vite-плагин `silent()` не трансформирует `node_modules`, поэтому TSX
 * библиотеки должен быть собран до публикации. Сборка не требует Vite,
 * идемпотентна и не оставляет промежуточных файлов.
 */
import { execFileSync } from "node:child_process";
import {
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { transform } from "@ivlev-dev/silent-swc";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = join(packageRoot, "src");
const distRoot = join(packageRoot, "dist");
const repoRoot = resolve(packageRoot, "..", "..");
const EMPTY_INDEX = JSON.stringify({ interfaces: {}, values: {} });

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
    ssr: false,
    hydrate: true,
    di: "warn",
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
  console.error(`[ui:build] ${message}`);
  process.exit(1);
}

function toPosix(value) {
  return value.split(sep).join("/");
}

function stripSourceMapComment(code) {
  return code.replace(/\n?\/\/# sourceMappingURL=.*$/u, "");
}

async function compileSources(files) {
  let compiled = 0;
  for (const file of files) {
    if (file.endsWith(".d.ts")) continue;
    const extension = file.endsWith(".tsx") ? ".tsx" : ".ts";
    if (!file.endsWith(extension)) continue;
    const relativePath = toPosix(relative(sourceRoot, file));
    const outputPath = join(distRoot, relativePath).replace(/\.tsx?$/u, ".js");
    const source = await readFile(file, "utf8");
    let raw;
    try {
      raw = transform(source, file, optionsJsonFor(file), EMPTY_INDEX);
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
const CREATE_ELEMENT = /\bReact\.createElement\s*\(|(?<![.\w$])createElement\s*\(/u;
const RUNTIME_MARKERS = ["template(", "templateHoles(", "component("];

/** Компоненты должны быть скомпилированы в шаблонный runtime, а не в `jsx()`. */
async function verifyCompiled(files) {
  const compiledFiles = [];
  for (const file of files) {
    const relativePath = toPosix(relative(sourceRoot, file)).replace(/\.tsx?$/u, ".js");
    compiledFiles.push({ relativePath, absolute: join(distRoot, relativePath), source: file });
  }
  const problems = [];
  for (const { relativePath, absolute, source } of compiledFiles) {
    const code = await readFile(absolute, "utf8");
    if (JSX_CALL.test(code)) {
      problems.push(`${relativePath}: остались вызовы jsx()/jsxs()`);
    }
    if (CREATE_ELEMENT.test(code)) {
      problems.push(`${relativePath}: остался React.createElement()/createElement() из JSX`);
    }
    // Проверяем только TSX-модули (barrel `index.ts` шаблонов не содержит).
    const isComponent =
      source.endsWith(".tsx")
      && (relativePath.startsWith("components/")
        || relativePath.startsWith("form/")
        || relativePath.startsWith("layout/")
        || relativePath.startsWith("icons/"));
    if (isComponent && !RUNTIME_MARKERS.some((marker) => code.includes(marker))) {
      problems.push(`${relativePath}: нет template()/templateHoles()/component() — компонент не скомпилирован`);
    }
  }
  if (problems.length > 0) {
    fail(`проверка dist не прошла:\n${problems.join("\n")}`);
  }
}

async function copyAssets(files) {
  for (const file of files) {
    const relativePath = toPosix(relative(sourceRoot, file));
    const outputPath = join(distRoot, relativePath);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, await readFile(file));
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

const LAYERS = "@layer sui.reset, sui.tokens, sui.base, sui.layout, sui.components, sui.overrides;";

async function readCss(relativePaths) {
  const parts = [];
  for (const relativePath of relativePaths) {
    const absolute = join(distRoot, relativePath);
    if (!existsSync(absolute)) fail(`не найден CSS-файл: dist/${relativePath}`);
    parts.push(`/* ${relativePath} */\n${(await readFile(absolute, "utf8")).trimEnd()}`);
  }
  return `${LAYERS}\n\n${parts.join("\n\n")}\n`;
}

async function writeCssAggregates(componentCss, formCss) {
  const reset = ["styles/reset.css"];
  const tokens = ["tokens/tokens.css"];
  const themes = ["styles/themes.css"];
  const base = ["styles/base.css"];
  const layout = ["layout/layout.css"];

  const aggregates = [
    ["styles.css", [...reset, ...tokens, ...themes, ...base, ...layout, ...componentCss, ...formCss]],
    ["base.css", [...reset, ...tokens, ...themes, ...base]],
    ["reset.css", reset],
    ["tokens.css", tokens],
    ["themes.css", [...tokens, ...themes]],
    ["layout.css", layout],
    ["form.css", formCss],
  ];
  for (const [name, sources] of aggregates) {
    await writeFile(join(distRoot, name), await readCss(sources));
  }
}

async function main() {
  await rm(distRoot, { recursive: true, force: true });
  // composite-проект кеширует состояние в .tsbuildinfo: после удаления dist
  // без этого файла tsc решит, что всё уже собрано, и ничего не эмитит.
  await rm(join(packageRoot, ".tsbuildinfo"), { force: true });
  const files = await walk(sourceRoot);
  const codeFiles = files.filter((file) => /\.(?:ts|tsx)$/u.test(file));
  const cssFiles = files.filter((file) => file.endsWith(".css"));
  const jsonFiles = files.filter((file) => file.endsWith(".json"));

  const compiled = await compileSources(codeFiles);
  await verifyCompiled(codeFiles);

  emitDeclarations();
  await copyAssets([...cssFiles, ...jsonFiles]);

  const relativeCss = cssFiles
    .map((file) => toPosix(relative(sourceRoot, file)))
    .sort((left, right) => left.localeCompare(right, "en"));
  const componentCss = relativeCss.filter((relativePath) => relativePath.startsWith("components/"));
  const formCss = relativeCss.filter((relativePath) => relativePath.startsWith("form/"));
  await writeCssAggregates(componentCss, formCss);

  // Идемпотентность: повторный прогон не должен видеть stale-файлы.
  console.log(
    `[ui:build] ok: ${compiled} модулей, ${cssFiles.length} CSS, ${jsonFiles.length} JSON, ${componentCss.length} компонентных CSS, ${formCss.length} form CSS`,
  );
}

await main();
