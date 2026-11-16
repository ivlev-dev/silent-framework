import type { AnyComponent } from "@ivlev-dev/silent-core";
import type {
  QueryInput,
  RouteGuard,
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
    ? Name | BracedParams<Rest>
    : never;

type ColonParams<Path extends string> =
  Path extends `${string}/:${infer Name}/${infer Rest}`
    ? Name | ColonParams<`/${Rest}`>
    : Path extends `${string}/:${infer Name}`
      ? Name
      : Path extends `:${infer Name}/${infer Rest}`
        ? Name | ColonParams<`/${Rest}`>
        : Path extends `:${infer Name}`
          ? Name
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

export interface RouteDefinition {
  readonly path: string;
  readonly name?: string;
  readonly component?: AnyComponent;
  readonly children?: readonly RouteInput[];
  readonly redirect?: RouteRedirect;
  readonly meta?: RouteMeta;
  readonly beforeEnter?: AnyRouteGuard;
  readonly load?: AnyRouteLoader;
}

export abstract class Route<
  Path extends string = string,
  Query extends RouteQueryShape = RouteQuery,
> implements RouteDefinition {
  abstract readonly path: Path;
  declare readonly name?: string;
  declare readonly component?: AnyComponent;
  declare readonly children?: readonly RouteInput[];
  declare readonly redirect?: RouteRedirect;
  declare readonly meta?: RouteMeta;
}

export interface Route<
  Path extends string = string,
  Query extends RouteQueryShape = RouteQuery,
> {
  beforeEnter?(
    to: TypedRouteLocation<Path, Query>,
    from: TypedRouteLocation<Path, Query> | null,
    signal: AbortSignal,
  ): RouteGuardResult | Promise<RouteGuardResult>;
  load?(
    context: RouteLoadContext<Path, Query>,
  ): RouteLoaderResult | Promise<RouteLoaderResult>;
}

export type RouteClass = new () => RouteDefinition;
export type RouteInput = RouteRecord | RouteDefinition | RouteClass;

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
  } = { path: input.path };

  if (input.name !== undefined) {
    record.name = input.name;
  }
  if (input.component !== undefined) {
    record.component = input.component;
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
