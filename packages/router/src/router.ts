import { devtoolsNavigate, type AnyComponent } from "@ivlev-dev/silent-core";
import type { Container } from "@ivlev-dev/silent-di";
import {
  createSignal,
  type Accessor,
  type Setter,
} from "@ivlev-dev/silent-reactivity";
import {
  BrowserHistory,
  MemoryHistory,
  type HistoryLocation,
  type RouterHistory,
} from "./history.js";
import {
  RouterAbortError,
  RouterNavigationError,
  ROUTER_MAX_REDIRECT_STEPS,
  compileRoutes,
  normalizePath,
  resolveLocation,
  type CompiledRoute,
  type MatchedRoute,
  type RouteGuardContext,
  type RouteGuardResult,
  type RouteLoaderResult,
  type RouteLocation,
  type RouteLocationTargetObject,
  type RouteMeta,
  type RouteParams,
  type RouteQuery,
  type RouteRecord,
  type RouteTarget,
  type ScrollBehavior,
  type ScrollBehaviorResult,
  type ScrollPosition,
} from "./match.js";
import {
  hasContextLoader,
  normalizeRoutes,
  type RouteClassLoad,
  type RouteInput,
  type RouteLoadContext,
} from "./route.js";

export interface RouterState {
  readonly route: RouteLocation | null;
  readonly params: RouteParams;
  readonly query: RouteQuery;
  readonly hash: string;
  readonly matched: readonly MatchedRoute[];
  readonly pending: boolean;
  readonly error: unknown;
}

export interface RouterTransitionOptions {
  /** При отмене навигации (abort) отклонить промис RouterAbortError. По умолчанию false. */
  readonly rejectOnAbort?: boolean;
}

export interface IRouter {
  readonly base: string;
  readonly state: Accessor<RouterState>;
  readonly route: RouteLocation | null;
  readonly params: RouteParams;
  readonly query: RouteQuery;
  readonly hash: string;
  readonly meta: RouteMeta;
  readonly matched: readonly MatchedRoute[];
  resolve(to: RouteTarget): RouteLocation;
  href(to: RouteTarget): string;
  hasRoute(to: RouteTarget): boolean;
  isLoaded(to: RouteTarget): boolean;
  prefetch(to: RouteTarget): Promise<void>;
  navigate(to: RouteTarget, options?: { readonly replace?: boolean }): Promise<boolean>;
  push(to: RouteTarget, options?: RouterTransitionOptions): Promise<void>;
  replace(to: RouteTarget, options?: RouterTransitionOptions): Promise<void>;
  back(): void;
  forward(): void;
  start(): Promise<void>;
  stop(): void;
  dispose(): void;
}

export interface RouterComponentLoadContext extends RouteLoadContext {
  readonly record: RouteRecord;
}

export type RouterComponentLoader = (
  context: RouterComponentLoadContext,
) => RouteLoaderResult | Promise<RouteLoaderResult>;

export interface RouterOptions {
  readonly routes: readonly RouteInput[];
  readonly base?: string;
  readonly history?: RouterHistory;
  readonly scrollBehavior?: ScrollBehavior;
  readonly container?: Container;
  readonly load?: RouterComponentLoader;
  readonly resolveComponent?: RouterComponentLoader;
  readonly onError?: (error: RouterNavigationError, to: RouteTarget) => void;
}

const EMPTY_PARAMS: RouteParams = Object.freeze({});
const EMPTY_QUERY: RouteQuery = Object.freeze({});
const EMPTY_META: RouteMeta = Object.freeze({});
const EMPTY_MATCHED: readonly MatchedRoute[] = Object.freeze([]);

const routers: Router[] = [];

type HistoryAction = "none" | "push" | "replace";

function normalizeBase(base: string): string {
  if (base === "" || base === "/") {
    return "";
  }
  return normalizePath(base);
}

function createDefaultHistory(): RouterHistory {
  if (typeof window !== "undefined" && typeof window.history !== "undefined") {
    return new BrowserHistory(window);
  }
  return new MemoryHistory("/");
}

function targetString(target: RouteTarget): string {
  if (typeof target === "string") {
    return target;
  }
  if (target.name !== undefined) {
    return target.name;
  }
  return target.path ?? "";
}

