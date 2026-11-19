import { builtinModules } from "node:module";
import * as path from "node:path";
import MagicString from "magic-string";
import ts from "typescript";
import type { Plugin, ViteDevServer } from "vite";
import { generateValidationBlocks, schemaHasClassRef } from "./typegen.js";
import type { ValidationBlock } from "./typegen.js";

export interface ValidationPluginOptions {
  readonly include?: RegExp;
  readonly exclude?: RegExp;
  readonly tsconfig?: string;
  readonly base?: string;
  readonly strict?: boolean;
}

const DEFAULT_INCLUDE = /\.(?:[cm]?ts|tsx)$/;
const DEFAULT_EXCLUDE = /node_modules/;
const PACKAGE_NAME = "@ivlev-dev/silent-validation";
const NAMESPACE_ALIAS_PREFIX = "__silent_validation_";
const ACCESSOR_PATTERN = /\baccessor\b/;
const EXTENDS_PATTERN = /\bextends\b/;
const SCHEMA_KEY = "silent.validation.schema";
const GENERATED_MARKER = /Symbol\s*\.\s*for\(\s*["']silent\.validation\.schema["']\s*\)/;
const DECLARATION_FILE_PATTERN = /\.d\.[cm]?ts$/i;
const RUNTIME_FILE_PATTERN = /\.(?:[cm]?js|jsx|[cm]?ts|tsx)$/i;
const SAFE_QUERY_KEYS: ReadonlySet<string> = new Set(["import", "v", "t", "direct"]);

function moduleExport(
  checker: ts.TypeChecker,
  moduleSymbol: ts.Symbol,
  name: string,
): ts.Symbol | null {
  let exports: readonly ts.Symbol[];
  try {
    exports = checker.getExportsOfModule(moduleSymbol);
  } catch {
    return null;
  }
  for (const entry of exports) {
    const resolved = resolveAlias(checker, entry);
    if (entry.getName() === name || resolved.getName() === name) {
      return resolved;
    }
  }
  return null;
}

function findBaseSymbols(
  program: ts.Program,
  checker: ts.TypeChecker,
  name: string,
): Set<ts.Symbol> {
  const symbols = new Set<ts.Symbol>();
  const addModule = (moduleSymbol: ts.Symbol | undefined): void => {
    if (moduleSymbol === undefined) return;
    const symbol = moduleExport(checker, moduleSymbol, name);
    if (symbol === null) return;
    symbols.add(symbol);
    symbols.add(resolveAlias(checker, symbol));
  };
  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
      const specifier = statement.moduleSpecifier;
      if (specifier === undefined) continue;
      if (!ts.isStringLiteral(specifier) || specifier.text !== PACKAGE_NAME) continue;
      addModule(checker.getSymbolAtLocation(specifier));
    }
  }
  for (const root of program.getRootFileNames()) {
    const resolved = ts.resolveModuleName(
      PACKAGE_NAME,
      root,
      program.getCompilerOptions(),
      ts.sys,
    ).resolvedModule;
    if (resolved === undefined) continue;
    const sourceFile = program.getSourceFile(resolved.resolvedFileName);
    if (sourceFile === undefined) continue;
    addModule(checker.getSymbolAtLocation(sourceFile));
  }
  return symbols;
}

function instanceTypeOf(
  checker: ts.TypeChecker,
  declaration: ts.ClassDeclaration | ts.ClassExpression,
): ts.Type {
  const type = checker.getTypeAtLocation(declaration);
  if (ts.isClassExpression(declaration)) {
    const signature = type.getConstructSignatures()[0];
    if (signature !== undefined) return signature.getReturnType();
  }
  return type;
}

function extendsTarget(
  type: ts.Type,
  checker: ts.TypeChecker,
  name: string,
  targets: readonly ts.Symbol[],
  seen: Set<ts.Type>,
): boolean {
  if (seen.has(type)) {
    return false;
  }
  seen.add(type);
  for (const base of type.getBaseTypes() ?? []) {
    const symbol = base.getSymbol();
    if (symbol !== undefined) {
      const resolved = resolveAlias(checker, symbol);
      const matches = targets.length > 0
        ? targets.some((target) => symbolsEqual(checker, resolved, target))
        : resolved.getName() === name;
      if (matches) {
        return true;
      }
    }
    if (extendsTarget(base, checker, name, targets, seen)) {
      return true;
    }
  }
  return false;
}

function needsValidation(file: string): boolean {
  const text = ts.sys.readFile(file);
  return text !== undefined && ACCESSOR_PATTERN.test(text) && EXTENDS_PATTERN.test(text);
}

const DEFAULT_COMPILER_OPTIONS: ts.CompilerOptions = {
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  module: ts.ModuleKind.ESNext,
  target: ts.ScriptTarget.ES2022,
  jsx: ts.JsxEmit.Preserve,
  strict: true,
  experimentalDecorators: false,
  useDefineForClassFields: true,
  skipLibCheck: true,
  noEmit: true,
};

interface ParsedProject {
  readonly configPath: string | null;
  readonly rootNames: readonly string[];
  readonly options: ts.CompilerOptions;
  readonly projectReferences: readonly ts.ProjectReference[] | undefined;
}

interface ProgramEntry {
  readonly program: ts.Program;
  readonly rootNames: ReadonlySet<string>;
  readonly project: ParsedProject;
  readonly warnings: Set<string>;
  readonly decisions: WeakMap<ts.ClassDeclaration | ts.ClassExpression, boolean>;
  readonly changedFiles: Set<string>;
  dirty: boolean;
  reloadProject: boolean;
}

