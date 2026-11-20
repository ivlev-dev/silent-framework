import type { AnyComponent } from "@ivlev-dev/silent-core";
import type { Container } from "@ivlev-dev/silent-di";
import type { TypedRouteLocation } from "./route.js";
import type { IRouter } from "./router.js";

export type RouteParams = Readonly<Record<string, string>>;
export type RouteQueryScalar = string | number | boolean;
export type RouteQueryValue =
  | string
  | number
  | boolean
  | readonly (string | number | boolean)[];
export type RouteQuery = Readonly<Record<string, RouteQueryValue>>;
export type RouteMeta = Readonly<Record<string, unknown>>;

export type QueryParser<T = unknown> =
  | "string"
  | "number"
  | "boolean"
  | "string[]"
  | "number[]"
  | "boolean[]"
  | ((raw: string | string[] | undefined) => T | undefined);

export type QuerySchema<Q> = {
  readonly [K in keyof Q]: QueryParser<Q[K]>;
};
export type RouterErrorCode =
  | "abort"
  | "guard"
  | "load"
  | "no-match"
  | "redirect"
  | "resolve"
  | "scroll";

export class RouterMissingError extends Error {
  constructor(message = "Router не найден: передайте router или создайте экземпляр Router") {
    super(message);
    this.name = "RouterMissingError";
  }
}

export class RouterNavigationError extends Error {
  readonly code: RouterErrorCode;
  readonly to: string;

  constructor(message: string, code: RouterErrorCode, to = "", cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "RouterNavigationError";
    this.code = code;
    this.to = to;
  }
}

export class RouterAbortError extends RouterNavigationError {
  constructor(to = "", message = "Навигация отменена") {
    super(message, "abort", to);
    this.name = "RouterAbortError";
  }
}

export type QueryInput =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly (string | number | boolean)[];

export interface RouteLocationTargetObject {
  readonly path?: string;
  readonly name?: string;
  readonly params?: Readonly<Record<string, string | number>>;
  readonly query?: Readonly<Record<string, QueryInput>>;
  readonly hash?: string;
}

export type RouteTarget = string | RouteLocationTargetObject;

export interface RouteLocation {
  readonly path: string;
  readonly fullPath: string;
  readonly name: string | null;
  readonly params: RouteParams;
  readonly query: RouteQuery;
  readonly hash: string;
  readonly meta: RouteMeta;
  readonly matched: readonly MatchedRoute[];
}

export interface MatchedRoute {
  readonly record: RouteRecord;
  readonly path: string;
  readonly name: string | null;
  readonly params: RouteParams;
  readonly component?: AnyComponent;
}

export type RouteGuardResult = boolean | void | string | RouteLocationTargetObject;

export interface RouteGuardContext<
  Path extends string = string,
  Query = RouteQuery,
> {
  readonly router: IRouter;
  readonly container: Container | undefined;
  readonly to: TypedRouteLocation<Path, Query>;
  readonly from: TypedRouteLocation<Path, Query> | null;
  readonly signal: AbortSignal;
}

export type RouteGuard = (
  to: RouteLocation,
  from: RouteLocation | null,
  signal: AbortSignal,
  context: RouteGuardContext,
) => RouteGuardResult | Promise<RouteGuardResult>;

export type RouteRedirect =
  | string
  | RouteLocationTargetObject
  | ((to: RouteLocation) => string | RouteLocationTargetObject);

export type RouteLoaderResult = AnyComponent | { readonly default: AnyComponent };

export type RouteLoader = (
  to: RouteLocation,
  signal: AbortSignal,
) => RouteLoaderResult | Promise<RouteLoaderResult>;

export interface RouteRecord<Q = Readonly<Record<string, unknown>>> {
  readonly path: string;
  readonly name?: string;
  readonly component?: AnyComponent;
  readonly children?: readonly RouteRecord[];
  readonly redirect?: RouteRedirect;
  readonly beforeEnter?: RouteGuard;
  readonly load?: RouteLoader;
  readonly meta?: RouteMeta;
  readonly query?: QuerySchema<Q>;
  readonly key?: (to: RouteLocation) => string | number;
}

export interface ScrollPosition {
  readonly left: number;
  readonly top: number;
}

export type ScrollBehaviorResult = ScrollPosition | null | void | false;

