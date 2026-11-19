import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LOCALE,
  configureValidation,
  createI18nextResolver,
  getValidationConfig,
  resetValidationConfig,
  resolveMessage,
  validationMessages,
} from "../src/messages.js";
import {
  Nested,
  Required,
  safeParseAsync,
  validate,
  validateAsync,
  validatePropertyAsync,
} from "../src/index.js";
import { SCHEMA_SYMBOL } from "../src/schema.js";
import type { ClassSchema, FieldSchemaMap } from "../src/schema.js";
import type {
  MessageContext,
  MessageResolver,
  ValidationConfig,
} from "../src/types.js";

function defineSchema(ctor: Function, schema: ClassSchema | FieldSchemaMap): void {
  Object.defineProperty(ctor, SCHEMA_SYMBOL, {
    value: schema,
    configurable: true,
  });
}

const contextOf = (overrides: Partial<MessageContext> = {}): MessageContext => ({
  rule: "min",
  key: "validation.min",
  field: "age",
  label: "Возраст",
  value: 1,
  params: { min: 3 },
  locale: "ru",
  instance: {},
  path: "age",
  ...overrides,
});

afterEach(() => {
  resetValidationConfig();
});

describe("Встроенные каталоги", () => {
  it("по умолчанию использует ru", () => {
    expect(DEFAULT_LOCALE).toBe("ru");
    expect(resolveMessage(contextOf(), {})).toBe(
      "Значение поля Возраст должно быть не меньше 3",
    );
  });

  it("интерполирует {label} и {min} из params", () => {
    const message = resolveMessage(
      contextOf({ label: "Количество", params: { min: 10 } }),
      { locale: "ru" },
    );
    expect(message).toBe("Значение поля Количество должно быть не меньше 10");
  });

  it("переключается на en через config.locale", () => {
    const message = resolveMessage(
      contextOf({ label: "Age", params: { min: 3 } }),
      { locale: "en" },
    );
    expect(message).toBe("Age must be at least 3");
  });

  it("содержит одинаковый набор базовых ключей в ru и en", () => {
    const isPluralVariant = (key: string): boolean =>
      /_(one|few|many|other)$/.test(key);
    const baseKeys = (locale: string): string[] =>
      Object.keys(validationMessages[locale] ?? {})
        .filter((key) => !isPluralVariant(key))
        .sort();
    const ruKeys = baseKeys("ru");
    const enKeys = baseKeys("en");
    expect(ruKeys).toEqual(enKeys);
    expect(ruKeys).toContain("validation.min");
  });

  it("неизвестная локаль откатывается к встроенной ru", () => {
    const message = resolveMessage(contextOf(), { locale: "de" });
    expect(message).toBe("Значение поля Возраст должно быть не меньше 3");
  });

  it("откатывается к en, если ключа нет в ru", () => {
    const en = validationMessages.en as Record<string, string>;
    en["validation.testEnOnly"] = "Only english";
    try {
      const message = resolveMessage(
        contextOf({ key: "validation.testEnOnly" }),
        { locale: "de" },
      );
      expect(message).toBe("Only english");
    } finally {
      delete en["validation.testEnOnly"];
    }
  });

  it("сохраняет {value} при кастомном шаблоне", () => {
    const message = resolveMessage(
      contextOf({ message: "Недопустимое значение: {value}" }),
      {},
    );
    expect(message).toBe("Недопустимое значение: 1");
  });
});