function isRedirectResult(
  value: RouteGuardResult,
): value is string | RouteLocationTargetObject {
  return typeof value === "string" || (typeof value === "object" && value !== null);
}

export class Router implements IRouter {
  readonly base: string;
  readonly state: Accessor<RouterState>;

  private readonly compiled: readonly CompiledRoute[];
  private readonly history: RouterHistory;
  private readonly ownsHistory: boolean;
  private readonly scrollBehavior: ScrollBehavior | undefined;
  private readonly container: Container | undefined;
  private readonly componentLoader: RouterComponentLoader | undefined;
  private readonly onError: ((error: RouterNavigationError, to: RouteTarget) => void) | undefined;
  private readonly stateSignal: readonly [Accessor<RouterState>, Setter<RouterState>];
  private readonly loadedComponents = new Map<RouteRecord, AnyComponent>();
  private readonly savedPositions = new Map<string, ScrollPosition>();
  private unlisten: (() => void) | null = null;
  private started = false;
  private disposed = false;
  private navigationId = 0;
  private controller: AbortController | null = null;

  constructor(options: RouterOptions) {
    this.base = normalizeBase(options.base ?? "");
    this.compiled = compileRoutes(normalizeRoutes(options.routes));
    this.history = options.history ?? createDefaultHistory();
    this.ownsHistory = options.history === undefined;
    this.scrollBehavior = options.scrollBehavior;
    this.container = options.container;
    this.componentLoader = options.load ?? options.resolveComponent;
    this.onError = options.onError;

    this.stateSignal = createSignal<RouterState>({
      route: null,
      params: EMPTY_PARAMS,
      query: EMPTY_QUERY,
      hash: "",
      matched: EMPTY_MATCHED,
      pending: false,
      error: null,
    });
    this.state = this.stateSignal[0];
    if (options.container !== undefined) {
      this.provide(options.container);
    }
  }

  static current(): Router | null {
    const router = routers[routers.length - 1];
    return router ?? null;
  }

  provide(container: Container): this {
    container.bindValue(Router, this);
    return this;
  }

  get route(): RouteLocation | null {
    return this.stateSignal[0]().route;
  }

  get params(): RouteParams {
    return this.stateSignal[0]().params;
  }

  get query(): RouteQuery {
    return this.stateSignal[0]().query;
  }

  get hash(): string {
    return this.stateSignal[0]().hash;
  }

  get meta(): RouteMeta {
    return this.stateSignal[0]().route?.meta ?? EMPTY_META;
  }

  get matched(): readonly MatchedRoute[] {
    return this.stateSignal[0]().matched;
  }

  resolve(to: RouteTarget): RouteLocation {
    return this.attachComponents(
      resolveLocation(this.compiled, to, this.stateSignal[0]().route, this.loadedComponents),
    );
  }

  href(to: RouteTarget): string {
    return `${this.base}${this.resolve(to).fullPath}`;
  }

  hasRoute(to: RouteTarget): boolean {
    try {
      resolveLocation(this.compiled, to, this.stateSignal[0]().route, this.loadedComponents);
      return true;
    } catch {
      return false;
    }
  }

  isLoaded(to: RouteTarget): boolean {
    let location: RouteLocation;
    try {
      location = this.resolve(to);
    } catch {
      return false;
    }
    for (const entry of location.matched) {
      if (entry.component !== undefined || entry.record.component !== undefined) {
        continue;
      }
      if (this.loadedComponents.has(entry.record)) {
        continue;
      }
      if (entry.record.load !== undefined || this.componentLoader !== undefined) {
        return false;
      }
    }
    return true;
  }

  prefetch(to: RouteTarget): Promise<void> {
    if (this.disposed) {
      return Promise.reject(new RouterNavigationError("Router уничтожен", "abort", targetString(to)));
    }
    const location = this.attachComponents(this.resolve(to));
    const id = this.navigationId;
    return this.runLoaders(location, new AbortController().signal, id);
  }

  async navigate(
    to: RouteTarget,
    options?: { readonly replace?: boolean },
  ): Promise<boolean> {
    try {
      return await this.transition(to, options?.replace ?? false, false);
    } catch {
      return false;
    }
  }