interface ImportInsertion {
  readonly module: string;
  readonly alias: string;
}

interface ImportBinding {
  readonly symbol: ts.Symbol;
  readonly localName: string;
  readonly module: string;
  readonly moduleSymbol: ts.Symbol | undefined;
  readonly typeOnly: boolean;
  readonly kind: "default" | "named" | "namespace";
  readonly exportedName?: string;
}

interface ValueTarget {
  readonly module: string;
  readonly name: string;
}

interface SymbolDeclaration {
  readonly file: ts.SourceFile;
  readonly declaration: ts.Declaration;
}

interface RuntimeRefResolver {
  readonly runtimeRef: (symbol: ts.Symbol) => string;
  readonly runtimeIssue: (symbol: ts.Symbol) => string | null;
  readonly imports: readonly ImportInsertion[];
}

function cleanModuleId(id: string): string {
  return id.split("?")[0]?.split("#")[0] ?? "";
}

function isVirtualModule(id: string): boolean {
  return id.includes("\0") || id.startsWith("virtual:");
}

function hasUnsafeQuery(id: string): boolean {
  const queryIndex = id.indexOf("?");
  if (queryIndex < 0) return false;
  const hashIndex = id.indexOf("#", queryIndex);
  const query = id.slice(queryIndex + 1, hashIndex < 0 ? undefined : hashIndex);
  if (query.length === 0) return false;
  for (const key of new URLSearchParams(query).keys()) {
    if (!SAFE_QUERY_KEYS.has(key)) return true;
  }
  return false;
}

function isDeclarationFile(file: string): boolean {
  return DECLARATION_FILE_PATTERN.test(file);
}

function hasGeneratedSchema(code: string): boolean {
  return code.includes("static {") && GENERATED_MARKER.test(code);
}

function matchesPattern(pattern: RegExp, value: string): boolean {
  const flags = pattern.flags.replace(/[gy]/g, "");
  return new RegExp(pattern.source, flags).test(value);
}

function resolveAlias(checker: ts.TypeChecker, symbol: ts.Symbol): ts.Symbol {
  let current = symbol;
  const seen = new Set<ts.Symbol>();
  while ((current.flags & ts.SymbolFlags.Alias) !== 0 && !seen.has(current)) {
    seen.add(current);
    let next: ts.Symbol;
    try {
      next = checker.getAliasedSymbol(current);
    } catch {
      break;
    }
    if (next === current) break;
    current = next;
  }
  return current;
}

function symbolsEqual(
  checker: ts.TypeChecker,
  left: ts.Symbol,
  right: ts.Symbol,
): boolean {
  return left === right || resolveAlias(checker, left) === resolveAlias(checker, right);
}

function declarationInfo(
  checker: ts.TypeChecker,
  symbol: ts.Symbol,
): SymbolDeclaration | null {
  const target = resolveAlias(checker, symbol);
  for (const declaration of target.declarations ?? []) {
    const sourceFile = declaration.getSourceFile();
    if (sourceFile !== undefined) return { file: sourceFile, declaration };
  }
  return null;
}

function ambientModuleName(declaration: ts.Declaration): string | null {
  let node: ts.Node | undefined = declaration;
  while (node !== undefined && !ts.isSourceFile(node)) {
    if (ts.isModuleDeclaration(node) && ts.isStringLiteral(node.name)) {
      return node.name.text;
    }
    node = node.parent;
  }
  return null;
}

function declarationName(symbol: ts.Symbol): string | null {
  for (const declaration of symbol.declarations ?? []) {
    if (
      ts.isClassDeclaration(declaration)
      || ts.isClassExpression(declaration)
      || ts.isEnumDeclaration(declaration)
    ) {
      if (declaration.name !== undefined) return declaration.name.text;
    }
  }
  for (const declaration of symbol.declarations ?? []) {
    const name = ts.getNameOfDeclaration(declaration);
    if (name !== undefined && ts.isIdentifier(name)) return name.text;
  }
  const name = symbol.getName();
  return name.length > 0 ? name : null;
}

function localQualifiedName(
  checker: ts.TypeChecker,
  symbol: ts.Symbol,
): string | null {
  const target = resolveAlias(checker, symbol);
  const declaration = target.valueDeclaration ?? target.declarations?.[0];
  if (declaration === undefined) return declarationName(target);
  const parts: string[] = [];
  let node: ts.Node | undefined = declaration;
  while (node !== undefined && !ts.isSourceFile(node)) {
    if (ts.isModuleDeclaration(node) && ts.isIdentifier(node.name)) {
      parts.unshift(node.name.text);
    } else if (
      (ts.isClassDeclaration(node) || ts.isClassExpression(node))
      && node.name !== undefined
      && ts.isIdentifier(node.name)
    ) {
      parts.unshift(node.name.text);
    } else if (ts.isEnumDeclaration(node) && ts.isIdentifier(node.name)) {
      parts.unshift(node.name.text);
    }
    node = node.parent;
  }
  if (parts.length > 0) return parts.join(".");
  return declarationName(target);
}

function isGlobalDeclaration(sourceFile: ts.SourceFile): boolean {
  return !ts.isExternalModule(sourceFile);
}

function isDefaultLibraryFile(sourceFile: ts.SourceFile): boolean {
  const name = sourceFile.fileName;
  const slash = Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\"));
  return /^lib(?:\.[^/\\]+)?\.d\.ts$/.test(name.slice(slash + 1));
}

const BUILTIN_MODULES: ReadonlySet<string> = new Set(
  builtinModules.map((name) => (name.startsWith("node:") ? name.slice(5) : name)),
);

