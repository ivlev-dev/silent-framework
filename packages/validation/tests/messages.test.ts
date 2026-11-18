import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LOCALE,
  configureValidation,
  getValidationConfig,
  resetValidationConfig,
  resolveMessage,
  validationMessages,
} from "../src/messages.js";
import type {
  MessageContext,
  MessageResolver,
  ValidationConfig,
} from "../src/types.js";

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

  it("содержит одинаковый набор ключей в ru и en", () => {
    const ruKeys = Object.keys(validationMessages.ru ?? {}).sort();
    const enKeys = Object.keys(validationMessages.en ?? {}).sort();
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