  push(to: RouteTarget, options?: RouterTransitionOptions): Promise<void> {
    return this.transition(to, false, false, options?.rejectOnAbort ?? false)
      .then(() => undefined);
  }

  replace(to: RouteTarget, options?: RouterTransitionOptions): Promise<void> {
    return this.transition(to, true, false, options?.rejectOnAbort ?? false)
      .then(() => undefined);
  }

  back(): void {
    this.history.back();
  }

  forward(): void {
    this.history.forward();
  }

  async start(): Promise<void> {
    if (this.disposed) {
      throw new RouterNavigationError("Router уничтожен", "abort", "");
    }
    if (this.started) {
      return;
    }
    this.activate();
    this.started = true;
    this.unlisten = this.history.listen((location) => {
      void this.navigateFromHistory(location);
    });
    await this.transition(this.fullPathFromHistory(this.history.location), true, true);
  }

  stop(): void {
    const unlisten = this.unlisten;
    this.unlisten = null;
    this.started = false;
    if (unlisten !== null) {
      unlisten();
    }
    this.controller?.abort();
    this.controller = null;
    this.deactivate();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.stop();
    this.disposed = true;
    if (this.ownsHistory) {
      this.history.dispose();
    }
    this.deactivate();
  }

  private activate(): void {
    this.deactivate();
    routers.push(this);
  }

  private deactivate(): void {
    const index = routers.indexOf(this);
    if (index !== -1) {
      routers.splice(index, 1);
    }
  }

  private isSameLocation(target: RouteTarget): boolean {
    const current = this.stateSignal[0]();
    if (current.route === null || current.error !== null) {
      return false;
    }
    try {
      const location = this.attachComponents(
        resolveLocation(this.compiled, target, current.route, this.loadedComponents),
      );
      const leaf = location.matched[location.matched.length - 1];
      return location.fullPath === current.route.fullPath
        && leaf?.record.redirect === undefined;
    } catch {
      return false;
    }
  }

  private async navigateFromHistory(location: HistoryLocation): Promise<void> {
    try {
      await this.transition(this.fullPathFromHistory(location), true, true);
    } catch {
      return;
    }
  }

  private restoreHistoryUrl(): void {
    const current = this.stateSignal[0]().route;
    if (current === null) {
      return;
    }
    this.history.replace(`${this.base}${current.fullPath}`);
  }

  private async transition(
    target: RouteTarget,
    replace: boolean,
    fromHistory: boolean,
    rejectOnAbort = false,
  ): Promise<boolean> {
    if (this.disposed) {
      throw new RouterNavigationError("Router уничтожен", "abort", targetString(target));
    }
    if (!fromHistory && this.isSameLocation(target)) {
      return true;
    }
    this.navigationId += 1;
    const id = this.navigationId;
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const signal = controller.signal;
    const from = this.stateSignal[0]().route;
    const origin = targetString(target);
    this.stateSignal[1]((previous) => ({ ...previous, pending: true, error: null }));
    let current: RouteTarget = target;
    let baseLocation = from;
    let action: HistoryAction = fromHistory ? "none" : replace ? "replace" : "push";
    let steps = 0;

    try {
      for (;;) {
        if (signal.aborted) {
          throw new RouterAbortError(origin);
        }
        const location = this.attachComponents(
          resolveLocation(this.compiled, current, baseLocation, this.loadedComponents),
        );
        const leaf = location.matched[location.matched.length - 1];
        const redirect = leaf?.record.redirect;
        if (redirect !== undefined) {
          const next = typeof redirect === "function" ? redirect(location) : redirect;
          current = next;
          baseLocation = location;
          action = "replace";
          steps += 1;
          if (steps > ROUTER_MAX_REDIRECT_STEPS) {
            throw new RouterNavigationError(
              "Превышено число редиректов",
              "redirect",
              location.fullPath,
            );
          }
          continue;
        }

        const guard = await this.runGuards(location, from, signal, id);
        if (guard === false) {
          if (id === this.navigationId) {
            this.stateSignal[1]((previous) => ({ ...previous, pending: false }));
            if (fromHistory) {
              this.restoreHistoryUrl();
            }
          }
          return false;
        }
        if (guard !== true) {
          current = guard;
          baseLocation = location;
          action = "replace";
          steps += 1;
          if (steps > ROUTER_MAX_REDIRECT_STEPS) {
            throw new RouterNavigationError(
              "Превышено число редиректов",
              "redirect",
              location.fullPath,
            );
          }
          continue;
        }

        await this.runLoaders(location, signal, id);
        if (signal.aborted || id !== this.navigationId) {
          throw new RouterAbortError(origin);
        }
        const resolved = this.attachComponents(location);
        this.commit(resolved, from, action);
        await this.restoreScroll(resolved, from, id);
        return true;
      }
    } catch (error) {
      if (
        error instanceof RouterAbortError
        || signal.aborted
        || id !== this.navigationId
      ) {
        if (id === this.navigationId) {
          this.stateSignal[1]((previous) => ({ ...previous, pending: false }));
        }
        if (rejectOnAbort) {
          throw error instanceof RouterAbortError ? error : new RouterAbortError(origin);
        }
        return false;
      }
      const navigationError = error instanceof RouterNavigationError
        ? error
        : new RouterNavigationError(
          error instanceof Error ? error.message : "Ошибка навигации",
          "guard",
          origin,
          error,
        );
      this.stateSignal[1]((previous) => ({
        ...previous,
        pending: false,
        error,
      }));
      if (fromHistory && id === this.navigationId) {
        this.restoreHistoryUrl();
      }
      if (this.onError !== undefined) {
        this.onError(navigationError, target);
      }
      throw navigationError;
    }
  }

