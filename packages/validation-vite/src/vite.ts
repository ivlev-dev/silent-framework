import * as path from "node:path";
import MagicString from "magic-string";
import ts from "typescript";
import type { Plugin, ViteDevServer } from "vite";
import { generateValidationBlocks } from "./typegen.js";
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
const BUILTIN_TYPE_NAMES: ReadonlySet<string> = new Set([
  "Date",
  "RegExp",
  "Error",
  "ArrayBuffer",
  "SharedArrayBuffer",
  "DataView",
  "URL",
  "URLSearchParams",
  "Iterable",
  "AsyncIterable",
  "Iterator",
  "AsyncIterator",
  "Int8Array",
  "Uint8Array",
  "Uint8ClampedArray",
  "Int16Array",
  "Uint16Array",
  "Int32Array",
  "Uint32Array",
  "Float32Array",
  "Float64Array",
  "BigInt64Array",
  "BigUint64Array",
  "Function",
  "Map",
  "Set",
  "WeakMap",
  "WeakSet",
  "Promise",
  "Array",
  "ReadonlyArray",
  "ReadonlyMap",
  "ReadonlySet",
  "Record",
]);

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
  readonly decisions: WeakMap<ts.ClassDeclaration, boolean>;
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
  readonly typeOnly: boolean;
  readonly kind: "default" | "named" | "namespace";
  readonly exportedName?: string;
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

