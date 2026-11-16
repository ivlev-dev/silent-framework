import { describe, expect, it } from "vitest";
import {
  CircularDependencyError,
  Container,
  InvalidScopeError,
  createToken,
} from "../src/index.js";

const DISPOSE: symbol = (Symbol as unknown as { readonly dispose: symbol }).dispose;

const delay = (ms: number): Promise<void> => new Promise<void>((settle) => setTimeout(settle, ms));

const errorOf = async (promise: Promise<unknown>): Promise<unknown> =>
  promise.catch((error: unknown) => error);

describe("Captive dependency: singleton не захватывает scoped", () => {
  it("singleton, зависящий от scoped, отклоняется с InvalidScopeError", async () => {
    const root = new Container("app");
    const scoped = createToken<{ tenant: string }>("Tenant");
    const service = createToken<{ tenant: string }>("TenantService");

    root.bind(scoped, () => ({ tenant: "request" })).inScopedScope();
    root.bind(service, async (c: Container) => ({ tenant: (await c.resolve<{ tenant: string }>(scoped)).tenant }));

    const request = root.createScope("request:1");
    const error = await errorOf(request.resolve(service));

    expect(error).toBeInstanceOf(InvalidScopeError);
    const invalid = error as InvalidScopeError;
    expect(invalid.singletonToken).toBe(service);
    expect(invalid.scopedToken).toBe(scoped);
    expect(invalid.owner).toBe(root);
    expect(invalid.message).toContain("Invalid scope");
    expect(invalid.message).toContain("singleton");
    expect(invalid.message).toContain("scoped");
    expect(invalid.message).toContain("request scope");
    expect(root.peek(service)).toBeUndefined();
  });

  it("ошибка captive-зависимости поднимается через transient-цепочку", async () => {
    const root = new Container("app");
    const scoped = createToken<string>("Scoped");
    const transient = createToken<string>("Transient");
    const service = createToken<string>("Service");

    root.bind(scoped, () => "scoped").inScopedScope();
    root.bind(transient, async (c: Container) => `t:${await c.resolve<string>(scoped)}`).inTransientScope();
    root.bind(service, async (c: Container) => c.resolve(transient));

    const request = root.createScope("request:2");

    await expect(request.resolve(service)).rejects.toBeInstanceOf(InvalidScopeError);
  });

  it("singleton в том же контейнере, что и scoped, разрешается", async () => {
    const root = new Container("app");
    const scoped = createToken<{ id: number }>("Scoped");
    const service = createToken<{ id: number }>("ViewService");

    root.bind(scoped, () => ({ id: 1 })).inScopedScope();

    const view = root.createScope("view:App");
    view.bind(service, async (c: Container) => ({ id: (await c.resolve<{ id: number }>(scoped)).id }));

    const value = await view.resolve(service);

    expect(value).toEqual({ id: 1 });
    expect(view.peek(service)).toBe(value);
    expect(root.peek(service)).toBeUndefined();
  });

  it("singleton получает запрашивающий контейнер, а кешируется у владельца", async () => {
    const root = new Container("app");
    const token = createToken<{ origin: string }>("Origin");
    let calls = 0;

    root.bind(token, (c: Container) => {
      calls += 1;
      return { origin: c.name };
    });

    const first = root.createScope("request:a");
    const second = root.createScope("request:b");

    const fromFirst = await first.resolve<{ origin: string }>(token);
    const fromSecond = await second.resolve<{ origin: string }>(token);
    const fromRoot = await root.resolve<{ origin: string }>(token);

    expect(calls).toBe(1);
    expect(fromFirst.origin).toBe("request:a");
    expect(fromSecond).toBe(fromFirst);
    expect(fromRoot).toBe(fromFirst);
    expect(root.peek(token)).toBe(fromFirst);
  });

  it("незабинженный класс из singleton фабрики привязывается к владельцу singleton", async () => {
    const root = new Container("app");
    class Helper {
      readonly mark = "helper";
    }
    const service = createToken<{ helper: Helper }>("Service");

    root.bind(service, async (c: Container) => ({ helper: await c.resolve<Helper>(Helper) }));

    const request = root.createScope("request:c");
    const value = await request.resolve<{ helper: Helper }>(service);

    expect(value.helper).toBeInstanceOf(Helper);
    expect(root.has(Helper)).toBe(true);
    expect(root.resolveSync(Helper)).toBe(value.helper);
  });

  it("вложенный singleton с более долгим владельцем тоже не захватывает scoped", async () => {
    const root = new Container("app");
    const scoped = createToken<string>("Scoped");
    const inner = createToken<string>("RootService");
    const outer = createToken<string>("ViewService");

    root.bind(scoped, () => "scoped").inScopedScope();
    root.bind(inner, async (c: Container) => c.resolve(scoped));

    const view = root.createScope("view:App");
    view.bind(outer, async (c: Container) => c.resolve(inner));

    const error = await errorOf(view.resolve(outer));

    expect(error).toBeInstanceOf(InvalidScopeError);
    expect((error as InvalidScopeError).singletonToken).toBe(inner);
    expect((error as InvalidScopeError).owner).toBe(root);
  });

  it("singleton в том же контейнере получает сам контейнер без фасада", async () => {
    const root = new Container("app");
    const token = createToken<boolean>("identity");
    const scope = root.createScope("view");
    scope.bind(token, (c: Container) => c === scope);

    expect(await scope.resolve(token)).toBe(true);
  });

  it("параллельный resolve scoped в соседнем скоупе не считается captive", async () => {
    const root = new Container("app");
    const singleton = createToken<string>("SlowSingleton");
    const scoped = createToken<string>("Scoped");

    root.bind(singleton, async () => {
      await delay(10);
      return "singleton";
    });
    root.bind(scoped, () => "scoped").inScopedScope();

    const requestA = root.createScope("request:a");
    const requestB = root.createScope("request:b");

    const [singletonValue, scopedValue] = await Promise.all([
      requestA.resolve(singleton),
      requestB.resolve(scoped),
    ]);

    expect(singletonValue).toBe("singleton");
    expect(scopedValue).toBe("scoped");
  });
});

