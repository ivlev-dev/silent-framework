import { describe, expect, it } from "vitest";
import { CircularDependencyError, Container, DI_CREATE, createToken, container } from "../src/index.js";
import type { Token } from "../src/index.js";

const delay = (ms: number): Promise<void> => new Promise<void>((settle) => setTimeout(settle, ms));

describe("Области видимости", () => {
  it("синглтон кешируется в контейнере-владельце и общий между скоупами", async () => {
    const root = new Container("root");
    const token = createToken<{ id: number }>("shared");
    let calls = 0;
    root.bind(token, async () => {
      calls += 1;
      return { id: calls };
    });

    const s1 = root.createScope("s1");
    const s2 = root.createScope("s2");

    const a = await s1.resolve(token);
    const b = await s2.resolve(token);
    const c = await root.resolve(token);

    expect(calls).toBe(1);
    expect(a).toBe(b);
    expect(a).toBe(c);
    expect(root.peek<{ id: number }>(token)).toBe(a);
    expect(s1.peek<{ id: number }>(token)).toBe(a);
  });

  it("scoped живёт в контейнере, с которого начался resolve", async () => {
    const root = new Container("root");
    const token = createToken<{ id: number }>("Scoped");
    let calls = 0;
    root.bind(token, () => {
      calls += 1;
      return { id: calls };
    }).inScopedScope();

    const s1 = root.createScope("s1");
    const s2 = root.createScope("s2");

    const a1 = await s1.resolve(token);
    const a2 = await s1.resolve(token);
    const b1 = await s2.resolve(token);
    const r1 = await root.resolve(token);

    expect(calls).toBe(3);
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b1);
    expect(a1).not.toBe(r1);
    expect(s1.peek<{ id: number }>(token)).toBe(a1);
    expect(root.peek<{ id: number }>(token)).toBe(r1);
  });

  it("transient не переиспользуется после успешного resolve", async () => {
    const root = new Container("root");
    const token = createToken<{ id: number }>("transient");
    let calls = 0;
    root.bind(token, () => {
      calls += 1;
      return { id: calls };
    }).inTransientScope();

    const a = await root.resolve(token);
    const b = await root.resolve(token);

    expect(calls).toBe(2);
    expect(a).not.toBe(b);
    expect(root.peek<{ id: number }>(token)).toBeUndefined();
  });

  it("зависимости резолвятся через factory с передачей контейнера", async () => {
    const root = new Container("root");
    const name = createToken<string>("Name");
    const user = createToken<{ name: string }>("User");
    root.bind(name, () => "ann");
    root.bind(user, (c: Container) => c.resolve<string>(name).then((value) => ({ name: value })));

    expect(await root.resolve(user)).toEqual({ name: "ann" });
  });
});

describe("Конкурентность и кеш", () => {
  it("параллельные resolve одного токена получают один промис", async () => {
    const root = new Container("root");
    const token = createToken<string>("slow");
    let calls = 0;
    root.bind(token, async () => {
      calls += 1;
      await delay(10);
      return "done";
    });

    const [a, b] = await Promise.all([root.resolve(token), root.resolve(token)]);

    expect(calls).toBe(1);
    expect(a).toBe(b);
    expect(a).toBe("done");
  });

  it("транзиент при параллельном резолве делит один промис", async () => {
    const root = new Container("root");
    const token = createToken<{ id: number }>("parallel-transient");
    let calls = 0;
    root.bind(token, async () => {
      calls += 1;
      await delay(5);
      return { id: calls };
    }).inTransientScope();

    const [a, b] = await Promise.all([root.resolve(token), root.resolve(token)]);

    expect(calls).toBe(1);
    expect(a).toBe(b);

    const c = await root.resolve(token);
    expect(calls).toBe(2);
    expect(c).not.toBe(a);
  });

  it("ошибка factory очищает кеш, следующий resolve повторяет попытку", async () => {
    const root = new Container("root");
    const token = createToken<string>("flaky");
    let calls = 0;
    root.bind(token, async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error("boom");
      }
      return "recovered";
    });

    await expect(root.resolve(token)).rejects.toThrow("boom");
    expect(await root.resolve(token)).toBe("recovered");
    expect(calls).toBe(2);
    expect(root.peek<string>(token)).toBe("recovered");
  });
});

