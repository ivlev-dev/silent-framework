import { describe, expect, it } from "vitest";
import { CircularDependencyError, Container, DI_CREATE, createToken } from "../src/index.js";

const errorOf = async (promise: Promise<unknown>): Promise<unknown> =>
  promise.catch((error: unknown) => error);

describe("Явный bind реализации интерфейса", () => {
  interface LoggerApi {
    readonly tag: string;
  }

  class ConsoleLogger implements LoggerApi {
    readonly tag = "console";
  }

  it("singleton: интерфейсный токен отдаёт один экземпляр класса", async () => {
    const root = new Container("root");
    const logger = createToken<LoggerApi>("Logger");
    root.bind<LoggerApi>(logger, ConsoleLogger);

    const scope = root.createScope("s");
    const fromScope = await scope.resolve<LoggerApi>(logger);
    const fromRoot = await root.resolve<LoggerApi>(logger);

    expect(fromScope).toBeInstanceOf(ConsoleLogger);
    expect(fromScope).toBe(fromRoot);
    expect(root.peek<LoggerApi>(logger)).toBe(fromRoot);
  });

  it("scoped: каждый скоуп получает свой экземпляр класса", async () => {
    const root = new Container("root");
    const logger = createToken<LoggerApi>("Logger");
    root.bind<LoggerApi>(logger, ConsoleLogger).inScopedScope();

    const s1 = root.createScope("s1");
    const s2 = root.createScope("s2");

    const a1 = await s1.resolve<LoggerApi>(logger);
    const a2 = await s1.resolve<LoggerApi>(logger);
    const b1 = await s2.resolve<LoggerApi>(logger);
    const rootValue = await root.resolve<LoggerApi>(logger);

    expect(a1).toBeInstanceOf(ConsoleLogger);
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b1);
    expect(a1).not.toBe(rootValue);
    expect(s1.peek<LoggerApi>(logger)).toBe(a1);
  });

  it("transient: каждый resolve создаёт экземпляр класса", async () => {
    const root = new Container("root");
    const logger = createToken<LoggerApi>("Logger");
    root.bind<LoggerApi>(logger, ConsoleLogger).inTransientScope();

    const a = await root.resolve<LoggerApi>(logger);
    const b = await root.resolve<LoggerApi>(logger);

    expect(a).toBeInstanceOf(ConsoleLogger);
    expect(a).not.toBe(b);
    expect(root.peek<LoggerApi>(logger)).toBeUndefined();
  });
});

describe("Явный bind против fallback", () => {
  it("явный bind выбирает одну реализацию среди нескольких классов", async () => {
    interface Store {
      readonly kind: string;
    }

    class MemoryStore implements Store {
      readonly kind = "memory";
    }

    class DiskStore implements Store {
      readonly kind = "disk";
    }

    const root = new Container("root");
    const store = createToken<Store>("Store");
    root.bind<Store>(store, MemoryStore);

    const instance = await root.resolve<Store>(store);

    expect(instance).toBeInstanceOf(MemoryStore);
    expect(instance).not.toBeInstanceOf(DiskStore);
    expect(instance.kind).toBe("memory");
  });

  it("явный bind на корне переопределяет fallback из дочернего скоупа", async () => {
    class Original {
      readonly kind = "original";
    }

    class Replacement {
      readonly kind = "replacement";
    }

    const root = new Container("root");
    const scope = root.createScope("s");

    const first = await scope.resolve<Original>(Original);
    expect(first).toBeInstanceOf(Original);
    expect(scope.has(Original)).toBe(true);

    root.bind(Original, Replacement);
    const second = await scope.resolve<unknown>(Original);
    if (!(second instanceof Replacement)) {
      throw new Error("ожидался Replacement");
    }

    expect(second.kind).toBe("replacement");
    expect(await scope.resolve<Original>(Original)).toBe(second);
  });
});

