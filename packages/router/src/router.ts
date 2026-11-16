import type { AnyComponent } from "@ivlev-dev/silent-core";
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
  type RouteGuardResult,
  type RouteLoaderResult,
  type RouteLocation,
  type RouteLocationTargetObject,
  type RouteParams,
  type RouteQuery,
  type RouteRecord,
  type RouteTarget,
  type ScrollBehavior,
  type ScrollPosition,
} from "./match.js";

export interface RouterState {
  readonly route: RouteLocation | null;
  readonly params: RouteParams;
  readonly query: RouteQuery;
  readonly hash: string;
  readonly matched: readonly MatchedRoute[];
  readonly pending: boolean;
  readonly error: unknown;
}

export interface RouterOptions {
  readonly routes: readonly RouteRecord[];
  readonly base?: string;
  readonly history?: RouterHistory;
  readonly scrollBehavior?: ScrollBehavior;
}

const EMPTY_PARAMS: RouteParams = Object.freeze({});
const EMPTY_QUERY: RouteQuery = Object.freeze({});
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

export class Router {
  readonly base: string;
  readonly state: Accessor<RouterState>;

  private readonly compiled: readonly CompiledRoute[];
  private readonly history: RouterHistory;
  private readonly ownsHistory: boolean;
  private readonly scrollBehavior: ScrollBehavior | undefined;
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
    this.compiled = compileRoutes(options.routes);
    this.history = options.history ?? createDefaultHistory();
    this.ownsHistory = options.history === undefined;
    this.scrollBehavior = options.scrollBehavior;

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
    this.activate();
  }

  static current(): Router | null {
    const router = routers[routers.length - 1];
    return router ?? null;
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

  push(to: RouteTarget): Promise<void> {
    return this.navigate(to, false, false);
  }

  replace(to: RouteTarget): Promise<void> {
    return this.navigate(to, true, false);
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
    this.activate();
    if (this.started) {
      return;
    }
    this.started = true;
    this.unlisten = this.history.listen((location) => {
      void this.navigateFromHistory(location);
    });
    await this.navigate(this.fullPathFromHistory(this.history.location), true, true);
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
    const index = routers.indexOf(this);
    if (index !== -1) {
      routers.splice(index, 1);
    }
  }

  private activate(): void {
    const index = routers.indexOf(this);
    if (index !== -1) {
      routers.splice(index, 1);
    }
    routers.push(this);
  }

  private async navigateFromHistory(location: HistoryLocation): Promise<void> {
    try {
      await this.navigate(this.fullPathFromHistory(location), true, true);
    } catch {
      return;
    }
  }

  private async navigate(
    target: RouteTarget,
    replace: boolean,
    fromHistory: boolean,
  ): Promise<void> {
    if (this.disposed) {
      throw new RouterNavigationError("Router уничтожен", "abort", targetString(target));
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
          }
          return;
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
        await this.restoreScroll(resolved, from);
        return;
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
        return;
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
      let result: RouteGuardResult;
      try {
        result = await guard(location, from, signal);
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
      const load = entry.record.load;
      if (load === undefined || entry.component !== undefined) {
        continue;
      }
      let result: RouteLoaderResult;
      try {
        result = await load(location, signal);
      } catch (error) {
        if (signal.aborted || id !== this.navigationId) {
          throw new RouterAbortError(location.fullPath);
        }
        throw new RouterNavigationError(
          `Загрузчик маршрута ${entry.path} завершился ошибкой`,
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
          `Загрузчик маршрута ${entry.path} вернул некорректный компонент`,
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
  }

  private async restoreScroll(
    to: RouteLocation,
    from: RouteLocation | null,
  ): Promise<void> {
    if (typeof window === "undefined") {
      return;
    }
    const saved = this.savedPositions.get(to.fullPath) ?? null;
    const behavior = this.scrollBehavior;
    if (behavior === undefined) {
      if (saved !== null) {
        this.applyScroll(saved);
      }
      return;
    }
    const result = await behavior(to, from, saved);
    if (result === false || result === null || result === undefined) {
      return;
    }
    this.applyScroll(result);
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
