import type { AnyComponent } from "@ivlev-dev/silent-core";
import type {
  QueryInput,
  QuerySchema,
  RouteGuard,
  RouteGuardContext,
  RouteGuardResult,
  RouteLoader,
  RouteLoaderResult,
  RouteLocation,
  RouteMeta,
  RouteQuery,
  RouteRecord,
  RouteRedirect,
} from "./match.js";
import type { IRouter } from "./router.js";

export type RouteQueryShape = Readonly<Record<string, QueryInput>>;

type BracedParams<Path extends string> =
  Path extends `${string}{${infer Name}}${infer Rest}`
    ? Name extends ""
      ? BracedParams<Rest>
      : Name | BracedParams<Rest>
    : never;

type NameChar =
  | "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h" | "i" | "j" | "k" | "l" | "m"
  | "n" | "o" | "p" | "q" | "r" | "s" | "t" | "u" | "v" | "w" | "x" | "y" | "z"
  | "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J" | "K" | "L" | "M"
  | "N" | "O" | "P" | "Q" | "R" | "S" | "T" | "U" | "V" | "W" | "X" | "Y" | "Z"
  | "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9"
  | "_" | "$";

type TakeParamName<
  Value extends string,
  Name extends string = "",
> = Value extends `${infer Char}${infer Rest}`
  ? Char extends NameChar
    ? TakeParamName<Rest, `${Name}${Char}`>
    : { readonly name: Name; readonly rest: Value }
  : { readonly name: Name; readonly rest: "" };

type LastChar<Value extends string> = Value extends `${infer Char}${infer Rest}`
  ? Rest extends ""
    ? Char
    : LastChar<Rest>
  : "";

type ColonParams<Path extends string> =
  Path extends `${infer Head}:${infer Tail}`
    ? LastChar<Head> extends NameChar
      ? ColonParams<Tail>
      : TakeParamName<Tail> extends {
        readonly name: infer Name extends string;
        readonly rest: infer Rest extends string;
      }
        ? Name extends ""
          ? ColonParams<Rest>
          : Name | ColonParams<Rest>
        : never
    : never;

type ParamName<Path extends string> = BracedParams<Path> | ColonParams<Path>;

export type PathParams<Path extends string> = string extends Path
  ? Readonly<Record<string, string>>
  : { readonly [Key in ParamName<Path>]: string };

export type TypedRouteLocation<
  Path extends string = string,
  Query = RouteQuery,
> = Omit<RouteLocation, "params" | "query"> & {
  readonly params: PathParams<Path>;
  readonly query: Query;
};

export interface RouteViewProps<
  Path extends string = string,
  Query = RouteQuery,
> {
  readonly route: TypedRouteLocation<Path, Query>;
  readonly params: PathParams<Path>;
  readonly query: Query;
  readonly hash: string;
  readonly meta: RouteMeta;
  readonly router: IRouter;
}

export type RouteComponent<
  Path extends string = string,
  Query = RouteQuery,
> = (props: RouteViewProps<Path, Query>) => unknown;

export interface RouteLoadContext<
  Path extends string = string,
  Query = RouteQuery,
> extends RouteViewProps<Path, Query> {
  readonly signal: AbortSignal;
}

export type RouteClassGuard<
  Path extends string = string,
  Query = RouteQuery,
> = (
  to: TypedRouteLocation<Path, Query>,
  from: TypedRouteLocation<Path, Query> | null,
  signal: AbortSignal,
  context?: RouteGuardContext<Path, Query>,
) => RouteGuardResult | Promise<RouteGuardResult>;

export type RouteClassLoad<
  Path extends string = string,
  Query = RouteQuery,
> = (
  context: RouteLoadContext<Path, Query>,
) => RouteLoaderResult | Promise<RouteLoaderResult>;

export type AnyRouteGuard = (
  ...args: never[]
) => RouteGuardResult | Promise<RouteGuardResult>;

export type AnyRouteLoader = (
  ...args: never[]
) => RouteLoaderResult | Promise<RouteLoaderResult>;

export interface RouteDefinition<
  Query = Readonly<Record<string, unknown>>,