describe("Каталоги из config", () => {
  it("per-call messages переопределяют встроенные", () => {
    const config: ValidationConfig = {
      locale: "ru",
      messages: { ru: { "validation.min": "Минимум {min} для {label}" } },
    };
    expect(resolveMessage(contextOf(), config)).toBe("Минимум 3 для Возраст");
  });

  it("каталог выбирается по локали, затем по ru", () => {
    const config: ValidationConfig = {
      locale: "de",
      messages: {
        de: { "validation.min": "DE {min}" },
        ru: { "validation.max": "RU MAX" },
      },
    };
    expect(resolveMessage(contextOf(), config)).toBe("DE 3");
    expect(resolveMessage(contextOf({ key: "validation.max" }), config)).toBe(
      "RU MAX",
    );
  });

  it("каталог en переопределяет встроенный en", () => {
    const config: ValidationConfig = {
      locale: "en",
      messages: { en: { "validation.required": "{label} required!" } },
    };
    const message = resolveMessage(
      contextOf({ key: "validation.required", label: "Email" }),
      config,
    );
    expect(message).toBe("Email required!");
  });

  it("для неизвестного ключа возвращает label и ключ", () => {
    const message = resolveMessage(
      contextOf({ key: "validation.unknown", label: "Поле" }),
      {},
    );
    expect(message).toBe("Поле: validation.unknown");
  });

  it("не читает ключи каталога из прототипа", () => {
    expect(
      resolveMessage(contextOf({ messageKey: "constructor", label: "Поле" }), {}),
    ).toBe("Поле: constructor");
    expect(
      resolveMessage(contextOf({ messageKey: "__proto__", label: "Поле" }), {}),
    ).toBe("Поле: __proto__");
    expect(
      resolveMessage(contextOf({ messageKey: "toString", label: "Поле" }), {}),
    ).toBe("Поле: toString");
  });
});

