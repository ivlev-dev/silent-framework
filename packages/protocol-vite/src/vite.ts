import * as path from "node:path";
import MagicString from "magic-string";
import ts from "typescript";
import type { Plugin, ViteDevServer } from "vite";
import { generateProtocolBlocks, protocolHelperAlias, PROTOCOL_MODULE } from "./typegen.js";
import type { RuntimeRefResult } from "./runtime-ref.js";
import { createRuntimeRefResolver } from "./runtime-ref.js";

export type ProtocolDiagnostics = (message: string) => void;

export interface ProtocolPluginOptions {
  readonly include?: RegExp;
  readonly exclude?: RegExp;
  readonly tsconfig?: string;
  readonly strict?: boolean;
  readonly diagnostics?: boolean | ProtocolDiagnostics;
}

const DEFAULT_INCLUDE = /\.(?:[cm]?ts|tsx)$/;
const DEFAULT_EXCLUDE = /node_modules/;
const SCHEMA_KEY = "silent.protocol.schema";
const GENERATED_MARKER = /Symbol\s*\.\s*for\(\s*["']silent\.protocol\.schema["']\s*\)/;
const DECLARATION_FILE_PATTERN = /\.d\.[cm]?ts$/i;
const SAFE_QUERY_KEYS: ReadonlySet<string> = new Set(["import", "v", "t", "direct"]);
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
  readonly changedFiles: Set<string>;
  dirty: boolean;
  reloadProject: boolean;
}

interface ProgramCache {
  previous: ts.Program | undefined;
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

function isDefaultLibraryFile(sourceFile: ts.SourceFile): boolean {
  const name = sourceFile.fileName;
  const slash = Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\"));
  return /^lib(?:\.[^/\\]+)?\.d\.ts$/.test(name.slice(slash + 1));
}

function isNodeModulesFile(fileName: string): boolean {
  return fileName.split(/[\\/]/).includes("node_modules");
}

function programWatchFiles(entry: ProgramEntry): readonly string[] {
  const files = new Set<string>();
  if (entry.project.configPath !== null) files.add(path.resolve(entry.project.configPath));
  for (const rootName of entry.project.rootNames) files.add(path.resolve(rootName));
  for (const sourceFile of entry.program.getSourceFiles()) {
    if (isDefaultLibraryFile(sourceFile)) continue;
    const fileName = path.resolve(sourceFile.fileName);
    if (isNodeModulesFile(fileName)) continue;
    files.add(fileName);
  }
  return [...files];
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
      `@ivlev-dev/silent-protocol-vite: не удалось прочитать ${configPath}: ${
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
      `@ivlev-dev/silent-protocol-vite: ошибка конфигурации ${configPath}:\n${details}`,
    );
  }
  return {
    configPath,
    rootNames: parsed.fileNames,
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

export function protocol(options: ProtocolPluginOptions = {}): Plugin {
  const include = options.include ?? DEFAULT_INCLUDE;
  const exclude = options.exclude ?? DEFAULT_EXCLUDE;
  const strict = options.strict === true;
  const programs = new Map<string, ProgramEntry>();
  const watchedFiles = new WeakMap<ts.Program, readonly string[]>();
  const registeredWatchFiles = new WeakMap<ts.Program, Set<string>>();
  let root = process.cwd();

  const watchFilesFor = (entry: ProgramEntry): readonly string[] => {
    const cached = watchedFiles.get(entry.program);
    if (cached !== undefined) return cached;
    const files = programWatchFiles(entry);
    watchedFiles.set(entry.program, files);
    return files;
  };

  const registerWatchFiles = (
    entry: ProgramEntry,
    context: { readonly addWatchFile?: (id: string) => void } | undefined,
  ): void => {
    if (context?.addWatchFile === undefined) return;
    let registered = registeredWatchFiles.get(entry.program);
    if (registered === undefined) {
      registered = new Set<string>();
      registeredWatchFiles.set(entry.program, registered);
    }
    for (const file of watchFilesFor(entry)) {
      if (registered.has(file)) continue;
      registered.add(file);
      context.addWatchFile(file);
    }
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
    if (!cached.dirty && cached.program.getSourceFile(file) !== undefined) return cached;
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
    name: "silent-protocol",
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
        if (!code.includes("class")) return null;
        const context: { readonly warn?: (message: string) => void; readonly addWatchFile?: (id: string) => void } | undefined = this;
        const entry = programEntryFor(file);
        if (entry === null) return null;
        registerWatchFiles(entry, context);
        const sourceFile = entry.program.getSourceFile(file);
        if (sourceFile === undefined) return null;
        const transformedBefore = code !== sourceFile.text;
        if (transformedBefore && hasGeneratedSchema(code)) return null;
        const warn = (message: string): void => {
          if (entry.warnings.has(message)) return;
          entry.warnings.add(message);
          context?.warn?.(message);
        };
        const emit = (message: string): void => {
          if (options.diagnostics === false) return;
          if (typeof options.diagnostics === "function") {
            options.diagnostics(message);
            return;
          }
          warn(message);
        };
        let offset = 0;
        if (transformedBefore) {
          const index = code.indexOf(sourceFile.text);
          if (index < 0) {
            warn(`${file}: код изменён до плагина silent-protocol, схема не сгенерирована`);
            return null;
          }
          offset = index;
        }
        const checker = entry.program.getTypeChecker();
        const resolver = createRuntimeRefResolver(sourceFile, checker, entry.project.options);
        const runtimeRef = (symbol: ts.Symbol): RuntimeRefResult => resolver.runtimeRef(symbol);
        const blocks = generateProtocolBlocks({
          sourceFile,
          checker,
          runtimeRef,
          diagnostics: emit,
          strict,
        });
        if (blocks.length === 0) return null;
        const magic = new MagicString(code);
        for (const block of blocks) {
          magic.appendLeft(block.position + offset, block.code);
        }
        const body = magic.toString();
        const usedImports = resolver.imports.filter((entryImport) => {
          const pattern = new RegExp(`\\b${entryImport.alias}\\b`);
          return pattern.test(body);
        });
        const newline = sourceFile.text.includes("\r\n") ? "\r\n" : "\n";
        if (usedImports.length > 0) {
          const statements = usedImports
            .map((entryImport) => `import * as ${entryImport.alias} from ${JSON.stringify(entryImport.module)};`)
            .join(newline);
          magic.appendLeft(importInsertionPosition(code), `${statements}${newline}`);
        }
        const helpers = [...new Set(blocks.flatMap((block) => block.helpers))];
        if (helpers.length > 0) {
          const specifiers = helpers
            .map((name) => `${name} as ${protocolHelperAlias(name)}`)
            .join(", ");
          const statement = `import { ${specifiers} } from ${JSON.stringify(PROTOCOL_MODULE)};`;
          magic.appendLeft(importInsertionPosition(code), `${statement}${newline}`);
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

export default protocol;
