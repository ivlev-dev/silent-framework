import { describe, expect, it } from "vitest";
import { Container, createToken } from "../src/index.js";

class CountingMap<K, V> extends Map<K, V> {
  valuesReads = 0;

  override values(): MapIterator<V> {
    this.valuesReads += 1;
    return super.values();
  }
}

describe("Оптимизации DI без изменения поведения", () => {
  it("bindValue кладёт готовый промис в кеш: повторный resolve возвращает тот же промис", async () => {
    const root = new Container("root");
    const token = createToken<{ id: number }>("cached-value");
    const value = { id: 1 };
    root.bindValue(token, value);

    const first = root.resolve(token);
    const second = root.resolve(token);

    expect(first).toBe(second);
    expect(root.snapshot().resolving).toBe(0);
    expect(await first).toBe(value);
    expect(await second).toBe(value);
  });

  it("константный bind тоже отдаёт закешированный промис", async () => {
    const root = new Container("root");
    root.bind("answer", 42);

    const first = root.resolve<number>("answer");
    const second = root.resolve<number>("answer");

    expect(first).toBe(second);
    expect(await first).toBe(42);
  });

  it("guard кеширует биндинг методов и сохраняет this", async () => {
    const root = new Container("root");
    const token = createToken<boolean>("guard-methods");
    root.bindFactory(token, async (container) => {
      const sameResolve = container.resolve === container.resolve;
      const sameHas = container.has === container.has;
      const sameName = container.name === "root";
      return sameResolve && sameHas && sameName;
    }).inTransientScope();

    expect(await root.resolve(token)).toBe(true);
  });

  it("ленивая инвалидация не ломает очистку дочерних scoped-значений", async () => {
    const root = new Container("root");
    const token = createToken<{ version: number }>("scoped-rebind");
    root.bind(token, () => ({ version: 1 })).inScopedScope();

    const scope = root.createScope("request");
    const first = await scope.resolve<{ version: number }>(token);

    root.bind(token, () => ({ version: 2 })).inScopedScope();
    const second = await scope.resolve<{ version: number }>(token);

    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    expect(second).not.toBe(first);
  });

  it("ленивая инвалидация не мешает очистке singleton в дочернем scope", async () => {
    const root = new Container("root");
    const token = createToken<string>("singleton-in-child");
    root.bind(token, () => "first");

    const scope = root.createScope("request");
    expect(await scope.resolve(token)).toBe("first");

    root.bind(token, () => "second");
    expect(await scope.resolve(token)).toBe("second");
    expect(await root.resolve(token)).toBe("second");
  });

  it("clearCache обходит каждое поддерево один раз, а не на каждое значение", () => {
    const root = new Container("root");
    const scope = root.createScope("request");
    const rootResolved = new CountingMap<unknown, unknown>();
    const scopeResolved = new CountingMap<unknown, unknown>();
    (root as unknown as { resolved: Map<unknown, unknown> }).resolved = rootResolved;
    (scope as unknown as { resolved: Map<unknown, unknown> }).resolved = scopeResolved;

    for (let index = 0; index < 5; index += 1) {
      root.bindValue(createToken(`root-${index}`), { index });
    }
    scope.bindValue(createToken("scope"), { index: 5 });

    root.clearCache();

    // По одному проходу на контейнер при отсоединении и по одному при
    // сборе выживших значений; старый вариант обходил дерево на каждое
    // удалённое значение.
    expect(rootResolved.valuesReads).toBe(2);
    expect(scopeResolved.valuesReads).toBe(2);
  });
});