function isBuiltinModule(moduleName: string): boolean {
  const bare = moduleName.startsWith("node:") ? moduleName.slice(5) : moduleName;
  return BUILTIN_MODULES.has(bare);
}

function isRelativeModule(moduleName: string): boolean {
  return moduleName.startsWith(".") || path.isAbsolute(moduleName);
}

function siblingRuntimeExists(fileName: string): boolean {
  const match = /^(.*)\.d\.([cm]?ts)$/i.exec(fileName);
  if (match === null || match[1] === undefined) return false;
  const stem = match[1];
  const extension = match[2] ?? "ts";
  const candidates = extension === "mts"
    ? [`${stem}.mjs`, `${stem}.js`]
    : extension === "cts"
      ? [`${stem}.cjs`, `${stem}.js`]
      : [`${stem}.js`, `${stem}.mjs`, `${stem}.cjs`];
  return candidates.some((candidate) => ts.sys.fileExists(candidate));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectRuntimeTargets(value: unknown, key: string, targets: string[]): void {
  if (typeof value === "string") {
    if (key !== "types" && key !== "typings") targets.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectRuntimeTargets(item, key, targets);
    return;
  }
  if (!isPlainRecord(value)) return;
  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (entryKey === "types" || entryKey === "typings") continue;
    collectRuntimeTargets(entryValue, entryKey, targets);
  }
}

function packageRuntimeExists(fileName: string): boolean {
  let directory = path.dirname(fileName);
  for (;;) {
    const packageFile = path.join(directory, "package.json");
    if (ts.sys.fileExists(packageFile)) {
      const text = ts.sys.readFile(packageFile);
      if (text === undefined) return false;
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        return false;
      }
      if (!isPlainRecord(data)) return false;
      const targets: string[] = [];
      if (typeof data.main === "string") targets.push(data.main);
      if (typeof data.module === "string") targets.push(data.module);
      if (data.exports !== undefined) collectRuntimeTargets(data.exports, "exports", targets);
      for (const target of targets) {
        const resolved = path.resolve(directory, target);
        if (RUNTIME_FILE_PATTERN.test(resolved) && ts.sys.fileExists(resolved)) {
          return true;
        }
      }
      return false;
    }
    const parent = path.dirname(directory);
    if (parent === directory) return false;
    directory = parent;
  }
}

function hasRuntimeModule(
  moduleName: string,
  containingFile: string,
  options: ts.CompilerOptions,
): boolean {
  if (isBuiltinModule(moduleName)) return true;
  const resolved = ts.resolveModuleName(moduleName, containingFile, options, ts.sys)
    .resolvedModule;
  if (resolved === undefined) return false;
  const fileName = resolved.resolvedFileName;
  if (!isDeclarationFile(fileName)) {
    return RUNTIME_FILE_PATTERN.test(fileName);
  }
  if (siblingRuntimeExists(fileName)) return true;
  if (isRelativeModule(moduleName)) return false;
  return packageRuntimeExists(fileName);
}

function rebaseModuleSpecifier(
  moduleName: string,
  importerFile: string,
  sourceFile: ts.SourceFile,
  options: ts.CompilerOptions,
): string {
  if (!isRelativeModule(moduleName)) return moduleName;
  const resolved = ts.resolveModuleName(moduleName, importerFile, options, ts.sys)
    .resolvedModule;
  if (resolved === undefined) return moduleName;
  return relativeModuleSpecifier(sourceFile.fileName, resolved.resolvedFileName) ?? moduleName;
}

function exportedName(
  checker: ts.TypeChecker,
  symbol: ts.Symbol,
  sourceFile: ts.SourceFile,
): string | null {
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  if (moduleSymbol === undefined) return null;
  const targets = new Set<ts.Symbol>([symbol, resolveAlias(checker, symbol)]);
  let exports: readonly ts.Symbol[];
  try {
    exports = checker.getExportsOfModule(moduleSymbol);
  } catch {
    return null;
  }
  for (const entry of exports) {
    if (targets.has(entry) || targets.has(resolveAlias(checker, entry))) {
      return entry.getName();
    }
  }
  return null;
}

function typeOnlyExportSymbol(symbol: ts.Symbol): boolean {
  const declarations = symbol.declarations ?? [];
  if (declarations.length === 0) return false;
  let sawSpecifier = false;
  for (const declaration of declarations) {
    if (!ts.isExportSpecifier(declaration)) return false;
    sawSpecifier = true;
    if (declaration.isTypeOnly) continue;
    const exportDeclaration = declaration.parent.parent;
    if (!ts.isExportDeclaration(exportDeclaration) || !exportDeclaration.isTypeOnly) {
      return false;
    }
  }
  return sawSpecifier;
}

function moduleValueExportName(
  checker: ts.TypeChecker,
  moduleSymbol: ts.Symbol,
  targets: ReadonlySet<ts.Symbol>,
  names: readonly string[],
): string | null {
  let exports: readonly ts.Symbol[];
  try {
    exports = checker.getExportsOfModule(moduleSymbol);
  } catch {
    return null;
  }
  for (const name of names) {
    for (const entry of exports) {
      if (entry.getName() !== name) continue;
      if (typeOnlyExportSymbol(entry)) continue;
      return entry.getName();
    }
  }
  for (const entry of exports) {
    if (typeOnlyExportSymbol(entry)) continue;
    if (targets.has(entry) || targets.has(resolveAlias(checker, entry))) {
      return entry.getName();
    }
  }
  return null;
}

