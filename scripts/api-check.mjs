import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import ts from "typescript";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");

const PACKAGES = [
  { name: "@ivlev-dev/silent-reactivity", entry: "packages/reactivity/dist/index.d.ts", doc: "docs/api/reactivity.md" },
  { name: "@ivlev-dev/silent-di", entry: "packages/di/dist/index.d.ts", doc: "docs/api/di.md" },
  { name: "@ivlev-dev/silent-core", entry: "packages/core/dist/index.d.ts", doc: "docs/api/core.md" },
  { name: "@ivlev-dev/silent-swc", entry: "packages/swc/index.d.ts", doc: "docs/api/swc.md" },
  { name: "@ivlev-dev/silent-vite", entry: "packages/vite/dist/index.d.ts", doc: "docs/api/vite.md" },
  { name: "@ivlev-dev/silent-server", entry: "packages/server/dist/index.d.ts", doc: "docs/api/core.md" },
  { name: "@ivlev-dev/silent-router", entry: "packages/router/dist/index.d.ts", doc: "docs/api/router.md" },
];

const SNAPSHOT_FILE = path.resolve(root, "scripts/api-snapshot.json");
const SIGNATURES_FILE = path.resolve(root, "scripts/api-signatures.json");
const SIGNATURES_VERSION = 1;
const TEXT_DIFF_LIMIT = 140;

const KIND_LABELS = {
  FunctionDeclaration: "function",
  FunctionExpression: "function",
  ArrowFunction: "function",
  MethodDeclaration: "method",
  MethodSignature: "method",
  CallSignature: "method",
  ConstructSignature: "method",
  ClassDeclaration: "class",
  InterfaceDeclaration: "interface",
  TypeAliasDeclaration: "type",
  VariableDeclaration: "variable",
  EnumDeclaration: "enum",
  ModuleDeclaration: "namespace",
  PropertySignature: "property",
  PropertyDeclaration: "property",
};

function normalizeExports(names) {
  return [...new Set(names)].sort((left, right) => left.localeCompare(right, "en"));
}

function sortedKeys(map) {
  return [...map.keys()].sort((left, right) => left.localeCompare(right, "en"));
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readSnapshot() {
  if (!fs.existsSync(SNAPSHOT_FILE)) return null;
  const parsed = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, "utf8"));
  const packages = parsed !== null && typeof parsed === "object" && parsed.packages !== null && typeof parsed.packages === "object"
    ? parsed.packages
    : {};
  const snapshot = new Map();
  for (const [name, value] of Object.entries(packages)) {
    if (!Array.isArray(value)) continue;
    snapshot.set(name, normalizeExports(value.filter((item) => typeof item === "string")));
  }
  return snapshot;
}

function writeSnapshot(reports, merge) {
  const packages = new Map();
  if (merge) {
    const existing = readSnapshot();
    if (existing !== null) {
      for (const [name, value] of existing) packages.set(name, value);
    }
  }
  for (const report of reports) {
    if (report.skipped) continue;
    packages.set(report.package, normalizeExports(report.exports));
  }
  const payload = { version: 1, packages: {} };
  for (const name of sortedKeys(packages)) {
    payload.packages[name] = packages.get(name);
  }
  fs.writeFileSync(SNAPSHOT_FILE, `${JSON.stringify(payload, null, 2)}\n`);
  return packages.size;
}