export type ScrollBehavior = (
  to: RouteLocation,
  from: RouteLocation | null,
  savedPosition: ScrollPosition | null,
) => ScrollBehaviorResult | Promise<ScrollBehaviorResult>;

interface PatternLiteralPart {
  readonly kind: "literal";
  readonly value: string;
}

interface PatternParamPart {
  readonly kind: "param";
  readonly name: string;
}

type PatternPart = PatternLiteralPart | PatternParamPart;

type PatternSegment =
  | { readonly kind: "static"; readonly value: string }
  | { readonly kind: "param"; readonly name: string }
  | {
    readonly kind: "mixed";
    readonly parts: readonly PatternPart[];
    readonly names: readonly string[];
    readonly regex: RegExp;
  }
  | { readonly kind: "wildcard"; readonly name: string };

export interface CompiledRoute {
  readonly record: RouteRecord;
  readonly chain: readonly RouteRecord[];
  readonly chainPaths: readonly string[];
  readonly path: string;
  readonly segments: readonly PatternSegment[];
  readonly score: readonly number[];
  readonly order: number;
}

const WILDCARD_PARAM = "*";
const MAX_REDIRECT_STEPS = 16;

export function normalizeHash(hash: string): string {
  if (hash === "" || hash === "#") {
    return "";
  }
  return hash.startsWith("#") ? hash : `#${hash}`;
}

export function normalizePath(path: string): string {
  let value = path.trim();
  if (value === "") {
    return "/";
  }
  if (!value.startsWith("/")) {
    value = `/${value}`;
  }
  value = value.replace(/\/{2,}/g, "/");
  if (value.length > 1 && value.endsWith("/")) {
    value = value.slice(0, -1);
  }
  return value === "" ? "/" : value;
}