describe("Конструкторы и class expression", () => {
  it("класс без конструктора создаётся fallback-фабрикой", async () => {
    class NoConstructor {
      readonly value = 1;
    }

    const root = new Container("root");
    const instance = await root.resolve<NoConstructor>(NoConstructor);

    expect(instance).toBeInstanceOf(NoConstructor);
    expect(instance.value).toBe(1);
  });

  it("класс с конструктором без зависимостей создаётся fallback-фабрикой", async () => {
    class EmptyConstructor {
      readonly initialized: boolean;

      constructor() {
        this.initialized = true;
      }
    }

    const root = new Container("root");
    const instance = await root.resolve<EmptyConstructor>(EmptyConstructor);

    expect(instance).toBeInstanceOf(EmptyConstructor);
    expect(instance.initialized).toBe(true);
  });

  it("анонимный и именованный class expression создаются через new", async () => {
    const Anonymous = class {
      readonly kind = "anonymous";
    };
    const Named = class NamedImpl {
      readonly kind = "named";
    };

    const root = new Container("root");
    root.bind(Anonymous, Anonymous);
    root.bind(Named, Named);

    const anonymous = await root.resolve<InstanceType<typeof Anonymous>>(Anonymous);
    const named = await root.resolve<InstanceType<typeof Named>>(Named);

    expect(anonymous).toBeInstanceOf(Anonymous);
    expect(anonymous.kind).toBe("anonymous");
    expect(named).toBeInstanceOf(Named);
    expect(named.kind).toBe("named");
  });

  it("DI_CREATE на class expression вызывается при bind", async () => {
    const root = new Container("root");
    const Prepared = class PreparedImpl {
      readonly origin: string;

      constructor(origin: string) {
        this.origin = origin;
      }

      static [DI_CREATE](container: Container): PreparedImpl {
        return new PreparedImpl(container.name);
      }
    };

    root.bind(Prepared, Prepared);
    const instance = await root.resolve<InstanceType<typeof Prepared>>(Prepared);

    expect(instance).toBeInstanceOf(Prepared);
    expect(instance.origin).toBe("root");
  });
});

describe("Наследуемый конструктор", () => {
  it("наследуемый конструктор без аргументов работает через fallback", async () => {
    class Base {
      readonly kind = "base";
    }

    class Derived extends Base {}

    const root = new Container("root");
    const instance = await root.resolve<Derived>(Derived);

    expect(instance).toBeInstanceOf(Derived);
    expect(instance.kind).toBe("base");
  });

  it("наследуемый конструктор с необязательным аргументом получает undefined", async () => {
    class Base {
      constructor(readonly value?: string) {}
    }

    class Derived extends Base {}

    const root = new Container("root");
    const instance = await root.resolve<Derived>(Derived);

    expect(instance).toBeInstanceOf(Derived);
    expect(instance.value).toBeUndefined();
  });

  it("наследуемый конструктор с обязательным аргументом падает без аргументов", async () => {
    class Base {
      readonly value: string;

      constructor(value: string) {
        if (value === undefined) {
          throw new Error("value is required");
        }
        this.value = value;
      }
    }

    class Derived extends Base {}

    const root = new Container("root");
    const error = await errorOf(root.resolve<Derived>(Derived));

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("value is required");
    expect(root.peek(Derived)).toBeUndefined();
  });

  it("унаследованный DI_CREATE вызывается с конструктором наследника", async () => {
    class Base {
      readonly kind: string;

      constructor(kind: string) {
        this.kind = kind;
      }

      static [DI_CREATE](this: typeof Base, container: Container): Base {
        return new this(container.name);
      }
    }

    class Derived extends Base {}

    const root = new Container("root");
    const instance = await root.resolve<Derived>(Derived);

    expect(instance).toBeInstanceOf(Derived);
    expect(instance.kind).toBe("root");
  });
});

describe("Generic-классы", () => {
  it("generic-класс не ломает контейнер и fallback", async () => {
    class Box<T> {
      readonly items: T[] = [];
    }

    const root = new Container("root");
    const instance = await root.resolve<Box<number>>(Box);

    expect(instance).toBeInstanceOf(Box);
    expect(instance.items).toEqual([]);
  });

  it("фабрика для generic-класса резолвится по токену", async () => {
    class Box<T> {
      readonly items: T[] = [];
    }

    const root = new Container("root");
    const token = createToken<Box<string>>("Box<string>");
    root.bind<Box<string>>(token, () => new Box<string>());

    const instance = await root.resolve<Box<string>>(token);
    instance.items.push("value");

    expect(instance.items).toEqual(["value"]);
  });
});

describe("Ошибки factory", () => {
  it("синхронная ошибка очищает кеш и повторный resolve ретраит", async () => {
    const root = new Container("root");
    const token = createToken<string>("sync-error");
    let calls = 0;

    root.bind(token, () => {
      calls += 1;
      if (calls === 1) {
        throw new Error("sync boom");
      }
      return "recovered";
    });

    const error = await errorOf(root.resolve(token));

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("sync boom");
    expect(root.peek(token)).toBeUndefined();
    expect(await root.resolve(token)).toBe("recovered");
    expect(calls).toBe(2);
  });

  it("асинхронная ошибка очищает кеш и повторный resolve ретраит", async () => {
    const root = new Container("root");
    const token = createToken<string>("async-error");
    let calls = 0;

    root.bind(token, async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error("async boom");
      }
      return "recovered";
    });

    const error = await errorOf(root.resolve(token));

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("async boom");
    expect(root.peek(token)).toBeUndefined();
    expect(await root.resolve(token)).toBe("recovered");
    expect(calls).toBe(2);
  });
});

