import { DI_CREATE } from "./token.js";
import type {
  Binding,
  BindingBuilder,
  ContainerOptions,
  ContainerResolutionEvent,
  ContainerResolutionInspector,
  Factory,
  ImplicitBindingMode,
  ScopeName,
} from "./types.js";

type FunctionValue = (...args: unknown[]) => unknown;
type ConstructorValue = new (...args: never[]) => unknown;
type CreateAware = { readonly [DI_CREATE]?: (container: Container) => unknown };

interface CaptiveFrame {
  readonly token: unknown;
  readonly owner: Container;
}

interface ResolutionContext {
  readonly captive: CaptiveFrame | null;
  readonly chain: ReadonlySet<unknown>;
}

const EMPTY_CHAIN: ReadonlySet<unknown> = new Set<unknown>();
const asyncBindings = new WeakSet<Binding<unknown>>();

const SYMBOL_DISPOSE: symbol | undefined = (Symbol as { readonly dispose?: symbol }).dispose;

let resolutionInspector: ContainerResolutionInspector | null = null;

export function setContainerResolutionInspector(
  inspector: ContainerResolutionInspector | null,
): void {
  resolutionInspector = inspector;
}

export interface ContainerSnapshot {
  readonly name: string;
  readonly disposed: boolean;
  readonly parent: string | null;
  readonly scopes: number;
  readonly bindings: number;
  readonly resolved: number;
  readonly resolving: number;
  readonly children: readonly ContainerSnapshot[];
}

export class CircularDependencyError extends Error {
  readonly path: unknown[];

  constructor(path: readonly unknown[]) {
    super(`Circular dependency detected: ${path.map(String).join(" -> ")}`);
    this.name = "CircularDependencyError";
    this.path = [...path];
  }
}

export class InvalidScopeError extends Error {
  readonly singletonToken: unknown;
  readonly scopedToken: unknown;
  readonly owner: Container;

  constructor(singletonToken: unknown, owner: Container, scopedToken: unknown) {
    super(
      `Invalid scope: singleton "${describeToken(singletonToken)}" контейнера "${owner.name}" зависит от scoped "${describeToken(scopedToken)}"; создайте request scope на запрос или измените scope зависимости`,
    );
    this.name = "InvalidScopeError";
    this.singletonToken = singletonToken;
    this.scopedToken = scopedToken;
    this.owner = owner;
  }
}

function describeToken(token: unknown): string {
  if (typeof token === "symbol") {
    return token.description ?? token.toString();
  }
  if (typeof token === "function") {
    return token.name === "" ? "anonymous" : token.name;
  }
  return String(token);
}

function isDevelopment(): boolean {
  const runtime = globalThis as {
    readonly process?: { readonly env?: { readonly NODE_ENV?: string } };
  };
  if (runtime.process?.env?.NODE_ENV === "development") {
    return true;
  }
  const meta = import.meta as ImportMeta & { readonly env?: { readonly DEV?: boolean } };
  return meta.env?.DEV === true;
}

export class MissingBindingError extends Error {
  readonly token: unknown;
  readonly container: Container;

  constructor(token: unknown, container: Container) {
    super(`Нет биндинга для зависимости "${describeToken(token)}" в контейнере "${container.name}"`);
    this.name = "MissingBindingError";
    this.token = token;
    this.container = container;
  }
}

function isFunctionValue(value: unknown): value is FunctionValue {
  return typeof value === "function";
}

function isClassSource(fn: FunctionValue): boolean {
  return /^class\b/.test(fn.toString().trim());
}

function isAsyncFunctionValue(fn: (...args: never[]) => unknown): boolean {
  return Object.prototype.toString.call(fn) === "[object AsyncFunction]";
}

function isAsyncFactorySource(factory: unknown): boolean {
  if (!isFunctionValue(factory)) {
    return false;
  }
  if (!isClassSource(factory)) {
    return isAsyncFunctionValue(factory);
  }
  const create = (factory as unknown as CreateAware)[DI_CREATE];
  return typeof create === "function" && isAsyncFunctionValue(create);
}

function toFactory(factory: unknown): Factory<unknown> {
  if (factory === undefined) {
    return async () => undefined;
  }
  if (!isFunctionValue(factory)) {
    return async () => factory;
  }
  if (!isClassSource(factory)) {
    return async (container) => factory(container);
  }
  return async (container) => {
    const create = (factory as unknown as CreateAware)[DI_CREATE];
    if (typeof create === "function") {
      return create.call(factory, container);
    }
    return new (factory as unknown as ConstructorValue)();
  };
}