interface TypeOnlyReexport {
  readonly specifier: string;
  readonly moduleSymbol: ts.Symbol | undefined;
  readonly importerFile: string;
  readonly name: string;
}

function typeOnlyReexport(
  checker: ts.TypeChecker,
  moduleSymbol: ts.Symbol,
  targets: ReadonlySet<ts.Symbol>,
): TypeOnlyReexport | null {
  let exports: readonly ts.Symbol[];
  try {
    exports = checker.getExportsOfModule(moduleSymbol);
  } catch {
    return null;
  }
  for (const entry of exports) {
    if (!typeOnlyExportSymbol(entry)) continue;
    if (!targets.has(entry) && !targets.has(resolveAlias(checker, entry))) continue;
    for (const declaration of entry.declarations ?? []) {
      if (!ts.isExportSpecifier(declaration)) continue;
      const exportDeclaration = declaration.parent.parent;
      if (!ts.isExportDeclaration(exportDeclaration)) continue;
      const specifier = exportDeclaration.moduleSpecifier;
      if (specifier === undefined || !ts.isStringLiteral(specifier)) continue;
      return {
        specifier: specifier.text,
        moduleSymbol: checker.getSymbolAtLocation(specifier),
        importerFile: exportDeclaration.getSourceFile().fileName,
        name: entry.getName(),
      };
    }
  }
  return null;
}

function collectImportBindings(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
): ImportBinding[] {
  const bindings: ImportBinding[] = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const clause = statement.importClause;
    if (clause === undefined) continue;
    const moduleName = statement.moduleSpecifier.text;
    const moduleSymbol = checker.getSymbolAtLocation(statement.moduleSpecifier);
    if (clause.name !== undefined) {
      const symbol = checker.getSymbolAtLocation(clause.name);
      if (symbol !== undefined) {
        bindings.push({
          symbol,
          localName: clause.name.text,
          module: moduleName,
          moduleSymbol,
          typeOnly: clause.isTypeOnly,
          kind: "default",
          exportedName: "default",
        });
      }
    }
    const namedBindings = clause.namedBindings;
    if (namedBindings === undefined) continue;
    if (ts.isNamespaceImport(namedBindings)) {
      const symbol = checker.getSymbolAtLocation(namedBindings.name);
      if (symbol !== undefined) {
        bindings.push({
          symbol,
          localName: namedBindings.name.text,
          module: moduleName,
          moduleSymbol,
          typeOnly: clause.isTypeOnly,
          kind: "namespace",
        });
      }
      continue;
    }
    for (const element of namedBindings.elements) {
      const symbol = checker.getSymbolAtLocation(element.name);
      if (symbol === undefined) continue;
      bindings.push({
        symbol,
        localName: element.name.text,
        module: moduleName,
        moduleSymbol,
        typeOnly: clause.isTypeOnly || element.isTypeOnly,
        kind: "named",
        exportedName: element.propertyName?.text ?? element.name.text,
      });
    }
  }
  return bindings;
}

function moduleSpecifierFor(
  sourceFile: ts.SourceFile,
  declarationFile: ts.SourceFile,
  checker: ts.TypeChecker,
): string | null {
  const declarationModule = checker.getSymbolAtLocation(declarationFile);
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const moduleSymbol = checker.getSymbolAtLocation(statement.moduleSpecifier);
    if (moduleSymbol !== undefined && moduleSymbol === declarationModule) {
      return statement.moduleSpecifier.text;
    }
  }
  return relativeModuleSpecifier(sourceFile.fileName, declarationFile.fileName);
}

function relativeModuleSpecifier(fromFile: string, toFile: string): string | null {
  let relative = path.relative(path.dirname(fromFile), toFile).replace(/\\/g, "/");
  if (relative.length === 0) return null;
  relative = relative.replace(/\.d\.[cm]?ts$/i, "").replace(/\.(?:[cm]?ts|tsx)$/i, "");
  if (!relative.startsWith(".")) relative = `./${relative}`;
  return relative;
}

function collectUsedNames(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) names.add(node.text);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return names;
}