describe("Dispose: exception safety и Symbol.dispose", () => {
  it("dispose очищает состояние и вызывает детей даже при исключении в onDispose", async () => {
    const root = new Container("root");
    const token = createToken<string>("svc");
    root.bind(token, () => "svc");
    await root.resolve(token);

    const scope = root.createScope("child");
    let childHook = false;
    scope.onDispose(() => {
      childHook = true;
    });
    root.onDispose(() => {
      throw new Error("hook boom");
    });

    expect(() => root.dispose()).toThrow("hook boom");
    expect(childHook).toBe(true);
    expect(root.has(token)).toBe(false);
    expect(scope.has(token)).toBe(false);
    expect(root.peek(token)).toBeUndefined();
    expect(() => root.createScope("late")).toThrow("has been disposed");
  });

  it("несколько ошибок хуков собираются в AggregateError", () => {
    const root = new Container("root");
    root.onDispose(() => {
      throw new Error("first");
    });
    root.onDispose(() => {
      throw new Error("second");
    });

    let caught: unknown = null;
    try {
      root.dispose();
    } catch (error: unknown) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).errors).toHaveLength(2);
  });

  it("вызывает Symbol.dispose у разрешённых инстансов в порядке LIFO", async () => {
    const root = new Container("root");
    const order: string[] = [];
    const makeToken = (name: string) =>
      createToken<object>(name);

    const a = makeToken("a");
    const b = makeToken("b");
    const c = makeToken("c");

    for (const [token, name] of [
      [a, "a"],
      [b, "b"],
      [c, "c"],
    ] as const) {
      root.bind(token, () => ({
        [DISPOSE](): void {
          order.push(name);
        },
      })).inScopedScope();
    }

    const scope = root.createScope("request");
    await scope.resolve(a);
    await scope.resolve(b);
    await scope.resolve(c);

    scope.dispose();

    expect(order).toEqual(["c", "b", "a"]);
  });

  it("singleton с Symbol.dispose освобождается при dispose владельца", async () => {
    const root = new Container("root");
    let disposed = 0;
    const token = createToken<object>("resource");
    root.bind(token, () => ({
      [DISPOSE](): void {
        disposed += 1;
      },
    }));

    const scope = root.createScope("request");
    await scope.resolve(token);
    scope.dispose();

    expect(disposed).toBe(0);

    root.dispose();
    expect(disposed).toBe(1);
  });

  it("dispose родителя освобождает Symbol.dispose детей", async () => {
    const root = new Container("root");
    const order: string[] = [];
    const token = createToken<object>("child-resource");
    root.bind(token, () => ({
      [DISPOSE](): void {
        order.push("child");
      },
    })).inScopedScope();

    const scope = root.createScope("child");
    await scope.resolve(token);

    root.dispose();

    expect(order).toEqual(["child"]);
    expect(scope.peek(token)).toBeUndefined();
  });

  it("один инстанс под двумя токенами освобождается один раз", async () => {
    const root = new Container("root");
    let disposed = 0;
    const shared = {
      [DISPOSE](): void {
        disposed += 1;
      },
    };

    root.bind("a", shared);
    root.bind("b", shared);
    await root.resolve("a");
    await root.resolve("b");

    root.dispose();

    expect(disposed).toBe(1);
  });

  it("исключение в Symbol.dispose не мешает очистке и освобождению остальных", async () => {
    const root = new Container("root");
    const order: string[] = [];
    const bad = createToken<object>("bad");
    const good = createToken<object>("good");

    root.bind(bad, () => ({
      [DISPOSE](): void {
        order.push("bad");
        throw new Error("dispose boom");
      },
    }));
    root.bind(good, () => ({
      [DISPOSE](): void {
        order.push("good");
      },
    }));

    await root.resolve(bad);
    await root.resolve(good);

    expect(() => root.dispose()).toThrow("dispose boom");
    expect(order).toEqual(["good", "bad"]);
    expect(root.has(bad)).toBe(false);
    expect(root.peek(good)).toBeUndefined();
  });
});