> {
  readonly path: string;
  readonly name?: string;
  readonly component?: AnyComponent;
  readonly children?: readonly RouteInput[];
  readonly redirect?: RouteRedirect;
  readonly meta?: RouteMeta;
  readonly beforeEnter?: AnyRouteGuard;
  readonly load?: AnyRouteLoader;
  readonly query?: QuerySchema<Query>;
  readonly key?: (to: RouteLocation) => string | number;
}

export abstract class Route<
  Path extends string = string,
  Query extends RouteQueryShape = RouteQuery,
> implements RouteDefinition<Query> {
  abstract readonly path: Path;
  declare readonly name?: string;
  declare readonly component?: AnyComponent;
  declare readonly children?: readonly RouteInput[];
  declare readonly redirect?: RouteRedirect;
  declare readonly meta?: RouteMeta;
  declare readonly query?: QuerySchema<Query>;
  declare readonly key?: (to: RouteLocation) => string | number;
}

export interface Route<
  Path extends string = string,
  Query extends RouteQueryShape = RouteQuery,
> {
  beforeEnter?(
    to: TypedRouteLocation<Path, Query>,
    from: TypedRouteLocation<Path, Query> | null,
    signal: AbortSignal,
    context?: RouteGuardContext<Path, Query>,
  ): RouteGuardResult | Promise<RouteGuardResult>;
  load?(
    context: RouteLoadContext<Path, Query>,
  ): RouteLoaderResult | Promise<RouteLoaderResult>;
}

export type RouteClass = new () => RouteDefinition;
export type RouteInput = RouteRecord | RouteDefinition | RouteClass;

export function createGuard<Path extends string = string, Query = RouteQuery>(
  handler: (
    context: RouteGuardContext<Path, Query>,
  ) => RouteGuardResult | Promise<RouteGuardResult>,
): RouteGuard {
  return (_to, _from, _signal, context) =>
    handler(context as RouteGuardContext<Path, Query>);
}

const contextLoaders = new WeakSet<RouteRecord>();

export function hasContextLoader(record: RouteRecord): boolean {
  return contextLoaders.has(record);
}

function isConstructor(input: RouteInput): input is RouteClass {
  return typeof input === "function";
}

function normalizeChildren(
  children: readonly RouteInput[] | undefined,
): RouteRecord[] | undefined {
  if (children === undefined || children.length === 0) {
    return undefined;
  }
  return children.map((child) => normalizeInput(child));
}

function definitionToRecord(
  input: RouteDefinition,
  fromClass: boolean,
): RouteRecord {
  const record: {
    path: string;
    name?: string;
    component?: AnyComponent;
    children?: readonly RouteRecord[];
    redirect?: RouteRedirect;
    meta?: RouteMeta;
    beforeEnter?: RouteGuard;
    load?: RouteLoader;
    query?: QuerySchema<Readonly<Record<string, unknown>>>;
    key?: (to: RouteLocation) => string | number;
  } = { path: input.path };

  if (input.name !== undefined) {
    record.name = input.name;
  }
  if (input.component !== undefined) {
    record.component = input.component;
  }
  if (input.key !== undefined) {
    record.key = input.key;
  }
  const children = normalizeChildren(input.children);
  if (children !== undefined) {
    record.children = children;
  }
  if (input.redirect !== undefined) {
    record.redirect = input.redirect;
  }
  if (input.meta !== undefined) {
    record.meta = input.meta;
  }
  if (input.query !== undefined) {
    record.query = input.query;
  }
  if (input.beforeEnter !== undefined) {
    record.beforeEnter = input.beforeEnter as RouteGuard;
  }
  if (input.load !== undefined) {
    record.load = input.load as RouteLoader;
    if (fromClass) {
      contextLoaders.add(record);
    }
  }
  return record;
}

function normalizeInput(input: RouteInput): RouteRecord {
  if (isConstructor(input)) {
    return definitionToRecord(new input(), true);
  }
  if (input instanceof Route) {
    return definitionToRecord(input, true);
  }
  return definitionToRecord(input, false);
}

export function normalizeRoutes(
  routes: readonly RouteInput[],
): readonly RouteRecord[] {
  return routes.map((route) => normalizeInput(route));
}