describe("Циклы в разных scope", () => {
  it("цикл в scoped-зависимостях сообщает путь", async () => {
    const root = new Container("root");
    const scope = root.createScope("s");
    const a = createToken<unknown>("scoped-a");
    const b = createToken<unknown>("scoped-b");

    root.bind(a, (c: Container) => c.resolve(b)).inScopedScope();
    root.bind(b, (c: Container) => c.resolve(a)).inScopedScope();

    const error = await errorOf(scope.resolve(a));

    expect(error).toBeInstanceOf(CircularDependencyError);
    expect((error as CircularDependencyError).path).toEqual([a, b]);
  });

  it("цикл в transient-зависимостях сообщает путь", async () => {
    const root = new Container("root");
    const a = createToken<unknown>("transient-a");
    const b = createToken<unknown>("transient-b");

    root.bind(a, (c: Container) => c.resolve(b)).inTransientScope();
    root.bind(b, (c: Container) => c.resolve(a)).inTransientScope();

    const error = await errorOf(root.resolve(a));

    expect(error).toBeInstanceOf(CircularDependencyError);
    expect((error as CircularDependencyError).path).toEqual([a, b]);
  });

  it("self-cycle в transient-зависимости сообщает путь", async () => {
    const root = new Container("root");
    const a = createToken<unknown>("transient-self");

    root.bind(a, (c: Container) => c.resolve(a)).inTransientScope();

    const error = await errorOf(root.resolve(a));

    expect(error).toBeInstanceOf(CircularDependencyError);
    expect((error as CircularDependencyError).path).toEqual([a]);
  });

  it("после цикла контейнер восстанавливается через rebind", async () => {
    const root = new Container("root");
    const a = createToken<unknown>("cycle-recover-a");
    const b = createToken<unknown>("cycle-recover-b");

    root.bind(a, (c: Container) => c.resolve(b)).inScopedScope();
    root.bind(b, (c: Container) => c.resolve(a)).inScopedScope();
    await errorOf(root.resolve(a));

    root.bind(a, () => "fixed").inScopedScope();

    expect(await root.resolve(a)).toBe("fixed");
  });
});

describe("dispose", () => {
  it("хуки выполняются в порядке регистрации: родитель до детей", () => {
    const root = new Container("root");
    const order: string[] = [];

    root.onDispose(() => order.push("root-1"));
    root.onDispose(() => order.push("root-2"));

    const child = root.createScope("child");
    child.onDispose(() => order.push("child-1"));

    const grandchild = child.createScope("grandchild");
    grandchild.onDispose(() => order.push("grandchild-1"));

    root.dispose();

    expect(order).toEqual(["root-1", "root-2", "child-1", "grandchild-1"]);
  });

  it("повторный dispose не выполняет хуки снова", () => {
    const root = new Container("root");
    let calls = 0;

    root.onDispose(() => {
      calls += 1;
    });

    root.dispose();
    root.dispose();

    expect(calls).toBe(1);
  });

  it("dispose родителя очищает кеш и bindings детей", async () => {
    const root = new Container("root");
    const token = createToken<{ id: number }>("scoped-dispose");
    let calls = 0;

    root.bind(token, () => {
      calls += 1;
      return { id: calls };
    }).inScopedScope();

    const child = root.createScope("child");
    const instance = await child.resolve(token);

    expect(child.peek(token)).toBe(instance);

    root.dispose();

    expect(child.peek(token)).toBeUndefined();
    expect(root.peek(token)).toBeUndefined();
    expect(child.has(token)).toBe(false);
  });

  it("resolve после dispose родителя выбрасывает понятную ошибку", () => {
    const root = new Container("root");
    const token = createToken<string>("after-dispose");
    root.bind(token, () => "value");

    root.dispose();

    expect(() => root.resolve(token)).toThrow('Container "root" has been disposed');
  });

  it("resolve класса после dispose не создаёт fallback-экземпляр", () => {
    const root = new Container("root");

    class Service {
      readonly ok = true;
    }

    root.dispose();

    expect(() => root.resolve(Service)).toThrow('Container "root" has been disposed');
  });

  it("resolve после dispose скоупа не затрагивает родителя", async () => {
    const root = new Container("root");
    const token = createToken<string>("child-dispose");
    root.bind(token, () => "alive");

    const child = root.createScope("child");
    child.dispose();

    expect(() => child.resolve(token)).toThrow('Container "child" has been disposed');
    expect(await root.resolve(token)).toBe("alive");
  });
});