function compareSnapshot(reports, warnings) {
  const snapshot = readSnapshot();
  if (snapshot === null) {
    warn(`warn: снимок API не найден: ${path.relative(root, SNAPSHOT_FILE)} (обновите: node scripts/api-check.mjs --snapshot)`, warnings);
    return { ok: false, file: path.relative(root, SNAPSHOT_FILE), mismatches: [], missing: true };
  }
  const mismatches = [];
  for (const report of reports) {
    if (report.skipped) continue;
    const actual = normalizeExports(report.exports);
    const expected = snapshot.get(report.package);
    if (expected === undefined) {
      mismatches.push({ package: report.package, missing: true, added: actual, removed: [] });
      continue;
    }
    const expectedSet = new Set(expected);
    const actualSet = new Set(actual);
    const added = actual.filter((name) => !expectedSet.has(name));
    const removed = expected.filter((name) => !actualSet.has(name));
    if (added.length > 0 || removed.length > 0) {
      mismatches.push({ package: report.package, missing: false, added, removed });
    }
  }
  for (const mismatch of mismatches) {
    const details = [];
    if (mismatch.missing) details.push("пакет отсутствует в снимке");
    if (mismatch.added.length > 0) details.push(`добавлено: ${mismatch.added.join(", ")}`);
    if (mismatch.removed.length > 0) details.push(`удалено: ${mismatch.removed.join(", ")}`);
    warn(`warn: ${mismatch.package}: снимок API расходится (${details.join("; ")})`, warnings);
  }
  return {
    ok: mismatches.length === 0,
    file: path.relative(root, SNAPSHOT_FILE),
    mismatches,
    missing: false,
  };
}

function pickSignatureEntry(entry) {
  const picked = { kind: entry.kind };
  if (typeof entry.type === "string") picked.type = entry.type;
  picked.signature = entry.signature;
  return picked;
}

function readSignatureSnapshot() {
  if (!fs.existsSync(SIGNATURES_FILE)) return null;
  const raw = fs.readFileSync(SIGNATURES_FILE, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`не удалось разобрать ${path.relative(root, SIGNATURES_FILE)}: ${message}`);
  }
  if (!isPlainObject(parsed) || !isPlainObject(parsed.packages)) {
    throw new Error(`некорректный формат ${path.relative(root, SIGNATURES_FILE)}: ожидается объект packages`);
  }
  const snapshot = new Map();
  for (const [packageName, exportsValue] of Object.entries(parsed.packages)) {
    if (!isPlainObject(exportsValue)) {
      throw new Error(`некорректный формат ${path.relative(root, SIGNATURES_FILE)}: ${packageName} должен быть объектом`);
    }
    const entries = new Map();
    for (const [exportName, entry] of Object.entries(exportsValue)) {
      if (!isPlainObject(entry) || typeof entry.kind !== "string" || typeof entry.signature !== "string") {
        throw new Error(`некорректная запись снимка сигнатур: ${packageName}.${exportName}`);
      }
      entries.set(exportName, pickSignatureEntry(entry));
    }
    snapshot.set(packageName, entries);
  }
  return snapshot;
}

function buildSignaturePayload(packages) {
  const payload = { version: SIGNATURES_VERSION, packages: {} };
  for (const name of sortedKeys(packages)) {
    const entries = packages.get(name);
    const exportsObject = {};
    for (const exportName of sortedKeys(entries)) {
      const entry = entries.get(exportName);
      for (const value of [entry.kind, entry.type, entry.signature]) {
        if (typeof value === "string" && value.includes(root)) {
          throw new Error(`в сигнатуре ${name}.${exportName} остался абсолютный путь`);
        }
      }
      exportsObject[exportName] = pickSignatureEntry(entry);
    }
    payload.packages[name] = exportsObject;
  }
  return payload;
}

function serializeSignaturePayload(payload) {
  return `${JSON.stringify(payload, null, 2)}\n`;
}

function writeSignatureSnapshot(reports, merge) {
  const packages = new Map();
  if (merge) {
    const existing = readSignatureSnapshot();
    if (existing !== null) {
      for (const [name, entries] of existing) packages.set(name, entries);
    }
  }
  let exportCount = 0;
  for (const report of reports) {
    if (report.skipped) continue;
    const entries = new Map();
    for (const entry of report.signatures) entries.set(entry.name, pickSignatureEntry(entry));
    packages.set(report.package, entries);
    exportCount += entries.size;
  }
  const payload = buildSignaturePayload(packages);
  fs.writeFileSync(SIGNATURES_FILE, serializeSignaturePayload(payload));
  return { packages: packages.size, exports: exportCount };
}