function createRuntimeRefResolver(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  options: ts.CompilerOptions,
): RuntimeRefResolver {
  const bindings = collectImportBindings(sourceFile, checker);
  const usedNames = collectUsedNames(sourceFile);
  const aliases = new Map<string, string>();
  const imports: ImportInsertion[] = [];
  const runtimeModules = new Map<string, boolean>();

  const moduleHasRuntime = (moduleName: string): boolean => {
    const cached = runtimeModules.get(moduleName);
    if (cached !== undefined) return cached;
    const result = hasRuntimeModule(moduleName, sourceFile.fileName, options);
    runtimeModules.set(moduleName, result);
    return result;
  };

  const valueTargetFor = (
    symbol: ts.Symbol,
    declarationFile: ts.SourceFile | null,
  ): ValueTarget | null => {
    const matching = bindings.filter((entry) => symbolsEqual(checker, entry.symbol, symbol));
    const targets = new Set<ts.Symbol>([symbol, resolveAlias(checker, symbol)]);
    const names = new Set<string>();
    for (const entry of matching) {
      if (entry.exportedName !== undefined) names.add(entry.exportedName);
    }
    const ownName = declarationName(symbol);
    if (ownName !== null) names.add(ownName);
    const primary = matching.find((entry) => entry.kind !== "namespace") ?? matching[0];
    let moduleName = primary?.module
      ?? (declarationFile === null
        ? null
        : moduleSpecifierFor(sourceFile, declarationFile, checker));
    let moduleSymbol = primary?.moduleSymbol
      ?? (declarationFile === null ? undefined : checker.getSymbolAtLocation(declarationFile));
    let exportedNames = [...names];
    const visited = new Set<string>();
    for (let depth = 0; depth < 16; depth += 1) {
      if (moduleName === null) return null;
      const key = `${moduleName}\u0000${moduleSymbol?.getName() ?? ""}`;
      if (visited.has(key)) return null;
      visited.add(key);
      if (moduleSymbol !== undefined) {
        const valueName = moduleValueExportName(checker, moduleSymbol, targets, exportedNames);
        if (valueName !== null) return { module: moduleName, name: valueName };
        const reexport = typeOnlyReexport(checker, moduleSymbol, targets);
        if (reexport !== null) {
          moduleName = rebaseModuleSpecifier(
            reexport.specifier,
            reexport.importerFile,
            sourceFile,
            options,
          );
          moduleSymbol = reexport.moduleSymbol;
          exportedNames = [reexport.name, ...exportedNames];
          continue;
        }
      }
      return null;
    }
    return null;
  };

  const runtimeIssue = (symbol: ts.Symbol): string | null => {
    const info = declarationInfo(checker, symbol);
    if (info === null) return null;
    if (info.file.fileName === sourceFile.fileName) return null;
    if (isGlobalDeclaration(info.file)) {
      if (!isDeclarationFile(info.file.fileName)) return null;
      if (isDefaultLibraryFile(info.file)) return null;
      const ambient = ambientModuleName(info.declaration);
      if (ambient === null) return "глобальная декларация без рантайм-модуля";
      return moduleHasRuntime(ambient) ? null : ambient;
    }
    const target = valueTargetFor(symbol, info.file);
    if (target !== null && moduleHasRuntime(target.module)) return null;
    const matching = bindings.filter((entry) => symbolsEqual(checker, entry.symbol, symbol));
    const moduleName = target?.module
      ?? matching[0]?.module
      ?? moduleSpecifierFor(sourceFile, info.file, checker);
    if (moduleName === null) return null;
    return moduleHasRuntime(moduleName) ? null : moduleName;
  };

  const aliasFor = (moduleName: string): string => {
    const existing = aliases.get(moduleName);
    if (existing !== undefined) return existing;
    let counter = 1;
    let alias = `${NAMESPACE_ALIAS_PREFIX}${counter}`;
    while (usedNames.has(alias)) {
      counter += 1;
      alias = `${NAMESPACE_ALIAS_PREFIX}${counter}`;
    }
    usedNames.add(alias);
    aliases.set(moduleName, alias);
    imports.push({ module: moduleName, alias });
    return alias;
  };

  const bindingReference = (
    symbol: ts.Symbol,
    moduleName: string,
    name: string,
  ): string => {
    const matching = bindings.filter((entry) => symbolsEqual(checker, entry.symbol, symbol));
    const valueBinding = matching.find(
      (entry) => !entry.typeOnly && entry.kind !== "namespace" && entry.module === moduleName,
    );
    if (valueBinding !== undefined) return valueBinding.localName;
    const namespaceBinding = bindings.find(
      (entry) => entry.kind === "namespace"
        && entry.module === moduleName
        && !entry.typeOnly,
    );
    if (namespaceBinding !== undefined) return `${namespaceBinding.localName}.${name}`;
    return `${aliasFor(moduleName)}.${name}`;
  };

  const runtimeRef = (symbol: ts.Symbol): string => {
    const info = declarationInfo(checker, symbol);
    if (info === null) return "undefined";
    if (info.file.fileName === sourceFile.fileName) {
      return localQualifiedName(checker, symbol) ?? "undefined";
    }
    if (isGlobalDeclaration(info.file)) {
      if (!isDeclarationFile(info.file.fileName) || isDefaultLibraryFile(info.file)) {
        return localQualifiedName(checker, symbol) ?? "undefined";
      }
      const ambient = ambientModuleName(info.declaration);
      if (ambient === null) return "undefined";
      if (!moduleHasRuntime(ambient)) return "undefined";
      const name = declarationName(symbol) ?? symbol.getName();
      return bindingReference(symbol, ambient, name);
    }
    if (runtimeIssue(symbol) !== null) {
      return "undefined";
    }
    const target = valueTargetFor(symbol, info.file);
    if (target !== null && moduleHasRuntime(target.module)) {
      return bindingReference(symbol, target.module, target.name);
    }
    const matching = bindings.filter((entry) => symbolsEqual(checker, entry.symbol, symbol));
    const name = matching.find((entry) => entry.exportedName !== undefined)?.exportedName
      ?? exportedName(checker, symbol, info.file);
    if (name === null) {
      return localQualifiedName(checker, symbol) ?? "undefined";
    }
    const moduleName = matching[0]?.module
      ?? moduleSpecifierFor(sourceFile, info.file, checker);
    if (moduleName === null) return "undefined";
    return bindingReference(symbol, moduleName, name);
  };

  return { runtimeRef, runtimeIssue, imports };
}

function closingPosition(
  sourceFile: ts.SourceFile,
  declaration: ts.ClassDeclaration | ts.ClassExpression,
): number {
  const end = declaration.getEnd();
  const position = end - 1;
  if (sourceFile.text[position] === "}") {
    return position;
  }
  const fallback = sourceFile.text.lastIndexOf("}", end);
  return fallback >= 0 ? fallback : position;
}

function hasDefaultModifier(declaration: ts.ClassDeclaration): boolean {
  const modifiers = ts.getModifiers(declaration);
  return modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword) ?? false;
}