describe("Циклы", () => {
  it("взаимный цикл выбрасывает CircularDependencyError с путём", async () => {
    const root = new Container("root");
    const a = createToken<unknown>("cycle-a");
    const b = createToken<unknown>("cycle-b");
    root.bind(a, (c: Container) => c.resolve(b));
    root.bind(b, (c: Container) => c.resolve(a));

    const error: unknown = await root.resolve(a).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CircularDependencyError);
    expect((error as CircularDependencyError).path).toEqual([a, b]);
    expect((error as Error).message).toContain("Circular dependency detected");

    root.bind(a, () => "pure");
    expect(await root.resolve(a)).toBe("pure");
  });

  it("самозацикленный токен выбрасывает CircularDependencyError", async () => {
    const root = new Container("root");
    const a = createToken<unknown>("self-cycle");
    root.bind(a, (c: Container) => c.resolve(a));

    const error: unknown = await root.resolve(a).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CircularDependencyError);
    expect((error as CircularDependencyError).path).toEqual([a]);
  });
});

describe("rebind и clearCache", () => {
  it("повторный bind заменяет factory и очищает кеш в потомках", async () => {
    const root = new Container("root");
    const token = createToken<string>("config");
    root.bind(token, () => "first");

    const scope = root.createScope("s");
    expect(await scope.resolve(token)).toBe("first");

    root.bind(token, () => "second");
    expect(await root.resolve(token)).toBe("second");
    expect(await scope.resolve(token)).toBe("second");
  });

  it("rebind в скоупе очищает кеш скоупа", async () => {
    const root = new Container("root");
    const token = createToken<{ v: number }>("scoped-rebind");
    root.bind(token, () => ({ v: 1 })).inScopedScope();

    const scope = root.createScope("s");
    const first = await scope.resolve(token);

    root.bind(token, () => ({ v: 2 })).inScopedScope();
    const second = await scope.resolve(token);

    expect(first).not.toBe(second);
    expect(second).toEqual({ v: 2 });
  });

  it("clearCache для токена сбрасывает resolved-значение", async () => {
    const root = new Container("root");
    const token = createToken<string>("cacheable");
    let calls = 0;
    root.bind(token, () => {
      calls += 1;
      return "value";
    });

    await root.resolve(token);
    expect(calls).toBe(1);

    root.clearCache(token);
    expect(root.peek<string>(token)).toBeUndefined();
    await root.resolve(token);
    expect(calls).toBe(2);
  });
});

describe("dispose и onDispose", () => {
  it("dispose вызывает хуки корня и детей и очищает состояние", async () => {
    const root = new Container("root");
    const token = createToken<string>("svc");
    root.bind(token, () => "svc");
    await root.resolve(token);

    const hooks: string[] = [];
    root.onDispose(() => hooks.push("root"));
    const child = root.createScope("child");
    child.onDispose(() => hooks.push("child"));

    root.dispose();

    expect(hooks).toEqual(["root", "child"]);
    expect(root.peek<string>(token)).toBeUndefined();
    expect(root.has(token)).toBe(false);
    expect(child.has(token)).toBe(false);
    expect(() => child.resolve(token)).toThrow("has been disposed");
  });

  it("повторный dispose не вызывает хуки", async () => {
    const root = new Container("root");
    const hooks: string[] = [];
    root.onDispose(() => hooks.push("hook"));

    root.dispose();
    root.dispose();

    expect(hooks).toEqual(["hook"]);
  });

  it("dispose скоупа не затрагивает родителя", async () => {
    const root = new Container("root");
    const token = createToken<string>("flow");
    root.bind(token, () => "flow");

    const scope = root.createScope("s");
    scope.dispose();

    expect(await root.resolve(token)).toBe("flow");
    expect(root.has(token)).toBe(true);
  });
});

describe("peek и has", () => {
  it("peek возвращает разрешённое значение без запуска factory", async () => {
    const root = new Container("root");
    const token = createToken<number>("lazy");
    let calls = 0;
    root.bind(token, async () => {
      calls += 1;
      return 42;
    });

    expect(root.peek<number>(token)).toBeUndefined();
    expect(calls).toBe(0);

    expect(await root.resolve(token)).toBe(42);
    expect(calls).toBe(1);
    expect(root.peek<number>(token)).toBe(42);
    expect(calls).toBe(1);
  });

  it("has учитывает parent", () => {
    const root = new Container("root");
    const token = createToken<number>("bound");
    root.bind(token, () => 1);

    const child = root.createScope("c");
    expect(root.has(token)).toBe(true);
    expect(child.has(token)).toBe(true);
    expect(child.has(createToken<number>("missing"))).toBe(false);
    expect(child.has("plain-string")).toBe(false);
  });
});

