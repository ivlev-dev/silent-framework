import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import ts from "typescript";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");

const PACKAGES = [
  { name: "@ivlev98/silent-reactivity", entry: "packages/reactivity/dist/index.d.ts", doc: "docs/api/reactivity.md" },
  { name: "@ivlev98/silent-di", entry: "packages/di/dist/index.d.ts", doc: "docs/api/di.md" },
  { name: "@ivlev98/silent-core", entry: "packages/core/dist/index.d.ts", doc: "docs/api/core.md" },
  { name: "@ivlev98/silent-swc", entry: "packages/swc/index.d.ts", doc: "docs/api/swc.md" },
  { name: "@ivlev98/silent-vite", entry: "packages/vite/dist/index.d.ts", doc: "docs/api/vite.md" },
  { name: "@ivlev98/silent-server", entry: "packages/server/dist/index.d.ts", doc: "docs/api/core.md" },
];

function compilerOptions() {
  return {
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
    skipLibCheck: true,
  };
}

const HAS_COMPILER_API = Boolean(
  typeof ts.createProgram === "function"
  && ts.ModuleResolutionKind?.Bundler !== undefined
  && ts.ModuleKind?.ESNext !== undefined
  && ts.ScriptTarget?.ES2022 !== undefined,
);

const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseArgs(argv) {
  const result = { packages: [], entry: null, doc: null, json: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--package") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw new Error("после --package ожидается имя пакета");
      result.packages.push(value);
      i += 1;
    } else if (arg === "--entry") {
      const value = argv[i + 1];
      if (value === undefined) throw new Error("после --entry ожидается путь");
      result.entry = value;
      i += 1;
    } else if (arg === "--doc") {
      const value = argv[i + 1];
      if (value === undefined) throw new Error("после --doc ожидается путь");
      result.doc = value;
      i += 1;
    } else if (arg === "--json") {
      result.json = true;
    } else if (arg === "--help" || arg === "-h") {
      result.help = true;
    } else {
      throw new Error(`неизвестный аргумент: ${arg}`);
    }
  }
  return result;
}

function printHelp() {
  console.log(`Использование: node scripts/api-check.mjs [опции]

Проверка полноты API-документации: экспорты .d.ts против markdown-документа.

Опции:
  --package <name>  Проверить только указанный пакет (можно повторять)
  --entry <path>    Разовый режим: произвольный .d.ts (--doc обязателен)
  --doc <path>      Документ для --entry
  --json            Отчёт в JSON (stdout, предупреждения в stderr)
  --help, -h        Показать эту справку

Коды выхода: 0 — успех, 1 — проблемы документации, 2 — ошибка запуска.

Без флагов проверяются все пакеты из встроенной карты.
Назначение символов: typeof symbol.getName === "function" ? symbol.getName() : symbol.name`);
}

function resolvePackageFilters(filters) {
  if (filters.length === 0) return [...PACKAGES];
  const selected = [];
  for (const filter of filters) {
    const found = PACKAGES.find((pkg) => (
      pkg.name === filter
      || pkg.name === `@ivlev98/silent-${filter}`
      || pkg.name.endsWith(`/${filter}`)
    ));
    if (!found) throw new Error(`неизвестный пакет: ${filter}`);
    if (!selected.includes(found)) selected.push(found);
  }
  return selected;
}

function symbolName(symbol) {
  if (typeof symbol.getName === "function") return symbol.getName();
  return String(symbol.name);
}

function symbolFiles(symbol) {
  const declarations = typeof symbol.getDeclarations === "function"
    ? symbol.getDeclarations()
    : symbol.declarations;
  if (!Array.isArray(declarations) || declarations.length === 0) return null;
  const files = [];
  for (const declaration of declarations) {
    if (typeof declaration.getSourceFile === "function") {
      files.push(declaration.getSourceFile().fileName);
    } else if (typeof declaration.path === "string") {
      files.push(declaration.path);
    } else if (typeof declaration.fileName === "string") {
      files.push(declaration.fileName);
    }
  }
  return files.length === 0 ? null : files;
}

