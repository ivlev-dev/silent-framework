import { describe, expect, it } from "vitest";
import { Container, createToken } from "../src/index.js";

interface Item {
  readonly id: number;
}

describe("Наследование биндингов дочерним scope", () => {
  it("bindValue: peek/resolve/resolveSync в дочернем scope возвращают тот же объект", async () => {
    const root = new Container("root");
    const token = createToken<Item>("config");
    const value: Item = { id: 7 };
    root.bindValue(token, value);
    const scope = root.createScope("scope");

    expect(scope.peek<Item>(token)).toBe(value);
    expect(await scope.resolve<Item>(token)).toBe(value);
    expect(scope.resolveSync<Item>(token)).toBe(value);
    expect(root.peek<Item>(token)).toBe(value);
    expect(root.resolveSync<Item>(token)).toBe(value);
  });

  it("factory singleton: до resolve peek undefined, после resolve дочерний scope видит тот же объект", async () => {
    const root = new Container("root");
    const token = createToken<Item>("service");
    let calls = 0;
    root.bind(token, () => {
      calls += 1;
      return { id: calls };
    });
    const scope = root.createScope("scope");

    expect(scope.peek(token)).toBeUndefined();
    expect(root.peek(token)).toBeUndefined();
    expect(() => scope.resolveSync(token)).toThrow("has not been resolved yet");

    const fromScope = await scope.resolve<Item>(token);
    expect(fromScope.id).toBe(1);
    expect(scope.peek<Item>(token)).toBe(fromScope);
    expect(root.peek<Item>(token)).toBe(fromScope);
    expect(scope.resolveSync<Item>(token)).toBe(fromScope);
    expect(root.resolveSync<Item>(token)).toBe(fromScope);
    expect(await root.resolve<Item>(token)).toBe(fromScope);
    expect(calls).toBe(1);
  });

  it("scoped: каждый scope получает свой экземпляр", async () => {
    const root = new Container("root");
    const token = createToken<Item>("scoped");
    let calls = 0;
    root.bind(token, () => {
      calls += 1;
      return { id: calls };
    }).inScopedScope();

    const scope = root.createScope("scope");
    const rootValue = await root.resolve<Item>(token);
    const scopeValue = await scope.resolve<Item>(token);
    const repeated = await scope.resolve<Item>(token);

    expect(calls).toBe(2);
    expect(rootValue).not.toBe(scopeValue);
    expect(repeated).toBe(scopeValue);
    expect(scope.peek<Item>(token)).toBe(scopeValue);
    expect(scope.resolveSync<Item>(token)).toBe(scopeValue);
  });

  it("transient: каждый resolve возвращает новый экземпляр", async () => {
    const root = new Container("root");
    const token = createToken<Item>("transient");
    let calls = 0;
    root.bind(token, () => {
      calls += 1;
      return { id: calls };
    }).inTransientScope();

    const scope = root.createScope("scope");
    const first = await scope.resolve<Item>(token);
    const second = await scope.resolve<Item>(token);
    const fromRoot = await root.resolve<Item>(token);

    expect(calls).toBe(3);
    expect(first).not.toBe(second);
    expect(first).not.toBe(fromRoot);
    expect(scope.peek(token)).toBeUndefined();
    expect(root.peek(token)).toBeUndefined();
  });

  it("вложенный scope видит singleton из корня", async () => {
    const root = new Container("root");
    const token = createToken<Item>("singleton");
    let calls = 0;
    root.bind(token, () => {
      calls += 1;
      return { id: calls };
    });

    const level1 = root.createScope("level-1");
    const level2 = level1.createScope("level-2");

    const value = await level2.resolve<Item>(token);
    expect(value.id).toBe(1);
    expect(level2.peek<Item>(token)).toBe(value);
    expect(level1.peek<Item>(token)).toBe(value);
    expect(root.peek<Item>(token)).toBe(value);
    expect(await level1.resolve<Item>(token)).toBe(value);
    expect(await root.resolve<Item>(token)).toBe(value);
    expect(calls).toBe(1);
  });

  it("clearCache(token) сбрасывает значение", async () => {
    const root = new Container("root");
    const token = createToken<Item>("cached");
    let calls = 0;
    root.bind(token, () => {
      calls += 1;
      return { id: calls };
    });
    const scope = root.createScope("scope");

    const first = await scope.resolve<Item>(token);
    expect(calls).toBe(1);

    root.clearCache(token);

    expect(root.peek(token)).toBeUndefined();
    expect(scope.peek(token)).toBeUndefined();

    const second = await scope.resolve<Item>(token);
    expect(calls).toBe(2);
    expect(second).not.toBe(first);
    expect(scope.peek<Item>(token)).toBe(second);
  });

  it("dispose дочернего scope не убивает singleton родителя", async () => {
    const root = new Container("root");
    const token = createToken<Item>("shared");
    let calls = 0;
    root.bind(token, () => {
      calls += 1;
      return { id: calls };
    });
    const scope = root.createScope("scope");

    const value = await scope.resolve<Item>(token);
    expect(scope.peek<Item>(token)).toBe(value);

    scope.dispose();

    expect(root.peek<Item>(token)).toBe(value);
    expect(await root.resolve<Item>(token)).toBe(value);
    expect(calls).toBe(1);
    expect(root.snapshot().scopes).toBe(0);
  });
});