function toFallbackFactory(ctor: FunctionValue): Factory<unknown> {
  return async (container) => {
    const create = (ctor as unknown as CreateAware)[DI_CREATE];
    if (typeof create === "function") {
      return create.call(ctor, container);
    }
    return new (ctor as unknown as ConstructorValue)();
  };
}

function disposeValue(value: unknown): void {
  if (SYMBOL_DISPOSE === undefined) {
    return;
  }
  if (value === null || (typeof value !== "object" && typeof value !== "function")) {
    return;
  }
  const method = (value as Record<PropertyKey, unknown>)[SYMBOL_DISPOSE];
  if (typeof method === "function") {
    method.call(value);
  }
}

function safeDisposeValue(value: unknown): void {
  try {
    disposeValue(value);
  } catch {
    return;
  }
}

export class Container {
  readonly name: string;

  private parent?: Container;
  private children = new Set<Container>();
  private bindings = new Map<unknown, Binding<unknown>>();
  private implicitTokens = new Set<unknown>();
  private cache = new Map<unknown, Promise<unknown>>();
  private resolved = new Map<unknown, unknown>();
  private resolving = new Map<unknown, unknown>();
  private syncContext: ResolutionContext | null = null;
  private disposeHooks: Array<() => void> = [];
  private disposed = false;
  private implicitBindingMode: ImplicitBindingMode;

  constructor(name = "root", parent?: Container, options: ContainerOptions = {}) {
    this.name = name;
    if (parent !== undefined) {
      this.parent = parent;
    }
    this.implicitBindingMode =
      options.implicitBindings ?? parent?.implicitBindings ?? Container.defaultImplicitBindings();
  }

  get implicitBindings(): ImplicitBindingMode {
    return this.implicitBindingMode;
  }

  bind<T = unknown>(token: unknown, factory?: unknown): BindingBuilder {
    this.assertUsable();
    const binding: Binding<unknown> = {
      factory: toFactory(factory),
      scope: "singleton",
    };
    if (isAsyncFactorySource(factory)) {
      asyncBindings.add(binding);
    }
    this.bindings.set(token, binding);
    this.implicitTokens.delete(token);
    this.clearCache(token);
    if (factory !== undefined && !isFunctionValue(factory)) {
      this.resolved.set(token, factory);
    }

    const changeScope = (scope: ScopeName): BindingBuilder => {
      if (binding.scope !== scope) {
        binding.scope = scope;
        this.clearCache(token);
      }
      return builder;
    };

    const builder: BindingBuilder = {
      inSingletonScope: () => changeScope("singleton"),
      inTransientScope: () => changeScope("transient"),
      inScopedScope: () => changeScope("scoped"),
    };
    return builder;
  }

  bindValue<T>(token: unknown, value: T): void {
    this.assertUsable();
    const binding: Binding<unknown> = {
      factory: async () => value,
      scope: "singleton",
    };
    this.bindings.set(token, binding);
    this.implicitTokens.delete(token);
    this.clearCache(token);
    this.resolved.set(token, value);
  }

  peekValue<T = unknown>(token: unknown): T | undefined {
    return this.peek<T>(token);
  }

  createScope(name = `scope:${Math.random()}`): Container {
    this.assertUsable();
    const scope = new Container(name, this, { implicitBindings: this.implicitBindingMode });
    this.children.add(scope);
    return scope;
  }