describe("MessageResolver", () => {
  it("получает key, params, locale и label", () => {
    const resolve = vi.fn<MessageResolver>(() => "resolved");
    const config: ValidationConfig = { locale: "en", resolve };

    expect(resolveMessage(contextOf({ label: "Age" }), config)).toBe("resolved");
    expect(resolve).toHaveBeenCalledTimes(1);
    const received = resolve.mock.calls[0]?.[0];
    expect(received?.key).toBe("validation.min");
    expect(received?.params).toEqual({ min: 3 });
    expect(received?.locale).toBe("en");
    expect(received?.label).toBe("Age");
    expect(received?.value).toBe(1);
  });

  it("строка резолвера интерполируется", () => {
    const config: ValidationConfig = {
      resolve: ({ label, params }) => `${label}: минимум ${String(params.min)}`,
    };
    expect(resolveMessage(contextOf({ label: "Age" }), config)).toBe(
      "Age: минимум 3",
    );
  });

  it("undefined от резолвера передаёт управление каталогу", () => {
    const resolve = vi.fn<MessageResolver>(() => undefined);
    const config: ValidationConfig = { locale: "en", resolve };
    expect(resolveMessage(contextOf({ label: "Age" }), config)).toBe(
      "Age must be at least 3",
    );
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("messageKey меняет ключ для резолвера", () => {
    const resolve = vi.fn<MessageResolver>(() => "custom");
    const message = resolveMessage(
      contextOf({ messageKey: "validation.required" }),
      { resolve },
    );
    expect(message).toBe("custom");
    expect(resolve.mock.calls[0]?.[0].key).toBe("validation.required");
  });
});

describe("Приоритет message и messageKey", () => {
  it("message-строка имеет приоритет над резолвером и каталогом", () => {
    const resolve = vi.fn<MessageResolver>(() => "resolver");
    const message = resolveMessage(
      contextOf({ message: "Своё сообщение для {field}" }),
      { resolve },
    );
    expect(message).toBe("Своё сообщение для age");
    expect(resolve).not.toHaveBeenCalled();
  });

  it("message-функция получает контекст с актуальной локалью", () => {
    const message = resolveMessage(
      contextOf({
        label: "Age",
        message: (context) => `${context.locale}:${context.label}:${String(context.value)}`,
      }),
      { locale: "en" },
    );
    expect(message).toBe("en:Age:1");
  });

  it("message-функция не интерполируется повторно", () => {
    const message = resolveMessage(
      contextOf({ message: () => "Литерал {label}" }),
      {},
    );
    expect(message).toBe("Литерал {label}");
  });

  it("messageKey выбирает ключ каталога", () => {
    const config: ValidationConfig = {
      locale: "ru",
      messages: { ru: { "validation.required": "Нужно поле {label}" } },
    };
    const message = resolveMessage(
      contextOf({ messageKey: "validation.required", label: "Email" }),
      config,
    );
    expect(message).toBe("Нужно поле Email");
  });
});

describe("Интерполяция", () => {
  it("оставляет {name}, если параметра нет", () => {
    const message = resolveMessage(
      contextOf({ message: "Привет, {name}!", params: {} }),
      {},
    );
    expect(message).toBe("Привет, {name}!");
  });

  it("не подставляет унаследованные свойства params", () => {
    expect(
      resolveMessage(contextOf({ message: "{constructor}", params: {} }), {}),
    ).toBe("{constructor}");
    expect(
      resolveMessage(contextOf({ message: "{toString}", params: {} }), {}),
    ).toBe("{toString}");
  });

  it("подставляет index, если он задан", () => {
    const message = resolveMessage(
      contextOf({ message: "Элемент {index}", index: 2 }),
      {},
    );
    expect(message).toBe("Элемент 2");
  });

  it("форматирует массив в {value}", () => {
    const message = resolveMessage(
      contextOf({ message: "Значение: {value}", value: [1, 2, 3] }),
      {},
    );
    expect(message).toBe("Значение: 1, 2, 3");
  });

  it("форматирует объект в {value} как JSON", () => {
    const message = resolveMessage(
      contextOf({ message: "Значение: {value}", value: { id: 7 } }),
      {},
    );
    expect(message).toBe('Значение: {"id":7}');
  });

  it("форматирует null и undefined", () => {
    expect(
      resolveMessage(contextOf({ message: "{value}", value: null }), {}),
    ).toBe("null");
    expect(
      resolveMessage(contextOf({ message: "{value}", value: undefined }), {}),
    ).toBe("undefined");
  });
});

describe("Глобальный конфиг", () => {
  it("configureValidation мержит настройки", () => {
    const resolve: MessageResolver = () => "resolved";
    configureValidation({ locale: "en" });
    configureValidation({ messages: { en: { "validation.min": "MIN {min}" } } });
    configureValidation({ resolve });

    const config = getValidationConfig();
    expect(config.locale).toBe("en");
    expect(config.messages?.en?.["validation.min"]).toBe("MIN {min}");
    expect(config.resolve).toBe(resolve);
  });

  it("resetValidationConfig очищает настройки", () => {
    configureValidation({ locale: "en", resolve: () => "x" });
    resetValidationConfig();
    expect(getValidationConfig()).toEqual({});
  });

  it("resolveMessage использует getValidationConfig()", () => {
    configureValidation({ locale: "en" });
    expect(
      resolveMessage(contextOf({ label: "Age" }), getValidationConfig()),
    ).toBe("Age must be at least 3");
  });

  it("resetValidationConfig возвращает поведение по умолчанию", () => {
    configureValidation({ locale: "en", messages: { en: { "validation.min": "MIN" } } });
    resetValidationConfig();
    expect(resolveMessage(contextOf(), getValidationConfig())).toBe(
      "Значение поля Возраст должно быть не меньше 3",
    );
  });
});

describe("Плюрализация", () => {
  const pluralContext = (
    key: string,
    params: Readonly<Record<string, unknown>>,
    overrides: Partial<MessageContext> = {},
  ): MessageContext =>
    contextOf({
      rule: key.replace("validation.", ""),
      key,
      params,
      value: null,
      ...overrides,
    });

  it("выбирает ru-формы one/few/many для arrayMinSize", () => {
    const message = (min: number): string =>
      resolveMessage(
        pluralContext("validation.arrayMinSize", { min }, { label: "Теги" }),
        { locale: "ru" },
      );

    expect(message(1)).toBe("В поле Теги должно быть не меньше 1 элемента");
    expect(message(2)).toBe("В поле Теги должно быть не меньше 2 элементов");
    expect(message(5)).toBe("В поле Теги должно быть не меньше 5 элементов");
  });

  it("выбирает ru-формы для arrayMaxSize, minLength и maxLength", () => {
    expect(
      resolveMessage(
        pluralContext("validation.arrayMaxSize", { max: 1 }, { label: "Теги" }),
        { locale: "ru" },
      ),
    ).toBe("В поле Теги должно быть не больше 1 элемента");
    expect(
      resolveMessage(
        pluralContext("validation.minLength", { min: 1 }, { label: "Имя" }),
        { locale: "ru" },
      ),
    ).toBe("Длина поля Имя должна быть не меньше 1 символа");
    expect(
      resolveMessage(
        pluralContext("validation.minLength", { min: 2 }, { label: "Имя" }),
        { locale: "ru" },
      ),
    ).toBe("Длина поля Имя должна быть не меньше 2 символов");
    expect(
      resolveMessage(
        pluralContext("validation.maxLength", { max: 5 }, { label: "Имя" }),
        { locale: "ru" },
      ),
    ).toBe("Длина поля Имя должна быть не больше 5 символов");
  });

  it("выбирает en-формы one/other", () => {
    const arrayMessage = (min: number): string =>
      resolveMessage(
        pluralContext("validation.arrayMinSize", { min }, { label: "Tags" }),
        { locale: "en" },
      );
    const lengthMessage = (min: number): string =>
      resolveMessage(
        pluralContext("validation.minLength", { min }, { label: "Name" }),
        { locale: "en" },
      );

    expect(arrayMessage(1)).toBe("Tags must contain at least 1 item");
    expect(arrayMessage(2)).toBe("Tags must contain at least 2 items");
    expect(lengthMessage(1)).toBe("Name must be at least 1 character");
    expect(lengthMessage(2)).toBe("Name must be at least 2 characters");
  });

  it("использует params.count раньше min, max и length", () => {
    const message = resolveMessage(
      pluralContext("validation.arrayMinSize", { min: 1, count: 5 }, { label: "Теги" }),
      { locale: "ru" },
    );
    expect(message).toBe("В поле Теги должно быть не меньше 1 элементов");
  });

  it("использует params.length, если других чисел нет", () => {
    const config: ValidationConfig = {
      locale: "ru",
      messages: {
        ru: {
          "validation.customCount": "базовое",
          "validation.customCount_one": "один",
          "validation.customCount_few": "несколько",
          "validation.customCount_many": "много",
        },
      },
    };
    expect(
      resolveMessage(pluralContext("validation.customCount", { length: 2 }), config),
    ).toBe("несколько");
  });

  it("использует число из value и длину массива или строки", () => {
    const config: ValidationConfig = {
      locale: "ru",
      messages: {
        ru: {
          "validation.customCount": "базовое",
          "validation.customCount_one": "один",
          "validation.customCount_few": "несколько",
          "validation.customCount_many": "много",
        },
      },
    };
    expect(
      resolveMessage(pluralContext("validation.customCount", {}, { value: 5 }), config),
    ).toBe("много");
    expect(
      resolveMessage(
        pluralContext("validation.customCount", {}, { value: [1, 2] }),
        config,
      ),
    ).toBe("несколько");
    expect(
      resolveMessage(
        pluralContext("validation.customCount", {}, { value: "abc" }),
        config,
      ),
    ).toBe("несколько");
  });

  it("возвращает базовое сообщение, если для ключа нет вариантов", () => {
    const message = resolveMessage(
      pluralContext(
        "validation.required",
        { count: 1 },
        { label: "Email", rule: "required" },
      ),
      { locale: "ru" },
    );
    expect(message).toBe("Поле Email обязательно");
  });

  it("использует базовое сообщение ru для локали без своих вариантов", () => {
    const message = resolveMessage(
      pluralContext("validation.arrayMinSize", { min: 2 }, { label: "Теги" }),
      { locale: "de" },
    );
    expect(message).toBe("В поле Теги должно быть не меньше 2 элементов");
  });

  it("возвращает базовое сообщение, если число не определено", () => {
    const message = resolveMessage(
      pluralContext("validation.arrayMinSize", {}, { label: "Теги" }),
      { locale: "ru" },
    );
    expect(message).toBe("В поле Теги должно быть не меньше {min} элементов");
  });

  it("использует плюральные варианты из config.messages", () => {
    const config: ValidationConfig = {
      locale: "ru",
      messages: {
        ru: {
          "validation.arrayMinSize_one": "Минимум {min} элемент",
          "validation.arrayMinSize_few": "Минимум {min} элемента",
        },
      },
    };
    expect(
      resolveMessage(
        pluralContext("validation.arrayMinSize", { min: 1 }, { label: "Теги" }),
        config,
      ),
    ).toBe("Минимум 1 элемент");
    expect(
      resolveMessage(
        pluralContext("validation.arrayMinSize", { min: 3 }, { label: "Теги" }),
        config,
      ),
    ).toBe("Минимум 3 элемента");
  });

  it("использует форму other для ru при дробном числе", () => {
    expect(
      resolveMessage(
        pluralContext("validation.arrayMinSize", { min: 1.5 }, { label: "Теги" }),
        { locale: "ru" },
      ),
    ).toBe("В поле Теги должно быть не меньше 1.5 элементов");
  });

  it("не теряет сообщение при частичном каталоге", () => {
    const config: ValidationConfig = {
      locale: "ru",
      messages: {
        ru: {
          "validation.arrayMinSize_one": "Минимум {min} элемент",
          "validation.arrayMinSize_few": "Минимум {min} элемента",
        },
      },
    };

    expect(
      resolveMessage(
        pluralContext("validation.arrayMinSize", { min: 1 }, { label: "Теги" }),
        config,
      ),
    ).toBe("Минимум 1 элемент");
    expect(
      resolveMessage(
        pluralContext("validation.arrayMinSize", { min: 3 }, { label: "Теги" }),
        config,
      ),
    ).toBe("Минимум 3 элемента");
    expect(
      resolveMessage(
        pluralContext("validation.arrayMinSize", { min: 5 }, { label: "Теги" }),
        config,
      ),
    ).toBe("В поле Теги должно быть не меньше 5 элементов");
    expect(
      resolveMessage(
        pluralContext("validation.arrayMinSize", { min: 1.5 }, { label: "Теги" }),
        config,
      ),
    ).toBe("В поле Теги должно быть не меньше 1.5 элементов");
  });
});

describe("Асинхронный MessageResolver", () => {
  class Model {
    @Required()
    public accessor name = "";
  }

  it("подставляет сообщение из асинхронного резолвера в validateAsync", async () => {
    const result = await validateAsync(new Model(), {
      resolve: async ({ label }) => `async:${label}`,
    });

    expect(result.valid).toBe(false);
    expect(result.errors[0]?.message).toBe("async:name");
  });

  it("бросает ошибку в синхронном validate", () => {
    expect(() =>
      validate(new Model(), { resolve: async () => "async" }),
    ).toThrow(/Асинхронный резолвер сообщений поддерживается только в validateAsync/);
  });

  it("поддерживает асинхронный резолвер во вложенных классах", async () => {
    class Child {
      @Required()
      public accessor value = "";
    }
    class Parent {
      @Nested()
      public accessor child = new Child();
    }

    const result = await validateAsync(new Parent(), {
      resolve: async ({ path }) => `async:${path}`,
    });

    expect(result.errors[0]?.path).toBe("child.value");
    expect(result.errors[0]?.message).toBe("async:child.value");
  });

  it("поддерживает асинхронный резолвер в safeParseAsync", async () => {
    const result = await safeParseAsync(new Model(), {
      resolve: async () => "async-safe",
    });

    expect(result.success).toBe(false);
    expect(result.errors[0]?.message).toBe("async-safe");
  });

  it("поддерживает асинхронный резолвер в validatePropertyAsync", async () => {
    const result = await validatePropertyAsync(new Model(), "name", {
      resolve: async () => "async-property",
    });

    expect(result.errors[0]?.message).toBe("async-property");
  });

  it("применяет асинхронный резолвер к ошибкам схемы типов", async () => {
    class Typed {
      public accessor value: unknown = 1;
    }
    defineSchema(Typed, { fields: { value: "number" } });
    const model = new Typed();
    model.value = "text";

    const result = await validateAsync(model, {
      resolve: async ({ key }) => `async:${key}`,
    });

    expect(result.errors[0]?.rule).toBe("type");
    expect(result.errors[0]?.message).toBe("async:validation.type");
  });
});

describe("createI18nextResolver", () => {
  it("передаёт ключ, params, label и defaultValue из встроенного каталога", () => {
    const calls: Array<{
      readonly key: string;
      readonly options: Readonly<Record<string, unknown>> | undefined;
    }> = [];
    const i18n = {
      t(key: string, options?: Readonly<Record<string, unknown>>): string {
        calls.push({ key, options });
        return "translated";
      },
    };
    const message = resolveMessage(
      contextOf({
        rule: "arrayMinSize",
        key: "validation.arrayMinSize",
        label: "Теги",
        params: { min: 3 },
        value: null,
      }),
      { locale: "ru", resolve: createI18nextResolver(i18n) },
    );

    expect(message).toBe("translated");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.key).toBe("validation.arrayMinSize");
    expect(calls[0]?.options?.min).toBe(3);
    expect(calls[0]?.options?.label).toBe("Теги");
    expect(calls[0]?.options?.defaultValue).toBe(
      "В поле {label} должно быть не меньше {min} элементов",
    );
  });

  it("применяет keyPrefix", () => {
    const keys: string[] = [];
    const i18n = {
      t(key: string): string {
        keys.push(key);
        return "translated";
      },
    };
    resolveMessage(
      contextOf({ key: "validation.required", label: "Email" }),
      { locale: "en", resolve: createI18nextResolver(i18n, { keyPrefix: "app." }) },
    );

    expect(keys).toEqual(["app.validation.required"]);
  });

  it("передаёт локаль в lng", () => {
    const options: Array<Readonly<Record<string, unknown>> | undefined> = [];
    const i18n = {
      t(_key: string, received?: Readonly<Record<string, unknown>>): string {
        options.push(received);
        return "translated";
      },
    };

    resolveMessage(
      contextOf({ key: "validation.required", label: "Email" }),
      { locale: "en", resolve: createI18nextResolver(i18n) },
    );

    expect(options[0]?.lng).toBe("en");
  });

  it("передаёт count из params", () => {
    const options: Array<Readonly<Record<string, unknown>> | undefined> = [];
    const i18n = {
      t(_key: string, received?: Readonly<Record<string, unknown>>): string {
        options.push(received);
        return "translated";
      },
    };

    resolveMessage(
      contextOf({
        rule: "arrayMinSize",
        key: "validation.arrayMinSize",
        label: "Теги",
        params: { min: 3 },
        value: null,
      }),
      { locale: "ru", resolve: createI18nextResolver(i18n) },
    );

    expect(options[0]?.count).toBe(3);
  });

  it("передаёт count из длины значения", () => {
    const options: Array<Readonly<Record<string, unknown>> | undefined> = [];
    const i18n = {
      t(_key: string, received?: Readonly<Record<string, unknown>>): string {
        options.push(received);
        return "translated";
      },
    };

    resolveMessage(
      contextOf({
        rule: "minLength",
        key: "validation.minLength",
        label: "Имя",
        params: {},
        value: "abc",
      }),
      { locale: "ru", resolve: createI18nextResolver(i18n) },
    );

    expect(options[0]?.count).toBe(3);
  });

  it("возвращает undefined, если t вернул не строку", () => {
    const i18n = {
      t: (() => null) as unknown as (
        key: string,
        options?: Readonly<Record<string, unknown>>,
      ) => string,
    };

    const message = resolveMessage(
      contextOf({ key: "validation.required", label: "Email" }),
      { locale: "ru", resolve: createI18nextResolver(i18n) },
    );

    expect(message).toBe("Поле Email обязательно");
  });

  it("возвращает undefined при пустом переводе", () => {
    const i18n = {
      t: (): string => "",
    };
    const message = resolveMessage(
      contextOf({ key: "validation.required", label: "Email" }),
      { locale: "ru", resolve: createI18nextResolver(i18n) },
    );

    expect(message).toBe("Поле Email обязательно");
  });

  it("возвращает undefined, если перевод совпадает с ключом", () => {
    const i18n = {
      t(key: string): string {
        return key;
      },
    };
    const message = resolveMessage(
      contextOf({ key: "validation.required", label: "Email" }),
      { locale: "ru", resolve: createI18nextResolver(i18n) },
    );

    expect(message).toBe("Поле Email обязательно");
  });

  it("возвращает undefined при пустом переводе и на en откатывается к каталогу", () => {
    const i18n = {
      t(key: string): string {
        return key;
      },
    };
    const message = resolveMessage(
      contextOf({ key: "validation.required", label: "Email" }),
      { locale: "en", resolve: createI18nextResolver(i18n) },
    );

    expect(message).toBe("Email is required");
  });

  it("интерполирует defaultValue, если i18n его возвращает", () => {
    const i18n = {
      t(
        _key: string,
        options?: Readonly<Record<string, unknown>>,
      ): string {
        return String(options?.defaultValue);
      },
    };
    const message = resolveMessage(
      contextOf({
        rule: "arrayMinSize",
        key: "validation.arrayMinSize",
        label: "Теги",
        params: { min: 3 },
        value: null,
      }),
      { locale: "ru", resolve: createI18nextResolver(i18n) },
    );

    expect(message).toBe("В поле Теги должно быть не меньше 3 элементов");
  });
});
