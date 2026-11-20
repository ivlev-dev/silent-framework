import { describe, expect, it } from "vitest";
import {
  Container,
  ContainerDisposedError,
  createToken,
} from "../src/index.js";

interface Tracked {
  disposed: number;
  [Symbol.dispose](): void;
}

interface LateDisposable {
  disposeCalls: number;
  dispose(): void;
}

interface LateBoth extends LateDisposable {
  symbolCalls: number;
  [Symbol.dispose](): void;
}

const makeTracked = (): Tracked => ({
  disposed: 0,
  [Symbol.dispose](): void {
    this.disposed += 1;
  },
});

const errorOf = async (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => null,
    (error: unknown) => error,
  );

const flush = async (): Promise<void> => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
};

describe("Освобождение значений при rebind и clearCache", () => {
  it("повторный bind освобождает прежний инстанс ровно один раз", async () => {
    const root = new Container("root");
    const token = createToken<Tracked>("resource");

    root.bind(token, () => makeTracked());
    const first = await root.resolve<Tracked>(token);

    root.bind(token, () => makeTracked());
    const second = await root.resolve<Tracked>(token);

    expect(first.disposed).toBe(1);
    expect(second.disposed).toBe(0);
    expect(root.peek(token)).toBe(second);

    root.dispose();

    expect(first.disposed).toBe(1);
    expect(second.disposed).toBe(1);
  });

  it("повторный bindValue освобождает прежнее значение", async () => {
    const root = new Container("root");
    const token = createToken<Tracked>("value");
    const first = makeTracked();

    root.bindValue(token, first);
    expect(first.disposed).toBe(0);

    const second = makeTracked();
    root.bindValue(token, second);

    expect(first.disposed).toBe(1);
    expect(second.disposed).toBe(0);
    expect(await root.resolve(token)).toBe(second);
  });

  it("повторный bindValue тем же значением не освобождает его", async () => {
    const root = new Container("root");
    const token = createToken<Tracked>("same-value");
    const value = makeTracked();

    root.bindValue(token, value);
    root.bindValue(token, value);

    expect(value.disposed).toBe(0);
    expect(root.peek(token)).toBe(value);
  });

  it("clearCache(token) освобождает значение этого токена", async () => {
    const root = new Container("root");
    const token = createToken<Tracked>("clear-one");

    root.bind(token, () => makeTracked());
    const instance = await root.resolve<Tracked>(token);

    root.clearCache(token);

    expect(instance.disposed).toBe(1);
    expect(root.peek(token)).toBeUndefined();
  });

  it("clearCache() освобождает одно значение под разными токенами один раз", async () => {
    const root = new Container("root");
    const a = createToken<Tracked>("shared-a");
    const b = createToken<Tracked>("shared-b");
    const shared = makeTracked();

    root.bindValue(a, shared);
    root.bindValue(b, shared);

    root.clearCache();

    expect(shared.disposed).toBe(1);
    expect(root.peek(a)).toBeUndefined();
    expect(root.peek(b)).toBeUndefined();
  });

  it("ошибка в Symbol.dispose не мешает установке нового биндинга", async () => {
    const root = new Container("root");
    const token = createToken<Tracked>("bad-dispose");
    const order: string[] = [];

    root.bindValue(token, {
      disposed: 0,
      [Symbol.dispose](): void {
        order.push("bad");
        throw new Error("dispose boom");
      },
    });

    expect(() => root.bind(token, () => "ok")).not.toThrow();
    expect(order).toEqual(["bad"]);
    expect(await root.resolve(token)).toBe("ok");
  });
});

describe("onDispose после dispose", () => {
  it("хук, зарегистрированный на disposed-контейнере, вызывается сразу", () => {
    const root = new Container("root");
    root.dispose();

    let calls = 0;
    root.onDispose(() => {
      calls += 1;
    });

    expect(calls).toBe(1);
  });
});

