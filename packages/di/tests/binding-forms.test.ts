import { describe, expect, it } from "vitest";
import {
  Container,
  DI_CREATE,
  bindClass as bindRootClass,
  bindFactory as bindRootFactory,
  container as rootContainer,
  createToken,
} from "../src/index.js";

const errorOf = async (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => null,
    (error: unknown) => error,
  );

describe("Диагностика вызова конструктора без new", () => {
  it("bind(token, Map) подсказывает bindClass", async () => {
    const root = new Container("root");
    const token = createToken<Map<string, number>>("NativeMap");

    root.bind(token, Map);

    const error = await errorOf(root.resolve(token));

    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toContain("bindClass");
    expect((error as Error).message).toContain("new");
    expect(root.peek(token)).toBeUndefined();
  });

  it("bound-класс через bind подсказывает bindClass", async () => {
    class Service {
      readonly kind = "service";
    }

    const Bound = Service.bind(null) as unknown as new () => Service;
    const root = new Container("root");
    const token = createToken<Service>("BoundService");

    root.bind(token, Bound);

    const error = await errorOf(root.resolve(token));

    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toContain("bindClass");
  });

  it("ES5-конструктор через bind подсказывает bindClass", async () => {
    function Legacy(this: { value?: number }): void {
      this.value = 1;
    }

    const root = new Container("root");
    const token = createToken<{ value: number }>("LegacyCtor");

    root.bind(token, Legacy);

    const error = await errorOf(root.resolve(token));

    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toContain("bindClass");
  });

  it("обычный TypeError фабрики не подменяется диагностикой", async () => {
    const root = new Container("root");
    const token = createToken<string>("plain-type-error");

    root.bind(token, () => {
      throw new TypeError("обычная ошибка пользователя");
    });

    const error = await errorOf(root.resolve(token));

    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toBe("обычная ошибка пользователя");
  });
});

describe("bindClass", () => {
  it("создаёт встроенный класс через new", async () => {
    const root = new Container("root");
    const token = createToken<Map<string, number>>("MapClass");

    root.bindClass(token, Map);
    const map = await root.resolve<Map<string, number>>(token);

    expect(map).toBeInstanceOf(Map);
    map.set("answer", 42);
    expect(map.get("answer")).toBe(42);
  });

  it("создаёт bound-класс через new", async () => {
    class Service {
      readonly kind = "service";

      constructor(readonly origin: string = "default") {}
    }

    const Bound = Service.bind(null) as unknown as new () => Service;
    const root = new Container("root");
    const token = createToken<Service>("BoundClass");

    root.bindClass(token, Bound);
    const instance = await root.resolve<Service>(token);

    expect(instance).toBeInstanceOf(Service);
    expect(instance.kind).toBe("service");
    expect(instance.origin).toBe("default");
  });

  it("использует DI_CREATE, если он объявлен", async () => {
    class Created {
      constructor(readonly origin: string) {}

      static [DI_CREATE](container: Container): Created {
        return new Created(container.name);
      }
    }

    const root = new Container("service-container");
    const token = createToken<Created>("Created");

    root.bindClass(token, Created);
    const instance = await root.resolve<Created>(token);

    expect(instance).toBeInstanceOf(Created);
    expect(instance.origin).toBe("service-container");
  });

  it("не вызывает класс как функцию", async () => {
    let constructed = 0;

    class StrictClass {
      constructor() {
        constructed += 1;
      }
    }

    const root = new Container("root");
    const token = createToken<StrictClass>("StrictClass");

    root.bindClass(token, StrictClass);
    const instance = await root.resolve<StrictClass>(token);

    expect(instance).toBeInstanceOf(StrictClass);
    expect(constructed).toBe(1);
  });
});

describe("bindFactory", () => {
  it("вызывает функцию, а не new", async () => {
    const root = new Container("root");
    const token = createToken<string>("ExplicitFactory");

    function ProducesString(this: unknown): string {
      return "factory-result";
    }

    root.bindFactory(token, ProducesString);

    expect(await root.resolve(token)).toBe("factory-result");
  });

  it("не создаёт экземпляр класса, переданного как фабрика", async () => {
    let constructed = 0;

    class LooksLikeClass {
      constructor() {
        constructed += 1;
      }
    }

    const root = new Container("root");
    const token = createToken<LooksLikeClass>("ClassAsFactory");

    root.bindFactory(token, LooksLikeClass as unknown as () => LooksLikeClass);

    const error = await errorOf(root.resolve(token));

    expect(error).toBeInstanceOf(TypeError);
    expect(constructed).toBe(0);
  });

  it("отклоняет не-функцию при регистрации", () => {
    const root = new Container("root");
    const token = createToken<string>("NotAFunction");

    expect(() => root.bindFactory(token, 42 as unknown as () => string)).toThrow("bindFactory");
  });
});

describe("Экспорты bindClass / bindFactory", () => {
  it("работают с глобальным контейнером", async () => {
    const factoryToken = createToken<string>("global-factory");
    bindRootFactory(factoryToken, () => "global");

    expect(await rootContainer.resolve(factoryToken)).toBe("global");

    class GlobalService {
      readonly kind = "global";
    }

    const classToken = createToken<GlobalService>("global-class");
    bindRootClass(classToken, GlobalService);

    expect((await rootContainer.resolve<GlobalService>(classToken)).kind).toBe("global");
  });
});