  private async runGuards(
    location: RouteLocation,
    from: RouteLocation | null,
    signal: AbortSignal,
    id: number,
  ): Promise<true | false | RouteTarget> {
    for (const entry of location.matched) {
      const guard = entry.record.beforeEnter;
      if (guard === undefined) {
        continue;
      }
      const context: RouteGuardContext = {
        router: this,
        container: this.container,
        to: location,
        from,
        signal,
      };
      let result: RouteGuardResult;
      try {
        result = await guard(location, from, signal, context);
      } catch (error) {
        if (signal.aborted || id !== this.navigationId) {
          throw new RouterAbortError(location.fullPath);
        }
        throw new RouterNavigationError(
          `Guard маршрута ${entry.path} завершился ошибкой`,
          "guard",
          location.fullPath,
          error,
        );
      }
      if (signal.aborted || id !== this.navigationId) {
        throw new RouterAbortError(location.fullPath);
      }
      if (result === false) {
        return false;
      }
      if (isRedirectResult(result)) {
        return result;
      }
    }
    return true;
  }

  private async runLoaders(
    location: RouteLocation,
    signal: AbortSignal,
    id: number,
  ): Promise<void> {
    for (const entry of location.matched) {
      if (entry.component !== undefined) {
        continue;
      }
      const record = entry.record;
      const own = record.load;
      const shared = this.componentLoader;
      if (own === undefined && shared === undefined) {
        continue;
      }
      const label = record.name ?? entry.path;
      const context: RouterComponentLoadContext = {
        route: location,
        params: location.params,
        query: location.query,
        hash: location.hash,
        meta: location.meta,
        router: this,
        signal,
        record,
      };
      let result: RouteLoaderResult;
      try {
        if (own !== undefined) {
          result = hasContextLoader(record)
            ? await (own as unknown as RouteClassLoad)(context)
            : await own(location, signal);
        } else if (shared !== undefined) {
          result = await shared(context);
        } else {
          continue;
        }
      } catch (error) {
        if (signal.aborted || id !== this.navigationId) {
          throw new RouterAbortError(location.fullPath);
        }
        throw new RouterNavigationError(
          `Загрузчик маршрута ${label} завершился ошибкой`,
          "load",
          location.fullPath,
          error,
        );
      }
      if (signal.aborted || id !== this.navigationId) {
        throw new RouterAbortError(location.fullPath);
      }
      const component = typeof result === "function" ? result : result.default;
      if (typeof component !== "function") {
        throw new RouterNavigationError(
          `Загрузчик маршрута ${label} вернул некорректный компонент`,
          "load",
          location.fullPath,
        );
      }
      this.loadedComponents.set(entry.record, component);
    }
  }