function pathSegments(path: string): string[] {
  return normalizePath(path).split("/").filter((segment) => segment.length > 0);
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

const PARAM_NAME = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const WHOLE_BRACED_PARAM = /^\{([^{}]+)\}$/;
const PARAM_TOKEN = /\{([^{}]+)\}|(?:^|([^A-Za-z0-9_$])):([A-Za-z_$][A-Za-z0-9_$]*)/g;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tokenizeSegment(segment: string): readonly PatternPart[] | null {
  const parts: PatternPart[] = [];
  let position = 0;
  let found = false;
  PARAM_TOKEN.lastIndex = 0;
  for (let match = PARAM_TOKEN.exec(segment); match !== null; match = PARAM_TOKEN.exec(segment)) {
    const braced = match[1];
    const boundary = match[2];
    const colon = match[3];
    const name = braced ?? colon;
    if (name === undefined || name === "") {
      continue;
    }
    const start = match.index + (boundary === undefined ? 0 : boundary.length);
    if (start > position) {
      parts.push({ kind: "literal", value: segment.slice(position, start) });
    }
    parts.push({ kind: "param", name });
    position = match.index + match[0].length;
    found = true;
  }
  if (!found) {
    return null;
  }
  if (position < segment.length) {
    parts.push({ kind: "literal", value: segment.slice(position) });
  }
  return parts;
}

function compileMixedSegment(parts: readonly PatternPart[]): PatternSegment {
  const names: string[] = [];
  let source = "^";
  for (const part of parts) {
    if (part.kind === "param") {
      names.push(part.name);
      source += "(.+)";
      continue;
    }
    source += escapeRegExp(safeDecode(part.value));
  }
  source += "$";
  return {
    kind: "mixed",
    parts,
    names,
    regex: new RegExp(source, "u"),
  };
}

function compilePattern(pattern: string): PatternSegment[] {
  const segments = pathSegments(pattern);
  const result: PatternSegment[] = [];
  for (const segment of segments) {
    if (segment === "*") {
      result.push({ kind: "wildcard", name: WILDCARD_PARAM });
      continue;
    }
    if (segment.startsWith(":") && PARAM_NAME.test(segment.slice(1))) {
      result.push({ kind: "param", name: segment.slice(1) });
      continue;
    }
    const braced = WHOLE_BRACED_PARAM.exec(segment);
    if (braced !== null) {
      result.push({ kind: "param", name: braced[1] ?? "" });
      continue;
    }
    const parts = tokenizeSegment(segment);
    if (parts !== null) {
      result.push(compileMixedSegment(parts));
      continue;
    }
    result.push({ kind: "static", value: segment });
  }
  return result;
}

function scoreOf(segments: readonly PatternSegment[]): number[] {
  if (segments.length === 0) {
    return [5];
  }
  return segments.map((segment) => {
    if (segment.kind === "static") {
      return 4;
    }
    if (segment.kind === "mixed") {
      return 3;
    }
    if (segment.kind === "param") {
      return 2;
    }
    return 1;
  });
}

function literalWeight(segment: PatternSegment | undefined): number {
  if (segment === undefined) {
    return 0;
  }
  if (segment.kind === "static") {
    return segment.value.length;
  }
  if (segment.kind !== "mixed") {
    return 0;
  }
  let total = 0;
  for (const part of segment.parts) {
    if (part.kind === "literal") {
      total += part.value.length;
    }
  }
  return total;
}

function joinRoutePath(parent: string, child: string): string {
  if (child.startsWith("/")) {
    return normalizePath(child);
  }
  if (child === "") {
    return normalizePath(parent);
  }
  const base = normalizePath(parent);
  return normalizePath(base === "/" ? `/${child}` : `${base}/${child}`);
}

export function compileRoutes(
  routes: readonly RouteRecord[],
  parentPath = "/",
  parentChain: readonly RouteRecord[] = [],
  parentPaths: readonly string[] = [],
): CompiledRoute[] {
  const compiled: CompiledRoute[] = [];
  const visit = (records: readonly RouteRecord[], rootPath: string, chain: readonly RouteRecord[], paths: readonly string[]): void => {
    for (const record of records) {
      const fullPath = joinRoutePath(rootPath, record.path);
      const nextChain = [...chain, record];
      const nextPaths = [...paths, fullPath];
      const segments = compilePattern(fullPath);
      compiled.push({
        record,
        chain: nextChain,
        chainPaths: nextPaths,
        path: fullPath,
        segments,
        score: scoreOf(segments),
        order: compiled.length,
      });
      if (record.children !== undefined && record.children.length > 0) {
        visit(record.children, fullPath, nextChain, nextPaths);
      }
    }
  };
  visit(routes, parentPath, parentChain, parentPaths);
  compiled.sort((left, right) => compareSpecificity(right, left));
  return compiled;
}

function compareSpecificity(left: CompiledRoute, right: CompiledRoute): number {
  const length = Math.max(left.score.length, right.score.length);
  for (let index = 0; index < length; index += 1) {
    const leftScore = left.score[index] ?? -1;
    const rightScore = right.score[index] ?? -1;
    if (leftScore !== rightScore) {
      return leftScore - rightScore;
    }
  }
  const weightLength = Math.max(left.segments.length, right.segments.length);
  for (let index = 0; index < weightLength; index += 1) {
    const leftWeight = literalWeight(left.segments[index]);
    const rightWeight = literalWeight(right.segments[index]);
    if (leftWeight !== rightWeight) {
      return leftWeight - rightWeight;
    }
  }
  if (left.chain.length !== right.chain.length) {
    return left.chain.length - right.chain.length;
  }
  return right.order - left.order;
}

function matchPattern(
  segments: readonly PatternSegment[],
  parts: readonly string[],
): RouteParams | null {
  const params: Record<string, string> = {};
  let position = 0;
  for (const segment of segments) {
    if (segment.kind === "wildcard") {
      params[segment.name] = parts
        .slice(position)
        .map((part) => safeDecode(part))
        .join("/");
      return params;
    }
    const part = parts[position];
    if (part === undefined) {
      return null;
    }
    if (segment.kind === "param") {
      params[segment.name] = safeDecode(part);
      position += 1;
      continue;
    }
    if (segment.kind === "mixed") {
      const match = segment.regex.exec(safeDecode(part));
      if (match === null) {
        return null;
      }
      for (let index = 0; index < segment.names.length; index += 1) {
        const name = segment.names[index];
        const value = match[index + 1];
        if (name === undefined || value === undefined) {
          return null;
        }
        params[name] = value;
      }
      position += 1;
      continue;
    }
    if (safeDecode(part) !== safeDecode(segment.value)) {
      return null;
    }
    position += 1;
  }
  return position === parts.length ? params : null;
}

export interface RouteMatch {
  readonly route: CompiledRoute;
  readonly params: RouteParams;
}

export function matchRoutes(
  compiled: readonly CompiledRoute[],
  pathname: string,
): RouteMatch | null {
  const parts = pathSegments(pathname);
  for (const route of compiled) {
    const params = matchPattern(route.segments, parts);
    if (params !== null) {
      return { route, params };
    }
  }
  return null;
}

export function parseQuery(search: string): RouteQuery {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  if (raw === "") {
    return {};
  }
  const params = new URLSearchParams(raw);
  const result: Record<string, string | string[]> = {};
  for (const [key, value] of params) {
    const existing = Object.prototype.hasOwnProperty.call(result, key)
      ? result[key]
      : undefined;
    if (existing === undefined) {
      result[key] = value;
      continue;
    }
    if (Array.isArray(existing)) {
      existing.push(value);
      continue;
    }
    result[key] = [existing, value];
  }
  return result;
}

function isQueryArray(value: RouteQueryValue): value is readonly RouteQueryScalar[] {
  return Array.isArray(value);
}

export function buildQuery(query: RouteQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (isQueryArray(value)) {
      for (const item of value) {
        params.append(key, String(item));
      }
      continue;
    }
    params.append(key, String(value));
  }
  const search = params.toString();
  return search === "" ? "" : `?${search}`;
}