function isLocalSymbol(symbol, packageRoot) {
  if (packageRoot === null) return true;
  const files = symbolFiles(symbol);
  if (files === null) return true;
  const prefix = path.resolve(packageRoot) + path.sep;
  return files.some((file) => path.resolve(file).startsWith(prefix));
}

function extractNames(symbols, packageRoot) {
  const names = [];
  for (const symbol of symbols) {
    const name = symbolName(symbol);
    if (!name || name === "default" || name.startsWith("__")) continue;
    if (!isLocalSymbol(symbol, packageRoot)) continue;
    names.push(name);
  }
  return names;
}

function readExportsCompilerApi(entryPath, packageRoot) {
  const program = ts.createProgram([entryPath], compilerOptions());
  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(entryPath)
    ?? program.getSourceFiles().find((file) => file.fileName === entryPath);
  if (!sourceFile) throw new Error(`не удалось прочитать ${entryPath}`);
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  if (!moduleSymbol) throw new Error(`не удалось получить символ модуля для ${entryPath}`);
  return extractNames(checker.getExportsOfModule(moduleSymbol), packageRoot);
}

let nativeModule = null;

async function loadNativeApi() {
  if (nativeModule === null) {
    nativeModule = await import("typescript/unstable/sync");
  }
  return nativeModule;
}

async function readExportsNativeApi(entryPath, packageRoot) {
  const { API } = await loadNativeApi();
  const api = new API();
  api.ensureInitialized();
  try {
    const snapshot = api.updateSnapshot({ openFiles: [entryPath] });
    try {
      const project = snapshot.getDefaultProjectForFile(entryPath);
      if (!project || !project.program) throw new Error(`не удалось получить проект для ${entryPath}`);
      const sourceFile = project.program.getSourceFile(entryPath);
      if (!sourceFile) throw new Error(`не удалось прочитать ${entryPath}`);
      const moduleSymbol = project.checker.getSymbolAtLocation(sourceFile);
      if (!moduleSymbol) throw new Error(`не удалось получить символ модуля для ${entryPath}`);
      return extractNames(project.checker.getExportsOfModule(moduleSymbol), packageRoot);
    } finally {
      snapshot.dispose();
    }
  } finally {
    api.close();
  }
}

function packageRootOf(entryPath) {
  const dir = path.dirname(entryPath);
  return path.basename(dir) === "dist" ? path.dirname(dir) : dir;
}

function readExports(entryPath, packageRoot) {
  return HAS_COMPILER_API
    ? readExportsCompilerApi(entryPath, packageRoot)
    : readExportsNativeApi(entryPath, packageRoot);
}