function classLikeName(
  declaration: ts.ClassDeclaration | ts.ClassExpression,
): string | undefined {
  if (declaration.name !== undefined) return declaration.name.text;
  const parent = declaration.parent;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  if (ts.isPropertyDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  if (ts.isPropertyAssignment(parent)) {
    if (ts.isIdentifier(parent.name) || ts.isStringLiteral(parent.name)) {
      return parent.name.text;
    }
  }
  if (ts.isArrayLiteralExpression(parent)) {
    const index = parent.elements.indexOf(declaration as ts.Expression);
    const owner = parent.parent;
    const ownerName = ts.isVariableDeclaration(owner) && ts.isIdentifier(owner.name)
      ? owner.name.text
      : ts.isPropertyAssignment(owner)
        && (ts.isIdentifier(owner.name) || ts.isStringLiteral(owner.name))
        ? owner.name.text
        : null;
    if (ownerName !== null && index >= 0) return `${ownerName}[${index}]`;
  }
  if (ts.isClassDeclaration(declaration) && hasDefaultModifier(declaration)) {
    return "default";
  }
  return undefined;
}

function unavailableFieldsOf(block: ValidationBlock): readonly string[] {
  if (block.unavailableFields !== undefined) return block.unavailableFields;
  if (block.fields === undefined) return [];
  return [...block.fields]
    .filter(([, schema]) => schemaHasClassRef(schema))
    .map(([name]) => name);
}

function collectSkippedFields(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  blocks: readonly ValidationBlock[],
  report: (message: string) => void,
): Map<number, ReadonlySet<string>> {
  const skipped = new Map<number, ReadonlySet<string>>();
  const declarations = new Map<number, ts.ClassDeclaration | ts.ClassExpression>();
  const collect = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      declarations.set(closingPosition(sourceFile, node), node);
    }
    ts.forEachChild(node, collect);
  };
  collect(sourceFile);
  for (const block of blocks) {
    const unavailable = unavailableFieldsOf(block);
    if (unavailable.length === 0) continue;
    const declaration = declarations.get(block.position);
    const className = block.className
      ?? (declaration === undefined ? "class" : classLikeName(declaration) ?? "class");
    const members = new Map<string, ts.AutoAccessorPropertyDeclaration>();
    for (const member of declaration?.members ?? []) {
      if (ts.isAutoAccessorPropertyDeclaration(member) && ts.isIdentifier(member.name)) {
        members.set(member.name.text, member);
      }
    }
    for (const field of unavailable) {
      const member = members.get(field);
      const typeText = member?.type === undefined
        ? field
        : checker.typeToString(checker.getTypeFromTypeNode(member.type));
      report(
        `${sourceFile.fileName}: ${className}.${field}: тип ${typeText} ссылается на класс, недоступный в рантайме`,
      );
    }
    skipped.set(block.position, new Set(unavailable));
  }
  return skipped;
}

interface FieldsBounds {
  readonly open: number;
  readonly close: number;
}