  resolve<T = unknown>(token: unknown): Promise<T> {
    try {
      return this.resolveInternal<T>(token, null);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  resolveSync<T = unknown>(token: unknown): T {
    this.assertUsable();
    if (token === undefined) {
      throw new Error("Async DI: resolve<T>() must be transformed by silentwire before runtime");
    }
    const found = this.findBindingWithOwner(token);
    if (found === undefined) {
      throw new Error(`Async DI: no binding registered for token ${String(token)}`);
    }
    const cacheContainer = found.binding.scope === "singleton" ? found.owner : this;
    if (cacheContainer.resolved.has(token)) {
      return cacheContainer.resolved.get(token) as T;
    }
    throw new Error(
      `Async DI: token ${describeToken(token)} has not been resolved yet; use resolve()`,
    );
  }

  peek<T = unknown>(token: unknown): T | undefined {
    const found = this.findBindingWithOwner(token);
    if (found === undefined) {
      return undefined;
    }
    const cacheContainer = found.binding.scope === "singleton" ? found.owner : this;
    if (!cacheContainer.resolved.has(token)) {
      return undefined;
    }
    return cacheContainer.resolved.get(token) as T;
  }

  has(token: unknown): boolean {
    return this.findBindingWithOwner(token) !== undefined;
  }

  hasExplicit(token: unknown): boolean {
    return this.findExplicitWithOwner(token) !== undefined;
  }

  snapshot(): ContainerSnapshot {
    return this.snapshotInternal(0);
  }

  private snapshotInternal(depth: number): ContainerSnapshot {
    const children = depth >= 64
      ? []
      : [...this.children].map((child) => child.snapshotInternal(depth + 1));
    let scopes = 0;
    let bindings = this.bindings.size;
    let resolved = this.resolved.size;
    let resolving = this.resolving.size;
    for (const child of children) {
      scopes += child.scopes + 1;
      bindings += child.bindings;
      resolved += child.resolved;
      resolving += child.resolving;
    }
    return {
      name: this.name,
      disposed: this.disposed,
      parent: this.parent === undefined ? null : this.parent.name,
      scopes,
      bindings,
      resolved,
      resolving,
      children,
    };
  }

  clearCache(token?: unknown): void {
    if (token === undefined) {
      this.cache.clear();
      this.resolved.clear();
      this.resolving.clear();
    } else {
      this.cache.delete(token);
      this.resolved.delete(token);
      this.resolving.delete(token);
    }
    for (const child of [...this.children]) {
      child.clearCache(token);
    }
  }

  onDispose(fn: () => void): void {
    this.disposeHooks.push(fn);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;

    const errors: unknown[] = [];

    while (this.disposeHooks.length > 0) {
      const hook = this.disposeHooks.shift();
      if (hook === undefined) {
        continue;
      }
      try {
        hook();
      } catch (error) {
        errors.push(error);
      }
    }

    const values = [...this.resolved.values()];
    const seen = new Set<unknown>();
    for (let index = values.length - 1; index >= 0; index -= 1) {
      const value = values[index];
      if (seen.has(value)) {
        continue;
      }
      seen.add(value);
      try {
        disposeValue(value);
      } catch (error) {
        errors.push(error);
      }
    }

    try {
      this.cache.clear();
      this.resolved.clear();
      this.resolving.clear();
      this.bindings.clear();
      this.implicitTokens.clear();
    } catch (error) {
      errors.push(error);
    }

    const children = [...this.children];
    for (const child of children) {
      try {
        child.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    this.children.clear();
    this.parent?.children.delete(this);

    if (errors.length === 1) {
      throw errors[0];
    }
    if (errors.length > 1) {
      throw new AggregateError(
        errors,
        `Container "${this.name}" dispose failed with ${errors.length} errors`,
      );
    }
  }

  private assertUsable(): void {
    if (this.disposed) {
      throw new Error(`Container "${this.name}" has been disposed`);
    }
  }

  private resolveInternal<T = unknown>(
    token: unknown,
    context: ResolutionContext | null,
  ): Promise<T> {
    this.assertUsable();

    if (token === undefined) {
      throw new Error("Async DI: resolve<T>() must be transformed by silentwire before runtime");
    }

    const effective = context ?? this.syncContext;
    const chain = effective?.chain ?? EMPTY_CHAIN;
    const captive = effective?.captive ?? null;

    const found = this.findBindingWithOwner(token);

    if (found === undefined) {
      if (!isFunctionValue(token)) {
        throw new Error(`Async DI: no binding registered for token ${String(token)}`);
      }
      this.bindImplicit(token, captive === null ? this : captive.owner);
      return this.resolveInternal<T>(token, effective);
    }

    const { binding, owner } = found;

    if (captive !== null && binding.scope === "scoped" && this !== captive.owner) {
      throw new InvalidScopeError(captive.token, captive.owner, token);
    }

    const cacheContainer = binding.scope === "singleton" ? owner : this;

    const cached = cacheContainer.cache.get(token);
    if (cached !== undefined) {
      if (chain.has(token) && cacheContainer.resolving.has(token)) {
        throw new CircularDependencyError([...chain, token]);
      }
      this.reportResolution(token, owner, binding, true);
      return cached as Promise<T>;
    }

    if (cacheContainer.resolving.has(token)) {
      throw new CircularDependencyError([...cacheContainer.resolving.keys()]);
    }

    this.reportResolution(token, owner, binding, false);

    const marker: object = {};
    cacheContainer.resolving.set(token, marker);

    let nextCaptive: CaptiveFrame | null = captive;
    if (
      binding.scope === "singleton" &&
      (nextCaptive === null || Container.isAncestor(cacheContainer, nextCaptive.owner))
    ) {
      nextCaptive = { token, owner: cacheContainer };
    }

    const nextChain = new Set(chain);
    nextChain.add(token);
    const needsAsyncFacade = asyncBindings.has(binding);
    const needsCaptiveFacade = nextCaptive !== null && nextCaptive.owner !== this;
    const factoryContext: ResolutionContext = {
      captive: needsCaptiveFacade ? nextCaptive : null,
      chain: nextChain,
    };
    const factoryContainer =
      needsAsyncFacade || needsCaptiveFacade
        ? Container.guard(this, factoryContext)
        : this;

    const instantiate = async (): Promise<unknown> => {
      try {
        const previousContext = this.syncContext;
        let produced: unknown;
        this.syncContext = factoryContext;
        try {
          produced = binding.factory(factoryContainer);
        } finally {
          this.syncContext = previousContext;
        }
        return await produced;
      } finally {
        if (cacheContainer.resolving.get(token) === marker) {
          cacheContainer.resolving.delete(token);
        }
      }
    };

    const promise: Promise<unknown> = instantiate().catch((error: unknown) => {
      if (cacheContainer.cache.get(token) === promise) {
        cacheContainer.cache.delete(token);
      }
      throw error;
    });

    cacheContainer.cache.set(token, promise);

    void promise.then(
      (value: unknown) => {
        if (cacheContainer.disposed) {
          if (binding.scope !== "transient") {
            safeDisposeValue(value);
          }
          return;
        }
        if (binding.scope !== "transient" && cacheContainer.cache.get(token) === promise) {
          cacheContainer.resolved.set(token, value);
        }
      },
      () => {
        if (cacheContainer.cache.get(token) === promise) {
          cacheContainer.resolved.delete(token);
        }
      },
    );

    if (binding.scope === "transient") {
      void promise.finally(() => {
        if (cacheContainer.cache.get(token) === promise) {
          cacheContainer.cache.delete(token);
        }
      }).catch(() => undefined);
    }

    return promise as Promise<T>;
  }

  private bindImplicit(token: FunctionValue, owner: Container): void {
    if (owner.implicitBindingMode === "error") {
      throw new MissingBindingError(token, owner);
    }
    if (owner.implicitBindingMode === "warn") {
      const stack = new Error().stack ?? "";
      console.warn(
        `[silent-di] Неявный биндинг для зависимости "${describeToken(token)}" в контейнере "${owner.name}". Стек:\n${stack}`,
      );
    }
    const binding: Binding<unknown> = {
      factory: toFallbackFactory(token),
      scope: "singleton",
    };
    if (isAsyncFactorySource(token)) {
      asyncBindings.add(binding);
    }
    owner.bindings.set(token, binding);
    owner.implicitTokens.add(token);
    owner.clearCache(token);
  }

  private static defaultImplicitBindings(): ImplicitBindingMode {
    return isDevelopment() ? "warn" : "allow";
  }

  private static isAncestor(ancestor: Container, node: Container): boolean {
    let current = node.parent;
    while (current !== undefined) {
      if (current === ancestor) {
        return true;
      }
      current = current.parent;
    }
    return false;
  }

  private static guard(target: Container, context: ResolutionContext): Container {
    return new Proxy(target, {
      get(object: Container, property: string | symbol): unknown {
        if (property === "resolve") {
          return (token: unknown): Promise<unknown> =>
            Container.resolveInContext(object, context, token);
        }
        if (property === "createScope") {
          return (name?: string): Container => Container.guard(object.createScope(name), context);
        }
        const value: unknown = Reflect.get(object, property, object);
        return typeof value === "function" ? value.bind(object) : value;
      },
    });
  }

  private static resolveInContext(
    target: Container,
    context: ResolutionContext,
    token: unknown,
  ): Promise<unknown> {
    try {
      return target.resolveInternal(token, context);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  private reportResolution(
    token: unknown,
    owner: Container,
    binding: Binding<unknown>,
    cached: boolean,
  ): void {
    const inspector = resolutionInspector;
    if (inspector === null) {
      return;
    }
    const event: ContainerResolutionEvent = {
      token,
      tokenName: describeToken(token),
      container: this.name,
      owner: owner.name,
      scope: binding.scope,
      implicit: owner.implicitTokens.has(token),
      cached,
    };
    try {
      inspector(event);
    } catch {
      return;
    }
  }

  private findBindingWithOwner(token: unknown): { binding: Binding<unknown>; owner: Container } | undefined {
    return this.findExplicitWithOwner(token) ?? this.findImplicitWithOwner(token);
  }

  private findExplicitWithOwner(token: unknown): { binding: Binding<unknown>; owner: Container } | undefined {
    const binding = this.bindings.get(token);
    if (binding !== undefined && !this.implicitTokens.has(token)) {
      return { binding, owner: this };
    }
    return this.parent?.findExplicitWithOwner(token);
  }

  private findImplicitWithOwner(token: unknown): { binding: Binding<unknown>; owner: Container } | undefined {
    if (this.implicitTokens.has(token)) {
      const binding = this.bindings.get(token);
      if (binding !== undefined) {
        return { binding, owner: this };
      }
    }
    return this.parent?.findImplicitWithOwner(token);
  }
}

export const container = new Container("root");