describe("dispose во время незавершённого resolve", () => {
  it("отложенная фабрика: resolve отклоняется ContainerDisposedError, инстанс освобождён один раз", async () => {
    const root = new Container("root");
    const token = createToken<Tracked>("slow");
    let release: () => void = () => undefined;
    let instance: Tracked | undefined;

    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate;
    });

    root.bind(token, async () => {
      const created = makeTracked();
      instance = created;
      await gate;
      return created;
    });

    const pending = root.resolve(token);
    expect(instance).toBeDefined();

    root.dispose();

    const error = await errorOf(pending);
    expect(error).toBeInstanceOf(ContainerDisposedError);
    expect((error as ContainerDisposedError).container).toBe(root);
    expect((error as Error).message).toContain('Container "root" has been disposed');

    release();
    await flush();

    expect(instance?.disposed).toBe(1);

    root.dispose();
    await flush();
    expect(instance?.disposed).toBe(1);
  });

  it("параллельные ожидающие получают ContainerDisposedError", async () => {
    const root = new Container("root");
    const token = createToken<Tracked>("shared-slow");
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate;
    });

    root.bind(token, async () => {
      await gate;
      return makeTracked();
    });

    const first = root.resolve(token);
    const second = root.resolve(token);
    const firstError = errorOf(first);
    const secondError = errorOf(second);

    root.dispose();

    expect(await firstError).toBeInstanceOf(ContainerDisposedError);
    expect(await secondError).toBeInstanceOf(ContainerDisposedError);

    release();
    await flush();
  });

  it("scoped: dispose скоупа отклоняет resolve и освобождает инстанс один раз", async () => {
    const root = new Container("root");
    const token = createToken<Tracked>("scoped-slow");
    let release: () => void = () => undefined;
    let instance: Tracked | undefined;
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate;
    });

    root.bind(token, async () => {
      const created = makeTracked();
      instance = created;
      await gate;
      return created;
    }).inScopedScope();

    const scope = root.createScope("request");
    const pending = scope.resolve(token);

    scope.dispose();

    expect(await errorOf(pending)).toBeInstanceOf(ContainerDisposedError);

    release();
    await flush();

    expect(instance?.disposed).toBe(1);
    expect(root.snapshot().resolved).toBe(0);
  });

  it("transient при dispose отклоняется, но инстанс остаётся у вызывающего", async () => {
    const root = new Container("root");
    const token = createToken<Tracked>("transient-slow");
    let release: () => void = () => undefined;
    let instance: Tracked | undefined;
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate;
    });

    root.bind(token, async () => {
      const created = makeTracked();
      instance = created;
      await gate;
      return created;
    }).inTransientScope();

    const pending = root.resolve(token);
    root.dispose();

    expect(await errorOf(pending)).toBeInstanceOf(ContainerDisposedError);

    release();
    await flush();

    expect(instance?.disposed).toBe(0);
  });

  it("поздно созданный инстанс освобождается методом dispose()", async () => {
    const root = new Container("root");
    const token = createToken<LateDisposable>("late-method");
    let release: () => void = () => undefined;
    let instance: LateDisposable | undefined;
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate;
    });

    root.bind(token, async () => {
      const created: LateDisposable = {
        disposeCalls: 0,
        dispose(): void {
          this.disposeCalls += 1;
        },
      };
      instance = created;
      await gate;
      return created;
    });

    const pending = root.resolve(token);
    root.dispose();

    expect(await errorOf(pending)).toBeInstanceOf(ContainerDisposedError);

    release();
    await flush();

    expect(instance?.disposeCalls).toBe(1);

    root.dispose();
    await flush();
    expect(instance?.disposeCalls).toBe(1);
  });

  it("поздно созданный инстанс с Symbol.dispose не вызывает dispose() повторно", async () => {
    const root = new Container("root");
    const token = createToken<LateBoth>("late-both");
    let release: () => void = () => undefined;
    let instance: LateBoth | undefined;
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate;
    });

    root.bind(token, async () => {
      const created: LateBoth = {
        symbolCalls: 0,
        disposeCalls: 0,
        [Symbol.dispose](): void {
          this.symbolCalls += 1;
        },
        dispose(): void {
          this.disposeCalls += 1;
        },
      };
      instance = created;
      await gate;
      return created;
    });

    const pending = root.resolve(token);
    root.dispose();

    expect(await errorOf(pending)).toBeInstanceOf(ContainerDisposedError);

    release();
    await flush();

    expect(instance?.symbolCalls).toBe(1);
    expect(instance?.disposeCalls).toBe(0);
  });

  it("обычный resolve не затронут", async () => {
    const root = new Container("root");
    const token = createToken<Tracked>("normal");
    const instance = makeTracked();

    root.bind(token, async () => {
      await Promise.resolve();
      return instance;
    });

    expect(await root.resolve(token)).toBe(instance);
    expect(instance.disposed).toBe(0);

    root.dispose();
    expect(instance.disposed).toBe(1);
  });
});
