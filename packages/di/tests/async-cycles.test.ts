import { describe, expect, it } from "vitest";
import { CircularDependencyError, Container, createToken } from "../src/index.js";

const CYCLE_TIMEOUT_MS = 50;

const errorOf = async (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => null,
    (error: unknown) => error,
  );

const withTimeout = async <T>(promise: Promise<T>, ms = CYCLE_TIMEOUT_MS): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`resolve не завершился за ${ms} мс: вероятен дедлок async-цикла`));
        }, ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
};

const cycleErrorOf = async (promise: Promise<unknown>): Promise<unknown> =>
  withTimeout(errorOf(promise));

describe("Async-циклы", () => {
  it("взаимный async-цикл отклоняется CircularDependencyError с путём", async () => {
    const root = new Container("root");
    const a = createToken<string>("async-a");
    const b = createToken<string>("async-b");

    root.bind(a, async (c: Container) => {
      await Promise.resolve();
      return `a:${await c.resolve<string>(b)}`;
    });
    root.bind(b, async (c: Container) => {
      await Promise.resolve();
      return `b:${await c.resolve<string>(a)}`;
    });

    const error = await cycleErrorOf(root.resolve(a));

    expect(error).toBeInstanceOf(CircularDependencyError);
    expect((error as CircularDependencyError).path).toEqual([a, b, a]);
    expect(root.snapshot().resolving).toBe(0);
    expect(root.peek(a)).toBeUndefined();
  });

  it("self-cycle после await отклоняется CircularDependencyError", async () => {
    const root = new Container("root");
    const a = createToken<string>("async-self");

    root.bind(a, async (c: Container) => {
      await Promise.resolve();
      return c.resolve<string>(a);
    });

    const error = await cycleErrorOf(root.resolve(a));

    expect(error).toBeInstanceOf(CircularDependencyError);
    expect((error as CircularDependencyError).path).toEqual([a, a]);
    expect(root.snapshot().resolving).toBe(0);
  });

  it("async-цикл в transient-зависимостях отклоняется с путём", async () => {
    const root = new Container("root");
    const a = createToken<string>("async-transient-a");
    const b = createToken<string>("async-transient-b");

    root.bind(a, async (c: Container) => {
      await Promise.resolve();
      return c.resolve<string>(b);
    }).inTransientScope();
    root.bind(b, async (c: Container) => {
      await Promise.resolve();
      return c.resolve<string>(a);
    }).inTransientScope();

    const error = await cycleErrorOf(root.resolve(a));

    expect(error).toBeInstanceOf(CircularDependencyError);
    expect((error as CircularDependencyError).path).toEqual([a, b, a]);
    expect(root.snapshot().resolving).toBe(0);
  });

  it("async-цикл в scoped-зависимостях отклоняется с путём", async () => {
    const root = new Container("root");
    const scope = root.createScope("request");
    const a = createToken<string>("async-scoped-a");
    const b = createToken<string>("async-scoped-b");

    root.bind(a, async (c: Container) => {
      await Promise.resolve();
      return c.resolve<string>(b);
    }).inScopedScope();
    root.bind(b, async (c: Container) => {
      await Promise.resolve();
      return c.resolve<string>(a);
    }).inScopedScope();

    const error = await cycleErrorOf(scope.resolve(a));

    expect(error).toBeInstanceOf(CircularDependencyError);
    expect((error as CircularDependencyError).path).toEqual([a, b, a]);
    expect(root.snapshot().resolving).toBe(0);
  });

  it("синхронная фабрика, возвращающая промис, тоже не зависает на async-цикле", async () => {
    const root = new Container("root");
    const a = createToken<string>("async-sync-a");
    const b = createToken<string>("async-sync-b");

    root.bind(a, (c: Container) => c.resolve<string>(b));
    root.bind(b, async (c: Container) => {
      await Promise.resolve();
      return c.resolve<string>(a);
    });

    const error = await cycleErrorOf(root.resolve(a));

    expect(error).toBeInstanceOf(CircularDependencyError);
    expect((error as CircularDependencyError).path).toEqual([a, b, a]);
    expect(root.snapshot().resolving).toBe(0);
  });
});

describe("Параллельные async-resolve без цикла", () => {
  it("два resolve одного singleton делят один промис и один инстанс", async () => {
    const root = new Container("root");
    const shared = createToken<{ id: number }>("async-shared");
    let calls = 0;

    root.bind(shared, async () => {
      calls += 1;
      await Promise.resolve();
      return { id: calls };
    });

    const [first, second] = await withTimeout(
      Promise.all([root.resolve(shared), root.resolve(shared)]),
    );

    expect(calls).toBe(1);
    expect(first).toBe(second);
    expect(root.peek(shared)).toBe(first);
    expect(root.snapshot().resolving).toBe(0);
  });

  it("разные цепочки могут параллельно разделить in-flight зависимость", async () => {
    const root = new Container("root");
    const shared = createToken<{ id: number }>("async-shared-dep");
    const left = createToken<string>("async-left");
    const right = createToken<string>("async-right");
    let calls = 0;

    root.bind(shared, async () => {
      calls += 1;
      await Promise.resolve();
      return { id: calls };
    });
    root.bind(left, async (c: Container) => {
      await Promise.resolve();
      return `left:${(await c.resolve<{ id: number }>(shared)).id}`;
    });
    root.bind(right, async (c: Container) => {
      await Promise.resolve();
      return `right:${(await c.resolve<{ id: number }>(shared)).id}`;
    });

    const [leftValue, rightValue] = await withTimeout(
      Promise.all([root.resolve(left), root.resolve(right)]),
    );

    expect(calls).toBe(1);
    expect(leftValue).toBe("left:1");
    expect(rightValue).toBe("right:1");
    expect(root.snapshot().resolving).toBe(0);
  });
});

describe("Восстановление после async-цикла", () => {
  it("после ошибки resolving очищен и повторный bind разрешает токен", async () => {
    const root = new Container("root");
    const a = createToken<string>("async-recover-a");
    const b = createToken<string>("async-recover-b");

    root.bind(a, async (c: Container) => {
      await Promise.resolve();
      return `a:${await c.resolve<string>(b)}`;
    });
    root.bind(b, async (c: Container) => {
      await Promise.resolve();
      return `b:${await c.resolve<string>(a)}`;
    });

    expect(await cycleErrorOf(root.resolve(a))).toBeInstanceOf(CircularDependencyError);
    expect(root.snapshot().resolving).toBe(0);

    root.bind(a, async () => {
      await Promise.resolve();
      return "fixed";
    });

    expect(await withTimeout(root.resolve(a))).toBe("fixed");
    expect(await withTimeout(root.resolve(b))).toBe("b:fixed");
    expect(root.peek(a)).toBe("fixed");
    expect(root.snapshot().resolving).toBe(0);
  });
});