function normalizeQuery(query: Readonly<Record<string, QueryInput>>): RouteQuery {
  const result: Record<string, RouteQueryValue> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      const items = (value as readonly (string | number | boolean)[]).map((item) => String(item));
      if (items.length === 0) {
        continue;
      }
      result[key] = items;
      continue;
    }
    result[key] = value as RouteQueryScalar;
  }
  return result;
}

function lastQueryString(value: RouteQueryValue | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (isQueryArray(value)) {
    const last = value[value.length - 1];
    return last === undefined ? undefined : String(last);
  }
  return String(value);
}

function queryStrings(value: RouteQueryValue | undefined): string[] {
  if (value === undefined) {
    return [];
  }
  if (isQueryArray(value)) {
    return value.map((item) => String(item));
  }
  return [String(value)];
}

function parseNumberValue(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseBooleanValue(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  return undefined;
}

function parseWithSchema<T>(
  parser: QueryParser<T>,
  value: RouteQueryValue | undefined,
): T | undefined {
  if (typeof parser === "function") {
    const raw = value === undefined
      ? undefined
      : isQueryArray(value)
        ? value.map((item) => String(item))
        : String(value);
    return parser(raw);
  }
  if (parser === "string") {
    return lastQueryString(value) as T | undefined;
  }
  if (parser === "number") {
    return parseNumberValue(lastQueryString(value)) as T | undefined;
  }
  if (parser === "boolean") {
    return parseBooleanValue(lastQueryString(value)) as T | undefined;
  }
  const items = queryStrings(value);
  if (items.length === 0) {
    return undefined;
  }
  if (parser === "string[]") {
    return items as T;
  }
  if (parser === "number[]") {
    const parsed = items
      .map((item) => parseNumberValue(item))
      .filter((item): item is number => item !== undefined);
    return parsed.length === 0 ? undefined : parsed as T;
  }
  const parsed = items
    .map((item) => parseBooleanValue(item))
    .filter((item): item is boolean => item !== undefined);
  return parsed.length === 0 ? undefined : parsed as T;
}

function querySchemaFor(
  chain: readonly RouteRecord[],
): QuerySchema<Readonly<Record<string, unknown>>> | undefined {
  let schema: Record<string, QueryParser<unknown>> | undefined;
  for (const record of chain) {
    const current = record.query;
    if (current === undefined) {
      continue;
    }
    schema = { ...(schema ?? {}), ...current };
  }
  return schema;
}

function applyQuerySchema(
  query: RouteQuery,
  schema: QuerySchema<Readonly<Record<string, unknown>>> | undefined,
): RouteQuery {
  if (schema === undefined) {
    return query;
  }
  const result: Record<string, RouteQueryValue> = { ...query };
  for (const [key, parser] of Object.entries(schema)) {
    const parsed = parseWithSchema(parser, query[key]);
    if (parsed === undefined || parsed === null) {
      delete result[key];
      continue;
    }
    result[key] = parsed as RouteQueryValue;
  }
  return result;
}

function encodeParam(value: string): string {
  return encodeURIComponent(value);
}

function interpolatePath(
  pattern: string,
  params: Readonly<Record<string, string | number>>,
): string {
  const segments = compilePattern(pattern);
  const output: string[] = [];
  for (const segment of segments) {
    if (segment.kind === "static") {
      output.push(segment.value);
      continue;
    }
    if (segment.kind === "wildcard") {
      const raw = params[segment.name];
      if (raw === undefined) {
        continue;
      }
      output.push(
        String(raw)
          .split("/")
          .filter((part) => part.length > 0)
          .map((part) => encodeParam(part))
          .join("/"),
      );
      continue;
    }
    if (segment.kind === "mixed") {
      let value = "";
      for (const part of segment.parts) {
        if (part.kind === "literal") {
          value += part.value;
          continue;
        }
        const raw = params[part.name];
        if (raw === undefined) {
          throw new RouterNavigationError(
            `Не задан параметр маршрута ":${part.name}"`,
            "resolve",
            pattern,
          );
        }
        value += encodeParam(String(raw));
      }
      output.push(value);
      continue;
    }
    const raw = params[segment.name];
    if (raw === undefined) {
      throw new RouterNavigationError(
        `Не задан параметр маршрута ":${segment.name}"`,
        "resolve",
        pattern,
      );
    }
    output.push(encodeParam(String(raw)));
  }
  return normalizePath(`/${output.filter((part) => part.length > 0).join("/")}`);
}

function findByName(
  compiled: readonly CompiledRoute[],
  name: string,
): CompiledRoute | null {
  for (const route of compiled) {
    if (route.record.name === name) {
      return route;
    }
  }
  return null;
}

function entryFor(
  record: RouteRecord,
  path: string,
  params: RouteParams,
  components: ReadonlyMap<RouteRecord, AnyComponent> | undefined,
): MatchedRoute {
  const component = components?.get(record) ?? record.component;
  const base = {
    record,
    path,
    name: record.name ?? null,
    params,
  };
  return component === undefined ? base : { ...base, component };
}

const EMPTY_META: RouteMeta = Object.freeze({});

function mergeMeta(chain: readonly RouteRecord[]): RouteMeta {
  let meta: Record<string, unknown> | undefined;
  for (const record of chain) {
    const current = record.meta;
    if (current === undefined) {
      continue;
    }
    meta = { ...(meta ?? {}), ...current };
  }
  return meta === undefined ? EMPTY_META : Object.freeze(meta);
}

export function createLocation(
  compiled: readonly CompiledRoute[],
  pathname: string,
  search: string,
  hash: string,
  components?: ReadonlyMap<RouteRecord, AnyComponent>,
): RouteLocation {
  const path = normalizePath(pathname);
  const match = matchRoutes(compiled, path);
  if (match === null) {
    throw new RouterNavigationError(
      `Маршрут не найден: ${path}`,
      "no-match",
      path,
    );
  }
  const matched: MatchedRoute[] = [];
  for (let index = 0; index < match.route.chain.length; index += 1) {
    const record = match.route.chain[index];
    const pattern = match.route.chainPaths[index];
    if (record === undefined || pattern === undefined) {
      continue;
    }
    matched.push(entryFor(record, pattern, match.params, components));
  }
  const rawQuery = parseQuery(search);
  const query = applyQuerySchema(rawQuery, querySchemaFor(match.route.chain));
  const normalizedHash = normalizeHash(hash);
  return {
    path,
    fullPath: `${path}${buildQuery(rawQuery)}${normalizedHash}`,
    name: match.route.record.name ?? null,
    params: match.params,
    query,
    hash: normalizedHash,
    meta: mergeMeta(match.route.chain),
    matched,
  };
}

function describeTarget(target: RouteTarget): string {
  if (typeof target === "string") {
    return target;
  }
  if (target.name !== undefined) {
    return `{ name: "${target.name}" }`;
  }
  return target.path ?? "{ path: \"/\" }";
}

function splitTarget(value: string): { path: string; search: string; hash: string } {
  let rest = value;
  let hash = "";
  const hashIndex = rest.indexOf("#");
  if (hashIndex !== -1) {
    hash = rest.slice(hashIndex);
    rest = rest.slice(0, hashIndex);
  }
  let search = "";
  const queryIndex = rest.indexOf("?");
  if (queryIndex !== -1) {
    search = rest.slice(queryIndex);
    rest = rest.slice(0, queryIndex);
  }
  return { path: rest, search, hash };
}

function resolveRelativePath(base: string, relative: string): string {
  if (relative === "." || relative === "") {
    return normalizePath(base);
  }
  if (relative === "..") {
    const segments = pathSegments(base);
    segments.pop();
    return normalizePath(`/${segments.join("/")}`);
  }
  if (relative.startsWith("./")) {
    const segments = pathSegments(base);
    segments.pop();
    return normalizePath(`/${[...segments, ...pathSegments(relative.slice(2))].join("/")}`);
  }
  const segments = pathSegments(base);
  segments.pop();
  return normalizePath(`/${[...segments, ...pathSegments(relative)].join("/")}`);
}

function resolveStringTarget(
  compiled: readonly CompiledRoute[],
  value: string,
  current: RouteLocation | null,
  components: ReadonlyMap<RouteRecord, AnyComponent> | undefined,
): RouteLocation {
  const currentPath = current?.path ?? "/";
  if (value.startsWith("#")) {
    return createLocation(
      compiled,
      currentPath,
      buildQuery(current?.query ?? {}),
      value,
      components,
    );
  }
  const split = splitTarget(value);
  if (split.search.startsWith("?") && split.path === "" && split.hash === "" && value.startsWith("?")) {
    return createLocation(
      compiled,
      currentPath,
      split.search,
      "",
      components,
    );
  }
  let targetPath = split.path;
  if (targetPath === "") {
    targetPath = currentPath;
  } else if (!targetPath.startsWith("/")) {
    targetPath = resolveRelativePath(currentPath, targetPath);
  }
  return createLocation(
    compiled,
    targetPath,
    split.search,
    split.hash,
    components,
  );
}

export function resolveLocation(
  compiled: readonly CompiledRoute[],
  target: RouteTarget,
  current: RouteLocation | null = null,
  components?: ReadonlyMap<RouteRecord, AnyComponent>,
): RouteLocation {
  if (typeof target === "string") {
    return resolveStringTarget(compiled, target, current, components);
  }
  const params = target.params ?? {};
  let targetPath: string;
  let inlineSearch: string | null = null;
  let inlineHash: string | null = null;
  if (target.name !== undefined) {
    const route = findByName(compiled, target.name);
    if (route === null) {
      throw new RouterNavigationError(
        `Маршрут с именем "${target.name}" не найден`,
        "resolve",
        describeTarget(target),
      );
    }
    targetPath = interpolatePath(route.path, params);
  } else if (target.path !== undefined && target.path !== "") {
    const split = splitTarget(target.path);
    targetPath = split.path.includes(":") || split.path.includes("{")
      ? interpolatePath(split.path, params)
      : normalizePath(split.path);
    if (split.search !== "") {
      inlineSearch = split.search;
    }
    if (split.hash !== "") {
      inlineHash = split.hash;
    }
  } else {
    targetPath = current?.path ?? "/";
  }
  // Объектная цель без query/hash наследует их у текущего маршрута;
  // query/hash из target.path уступают явным полям объекта.
  const query = target.query === undefined
    ? current?.query ?? {}
    : normalizeQuery(target.query);
  const search = target.query !== undefined
    ? buildQuery(query)
    : inlineSearch ?? buildQuery(query);
  const hash = target.hash !== undefined
    ? target.hash
    : inlineHash ?? current?.hash ?? "";
  return createLocation(compiled, targetPath, search, hash, components);
}

export function isPathActive(
  currentPath: string,
  targetPath: string,
  exact: boolean,
): boolean {
  if (currentPath === targetPath) {
    return true;
  }
  if (exact) {
    return false;
  }
  if (targetPath === "/") {
    return false;
  }
  return currentPath.startsWith(`${targetPath}/`);
}

export const ROUTER_MAX_REDIRECT_STEPS = MAX_REDIRECT_STEPS;