function collectHeadings(docText) {
  const titles = [];
  for (const line of docText.split(/\r?\n/)) {
    const match = line.match(/^#{3,4}\s+(.+?)\s*$/);
    if (!match) continue;
    let title = match[1];
    if (title.startsWith("`") && title.endsWith("`") && title.length >= 2) {
      title = title.slice(1, -1).trim();
    }
    if (title === "" || !IDENTIFIER_PATTERN.test(title)) continue;
    titles.push(title);
  }
  return [...new Set(titles)];
}

function findUndocumented(name, docText) {
  const pattern = new RegExp(`\`${escapeRegExp(name)}\``);
  return !pattern.test(docText);
}

function makeReport(packageName, entryAbs, docAbs, exportsList, sharedExports) {
  let docText = null;
  if (fs.existsSync(docAbs)) {
    docText = fs.readFileSync(docAbs, "utf8");
  }
  const headingSet = sharedExports ?? new Set(exportsList);

  const undocumented = docText === null
    ? [...exportsList]
    : exportsList.filter((name) => findUndocumented(name, docText));

  const deadHeadings = docText === null
    ? []
    : collectHeadings(docText).filter((title) => !headingSet.has(title));

  const docMissing = docText === null;
  const problem = docMissing || undocumented.length > 0 || deadHeadings.length > 0;

  return {
    package: packageName,
    entry: entryAbs,
    doc: docAbs,
    skipped: false,
    docMissing,
    exports: exportsList,
    undocumented,
    deadHeadings,
    problem,
  };
}


function printTextReport(report) {
  if (report.skipped) return;
  console.log(
    `${report.package}: экспортов=${report.exports.length}, недокументировано=${report.undocumented.length}, мёртвых заголовков=${report.deadHeadings.length}`
    + (report.docMissing ? ", документ отсутствует" : ""),
  );
  if (report.undocumented.length > 0) {
    console.log(`  недокументировано: ${report.undocumented.join(", ")}`);
  }
  if (report.deadHeadings.length > 0) {
    console.log(`  мёртвые заголовки: ${report.deadHeadings.join(", ")}`);
  }
}

function skipReport(packageName, entryAbs, docAbs) {
  return {
    package: packageName,
    entry: entryAbs,
    doc: docAbs,
    skipped: true,
    docMissing: false,
    exports: [],
    undocumented: [],
    deadHeadings: [],
    problem: false,
  };
}

function warn(message, list) {
  list.push(message);
  console.error(message);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exitCode = 0;
    return;
  }

  const warnings = [];
  const filtered = args.packages.length > 0;
  let targets;
  if (args.entry !== null || args.doc !== null) {
    if (args.entry === null || args.doc === null) {
      throw new Error("разовый режим требует оба флага: --entry и --doc");
    }
    targets = [{
      name: "custom",
      entryAbs: path.resolve(process.cwd(), args.entry),
      docAbs: path.resolve(process.cwd(), args.doc),
      known: false,
    }];
  } else {
    targets = resolvePackageFilters(args.packages).map((pkg) => ({
      name: pkg.name,
      entryAbs: path.resolve(root, pkg.entry),
      docAbs: path.resolve(root, pkg.doc),
      known: true,
    }));
  }

  const reports = [];
  const pending = [];
  for (const target of targets) {
    if (!fs.existsSync(target.entryAbs)) {
      if (target.known) {
        warn(`warn: ${target.name}: dist не собран, пропуск`, warnings);
        reports.push(skipReport(target.name, target.entryAbs, target.docAbs));
        continue;
      }
      throw new Error(`файл не найден: ${target.entryAbs}`);
    }
    if (fs.existsSync(target.docAbs) === false && target.known && filtered) {
      warn(`warn: ${target.name}: документ отсутствует, пропуск`, warnings);
      reports.push(skipReport(target.name, target.entryAbs, target.docAbs));
      continue;
    }

    const exportsList = await readExports(
      target.entryAbs,
      target.known ? packageRootOf(target.entryAbs) : path.dirname(target.entryAbs),
    );
    pending.push({ target, exportsList });
  }

  const sharedByDoc = new Map();
  for (const { target, exportsList } of pending) {
    const key = path.resolve(target.docAbs);
    const set = sharedByDoc.get(key) ?? new Set();
    for (const name of exportsList) set.add(name);
    sharedByDoc.set(key, set);
  }

  for (const { target, exportsList } of pending) {
    const report = makeReport(
      target.name,
      target.entryAbs,
      target.docAbs,
      exportsList,
      sharedByDoc.get(path.resolve(target.docAbs)),
    );
    if (!args.json) printTextReport(report);
    reports.push(report);
  }

  const hasProblems = reports.some((report) => report.problem);

  if (args.json) {
    console.log(JSON.stringify({
      ok: !hasProblems,
      warnings,
      packages: reports.map((report) => ({
        package: report.package,
        entry: report.entry,
        doc: report.doc,
        skipped: report.skipped,
        docMissing: report.docMissing,
        exported: report.exports.length,
        undocumented: report.undocumented,
        deadHeadings: report.deadHeadings,
        ok: !report.problem,
      })),
    }, null, 2));
  }

  process.exitCode = hasProblems ? 1 : 0;
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ошибка: ${message}`);
  process.exitCode = 2;
}