function describeTextChange(expected, actual) {
  if (expected === null || expected === undefined) return `(нет) → ${truncateValue(actual)}`;
  if (actual === null || actual === undefined) return `${truncateValue(expected)} → (нет)`;
  if (expected === actual) return expected;
  if (expected.length <= TEXT_DIFF_LIMIT && actual.length <= TEXT_DIFF_LIMIT) {
    return `${expected} → ${actual}`;
  }
  let index = 0;
  while (index < expected.length && index < actual.length && expected[index] === actual[index]) index += 1;
  const start = Math.max(0, index - 30);
  const expectedSlice = expected.slice(start, start + TEXT_DIFF_LIMIT);
  const actualSlice = actual.slice(start, start + TEXT_DIFF_LIMIT);
  const prefix = start > 0 ? "…" : "";
  return `${prefix}${expectedSlice} → ${prefix}${actualSlice}`;
}

function truncateValue(value) {
  if (value === null || value === undefined) return String(value);
  return value.length <= TEXT_DIFF_LIMIT ? value : `${value.slice(0, TEXT_DIFF_LIMIT)}…`;
}

function compareSignatureSnapshot(reports, warnings) {
  const snapshot = readSignatureSnapshot();
  if (snapshot === null) {
    warn(`warn: снимок сигнатур API не найден: ${path.relative(root, SIGNATURES_FILE)} (обновите: node scripts/api-check.mjs --snapshot-signatures)`, warnings);
    return { ok: false, file: path.relative(root, SIGNATURES_FILE), mismatches: [], missing: true };
  }
  const mismatches = [];
  let compared = 0;
  for (const report of reports) {
    if (report.skipped) continue;
    const actual = new Map(report.signatures.map((entry) => [entry.name, pickSignatureEntry(entry)]));
    const expected = snapshot.get(report.package);
    if (expected === undefined) {
      mismatches.push({ package: report.package, missing: true, added: sortedKeys(actual), removed: [], changed: [] });
      continue;
    }
    const added = sortedKeys(actual).filter((name) => !expected.has(name));
    const removed = sortedKeys(expected).filter((name) => !actual.has(name));
    const changed = [];
    for (const [name, entry] of actual) {
      const previous = expected.get(name);
      if (previous === undefined) continue;
      compared += 1;
      const changes = {};
      for (const field of ["kind", "type", "signature"]) {
        const before = previous[field] ?? null;
        const after = entry[field] ?? null;
        if (before !== after) changes[field] = { expected: before, actual: after };
      }
      if (Object.keys(changes).length > 0) {
        changed.push({ name, changes, expected: previous, actual: entry });
      }
    }
    if (added.length > 0 || removed.length > 0 || changed.length > 0) {
      mismatches.push({ package: report.package, missing: false, added, removed, changed });
    }
  }
  for (const mismatch of mismatches) {
    const details = [];
    if (mismatch.missing) details.push("пакет отсутствует в снимке сигнатур");
    if (mismatch.added.length > 0) details.push(`добавлено: ${mismatch.added.join(", ")}`);
    if (mismatch.removed.length > 0) details.push(`удалено: ${mismatch.removed.join(", ")}`);
    if (mismatch.changed.length > 0) details.push(`изменено: ${mismatch.changed.map((item) => item.name).join(", ")}`);
    warn(`warn: ${mismatch.package}: снимок сигнатур API расходится (${details.join("; ")})`, warnings);
    for (const change of mismatch.changed) {
      for (const [field, diff] of Object.entries(change.changes)) {
        console.error(`  ~ ${change.name} [${field}]: ${describeTextChange(diff.expected, diff.actual)}`);
      }
    }
  }
  return {
    ok: mismatches.length === 0,
    file: path.relative(root, SIGNATURES_FILE),
    mismatches,
    missing: false,
    compared,
  };
}

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
const IMPORT_TYPE_PREFIX = /\bimport\("[^"]*"\)\./g;
const IMPORT_TYPE_ONLY = /import\("[^"]*"\)/g;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseArgs(argv) {
  const result = {
    packages: [],
    entry: null,
    doc: null,
    json: false,
    snapshot: false,
    snapshotSignatures: false,
    selfCheck: false,
    help: false,
  };
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
    } else if (arg === "--snapshot") {
      result.snapshot = true;
    } else if (arg === "--snapshot-signatures" || arg === "--update-signatures") {
      result.snapshotSignatures = true;
    } else if (arg === "--self-check") {
      result.selfCheck = true;
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

Проверка полноты API-документации: экспорты .d.ts против markdown-документа,
сверка с снимком имён и снимком сигнатур публичного API.

Опции:
  --package <name>       Проверить только указанный пакет (можно повторять)
  --entry <path>         Разовый режим: произвольный .d.ts (--doc обязателен)
  --doc <path>           Документ для --entry
  --snapshot             Обновить снимок имён scripts/api-snapshot.json
  --snapshot-signatures  Обновить снимок сигнатур scripts/api-signatures.json
  --update-signatures    Синоним --snapshot-signatures
  --self-check           Дважды собрать сигнатуры и проверить детерминизм
  --json                 Отчёт в JSON (stdout, предупреждения в stderr)
  --help, -h             Показать эту справку

Коды выхода: 0 — успех, 1 — проблемы документации или снимка, 2 — ошибка запуска.

Без флагов проверяются все пакеты из встроенной карты.`);
}

function resolvePackageFilters(filters) {
  if (filters.length === 0) return [...PACKAGES];
  const selected = [];
  for (const filter of filters) {
    const found = PACKAGES.find((pkg) => (
      pkg.name === filter
      || pkg.name === `@ivlev-dev/silent-${filter}`
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

function kindLabel(syntaxKindName) {
  if (typeof syntaxKindName !== "string") return "declaration";
  return KIND_LABELS[syntaxKindName] ?? "declaration";
}

function classDeclarationText(node) {
  const text = node.getText();
  const braceIndex = text.indexOf("{");
  if (braceIndex === -1) return text;
  const header = text.slice(0, braceIndex).trim();
  const bracePosition = node.getStart() + braceIndex;
  const members = [];
  node.forEachChild((child) => {
    if (typeof child.getStart !== "function" || child.getStart() <= bracePosition) return;
    const memberText = child.getText().trim();
    if (memberText === "" || memberText === "}" || memberText === "#private;") return;
    if (/^(?:private|protected)\s+(?!constructor\b)/.test(memberText)) return;
    members.push(memberText);
  });
  return members.length === 0 ? `${header} {}` : `${header} { ${members.join(" ")} }`;
}

function declarationText(node, syntaxKind) {
  if (syntaxKind?.VariableDeclaration !== undefined && node.kind === syntaxKind.VariableDeclaration) {
    const statement = node.parent?.parent;
    return statement && typeof statement.getText === "function" ? statement.getText() : node.getText();
  }
  if (syntaxKind?.ClassDeclaration !== undefined && node.kind === syntaxKind.ClassDeclaration) {
    return classDeclarationText(node);
  }
  return node.getText();
}

function normalizeSignature(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function normalizeTypeText(text) {
  return String(text ?? "")
    .replace(IMPORT_TYPE_PREFIX, "")
    .replace(IMPORT_TYPE_ONLY, "import(<module>)")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveAlias(symbol, resolve, isUnknown) {
  try {
    const resolved = resolve(symbol);
    if (resolved === undefined || resolved === null) return symbol;
    if (typeof isUnknown === "function" && isUnknown(resolved)) return symbol;
    return resolved;
  } catch {
    return symbol;
  }
}

function collectSignatures(symbols, packageRoot, adapter) {
  const entries = new Map();
  for (const symbol of symbols) {
    const name = adapter.name(symbol);
    if (!name || name === "default" || name.startsWith("__")) continue;
    if (!isLocalSymbol(symbol, packageRoot)) continue;
    const real = adapter.isAlias(symbol) ? resolveAlias(symbol, adapter.resolveAlias, adapter.isUnknown) : symbol;
    const described = adapter.describe(real);
    const signature = normalizeSignature(described.text);
    const kind = kindLabel(described.kind);
    let typeText = "";
    if (kind === "function" || kind === "variable") {
      try {
        typeText = normalizeTypeText(adapter.typeText(symbol));
      } catch {
        typeText = "";
      }
    }
    if (signature === "" && typeText === "") continue;
    const entry = { kind };
    if (typeText !== "") entry.type = typeText;
    entry.signature = signature === "" ? typeText : signature;
    entries.set(name, entry);
  }
  return entries;
}

function readPackageCompilerApi(entryPath, packageRoot) {
  const program = ts.createProgram([entryPath], compilerOptions());
  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(entryPath)
    ?? program.getSourceFiles().find((file) => file.fileName === entryPath);
  if (!sourceFile) throw new Error(`не удалось прочитать ${entryPath}`);
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  if (!moduleSymbol) throw new Error(`не удалось получить символ модуля для ${entryPath}`);
  const symbols = checker.getExportsOfModule(moduleSymbol);
  const signatures = collectSignatures(symbols, packageRoot, {
    name: symbolName,
    isAlias: (symbol) => (symbol.flags & ts.SymbolFlags.Alias) !== 0,
    resolveAlias: (symbol) => checker.getAliasedSymbol(symbol),
    isUnknown: () => false,
    describe: (symbol) => {
      const declarations = Array.isArray(symbol.declarations) ? symbol.declarations : [];
      if (declarations.length === 0) return { kind: "declaration", text: "" };
      return {
        kind: ts.SyntaxKind[declarations[0].kind],
        text: declarations.map((declaration) => declarationText(declaration, ts.SyntaxKind)).join(" "),
      };
    },
    typeText: (symbol) => {
      const declaration = Array.isArray(symbol.declarations) ? symbol.declarations[0] : undefined;
      const type = checker.getTypeOfSymbol(symbol);
      return type ? checker.typeToString(type, declaration ?? sourceFile, ts.NodeBuilderFlags.NoTruncation) : "";
    },
  });
  return { names: extractNames(symbols, packageRoot), signatures };
}

let nativeModule = null;

async function loadNativeApi() {
  if (nativeModule === null) {
    const [sync, ast] = await Promise.all([
      import("typescript/unstable/sync"),
      import("typescript/unstable/ast"),
    ]);
    nativeModule = { ...sync, SyntaxKind: ast.SyntaxKind };
  }
  return nativeModule;
}

async function readPackageNativeApi(entryPath, packageRoot) {
  const native = await loadNativeApi();
  const api = new native.API();
  api.ensureInitialized();
  try {
    const snapshot = api.updateSnapshot({ openFiles: [entryPath] });
    try {
      const project = snapshot.getDefaultProjectForFile(entryPath);
      if (!project || !project.program) throw new Error(`не удалось получить проект для ${entryPath}`);
      const sourceFile = project.program.getSourceFile(entryPath);
      if (!sourceFile) throw new Error(`не удалось прочитать ${entryPath}`);
      const checker = project.checker;
      const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
      if (!moduleSymbol) throw new Error(`не удалось получить символ модуля для ${entryPath}`);
      const symbols = checker.getExportsOfModule(moduleSymbol);
      const signatures = collectSignatures(symbols, packageRoot, {
        name: symbolName,
        isAlias: (symbol) => (symbol.flags & native.SymbolFlags.Alias) !== 0,
        resolveAlias: (symbol) => checker.getAliasedSymbol(symbol),
        isUnknown: (symbol) => checker.isUnknownSymbol(symbol),
        describe: (symbol) => {
          const declarations = Array.isArray(symbol.declarations) ? symbol.declarations : [];
          if (declarations.length === 0) return { kind: "declaration", text: "" };
          const parts = [];
          for (const declaration of declarations) {
            const node = declaration.resolve(project);
            if (node) parts.push(declarationText(node, native.SyntaxKind));
          }
          return { kind: native.SyntaxKind[declarations[0].kind], text: parts.join(" ") };
        },
        typeText: (symbol) => {
          const declaration = Array.isArray(symbol.declarations) ? symbol.declarations[0] : undefined;
          const node = declaration ? declaration.resolve(project) : undefined;
          const type = checker.getTypeOfSymbol(symbol);
          return type
            ? checker.typeToString(type, node ?? sourceFile, native.NodeBuilderFlags.NoTruncation)
            : "";
        },
      });
      return { names: extractNames(symbols, packageRoot), signatures };
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

function readPackageExports(entryPath, packageRoot) {
  return HAS_COMPILER_API
    ? readPackageCompilerApi(entryPath, packageRoot)
    : readPackageNativeApi(entryPath, packageRoot);
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

function makeReport(packageName, entryAbs, docAbs, exportsList, signatureEntries, sharedExports) {
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
  const signatures = [...signatureEntries.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([name, entry]) => ({ name, ...pickSignatureEntry(entry) }));

  return {
    package: packageName,
    entry: entryAbs,
    doc: docAbs,
    skipped: false,
    docMissing,
    exports: exportsList,
    signatures,
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
    signatures: [],
    undocumented: [],
    deadHeadings: [],
    problem: false,
  };
}

function warn(message, list) {
  list.push(message);
  console.error(message);
}

function buildTargets(args) {
  if (args.entry !== null || args.doc !== null) {
    if (args.entry === null || args.doc === null) {
      throw new Error("разовый режим требует оба флага: --entry и --doc");
    }
    return [{
      name: "custom",
      entryAbs: path.resolve(process.cwd(), args.entry),
      docAbs: path.resolve(process.cwd(), args.doc),
      known: false,
    }];
  }
  return resolvePackageFilters(args.packages).map((pkg) => ({
    name: pkg.name,
    entryAbs: path.resolve(root, pkg.entry),
    docAbs: path.resolve(root, pkg.doc),
    known: true,
  }));
}

async function collectReports(targets, warnings, options) {
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
    if (fs.existsSync(target.docAbs) === false && target.known && options.filtered) {
      warn(`warn: ${target.name}: документ отсутствует, пропуск`, warnings);
      reports.push(skipReport(target.name, target.entryAbs, target.docAbs));
      continue;
    }

    const collected = await readPackageExports(
      target.entryAbs,
      target.known ? packageRootOf(target.entryAbs) : path.dirname(target.entryAbs),
    );
    pending.push({ target, collected });
  }

  const sharedByDoc = new Map();
  for (const { target, collected } of pending) {
    const key = path.resolve(target.docAbs);
    const set = sharedByDoc.get(key) ?? new Set();
    for (const name of collected.names) set.add(name);
    sharedByDoc.set(key, set);
  }

  for (const { target, collected } of pending) {
    const report = makeReport(
      target.name,
      target.entryAbs,
      target.docAbs,
      collected.names,
      collected.signatures,
      sharedByDoc.get(path.resolve(target.docAbs)),
    );
    if (!options.quiet) printTextReport(report);
    reports.push(report);
  }

  return reports;
}

function signaturesFromReports(reports) {
  const packages = new Map();
  for (const report of reports) {
    if (report.skipped) continue;
    const entries = new Map();
    for (const entry of report.signatures) entries.set(entry.name, pickSignatureEntry(entry));
    packages.set(report.package, entries);
  }
  return packages;
}

function countSignatures(packages) {
  let total = 0;
  for (const entries of packages.values()) total += entries.size;
  return total;
}

async function runSelfCheck(args, targets, warnings) {
  const first = signaturesFromReports(await collectReports(targets, warnings, { filtered: false, quiet: true }));
  const second = signaturesFromReports(await collectReports(targets, warnings, { filtered: false, quiet: true }));
  const firstPayload = buildSignaturePayload(first);
  const secondPayload = buildSignaturePayload(second);
  const firstJson = serializeSignaturePayload(firstPayload);
  const secondJson = serializeSignaturePayload(secondPayload);
  const stable = firstJson === secondJson;
  const hash = crypto.createHash("sha256").update(firstJson).digest("hex");
  const packages = first.size;
  const exportsCount = countSignatures(first);
  const skipped = targets.length - packages;

  if (args.json) {
    console.log(JSON.stringify({ ok: stable, stable, packages, exports: exportsCount, skipped, hash }, null, 2));
  } else if (stable) {
    console.log(`api-signatures: стабильность в порядке (пакетов: ${packages}, экспортов: ${exportsCount}, sha256: ${hash.slice(0, 12)})`);
  } else {
    console.error("warn: api-signatures: два прогона дали разный JSON");
  }
  process.exitCode = stable ? 0 : 1;
}

async function writeSnapshots(args, reports) {
  const result = { ok: true };
  const merge = args.packages.length > 0;
  if (args.snapshot) {
    const count = writeSnapshot(reports, merge);
    result.snapshot = { file: path.relative(root, SNAPSHOT_FILE), packages: count };
  }
  if (args.snapshotSignatures) {
    const summary = writeSignatureSnapshot(reports, merge);
    result.signatures = { file: path.relative(root, SIGNATURES_FILE), packages: summary.packages, exports: summary.exports };
  }
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    if (result.snapshot) {
      console.log(`api-snapshot: обновлён ${result.snapshot.file} (пакетов: ${result.snapshot.packages})`);
    }
    if (result.signatures) {
      console.log(`api-signatures: обновлён ${result.signatures.file} (пакетов: ${result.signatures.packages}, экспортов: ${result.signatures.exports})`);
    }
  }
  process.exitCode = 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exitCode = 0;
    return;
  }
  if ((args.snapshot || args.snapshotSignatures) && (args.entry !== null || args.doc !== null)) {
    throw new Error("--snapshot/--snapshot-signatures несовместимы с --entry/--doc");
  }
  if (args.selfCheck && (args.entry !== null || args.doc !== null || args.snapshot || args.snapshotSignatures)) {
    throw new Error("--self-check несовместим с --entry/--doc/--snapshot/--snapshot-signatures");
  }

  const warnings = [];
  const filtered = args.packages.length > 0;
  const targets = buildTargets(args);

  if (args.selfCheck) {
    await runSelfCheck(args, targets, warnings);
    return;
  }

  const reports = await collectReports(targets, warnings, { filtered, quiet: args.json });

  if (args.snapshot || args.snapshotSignatures) {
    await writeSnapshots(args, reports);
    return;
  }

  const customMode = args.entry !== null || args.doc !== null;
  const snapshot = customMode ? null : compareSnapshot(reports, warnings);
  const signatures = customMode ? null : compareSignatureSnapshot(reports, warnings);
  const hasProblems = reports.some((report) => report.problem)
    || (snapshot !== null && !snapshot.ok)
    || (signatures !== null && !signatures.ok);

  if (args.json) {
    console.log(JSON.stringify({
      ok: !hasProblems,
      warnings,
      ...(snapshot === null ? {} : { snapshot }),
      ...(signatures === null ? {} : { signatures }),
      packages: reports.map((report) => ({
        package: report.package,
        entry: report.entry,
        doc: report.doc,
        skipped: report.skipped,
        docMissing: report.docMissing,
        exported: report.exports.length,
        signatures: report.signatures.length,
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