describe("peek", () => {
  it("singleton возвращает значение после resolve", async () => {
    const root = new Container("root");
    const token = createToken<string>("singleton-peek");
    root.bind(token, () => "value");

    expect(root.peek(token)).toBeUndefined();
    const value = await root.resolve(token);

    expect(root.peek(token)).toBe(value);
  });

  it("transient не оставляет значение после resolve", async () => {
    const root = new Container("root");
    const token = createToken<string>("transient-peek");
    root.bind(token, () => "value").inTransientScope();

    await root.resolve(token);

    expect(root.peek(token)).toBeUndefined();
  });

  it("после ошибки peek возвращает undefined", async () => {
    const root = new Container("root");
    const token = createToken<string>("error-peek");
    root.bind(token, () => {
      throw new Error("boom");
    });

    await errorOf(root.resolve(token));

    expect(root.peek(token)).toBeUndefined();
  });
});

describe("Незавершённые resolve и rebind", () => {
  it("старый успешный resolve не перезаписывает resolved нового биндинга", async () => {
    const root = new Container("root");
    const token = createToken<string>("inflight-success");
    let releaseFirst: (value: string) => void = () => undefined;
    const gate = new Promise<string>((resolveGate) => {
      releaseFirst = resolveGate;
    });

    root.bind(token, () => gate);
    const first = root.resolve(token);

    root.bind(token, () => "second");
    const second = await root.resolve(token);

    releaseFirst("first");

    expect(await first).toBe("first");
    expect(second).toBe("second");
    expect(await root.resolve(token)).toBe("second");
    expect(root.peek<string>(token)).toBe("second");
  });

  it("ошибка старого resolve не удаляет кеш нового биндинга", async () => {
    const root = new Container("root");
    const token = createToken<string>("inflight-error");
    let rejectFirst: (reason: Error) => void = () => undefined;
    const gate = new Promise<string>((_resolveGate, rejectGate) => {
      rejectFirst = rejectGate;
    });

    root.bind(token, () => gate);
    const firstError = errorOf(root.resolve(token));

    let calls = 0;
    root.bind(token, () => {
      calls += 1;
      return "second";
    });

    expect(await root.resolve(token)).toBe("second");
    expect(calls).toBe(1);

    rejectFirst(new Error("stale"));
    expect(await firstError).toBeInstanceOf(Error);

    expect(await root.resolve(token)).toBe("second");
    expect(calls).toBe(1);
    expect(root.peek<string>(token)).toBe("second");
  });
});

describe("BindingBuilder", () => {
  it("смена scope после bind сбрасывает singleton-кеш", async () => {
    const root = new Container("root");
    const token = createToken<{ id: number }>("builder-singleton-to-transient");
    let calls = 0;

    const builder = root.bind(token, () => {
      calls += 1;
      return { id: calls };
    });

    const first = await root.resolve(token);
    expect(root.peek(token)).toBe(first);

    builder.inTransientScope();

    expect(root.peek(token)).toBeUndefined();
    const second = await root.resolve(token);
    const third = await root.resolve(token);

    expect(second).not.toBe(first);
    expect(third).not.toBe(second);
    expect(calls).toBe(3);
  });

  it("смена scope с transient на singleton начинает кешировать", async () => {
    const root = new Container("root");
    const token = createToken<{ id: number }>("builder-transient-to-singleton");
    let calls = 0;

    const builder = root.bind(token, () => {
      calls += 1;
      return { id: calls };
    }).inTransientScope();

    const first = await root.resolve(token);
    const second = await root.resolve(token);
    expect(first).not.toBe(second);

    builder.inSingletonScope();
    const third = await root.resolve(token);
    const fourth = await root.resolve(token);

    expect(third).toBe(fourth);
    expect(third).not.toBe(second);
    expect(root.peek(token)).toBe(third);
  });

  it("повторный bind очищает кеш во всех дочерних скоупах", async () => {
    const root = new Container("root");
    const token = createToken<{ version: number }>("builder-rebind-children");

    root.bind(token, () => ({ version: 1 }));

    const s1 = root.createScope("s1");
    const s2 = root.createScope("s2");
    const first1 = await s1.resolve<{ version: number }>(token);
    const first2 = await s2.resolve<{ version: number }>(token);

    root.bind(token, () => ({ version: 2 }));
    const second1 = await s1.resolve<{ version: number }>(token);
    const second2 = await s2.resolve<{ version: number }>(token);

    expect(first1.version).toBe(1);
    expect(first2.version).toBe(1);
    expect(second1).toEqual({ version: 2 });
    expect(second2).toEqual({ version: 2 });
    expect(second1).not.toBe(first1);
    expect(second2).not.toBe(first2);
  });
});