function findFieldsBounds(code: string): FieldsBounds | null {
  const marker = "fields: {";
  const index = code.indexOf(marker);
  if (index < 0) return null;
  const open = index + marker.length - 1;
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;
  for (let position = open; position < code.length; position += 1) {
    const char = code[position]!;
    if (quote !== null) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{" || char === "[" || char === "(") {
      depth += 1;
      continue;
    }
    if (char === "}" || char === "]" || char === ")") {
      depth -= 1;
      if (depth === 0) return { open, close: position };
    }
  }
  return null;
}

function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  let quote: string | null = null;
  let escaped = false;
  for (let position = 0; position < text.length; position += 1) {
    const char = text[position]!;
    if (quote !== null) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{" || char === "[" || char === "(") {
      depth += 1;
      continue;
    }
    if (char === "}" || char === "]" || char === ")") {
      depth -= 1;
      continue;
    }
    if (char === "," && depth === 0) {
      parts.push(text.slice(start, position));
      start = position + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

function entryFieldName(entry: string): string | null {
  const match = /^("(?:[^"\\]|\\.)*")\s*:/.exec(entry);
  if (match === null || match[1] === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(match[1]);
    return typeof parsed === "string" ? parsed : null;
  } catch {
    return null;
  }
}

function stripUnusedLazyDefinitions(code: string, fieldsText: string): string {
  const definitionPattern = /^([ \t]*)const (lazy\d+) = (.*);\r?$/;
  const definitions = new Map<string, string>();
  for (const line of code.split("\n")) {
    const match = definitionPattern.exec(line);
    if (match === null || match[2] === undefined || match[3] === undefined) continue;
    definitions.set(match[2], match[3]);
  }
  if (definitions.size === 0) return code;
  const needed = new Set<string>();
  const queue: string[] = [];
  const scan = (text: string): void => {
    for (const match of text.matchAll(/\blazy\d+\b/g)) {
      const name = match[0];
      if (needed.has(name)) continue;
      needed.add(name);
      queue.push(name);
    }
  };
  scan(fieldsText);
  while (queue.length > 0) {
    const name = queue.pop();
    if (name === undefined) continue;
    const body = definitions.get(name);
    if (body !== undefined) scan(body);
  }
  const lines = code.split("\n").filter((line) => {
    const match = definitionPattern.exec(line);
    if (match === null || match[2] === undefined) return true;
    return needed.has(match[2]);
  });
  return lines.join("\n");
}

function stripSkippedFields(
  block: ValidationBlock,
  skipped: ReadonlySet<string> | undefined,
): string | null {
  if (skipped === undefined || skipped.size === 0) return block.code;
  const bounds = findFieldsBounds(block.code);
  if (bounds === null) return block.code;
  const entries = splitTopLevel(block.code.slice(bounds.open + 1, bounds.close));
  const kept = entries.filter((entry) => {
    const name = entryFieldName(entry);
    return name === null || !skipped.has(name);
  });
  if (kept.length === 0) return null;
  const fieldsText = ` ${kept.join(", ")} `;
  const updated = `${block.code.slice(0, bounds.open + 1)}${fieldsText}${
    block.code.slice(bounds.close)
  }`;
  return stripUnusedLazyDefinitions(updated, fieldsText);
}

function importInsertionPosition(code: string): number {
  let position = code.charCodeAt(0) === 0xfeff ? 1 : 0;
  if (code.startsWith("#!", position)) {
    const newline = code.indexOf("\n", position);
    position = newline < 0 ? code.length : newline + 1;
  }
  for (;;) {
    const trivia = /^(?:\s+|\/\/[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*/.exec(code.slice(position));
    const cursor = position + (trivia?.[0].length ?? 0);
    const directive = /^(?:"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')/.exec(code.slice(cursor));
    if (directive === null) return cursor;
    let end = cursor + directive[0].length;
    const semicolon = /^\s*;/.exec(code.slice(end));
    if (semicolon !== null) end += semicolon[0].length;
    position = end;
  }
}

function readProject(configPath: string): ParsedProject {
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error !== undefined) {
    throw new Error(
      `@ivlev-dev/silent-validation: не удалось прочитать ${configPath}: ${
        ts.flattenDiagnosticMessageText(config.error.messageText, "\n")
      }`,
    );
  }
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    path.dirname(configPath),
    undefined,
    configPath,
  );
  const errors = parsed.errors.filter((diagnostic) => diagnostic.code !== 18003);
  if (errors.length > 0) {
    const details = errors
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))
      .join("\n");
    throw new Error(
      `@ivlev-dev/silent-validation: ошибка конфигурации ${configPath}:\n${details}`,
    );
  }
  return {
    configPath,
    rootNames: parsed.fileNames.filter(
      (fileName) => isDeclarationFile(fileName) || needsValidation(fileName),
    ),
    options: { ...parsed.options, noEmit: true },
    projectReferences: parsed.projectReferences,
  };
}

function fallbackProject(): ParsedProject {
  return {
    configPath: null,
    rootNames: [],
    options: DEFAULT_COMPILER_OPTIONS,
    projectReferences: undefined,
  };
}

interface ProgramCache {
  previous: ts.Program | undefined;
}

function createCompilerHost(
  options: ts.CompilerOptions,
  cache: ProgramCache,
  changedFiles: ReadonlySet<string>,
): ts.CompilerHost {
  const host = ts.createCompilerHost(options, true);
  const readSourceFile = host.getSourceFile.bind(host);
  const changed = new Set([...changedFiles].map((fileName) => path.resolve(fileName)));
  host.getSourceFile = (fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile) => {
    const previous = cache.previous;
    if (
      previous !== undefined
      && shouldCreateNewSourceFile !== true
      && !changed.has(path.resolve(fileName))
    ) {
      const cached = previous.getSourceFile(fileName);
      if (cached !== undefined) return cached;
    }
    return readSourceFile(fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile);
  };
  return host;
}

export function validation(options: ValidationPluginOptions = {}): Plugin {
  const include = options.include ?? DEFAULT_INCLUDE;
  const exclude = options.exclude ?? DEFAULT_EXCLUDE;
  const baseName = options.base ?? "ValidationModel";
  const strict = options.strict === true;
  const programs = new Map<string, ProgramEntry>();
  const baseSymbols = new WeakMap<ts.Program, ReadonlySet<ts.Symbol>>();
  let root = process.cwd();

  const baseSymbolsFor = (
    program: ts.Program,
    checker: ts.TypeChecker,
  ): ReadonlySet<ts.Symbol> => {
    const cached = baseSymbols.get(program);
    if (cached !== undefined) return cached;
    const symbols = findBaseSymbols(program, checker, baseName);
    baseSymbols.set(program, symbols);
    return symbols;
  };

  const resolveConfigPath = (file: string): string | null => {
    if (options.tsconfig !== undefined) {
      return path.isAbsolute(options.tsconfig)
        ? options.tsconfig
        : path.resolve(root, options.tsconfig);
    }
    return ts.findConfigFile(path.dirname(file), ts.sys.fileExists, "tsconfig.json") ?? null;
  };

  const invalidate = (file: string, reloadProject: boolean): void => {
    const cleaned = cleanModuleId(file);
    if (cleaned.endsWith(".json")) {
      programs.clear();
      return;
    }
    for (const entry of programs.values()) {
      if (reloadProject) {
        entry.reloadProject = true;
        entry.dirty = true;
        entry.changedFiles.add(cleaned);
        continue;
      }
      if (entry.program.getSourceFile(cleaned) !== undefined) {
        entry.dirty = true;
        entry.changedFiles.add(cleaned);
      }
    }
  };

  const createProgramEntry = (
    file: string,
    project: ParsedProject,
    previous: ProgramEntry | undefined,
  ): ProgramEntry => {
    const rootNames = new Set<string>();
    const addRoot = (name: string): void => {
      if (name === file || ts.sys.fileExists(name)) rootNames.add(name);
    };
    if (previous !== undefined && !previous.reloadProject) {
      for (const name of previous.rootNames) addRoot(name);
    }
    for (const name of project.rootNames) addRoot(name);
    addRoot(file);
    const changedFiles = previous?.changedFiles ?? new Set<string>();
    const cache: ProgramCache = { previous: previous?.program };
    let created: ts.Program;
    try {
      created = ts.createProgram({
        rootNames: [...rootNames],
        options: project.options,
        host: createCompilerHost(project.options, cache, changedFiles),
        ...(previous === undefined ? {} : { oldProgram: previous.program }),
        ...(project.projectReferences === undefined
          ? {}
          : { projectReferences: project.projectReferences }),
      });
    } finally {
      cache.previous = undefined;
    }
    return {
      program: created,
      rootNames,
      project,
      warnings: new Set<string>(),
      decisions: new WeakMap<ts.ClassDeclaration | ts.ClassExpression, boolean>(),
      changedFiles: new Set<string>(),
      dirty: false,
      reloadProject: false,
    };
  };

  const programEntryFor = (file: string): ProgramEntry | null => {
    const configPath = resolveConfigPath(file);
    const key = configPath ?? "<fallback>";
    const cached = programs.get(key);
    if (cached === undefined) {
      const project = configPath === null ? fallbackProject() : readProject(configPath);
      const created = createProgramEntry(file, project, undefined);
      programs.set(key, created);
      return created;
    }
    if (!cached.dirty && cached.program.getSourceFile(file) !== undefined) {
      return cached;
    }
    let project = cached.project;
    if (cached.reloadProject) {
      project = project.configPath === null ? fallbackProject() : readProject(project.configPath);
    }
    const created = createProgramEntry(file, project, cached);
    programs.set(key, created);
    return created;
  };

  const shouldTransform = (id: string, file: string): boolean => {
    if (isVirtualModule(id) || isVirtualModule(file)) return false;
    if (isDeclarationFile(file)) return false;
    if (!matchesPattern(include, file)) return false;
    if (matchesPattern(exclude, file)) return false;
    return true;
  };

  return {
    name: "silent-validation",
    enforce: "pre",
    configResolved(config) {
      root = config.root;
    },
    configureServer(server: ViteDevServer) {
      server.watcher.on("change", (file) => {
        invalidate(file, false);
      });
      server.watcher.on("add", (file) => {
        invalidate(file, true);
      });
      server.watcher.on("unlink", (file) => {
        invalidate(file, true);
      });
    },
    watchChange(id) {
      invalidate(id, false);
    },
    transform: {
      order: "pre",
      handler(code, id) {
        if (hasUnsafeQuery(id)) return null;
        const file = cleanModuleId(id);
        if (!shouldTransform(id, file)) return null;
        if (!ACCESSOR_PATTERN.test(code) || !EXTENDS_PATTERN.test(code)) return null;
        const entry = programEntryFor(file);
        if (entry === null) return null;
        const sourceFile = entry.program.getSourceFile(file);
        if (sourceFile === undefined) return null;
        const transformedBefore = code !== sourceFile.text;
        if (transformedBefore && hasGeneratedSchema(code)) return null;
        const context: { readonly warn?: (message: string) => void } | undefined = this;
        const warn = (message: string): void => {
          if (entry.warnings.has(message)) return;
          entry.warnings.add(message);
          context?.warn?.(message);
        };
        let offset = 0;
        if (transformedBefore) {
          const index = code.indexOf(sourceFile.text);
          if (index < 0) {
            warn(
              `${file}: код изменён до плагина silent-validation, схема не сгенерирована`,
            );
            return null;
          }
          offset = index;
        }
        const checker = entry.program.getTypeChecker();
        const targets = baseSymbolsFor(entry.program, checker);
        const resolver = createRuntimeRefResolver(sourceFile, checker, entry.project.options);
        const shouldGenerate = (
          declaration: ts.ClassDeclaration | ts.ClassExpression,
        ): boolean => {
          const cached = entry.decisions.get(declaration);
          if (cached !== undefined) return cached;
          const result = extendsTarget(
            instanceTypeOf(checker, declaration),
            checker,
            baseName,
            targets.size > 0 ? [...targets] : [],
            new Set<ts.Type>(),
          );
          entry.decisions.set(declaration, result);
          return result;
        };
        const blocks = generateValidationBlocks({
          sourceFile,
          checker,
          runtimeRef: resolver.runtimeRef,
          shouldGenerate,
          diagnostics: warn,
          strict,
        });
        const skippedFields = collectSkippedFields(
          sourceFile,
          checker,
          blocks,
          (message) => {
            if (strict) throw new Error(message);
            warn(message);
          },
        );
        if (blocks.length === 0) return null;
        const magic = new MagicString(code);
        let kept = 0;
        for (const block of blocks) {
          const rendered = stripSkippedFields(block, skippedFields.get(block.position));
          if (rendered === null) continue;
          magic.appendLeft(block.position + offset, rendered);
          kept += 1;
        }
        if (kept === 0) return null;
        const body = magic.toString();
        const usedImports = resolver.imports.filter((entry) => {
          const pattern = new RegExp(`\\b${entry.alias}\\b`);
          return pattern.test(body);
        });
        if (usedImports.length > 0) {
          const newline = sourceFile.text.includes("\r\n") ? "\r\n" : "\n";
          const statements = usedImports
            .map((entry) => `import * as ${entry.alias} from ${JSON.stringify(entry.module)};`)
            .join(newline);
          magic.appendLeft(importInsertionPosition(code), `${statements}${newline}`);
        }
        return {
          code: magic.toString(),
          map: magic.generateMap({
            hires: true,
            source: file,
            includeContent: true,
          }),
        };
      },
    },
  };
}

export default validation;