function declarationSourceFile(
  checker: ts.TypeChecker,
  symbol: ts.Symbol,
): ts.SourceFile | null {
  const target = resolveAlias(checker, symbol);
  for (const declaration of target.declarations ?? []) {
    const sourceFile = declaration.getSourceFile();
    if (sourceFile !== undefined) return sourceFile;
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

function hasRuntimeModule(
  moduleName: string,
  containingFile: string,
  options: ts.CompilerOptions,
): boolean {
  const resolved = ts.resolveModuleName(moduleName, containingFile, options, ts.sys)
    .resolvedModule;
  if (resolved === undefined) return false;
  const fileName = resolved.resolvedFileName;
  if (!isDeclarationFile(fileName)) {
    return RUNTIME_FILE_PATTERN.test(fileName);
  }
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
    if (clause.name !== undefined) {
      const symbol = checker.getSymbolAtLocation(clause.name);
      if (symbol !== undefined) {
        bindings.push({
          symbol,
          localName: clause.name.text,
          module: moduleName,
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

  const runtimeIssue = (symbol: ts.Symbol): string | null => {
    const declarationFile = declarationSourceFile(checker, symbol);
    if (declarationFile === null) return null;
    if (declarationFile.fileName === sourceFile.fileName) return null;
    if (isGlobalDeclaration(declarationFile)) return null;
    const matching = bindings.filter((entry) => symbolsEqual(checker, entry.symbol, symbol));
    if (matching.some((entry) => !entry.typeOnly && entry.kind !== "namespace")) {
      return null;
    }
    const moduleName = matching[0]?.module
      ?? moduleSpecifierFor(sourceFile, declarationFile, checker);
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

  const runtimeRef = (symbol: ts.Symbol): string => {
    const declarationFile = declarationSourceFile(checker, symbol);
    if (declarationFile === null) return "undefined";
    if (declarationFile.fileName === sourceFile.fileName) {
      return localQualifiedName(checker, symbol) ?? "undefined";
    }
    if (isGlobalDeclaration(declarationFile)) {
      return localQualifiedName(checker, symbol) ?? "undefined";
    }
    if (runtimeIssue(symbol) !== null) {
      return "undefined";
    }
    const matching = bindings.filter((entry) => symbolsEqual(checker, entry.symbol, symbol));
    const valueBinding = matching.find(
      (entry) => !entry.typeOnly && entry.kind !== "namespace",
    );
    if (valueBinding !== undefined) {
      return valueBinding.localName;
    }

    const name = matching.find((entry) => entry.exportedName !== undefined)?.exportedName
      ?? exportedName(checker, symbol, declarationFile);
    if (name === null) {
      return localQualifiedName(checker, symbol) ?? "undefined";
    }

    const moduleName = matching[0]?.module
      ?? moduleSpecifierFor(sourceFile, declarationFile, checker);
    if (moduleName === null) return "undefined";

    const namespaceBinding = bindings.find(
      (entry) => entry.kind === "namespace"
        && entry.module === moduleName
        && !entry.typeOnly,
    );
    if (namespaceBinding !== undefined) {
      return `${namespaceBinding.localName}.${name}`;
    }

    return `${aliasFor(moduleName)}.${name}`;
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

function typeArgumentsOf(
  type: ts.Type,
  checker: ts.TypeChecker,
): readonly ts.Type[] {
  if (type.aliasTypeArguments !== undefined && type.aliasTypeArguments.length > 0) {
    return type.aliasTypeArguments;
  }
  if ((type.flags & ts.TypeFlags.Object) !== 0) {
    const objectType = type as ts.ObjectType;
    if ((objectType.objectFlags & ts.ObjectFlags.Reference) !== 0) {
      return checker.getTypeArguments(type as ts.TypeReference);
    }
  }
  return [];
}

function isClassLikeSymbol(symbol: ts.Symbol): boolean {
  return (symbol.declarations ?? []).some(
    (declaration) => ts.isClassDeclaration(declaration) || ts.isClassExpression(declaration),
  );
}

function typeContainsUnavailableRuntime(
  type: ts.Type,
  checker: ts.TypeChecker,
  runtimeIssue: (symbol: ts.Symbol) => string | null,
  seen: Set<ts.Type>,
): string | null {
  if (seen.has(type)) return null;
  seen.add(type);
  const symbol = type.getSymbol();
  if (symbol !== undefined) {
    const resolved = resolveAlias(checker, symbol);
    if (isClassLikeSymbol(resolved)) {
      return runtimeIssue(resolved);
    }
  }
  if ((type.flags & ts.TypeFlags.Union) !== 0) {
    for (const member of (type as ts.UnionType).types) {
      const missing = typeContainsUnavailableRuntime(member, checker, runtimeIssue, seen);
      if (missing !== null) return missing;
    }
  }
  if ((type.flags & ts.TypeFlags.Intersection) !== 0) {
    for (const member of (type as ts.IntersectionType).types) {
      const missing = typeContainsUnavailableRuntime(member, checker, runtimeIssue, seen);
      if (missing !== null) return missing;
    }
  }
  for (const argument of typeArgumentsOf(type, checker)) {
    const missing = typeContainsUnavailableRuntime(argument, checker, runtimeIssue, seen);
    if (missing !== null) return missing;
  }
  if ((type.flags & ts.TypeFlags.Object) === 0) return null;
  if (checker.isTupleType(type) || checker.isArrayType(type)) return null;
  if (type.getCallSignatures().length > 0) return null;
  const symbolNames = [type.getSymbol()?.getName(), type.aliasSymbol?.getName()];
  if (symbolNames.some((name) => name !== undefined && BUILTIN_TYPE_NAMES.has(name))) {
    return null;
  }
  for (const property of checker.getPropertiesOfType(type)) {
    const propertyType = checker.getTypeOfSymbol(property);
    const missing = typeContainsUnavailableRuntime(propertyType, checker, runtimeIssue, seen);
    if (missing !== null) return missing;
  }
  return null;
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
  return undefined;
}

function collectSkippedFields(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  runtimeIssue: (symbol: ts.Symbol) => string | null,
  report: (message: string) => void,
): Map<number, ReadonlySet<string>> {
  const skipped = new Map<number, ReadonlySet<string>>();
  const classes: (ts.ClassDeclaration | ts.ClassExpression)[] = [];
  const collect = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) classes.push(node);
    ts.forEachChild(node, collect);
  };
  collect(sourceFile);
  for (const declaration of classes) {
    const className = classLikeName(declaration);
    if (className === undefined) continue;
    const fields = new Set<string>();
    for (const member of declaration.members) {
      if (!ts.isAutoAccessorPropertyDeclaration(member)) continue;
      if (!ts.isIdentifier(member.name)) continue;
      if (member.type === undefined) continue;
      const type = checker.getTypeFromTypeNode(member.type);
      const missing = typeContainsUnavailableRuntime(
        type,
        checker,
        runtimeIssue,
        new Set<ts.Type>(),
      );
      if (missing === null) continue;
      report(
        `${sourceFile.fileName}: ${className}.${member.name.text}: тип ${
          checker.typeToString(type)
        } ссылается на модуль ${missing}, но рантайм-модуль не найден`,
      );
      fields.add(member.name.text);
    }
    if (fields.size > 0) {
      skipped.set(closingPosition(sourceFile, declaration), fields);
    }
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
  const definitionPattern = /^([ \t]*)const (lazy\d+) = (.*);$/;
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
  if (parsed.errors.length > 0) {
    const details = parsed.errors
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

function createCompilerHost(
  options: ts.CompilerOptions,
  previous: ts.Program | undefined,
  changedFiles: ReadonlySet<string>,
): ts.CompilerHost {
  const host = ts.createCompilerHost(options, true);
  const readSourceFile = host.getSourceFile.bind(host);
  const changed = new Set([...changedFiles].map((fileName) => path.resolve(fileName)));
  host.getSourceFile = (fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile) => {
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
    const created = ts.createProgram({
      rootNames: [...rootNames],
      options: project.options,
      host: createCompilerHost(project.options, previous?.program, changedFiles),
      ...(previous === undefined ? {} : { oldProgram: previous.program }),
      ...(project.projectReferences === undefined
        ? {}
        : { projectReferences: project.projectReferences }),
    });
    return {
      program: created,
      rootNames,
      project,
      warnings: new Set<string>(),
      decisions: previous?.decisions ?? new WeakMap<ts.ClassDeclaration, boolean>(),
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
        if (hasGeneratedSchema(code)) return null;
        const entry = programEntryFor(file);
        if (entry === null) return null;
        const sourceFile = entry.program.getSourceFile(file);
        if (sourceFile === undefined) return null;
        const context: { readonly warn?: (message: string) => void } | undefined = this;
        const warn = (message: string): void => {
          if (entry.warnings.has(message)) return;
          entry.warnings.add(message);
          context?.warn?.(message);
        };
        let offset = 0;
        if (code !== sourceFile.text) {
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
        const skippedFields = collectSkippedFields(
          sourceFile,
          checker,
          resolver.runtimeIssue,
          (message) => {
            if (strict) throw new Error(message);
            warn(message);
          },
        );
        const blocks = generateValidationBlocks({
          sourceFile,
          checker,
          runtimeRef: resolver.runtimeRef,
          shouldGenerate: (declaration) => {
            const cached = entry.decisions.get(declaration);
            if (cached !== undefined) return cached;
            const type = checker.getTypeAtLocation(declaration);
            const result = extendsTarget(
              type,
              checker,
              baseName,
              targets.size > 0 ? [...targets] : [],
              new Set<ts.Type>(),
            );
            entry.decisions.set(declaration, result);
            return result;
          },
          diagnostics: warn,
          strict,
        });
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
          const statements = usedImports
            .map((entry) => `import * as ${entry.alias} from ${JSON.stringify(entry.module)};`)
            .join("\n");
          magic.appendLeft(importInsertionPosition(code), `${statements}\n`);
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
