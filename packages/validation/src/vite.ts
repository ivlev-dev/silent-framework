import * as path from "node:path";
import MagicString from "magic-string";
import ts from "typescript";
import type { Plugin, ViteDevServer } from "vite";
import { generateValidationBlocks } from "./typegen.js";

export interface ValidationPluginOptions {
  readonly include?: RegExp;
  readonly exclude?: RegExp;
  readonly tsconfig?: string;
  readonly base?: string;
}

const DEFAULT_INCLUDE = /\.(?:ts|tsx)$/;
const DEFAULT_EXCLUDE = /node_modules/;
const NAMESPACE_ALIAS_PREFIX = "__silent_validation_";
const ACCESSOR_PATTERN = /\baccessor\b/;
const EXTENDS_PATTERN = /\bextends\b/;

function extendsBase(
  type: ts.Type,
  name: string,
  seen: Set<ts.Type>,
): boolean {
  if (seen.has(type)) {
    return false;
  }
  seen.add(type);
  if (type.getSymbol()?.getName() === name) {
    return true;
  }
  for (const base of type.getBaseTypes() ?? []) {
    if (extendsBase(base, name, seen)) {
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
  readonly rootNames: string[];
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
  readonly imports: readonly ImportInsertion[];
}

function cleanModuleId(id: string): string {
  return id.split("?")[0]?.split("#")[0] ?? "";
}

function isVirtualModule(id: string): boolean {
  return id.includes("\0") || id.startsWith("virtual:");
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
): RuntimeRefResolver {
  const bindings = collectImportBindings(sourceFile, checker);
  const usedNames = collectUsedNames(sourceFile);
  const aliases = new Map<string, string>();
  const imports: ImportInsertion[] = [];

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
      return declarationName(symbol) ?? "undefined";
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
    if (name === null) return "undefined";

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

  return { runtimeRef, imports };
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
    rootNames: parsed.fileNames.filter(needsValidation),
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

export function validation(options: ValidationPluginOptions = {}): Plugin {
  const include = options.include ?? DEFAULT_INCLUDE;
  const exclude = options.exclude ?? DEFAULT_EXCLUDE;
  const baseName = options.base ?? "ValidationModel";
  const programs = new Map<string, ProgramEntry>();
  let root = process.cwd();

  const resolveConfigPath = (file: string): string | null => {
    if (options.tsconfig !== undefined) {
      return path.isAbsolute(options.tsconfig)
        ? options.tsconfig
        : path.resolve(root, options.tsconfig);
    }
    return ts.findConfigFile(path.dirname(file), ts.sys.fileExists, "tsconfig.json") ?? null;
  };

  const invalidate = (file: string): void => {
    const cleaned = cleanModuleId(file);
    if (path.basename(cleaned) === "tsconfig.json" || cleaned.endsWith(".json")) {
      programs.clear();
      return;
    }
    for (const [key, entry] of programs) {
      if (entry.program.getSourceFile(cleaned) !== undefined) {
        programs.delete(key);
      }
    }
  };

  const createProgram = (file: string, project: ParsedProject, previous?: ProgramEntry): ProgramEntry => {
    const rootNames = new Set<string>(project.rootNames);
    if (previous !== undefined) {
      for (const name of previous.rootNames) rootNames.add(name);
    }
    rootNames.add(file);
    const created = ts.createProgram({
      rootNames: [...rootNames],
      options: project.options,
      ...(project.projectReferences === undefined
        ? {}
        : { projectReferences: project.projectReferences }),
    });
    return { program: created, rootNames: [...rootNames] };
  };

  const programFor = (file: string): ts.Program | null => {
    const configPath = resolveConfigPath(file);
    const key = configPath ?? "<fallback>";
    const cached = programs.get(key);
    if (cached !== undefined && cached.program.getSourceFile(file) !== undefined) {
      return cached.program;
    }
    let project: ParsedProject;
    if (configPath === null) {
      project = fallbackProject();
    } else {
      project = readProject(configPath);
    }
    const created = createProgram(file, project, cached);
    programs.set(key, created);
    return created.program;
  };

  const shouldTransform = (id: string, file: string): boolean => {
    if (isVirtualModule(id) || isVirtualModule(file)) return false;
    if (!DEFAULT_INCLUDE.test(file)) return false;
    if (file.endsWith(".d.ts")) return false;
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
      const handle = (file: string): void => {
        invalidate(file);
      };
      server.watcher.on("change", handle);
      server.watcher.on("add", handle);
      server.watcher.on("unlink", handle);
    },
    watchChange(id) {
      invalidate(id);
    },
    transform: {
      order: "pre",
      handler(code, id) {
        const file = cleanModuleId(id);
        if (!shouldTransform(id, file)) return null;
        if (!ACCESSOR_PATTERN.test(code) || !EXTENDS_PATTERN.test(code)) return null;
        const program = programFor(file);
        if (program === null) return null;
        const sourceFile = program.getSourceFile(file);
        if (sourceFile === undefined) return null;
        const checker = program.getTypeChecker();
        const resolver = createRuntimeRefResolver(sourceFile, checker);
        const decisions = new Map<ts.ClassDeclaration, boolean>();
        const blocks = generateValidationBlocks({
          sourceFile,
          checker,
          runtimeRef: resolver.runtimeRef,
          shouldGenerate: (declaration) => {
            const cached = decisions.get(declaration);
            if (cached !== undefined) {
              return cached;
            }
            const type = checker.getTypeAtLocation(declaration);
            const result = extendsBase(type, baseName, new Set<ts.Type>());
            decisions.set(declaration, result);
            return result;
          },
        });
        if (blocks.length === 0) return null;
        const magic = new MagicString(code);
        for (const block of blocks) {
          magic.appendLeft(block.position, block.code);
        }
        if (resolver.imports.length > 0) {
          const statements = resolver.imports
            .map((entry) => `import * as ${entry.alias} from ${JSON.stringify(entry.module)};`)
            .join("\n");
          magic.appendLeft(0, `${statements}\n`);
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