describe("Токены и DI_CREATE", () => {
  it("createToken создаёт уникальные именованные символы", () => {
    const a: Token<number> = createToken<number>("num");
    const b = createToken<number>("num");

    expect(typeof a).toBe("symbol");
    expect(a.description).toBe("num");
    expect(a).not.toBe(b);
  });

  it("DI_CREATE равен Symbol.for(silent.di.create)", () => {
    expect(DI_CREATE).toBe(Symbol.for("silent.di.create"));
    expect(DI_CREATE).not.toBe(Symbol.for("silentwire:create"));
  });

  it("класс-factory создаётся через new, function-factory вызывается", async () => {
    const root = new Container("root");
    const token = createToken<{ kind: string }>("mixed");

    class Impl {
      readonly kind = "class";
    }
    root.bind(Impl, Impl);
    expect((await root.resolve<Impl>(Impl)).kind).toBe("class");

    root.bind(token, (c: Container) => ({ kind: `fn:${c.name}` }));
    expect(await root.resolve(token)).toEqual({ kind: "fn:root" });
  });

  it("класс со статическим [DI_CREATE] создаётся через него при bind", async () => {
    const root = new Container("root");

    class Prepared {
      readonly source: string;
      constructor(source: string) {
        this.source = source;
      }
      static [DI_CREATE](from: Container): Prepared {
        return new Prepared(from.name);
      }
    }

    root.bind(Prepared, Prepared);
    const instance = await root.resolve<Prepared>(Prepared);

    expect(instance.source).toBe("root");
    expect(await root.resolve(Prepared)).toBe(instance);
  });
});

describe("Fallback", () => {
  it("незабинженный класс резолвится как синглтон", async () => {
    const root = new Container("root");
    let nextId = 0;

    class Repo {
      readonly id: number;
      constructor() {
        nextId += 1;
        this.id = nextId;
      }
    }

    const a = await root.resolve<Repo>(Repo);
    const b = await root.resolve<Repo>(Repo);

    expect(a).toBeInstanceOf(Repo);
    expect(a).toBe(b);
    expect(root.has(Repo)).toBe(true);
  });

  it("незабинженный класс с [DI_CREATE] резолвится через DI_CREATE", async () => {
    const root = new Container("root");
    const scope = root.createScope("worker");

    class Handler {
      readonly origin: string;
      constructor(origin: string) {
        this.origin = origin;
      }
      static [DI_CREATE](from: Container): Handler {
        return new Handler(from.name);
      }
    }

    const instance = await scope.resolve<Handler>(Handler);

    expect(instance.origin).toBe("worker");
    expect(await scope.resolve(Handler)).toBe(instance);
  });
});

describe("Граничные случаи", () => {
  it("resolve(undefined) выбрасывает ошибку", () => {
    const root = new Container("root");
    expect(() => root.resolve(undefined)).toThrow("must be transformed by silentwire before runtime");
  });

  it("неизвестный токен выбрасывает ошибку no binding", () => {
    const root = new Container("root");
    expect(() => root.resolve("unknown")).toThrow("no binding registered");
    expect(() => root.resolve(createToken<unknown>("unbound"))).toThrow("no binding registered");
  });

  it("bind без factory резолвится в undefined", async () => {
    const root = new Container("root");
    const token = createToken<undefined>("empty");
    root.bind(token);
    expect(await root.resolve(token)).toBeUndefined();
    expect(root.peek(token)).toBeUndefined();
  });

  it("константный bind возвращает значение", async () => {
    const root = new Container("root");
    root.bind("answer", 42);
    root.bind("none", null);
    expect(await root.resolve<number>("answer")).toBe(42);
    expect(await root.resolve<null>("none")).toBeNull();
    expect(root.peek<number>("answer")).toBe(42);
  });

  it("повторный bind константы очищает кеш", async () => {
    const root = new Container("root");
    root.bind("v", 1);
    expect(await root.resolve<number>("v")).toBe(1);
    root.bind("v", 2);
    expect(await root.resolve<number>("v")).toBe(2);
  });

  it("BindingBuilder цепляется и меняет scope", async () => {
    const root = new Container("root");
    const token = createToken<string>("chain");
    const builder = root.bind(token, () => "x");
    expect(builder.inTransientScope()).toBe(builder);
    expect(builder.inScopedScope()).toBe(builder);
    expect(builder.inSingletonScope()).toBe(builder);

    const a = await root.resolve(token);
    const b = await root.resolve(token);
    expect(a).toBe(b);
  });

  it("глобальный container — корневой экземпляр", () => {
    expect(container.name).toBe("root");
    const scope = container.createScope();
    expect(scope).toBeInstanceOf(Container);
    expect(scope.name).toMatch(/^scope:/);
  });
});