describe("Асинхронный resolve и конкурентность", () => {
  it("resolve возвращает rejected Promise, а не бросает синхронно", () => {
    const root = new Container("root");

    let disposedPromise: Promise<unknown> | null = null;
    root.dispose();
    expect(() => {
      disposedPromise = root.resolve("token");
    }).not.toThrow();

    const fresh = new Container("fresh");
    let unknownPromise: Promise<unknown> | null = null;
    expect(() => {
      unknownPromise = fresh.resolve("missing");
    }).not.toThrow();

    return Promise.all([
      expect(disposedPromise).rejects.toThrow("has been disposed"),
      expect(unknownPromise).rejects.toThrow("no binding registered"),
    ]);
  });

  it("параллельные resolve singleton из разных скоупов делят один промис", async () => {
    const root = new Container("root");
    const token = createToken<{ id: number }>("shared");
    let calls = 0;

    root.bind(token, async () => {
      calls += 1;
      await delay(5);
      return { id: calls };
    });

    const scopes = [root.createScope("a"), root.createScope("b"), root.createScope("c")];
    const values = await Promise.all(scopes.map((scope) => scope.resolve(token)));

    expect(calls).toBe(1);
    expect(values[0]).toBe(values[1]);
    expect(values[1]).toBe(values[2]);
  });

  it("после captive-ошибки контейнер восстанавливается через rebind", async () => {
    const root = new Container("root");
    const scoped = createToken<string>("Scoped");
    const service = createToken<string>("Service");

    root.bind(scoped, () => "scoped").inScopedScope();
    root.bind(service, async (c: Container) => c.resolve(scoped));

    const request = root.createScope("request");
    await expect(request.resolve(service)).rejects.toBeInstanceOf(InvalidScopeError);
    expect(root.has(service)).toBe(true);

    root.bind(service, () => "safe");
    expect(await request.resolve(service)).toBe("safe");
  });

  it("цикл остаётся CircularDependencyError и не блокирует следующие resolve", async () => {
    const root = new Container("root");
    const a = createToken<unknown>("cycle-a");
    const b = createToken<unknown>("cycle-b");
    root.bind(a, (c: Container) => c.resolve(b));
    root.bind(b, (c: Container) => c.resolve(a));

    await expect(root.resolve(a)).rejects.toBeInstanceOf(CircularDependencyError);

    root.bind(a, () => "recovered");
    expect(await root.resolve(a)).toBe("recovered");
  });
});
