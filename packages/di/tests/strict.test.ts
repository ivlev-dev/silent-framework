import { afterEach, describe, expect, it, vi } from "vitest";
import { Container, MissingBindingError, createToken } from "../src/index.js";
import type { ImplicitBindingMode } from "../src/index.js";

const errorOf = async (promise: Promise<unknown>): Promise<unknown> =>
  promise.catch((error: unknown) => error);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Строгий режим неявных биндингов", () => {
  it("error: resolve незабинженного класса отклоняется MissingBindingError", async () => {
    class Service {
      readonly id = 1;
    }

    const root = new Container("app", undefined, { implicitBindings: "error" });
    const error = await errorOf(root.resolve(Service));

    expect(error).toBeInstanceOf(MissingBindingError);
    const missing = error as MissingBindingError;
    expect(missing.token).toBe(Service);
    expect(missing.container).toBe(root);
    expect(missing.name).toBe("MissingBindingError");
    expect(missing.message).toContain('"Service"');
    expect(missing.message).toContain('"app"');
  });

  it("error: контейнер не создаёт неявный экземпляр", async () => {
    class Service {
      constructor() {
        throw new Error("must not be constructed");
      }
    }

    const root = new Container("app", undefined, { implicitBindings: "error" });

    await expect(root.resolve(Service)).rejects.toBeInstanceOf(MissingBindingError);
    await expect(root.resolve(Service)).rejects.toBeInstanceOf(MissingBindingError);
    expect(root.has(Service)).toBe(false);
    expect(root.hasExplicit(Service)).toBe(false);
    expect(root.peek(Service)).toBeUndefined();
  });

  it("error: незабинженный symbol-токен даёт прежнюю общую ошибку", async () => {
    const token = createToken<number>("unbound");

    const root = new Container("app", undefined, { implicitBindings: "error" });

    await expect(root.resolve(token)).rejects.toThrow("no binding registered");
  });

  it("warn: console.warn вызывается, resolve создаёт экземпляр", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    class Service {
      readonly id = 1;
    }

    const root = new Container("app", undefined, { implicitBindings: "warn" });
    const first = await root.resolve<Service>(Service);
    const second = await root.resolve<Service>(Service);

    expect(first).toBeInstanceOf(Service);
    expect(second).toBe(first);
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toContain('"Service"');
    expect(message).toContain('"app"');
    expect(message).toContain("Стек:");
  });

  it("error: явный bindValue работает", async () => {
    const root = new Container("app", undefined, { implicitBindings: "error" });
    const token = createToken<{ value: number }>("config");
    const value = { value: 42 };
    root.bindValue(token, value);

    expect(await root.resolve(token)).toBe(value);
    expect(root.peek(token)).toBe(value);
    expect(root.resolveSync(token)).toBe(value);
  });

  it("error: явный bind работает для класса", async () => {
    class Service {
      readonly id = 1;
    }

    const root = new Container("app", undefined, { implicitBindings: "error" });
    root.bind(Service, Service);

    const instance = await root.resolve<Service>(Service);
    expect(instance).toBeInstanceOf(Service);
    expect(await root.resolve(Service)).toBe(instance);
  });

  it("error: явный bind не даёт упасть зависимостям", async () => {
    class Dependency {
      readonly id = "dep";
    }

    class Service {
      readonly dependency: Dependency;
      constructor(dependency: Dependency) {
        this.dependency = dependency;
      }
    }

    const root = new Container("app", undefined, { implicitBindings: "error" });
    root.bind(Dependency, Dependency);
    root.bind(Service, async (container: Container) => new Service(await container.resolve(Dependency)));

    const service = await root.resolve<Service>(Service);
    expect(service).toBeInstanceOf(Service);
    expect(service.dependency).toBeInstanceOf(Dependency);
  });

  it("вложенный resolve незабинженного класса в error-режиме отклоняется", async () => {
    class Dependency {
      readonly id = 1;
    }

    class Service {
      readonly dependency: Dependency;
      constructor(dependency: Dependency) {
        this.dependency = dependency;
      }
    }

    const root = new Container("app", undefined, { implicitBindings: "error" });
    root.bind(Service, async (container: Container) => new Service(await container.resolve(Dependency)));

    await expect(root.resolve(Service)).rejects.toBeInstanceOf(MissingBindingError);
    expect(root.has(Dependency)).toBe(false);
  });

  it("дочерний scope наследует режим", () => {
    for (const mode of ["allow", "warn", "error"] as const satisfies readonly ImplicitBindingMode[]) {
      const root = new Container("root", undefined, { implicitBindings: mode });
      const scope = root.createScope("scope");
      const nested = scope.createScope("nested");

      expect(root.implicitBindings).toBe(mode);
      expect(scope.implicitBindings).toBe(mode);
      expect(nested.implicitBindings).toBe(mode);
    }
  });

  it("дочерний scope унаследовал error и не создаёт экземпляр", async () => {
    class Service {
      readonly id = 1;
    }

    const root = new Container("root", undefined, { implicitBindings: "error" });
    const scope = root.createScope("scope");

    await expect(scope.resolve(Service)).rejects.toBeInstanceOf(MissingBindingError);
    expect(root.has(Service)).toBe(false);
  });

  it("дочерний scope унаследовал warn и предупреждает", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    class Service {
      readonly id = 1;
    }

    const root = new Container("root", undefined, { implicitBindings: "warn" });
    const scope = root.createScope("scope");

    const instance = await scope.resolve<Service>(Service);
    expect(instance).toBeInstanceOf(Service);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('"scope"');
  });

  it("дочерний scope унаследовал allow и молча создаёт экземпляр", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    class Service {
      readonly id = 1;
    }

    const root = new Container("root", undefined, { implicitBindings: "allow" });
    const scope = root.createScope("scope");

    const instance = await scope.resolve<Service>(Service);
    expect(instance).toBeInstanceOf(Service);
    expect(warn).not.toHaveBeenCalled();
  });

  it("hasExplicit видит только явные биндинги", async () => {
    const root = new Container("root", undefined, { implicitBindings: "allow" });
    const token = createToken<number>("value");
    root.bindValue(token, 1);
    const scope = root.createScope("scope");

    class Service {
      readonly id = 1;
    }

    expect(scope.hasExplicit(token)).toBe(true);
    expect(scope.hasExplicit(Service)).toBe(false);

    await scope.resolve(Service);
    expect(scope.has(Service)).toBe(true);
    expect(scope.hasExplicit(Service)).toBe(false);
  });

  it("режим по умолчанию сохраняет неявные биндинги", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    class Service {
      readonly id = 1;
    }

    const root = new Container("root");
    expect(["allow", "warn"]).toContain(root.implicitBindings);

    const instance = await root.resolve<Service>(Service);
    expect(instance).toBeInstanceOf(Service);
    expect(root.has(Service)).toBe(true);
    expect(await root.resolve(Service)).toBe(instance);
    expect(warn.mock.calls.length).toBeLessThanOrEqual(1);
  });
});
