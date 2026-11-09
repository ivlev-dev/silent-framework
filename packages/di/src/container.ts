import { DI_CREATE } from "./token.js";
import type { Binding, BindingBuilder, Factory, ScopeName } from "./types.js";

type FunctionValue = (...args: unknown[]) => unknown;
type ConstructorValue = new (...args: never[]) => unknown;
type CreateAware = { readonly [DI_CREATE]?: (container: Container) => unknown };

export class CircularDependencyError extends Error {
  readonly path: unknown[];

  constructor(path: readonly unknown[]) {
    super(`Circular dependency detected: ${path.map(String).join(" -> ")}`);
    this.name = "CircularDependencyError";
    this.path = [...path];
  }
}

function isFunctionValue(value: unknown): value is FunctionValue {
  return typeof value === "function";
}

function isClassSource(fn: FunctionValue): boolean {
  return /^class\b/.test(fn.toString().trim());
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

export class Container {
  readonly name: string;

  private parent?: Container;
  private children = new Set<Container>();
  private bindings = new Map<unknown, Binding<unknown>>();
  private implicitTokens = new Set<unknown>();
  private cache = new Map<unknown, Promise<unknown>>();
  private resolved = new Map<unknown, unknown>();
  private resolving = new Map<unknown, unknown>();
  private disposeHooks: Array<() => void> = [];
  private disposed = false;

  constructor(name = "root", parent?: Container) {
    this.name = name;
    if (parent !== undefined) {
      this.parent = parent;
    }
  }

  bind<T = unknown>(token: unknown, factory?: unknown): BindingBuilder {
    const binding: Binding<unknown> = {
      factory: toFactory(factory),
      scope: "singleton",
    };
    this.bindings.set(token, binding);
    this.implicitTokens.delete(token);
    this.clearCache(token);

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

  createScope(name = `scope:${Math.random()}`): Container {
    const scope = new Container(name, this);
    this.children.add(scope);
    return scope;
  }

  resolve<T = unknown>(token: unknown): Promise<T> {
    if (this.disposed) {
      throw new Error(`Container "${this.name}" has been disposed`);
    }

    if (token === undefined) {
      throw new Error("Async DI: resolve<T>() must be transformed by silentwire before runtime");
    }

    const found = this.findBindingWithOwner(token);

    if (found === undefined && isFunctionValue(token)) {
      this.bindings.set(token, {
        factory: toFallbackFactory(token),
        scope: "singleton",
      });
      this.implicitTokens.add(token);
      return this.resolve<T>(token);
    }

    if (found === undefined) {
      throw new Error(`Async DI: no binding registered for token ${String(token)}`);
    }

    const { binding, owner } = found;
    const cacheContainer = binding.scope === "singleton" ? owner : this;

    const cached = cacheContainer.cache.get(token);
    if (cached !== undefined) {
      return cached as Promise<T>;
    }

    if (cacheContainer.resolving.has(token)) {
      throw new CircularDependencyError([...cacheContainer.resolving.keys()]);
    }

    const marker: object = {};
    cacheContainer.resolving.set(token, marker);

    const instantiate = async (): Promise<unknown> => {
      try {
        return await binding.factory(cacheContainer);
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

    const hooks = [...this.disposeHooks];
    this.disposeHooks.length = 0;
    for (const hook of hooks) {
      hook();
    }
    this.clearCache();
    this.bindings.clear();
    this.implicitTokens.clear();
    const children = [...this.children];
    for (const child of children) {
      child.dispose();
    }
    this.children.clear();
    this.parent?.children.delete(this);
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
