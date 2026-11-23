import { builtinModules, isBuiltin } from "node:module";
import * as path from "node:path";
import ts from "typescript";

export interface ImportInsertion {
  readonly module: string;
  readonly alias: string;
}

export type RuntimeRefResult =
  | { readonly kind: "ok"; readonly reference: string }
  | { readonly kind: "error"; readonly reason: string };

export interface RuntimeRefResolver {
  readonly runtimeRef: (symbol: ts.Symbol) => RuntimeRefResult;
  readonly imports: readonly ImportInsertion[];
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

interface TypeOnlyReexport {
  readonly specifier: string;
  readonly moduleSymbol: ts.Symbol | undefined;
  readonly importerFile: string;
  readonly name: string;
}

const NAMESPACE_ALIAS_PREFIX = "__silent_protocol_";
const DECLARATION_FILE_PATTERN = /\.d\.[cm]?ts$/i;
const RUNTIME_FILE_PATTERN = /\.(?:[cm]?js|jsx|[cm]?ts|tsx)$/i;
const REFERENCE_IDENTIFIER = /^[\p{ID_Start}$_][\p{ID_Continue}$\u200C\u200D]*$/u;
const NODE_PREFIX = "node:";
const BARE_BUILTIN_MODULES: ReadonlySet<string> = new Set(
  builtinModules.filter((name) => !name.startsWith(NODE_PREFIX)),
);
const PREFIXED_BUILTIN_MODULES: ReadonlySet<string> = new Set(
  builtinModules.filter((name) => name.startsWith(NODE_PREFIX)),
);

export function isSafeReference(reference: string): boolean {
  return reference.split(".").every((part) => REFERENCE_IDENTIFIER.test(part));
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

function isDeclarationFile(fileName: string): boolean {
  return DECLARATION_FILE_PATTERN.test(fileName);
}

function isDefaultLibraryFile(sourceFile: ts.SourceFile): boolean {
  const name = sourceFile.fileName;
  const slash = Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\"));
  return /^lib(?:\.[^/\\]+)?\.d\.ts$/.test(name.slice(slash + 1));
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

function isGlobalModuleDeclaration(node: ts.ModuleDeclaration): boolean {
  if ((node.flags & ts.NodeFlags.GlobalAugmentation) !== 0) return true;
  return ts.isIdentifier(node.name) && node.name.text === "global";
}

function isGlobalAugmentation(declaration: ts.Declaration): boolean {
  let node: ts.Node | undefined = declaration;
  while (node !== undefined && !ts.isSourceFile(node)) {
    if (ts.isModuleDeclaration(node)) {
      if (isGlobalModuleDeclaration(node)) return true;
      if (ts.isStringLiteral(node.name)) return false;
    }
    node = node.parent;
  }
  return false;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  return ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) ?? false;
}

function isAmbientWithoutRuntime(declaration: ts.Declaration): boolean {
  if (isGlobalAugmentation(declaration)) return true;
  if (declaration.getSourceFile().isDeclarationFile) return false;
  let node: ts.Node | undefined = declaration;
  while (node !== undefined && !ts.isSourceFile(node)) {
    if (hasModifier(node, ts.SyntaxKind.DeclareKeyword)) return true;
    node = node.parent;
  }
  return false;
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
  let node: ts.Node = declaration;
  if (ts.isClassExpression(node)) {
    const parent: ts.Node = node.parent;
    if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
      parts.unshift(parent.name.text);
      node = parent.parent;
    } else if (node.name !== undefined && ts.isIdentifier(node.name)) {
      parts.unshift(node.name.text);
      node = node.parent;
    } else {
      return null;
    }
  } else if (
    (ts.isClassDeclaration(node) || ts.isEnumDeclaration(node))
    && node.name !== undefined
    && ts.isIdentifier(node.name)
  ) {
    parts.unshift(node.name.text);
    node = node.parent;
  } else {
    return declarationName(target);
  }
  let current: ts.Node | undefined = node;
  while (current !== undefined && !ts.isSourceFile(current)) {
    if (ts.isModuleDeclaration(current) && ts.isIdentifier(current.name)) {
      if (!isGlobalModuleDeclaration(current)) parts.unshift(current.name.text);
    }
    current = current.parent;
  }
  return parts.length > 0 ? parts.join(".") : declarationName(target);
}

export function classLikeName(
  declaration: ts.ClassDeclaration | ts.ClassExpression,
): string {
  if (declaration.name !== undefined) return declaration.name.text;
  const parent: ts.Node = declaration.parent;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  if (ts.isPropertyDeclaration(parent) || ts.isPropertyAssignment(parent)) {
    if (ts.isIdentifier(parent.name) || ts.isStringLiteral(parent.name)) {
      return parent.name.text;
    }
  }
  if (ts.isExportAssignment(parent)) return "default";
  if (ts.isClassDeclaration(declaration)) return "default";
  return "class";
}

function isBuiltinModule(moduleName: string): boolean {
  if (isBuiltin(moduleName)) return true;
  if (moduleName.startsWith(NODE_PREFIX)) {
    return PREFIXED_BUILTIN_MODULES.has(moduleName)
      || BARE_BUILTIN_MODULES.has(moduleName.slice(NODE_PREFIX.length));
  }
  return BARE_BUILTIN_MODULES.has(moduleName);
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

function runtimeTargetsExist(
  directory: string,
  data: Readonly<Record<string, unknown>>,
): boolean {
  const targets: string[] = [];
  if (typeof data.main === "string") targets.push(data.main);
  if (typeof data.module === "string") targets.push(data.module);
  if (data.exports !== undefined) collectRuntimeTargets(data.exports, "exports", targets);
  for (const target of targets) {
    const resolved = path.resolve(directory, target);
    if (
      RUNTIME_FILE_PATTERN.test(resolved)
      && !isDeclarationFile(resolved)
      && ts.sys.fileExists(resolved)
    ) {
      return true;
    }
  }
  return false;
}

function packageDirectoryHasRuntime(directory: string): boolean {
  const packageFile = path.join(directory, "package.json");
  if (ts.sys.fileExists(packageFile)) {
    const text = ts.sys.readFile(packageFile);
    if (text !== undefined) {
      try {
        const data: unknown = JSON.parse(text);
        if (isPlainRecord(data) && runtimeTargetsExist(directory, data)) {
          return true;
        }
      } catch {
        return false;
      }
    }
  }
  for (const candidate of ["index.js", "index.mjs", "index.cjs"]) {
    if (ts.sys.fileExists(path.join(directory, candidate))) return true;
  }
  return false;
}

function typesRuntimeDirectory(fileName: string): string | null {
  const normalized = fileName.replace(/\\/g, "/");
  const marker = "/node_modules/@types/";
  const index = normalized.lastIndexOf(marker);
  if (index < 0) return null;
  const rest = normalized.slice(index + marker.length);
  const segments = rest.split("/");
  const first = segments[0];
  if (first === undefined || first.length === 0) return null;
  let packageName: string;
  if (first.startsWith("@")) {
    const name = segments[1];
    if (name === undefined || name.length === 0) return null;
    packageName = `${first}/${name}`;
  } else {
    const separator = first.indexOf("__");
    if (separator > 0) {
      const scope = first.slice(0, separator);
      const name = first.slice(separator + 2);
      if (name.length === 0) return null;
      packageName = `@${scope}/${name}`;
    } else {
      packageName = first;
    }
  }
  return `${normalized.slice(0, index + "/node_modules/".length)}${packageName}`;
}

function packageRuntimeExists(fileName: string): boolean {
  const typesDirectory = typesRuntimeDirectory(fileName);
  if (typesDirectory !== null) return packageDirectoryHasRuntime(typesDirectory);
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
      return runtimeTargetsExist(directory, data);
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
  if (!isDeclarationFile(fileName)) return RUNTIME_FILE_PATTERN.test(fileName);
  if (siblingRuntimeExists(fileName)) return true;
  if (isRelativeModule(moduleName)) return false;
  return packageRuntimeExists(fileName);
}

function relativeModuleSpecifier(fromFile: string, toFile: string): string | null {
  let relative = path.relative(path.dirname(fromFile), toFile).replace(/\\/g, "/");
  if (relative.length === 0) return null;
  relative = relative.replace(/\.d\.[cm]?ts$/i, "").replace(/\.(?:[cm]?ts|tsx|js|jsx|mjs|cjs)$/i, "");
  if (!relative.startsWith(".")) relative = `./${relative}`;
  return relative;
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

function collectUsedNames(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) names.add(node.text);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return names;
}

function isConstEnum(symbol: ts.Symbol): boolean {
  return (symbol.declarations ?? []).some(
    (declaration) => ts.isEnumDeclaration(declaration)
      && hasModifier(declaration, ts.SyntaxKind.ConstKeyword),
  );
}

export function createRuntimeRefResolver(
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
    if (info === null) return "символ не имеет объявления";
    if (isAmbientWithoutRuntime(info.declaration)) {
      return "глобальная декларация без рантайм-модуля";
    }
    if (info.file.fileName === sourceFile.fileName) return null;
    if (!ts.isExternalModule(info.file)) {
      if (!isDeclarationFile(info.file.fileName)) return null;
      if (isDefaultLibraryFile(info.file)) return "глобальный тип без рантайм-модуля";
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
    const reference = namespaceBinding !== undefined
      ? `${namespaceBinding.localName}.${name}`
      : `${aliasFor(moduleName)}.${name}`;
    return reference;
  };

  const runtimeRef = (symbol: ts.Symbol): RuntimeRefResult => {
    const target = resolveAlias(checker, symbol);
    if (isConstEnum(target)) {
      return {
        kind: "error",
        reason: "const enum не имеет рантайм-значения; используйте обычный enum",
      };
    }
    const info = declarationInfo(checker, target);
    if (info === null) {
      return { kind: "error", reason: "символ не имеет объявления" };
    }
    const issue = runtimeIssue(target);
    if (issue !== null) {
      return { kind: "error", reason: `класс недоступен в рантайме: ${issue}` };
    }
    let reference: string | null;
    if (info.file.fileName === sourceFile.fileName) {
      reference = localQualifiedName(checker, target);
    } else if (!ts.isExternalModule(info.file)) {
      if (!isDeclarationFile(info.file.fileName) || isDefaultLibraryFile(info.file)) {
        reference = localQualifiedName(checker, target);
      } else {
        const ambient = ambientModuleName(info.declaration);
        const name = declarationName(target) ?? target.getName();
        reference = ambient === null ? null : bindingReference(target, ambient, name);
      }
    } else {
      const valueTarget = valueTargetFor(target, info.file);
      if (valueTarget !== null) {
        reference = bindingReference(target, valueTarget.module, valueTarget.name);
      } else {
        const matching = bindings.filter((entry) => symbolsEqual(checker, entry.symbol, target));
        const boundName = matching.find((entry) => entry.exportedName !== undefined)?.exportedName;
        const exported = boundName ?? exportedName(checker, target, info.file)
          ?? (matching.length > 0 ? declarationName(target) : null);
        const moduleName = matching[0]?.module
          ?? moduleSpecifierFor(sourceFile, info.file, checker);
        reference = exported === null || moduleName === null
          ? null
          : bindingReference(target, moduleName, exported);
      }
    }
    if (reference === null || !isSafeReference(reference)) {
      return {
        kind: "error",
        reason: "класс недоступен в рантайме: ссылка не является корректным идентификатором",
      };
    }
    return { kind: "ok", reference };
  };

  return { runtimeRef, imports };
}