  private commit(
    location: RouteLocation,
    from: RouteLocation | null,
    action: HistoryAction,
  ): void {
    if (from !== null) {
      this.saveScroll(from);
    }
    if (action !== "none") {
      const to = `${this.base}${location.fullPath}`;
      if (action === "replace") {
        this.history.replace(to);
      } else {
        this.history.push(to);
      }
    }
    this.stateSignal[1]({
      route: location,
      params: location.params,
      query: location.query,
      hash: location.hash,
      matched: location.matched,
      pending: false,
      error: null,
    });
    devtoolsNavigate(location.fullPath, from?.fullPath ?? null);
  }

  private async restoreScroll(
    to: RouteLocation,
    from: RouteLocation | null,
    id: number,
  ): Promise<void> {
    if (typeof window === "undefined") {
      return;
    }
    await Promise.resolve();
    if (id !== this.navigationId) {
      return;
    }
    const saved = this.savedPositions.get(to.fullPath) ?? null;
    const behavior = this.scrollBehavior;
    if (behavior === undefined) {
      if (saved !== null) {
        this.applyScroll(saved);
        return;
      }
      if (to.hash !== "") {
        this.scrollToHash(to.hash);
      }
      return;
    }
    let result: ScrollBehaviorResult;
    try {
      result = await behavior(to, from, saved);
    } catch (error) {
      if (id === this.navigationId) {
        this.reportScrollError(error, to);
      }
      return;
    }
    if (id !== this.navigationId) {
      return;
    }
    if (result === false || result === null || result === undefined) {
      return;
    }
    this.applyScroll(result);
  }

  private reportScrollError(error: unknown, to: RouteLocation): void {
    if (this.onError === undefined) {
      return;
    }
    const navigationError = new RouterNavigationError(
      error instanceof Error ? error.message : "Ошибка scrollBehavior",
      "scroll",
      to.fullPath,
      error,
    );
    this.onError(navigationError, to.fullPath);
  }

  private scrollToHash(hash: string): void {
    if (typeof document === "undefined") {
      return;
    }
    const raw = hash.startsWith("#") ? hash.slice(1) : hash;
    if (raw === "") {
      return;
    }
    let id = raw;
    try {
      id = decodeURIComponent(raw);
    } catch {
      id = raw;
    }
    const element = document.getElementById(id) ?? document.getElementsByName(id)[0] ?? null;
    if (element === null || typeof element.scrollIntoView !== "function") {
      return;
    }
    try {
      element.scrollIntoView({ block: "start" });
    } catch {
      void 0;
    }
  }

  private applyScroll(position: ScrollPosition): void {
    if (typeof window === "undefined") {
      return;
    }
    if (window.scrollX === position.left && window.scrollY === position.top) {
      return;
    }
    try {
      window.scrollTo(position.left, position.top);
    } catch {
      return;
    }
  }

  private saveScroll(location: RouteLocation): void {
    if (typeof window === "undefined") {
      return;
    }
    this.savedPositions.set(location.fullPath, {
      left: window.scrollX,
      top: window.scrollY,
    });
  }

  private attachComponents(location: RouteLocation): RouteLocation {
    let changed = false;
    const matched = location.matched.map((entry) => {
      const component = this.loadedComponents.get(entry.record) ?? entry.component;
      if (component === entry.component) {
        return entry;
      }
      changed = true;
      const base = {
        record: entry.record,
        path: entry.path,
        name: entry.name,
        params: entry.params,
      };
      return component === undefined ? base : { ...base, component };
    });
    return changed ? { ...location, matched } : location;
  }

  private fullPathFromHistory(location: HistoryLocation): string {
    return `${this.stripBase(location.pathname)}${location.search}${location.hash}`;
  }

  private stripBase(pathname: string): string {
    if (this.base === "") {
      return normalizePath(pathname);
    }
    if (pathname === this.base || pathname === `${this.base}/`) {
      return "/";
    }
    if (pathname.startsWith(`${this.base}/`)) {
      return normalizePath(pathname.slice(this.base.length));
    }
    return normalizePath(pathname);
  }
}

export const IRouter: typeof Router = Router;
