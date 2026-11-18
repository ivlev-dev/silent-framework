import { afterEach, describe, expect, it } from "vitest";
import {
  AsyncRuleError,
  Custom,
  Required,
  safeParse,
  safeParseAsync,
} from "../src/index.js";
import { resetValidationConfig } from "../src/messages.js";
import { SCHEMA_SYMBOL } from "../src/schema.js";
import type { ClassSchema, FieldSchemaMap } from "../src/schema.js";
import type { SafeParseResult } from "../src/types.js";

function defineSchema(ctor: Function, schema: ClassSchema | FieldSchemaMap): void {
  Object.defineProperty(ctor, SCHEMA_SYMBOL, {
    value: schema,
    configurable: true,
  });
}

afterEach(() => {
  resetValidationConfig();
});

describe("safeParse", () => {
  class Model {
    @Required()
    public accessor name = "Иван";
  }

  it("возвращает success с тем же экземпляром", () => {
    const model = new Model();
    const result: SafeParseResult<Model> = safeParse(model);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe(model);
      expect(result.errors).toEqual([]);
    }
  });

  it("возвращает failure с ошибками без выброса исключения", () => {
    const model = new Model();
    model.name = "";

    const result = safeParse(model);

    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.field).toBe("name");
    expect("data" in result).toBe(false);
  });

  it("не бросает ValidationException при ошибках", () => {
    const model = new Model();
    model.name = "";

    expect(() => safeParse(model)).not.toThrow();
  });

  it("уважает options.types: false", () => {
    class Typed {
      public accessor value = 0;
    }
    defineSchema(Typed, { fields: { value: "number" } });

    const model = new Typed();
    model.value = "text" as unknown as number;

    expect(safeParse(model).success).toBe(false);
    expect(safeParse(model, { types: false }).success).toBe(true);
  });

  it("пробрасывает AsyncRuleError в синхронном режиме", () => {
    class AsyncModel {
      @Custom(async (value) => value === "ok")
      public accessor value = "bad";
    }

    expect(() => safeParse(new AsyncModel())).toThrow(AsyncRuleError);
  });

  it("бросает TypeError для не-объекта", () => {
    expect(() => safeParse(null as unknown as object)).toThrow(TypeError);
    expect(() => safeParse("text" as unknown as object)).toThrow(TypeError);
  });
});

describe("safeParseAsync", () => {
  class AsyncModel {
    @Custom(async (value) => value === "ok")
    public accessor value = "ok";
  }

  it("возвращает success с тем же экземпляром", async () => {
    const model = new AsyncModel();
    const result = await safeParseAsync(model);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe(model);
    }
  });

  it("возвращает failure для асинхронной ошибки", async () => {
    const model = new AsyncModel();
    model.value = "bad";

    const result = await safeParseAsync(model);

    expect(result.success).toBe(false);
    expect(result.errors[0]?.field).toBe("value");
  });

  it("проверяет схему", async () => {
    class Typed {
      public accessor value = 1;
    }
    defineSchema(Typed, { fields: { value: "number" } });

    const model = new Typed();
    model.value = "text" as unknown as number;

    const result = await safeParseAsync(model);

    expect(result.success).toBe(false);
    expect(result.errors[0]?.rule).toBe("type");
  });

  it("бросает TypeError для не-объекта", async () => {
    await expect(safeParseAsync(null as unknown as object)).rejects.toBeInstanceOf(
      TypeError,
    );
  });
});
