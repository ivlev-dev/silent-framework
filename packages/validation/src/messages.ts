import type {
  MessageContext,
  MessageResolver,
  ValidationConfig,
} from "./types.js";

export const DEFAULT_LOCALE = "ru";

export const validationMessages: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  ru: {
    "validation.required": "Поле {label} обязательно",
    "validation.notNull": "Поле {label} не может быть null",
    "validation.notUndefined": "Поле {label} должно быть определено",
    "validation.notEmpty": "Поле {label} не может быть пустым",
    "validation.isDefined": "Поле {label} должно быть определено",
    "validation.isString": "Поле {label} должно быть строкой",
    "validation.isBoolean": "Поле {label} должно быть логическим значением",
    "validation.isInt": "Поле {label} должно быть целым числом",
    "validation.isFloat": "Поле {label} должно быть числом с плавающей точкой",
    "validation.isNumber": "Поле {label} должно быть числом",
    "validation.isArray": "Поле {label} должно быть массивом",
    "validation.isDate": "Поле {label} должно быть датой",
    "validation.isEnum": "Поле {label} должно быть одним из допустимых значений",
    "validation.isInstanceOf": "Поле {label} должно быть экземпляром {type}",
    "validation.isObject": "Поле {label} должно быть объектом",
    "validation.isFunction": "Поле {label} должно быть функцией",
    "validation.min": "Значение поля {label} должно быть не меньше {min}",
    "validation.max": "Значение поля {label} должно быть не больше {max}",
    "validation.between": "Значение поля {label} должно быть от {min} до {max}",
    "validation.positive": "Значение поля {label} должно быть положительным",
    "validation.negative": "Значение поля {label} должно быть отрицательным",
    "validation.nonNegative": "Значение поля {label} не может быть отрицательным",
    "validation.nonPositive": "Значение поля {label} не может быть положительным",
    "validation.multipleOf": "Значение поля {label} должно быть кратно {factor}",
    "validation.minLength": "Длина поля {label} должна быть не меньше {min}",
    "validation.minLength_one": "Длина поля {label} должна быть не меньше {min} символа",
    "validation.minLength_few": "Длина поля {label} должна быть не меньше {min} символов",
    "validation.minLength_many": "Длина поля {label} должна быть не меньше {min} символов",
    "validation.maxLength": "Длина поля {label} должна быть не больше {max}",
    "validation.maxLength_one": "Длина поля {label} должна быть не больше {max} символа",
    "validation.maxLength_few": "Длина поля {label} должна быть не больше {max} символов",
    "validation.maxLength_many": "Длина поля {label} должна быть не больше {max} символов",
    "validation.length": "Длина поля {label} должна быть равна {length}",
    "validation.matches": "Поле {label} имеет неверный формат",
    "validation.isEmail": "Поле {label} должно быть корректным email",
    "validation.isUrl": "Поле {label} должно быть корректным URL",
    "validation.isUUID": "Поле {label} должно быть корректным UUID",
    "validation.isISO8601": "Поле {label} должно быть датой ISO 8601",
    "validation.isPhone": "Поле {label} должно быть корректным телефоном",
    "validation.isAlpha": "Поле {label} должно содержать только буквы",
    "validation.isAlphanumeric": "Поле {label} должно содержать только буквы и цифры",
    "validation.isSlug": "Поле {label} должно быть корректным slug",
    "validation.isHexColor": "Поле {label} должно быть цветом в формате HEX",
    "validation.isBase64": "Поле {label} должно быть корректным Base64",
    "validation.isJSON": "Поле {label} должно содержать корректный JSON",
    "validation.arrayMinSize": "В поле {label} должно быть не меньше {min} элементов",
    "validation.arrayMinSize_one": "В поле {label} должно быть не меньше {min} элемента",
    "validation.arrayMinSize_few": "В поле {label} должно быть не меньше {min} элементов",
    "validation.arrayMinSize_many": "В поле {label} должно быть не меньше {min} элементов",
    "validation.arrayMaxSize": "В поле {label} должно быть не больше {max} элементов",
    "validation.arrayMaxSize_one": "В поле {label} должно быть не больше {max} элемента",
    "validation.arrayMaxSize_few": "В поле {label} должно быть не больше {max} элементов",
    "validation.arrayMaxSize_many": "В поле {label} должно быть не больше {max} элементов",
    "validation.arrayNotEmpty": "Поле {label} не может быть пустым массивом",
    "validation.arrayUnique": "Элементы поля {label} не должны повторяться",
    "validation.hasKey": "В поле {label} должен быть ключ {key}",
    "validation.equals": "Поле {label} должно быть равно {expected}",
    "validation.notEquals": "Поле {label} не должно быть равно {expected}",
    "validation.isIn": "Поле {label} должно быть одним из: {values}",
    "validation.notIn": "Поле {label} не должно быть одним из: {values}",
    "validation.nested": "Поле {label} содержит некорректный объект",
    "validation.each": "Элемент {index} поля {label} некорректен",
    "validation.custom": "Поле {label} не прошло проверку",
    "validation.type": "Поле {label} должно быть типа {type}",
  },
  en: {
    "validation.required": "{label} is required",
    "validation.notNull": "{label} must not be null",
    "validation.notUndefined": "{label} must be defined",
    "validation.notEmpty": "{label} must not be empty",
    "validation.isDefined": "{label} must be defined",
    "validation.isString": "{label} must be a string",
    "validation.isBoolean": "{label} must be a boolean",
    "validation.isInt": "{label} must be an integer",
    "validation.isFloat": "{label} must be a float",
    "validation.isNumber": "{label} must be a number",
    "validation.isArray": "{label} must be an array",
    "validation.isDate": "{label} must be a date",
    "validation.isEnum": "{label} must be one of the allowed values",
    "validation.isInstanceOf": "{label} must be an instance of {type}",
    "validation.isObject": "{label} must be an object",
    "validation.isFunction": "{label} must be a function",
    "validation.min": "{label} must be at least {min}",
    "validation.max": "{label} must be at most {max}",
    "validation.between": "{label} must be between {min} and {max}",
    "validation.positive": "{label} must be positive",
    "validation.negative": "{label} must be negative",
    "validation.nonNegative": "{label} must not be negative",
    "validation.nonPositive": "{label} must not be positive",
    "validation.multipleOf": "{label} must be a multiple of {factor}",
    "validation.minLength": "{label} must be at least {min} characters",
    "validation.minLength_one": "{label} must be at least {min} character",
    "validation.minLength_other": "{label} must be at least {min} characters",
    "validation.maxLength": "{label} must be at most {max} characters",
    "validation.maxLength_one": "{label} must be at most {max} character",
    "validation.maxLength_other": "{label} must be at most {max} characters",
    "validation.length": "{label} must be exactly {length} characters",
    "validation.matches": "{label} has an invalid format",
    "validation.isEmail": "{label} must be a valid email",
    "validation.isUrl": "{label} must be a valid URL",
    "validation.isUUID": "{label} must be a valid UUID",
    "validation.isISO8601": "{label} must be an ISO 8601 date",
    "validation.isPhone": "{label} must be a valid phone number",
    "validation.isAlpha": "{label} must contain only letters",
    "validation.isAlphanumeric": "{label} must contain only letters and digits",
    "validation.isSlug": "{label} must be a valid slug",
    "validation.isHexColor": "{label} must be a HEX color",
    "validation.isBase64": "{label} must be valid Base64",
    "validation.isJSON": "{label} must be valid JSON",
    "validation.arrayMinSize": "{label} must contain at least {min} items",
    "validation.arrayMinSize_one": "{label} must contain at least {min} item",
    "validation.arrayMinSize_other": "{label} must contain at least {min} items",
    "validation.arrayMaxSize": "{label} must contain at most {max} items",
    "validation.arrayMaxSize_one": "{label} must contain at most {max} item",
    "validation.arrayMaxSize_other": "{label} must contain at most {max} items",
    "validation.arrayNotEmpty": "{label} must not be an empty array",
    "validation.arrayUnique": "{label} items must be unique",
    "validation.hasKey": "{label} must contain the key {key}",
    "validation.equals": "{label} must equal {expected}",
    "validation.notEquals": "{label} must not equal {expected}",
    "validation.isIn": "{label} must be one of: {values}",
    "validation.notIn": "{label} must not be one of: {values}",
    "validation.nested": "{label} contains an invalid object",
    "validation.each": "Item {index} of {label} is invalid",
    "validation.custom": "{label} failed validation",
    "validation.type": "{label} must be of type {type}",
  },
};

const ASYNC_RESOLVER_ERROR =
  "Асинхронный резолвер сообщений поддерживается только в validateAsync";

const pluralRulesCache = new Map<string, Intl.PluralRules | null>();

let currentConfig: ValidationConfig = {};

export function configureValidation(config: ValidationConfig): void {
  currentConfig = {
    ...currentConfig,
    ...(config.locale === undefined ? {} : { locale: config.locale }),
    ...(config.resolve === undefined ? {} : { resolve: config.resolve }),
    ...(config.messages === undefined ? {} : { messages: config.messages }),
    ...(config.cascade === undefined ? {} : { cascade: config.cascade }),
  };
}

export function resetValidationConfig(): void {
  currentConfig = {};
}

export function getValidationConfig(): ValidationConfig {
  return currentConfig;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object"
    && value !== null
    && typeof (value as { then?: unknown }).then === "function"
  );
}

function pluralRulesFor(locale: string): Intl.PluralRules | null {
  const cached = pluralRulesCache.get(locale);
  if (cached !== undefined) {
    return cached;
  }
  let rules: Intl.PluralRules | null = null;
  try {
    rules = new Intl.PluralRules(locale);
  } catch {
    rules = null;
  }
  pluralRulesCache.set(locale, rules);
  return rules;
}

function pluralCount(context: MessageContext): number | undefined {
  for (const name of ["count", "min", "max", "length"] as const) {
    const value = context.params[name];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  if (typeof context.value === "number" && Number.isFinite(context.value)) {
    return context.value;
  }
  if (Array.isArray(context.value)) {
    return context.value.length;
  }
  if (typeof context.value === "string") {
    return context.value.length;
  }
  return undefined;
}

function pluralSuffix(
  locale: string,
  context: MessageContext,
): string | undefined {
  const count = pluralCount(context);
  if (count === undefined) {
    return undefined;
  }
  const rules = pluralRulesFor(locale);
  if (rules === null) {
    return undefined;
  }
  return rules.select(count);
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).join(", ");
  }
  if (value !== null && typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function interpolate(
  template: string,
  context: MessageContext,
): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    if (name === "field") {
      return context.field;
    }
    if (name === "label") {
      return context.label;
    }
    if (name === "value") {
      return formatValue(context.value);
    }
    if (name === "index" && context.index !== undefined) {
      return String(context.index);
    }
    const value = context.params[name];
    return value === undefined ? match : formatValue(value);
  });
}

type MessageCatalog = Readonly<Record<string, string>>;

function lookupCatalog(
  catalog: MessageCatalog | undefined,
  key: string,
  suffix: string | undefined,
): string | undefined {
  if (catalog === undefined) {
    return undefined;
  }
  if (suffix !== undefined) {
    const variant = catalog[`${key}_${suffix}`];
    if (variant !== undefined) {
      return variant;
    }
  }
  return catalog[key];
}

function lookupSources(
  sources: readonly (MessageCatalog | undefined)[],
  key: string,
  suffix: string | undefined,
): string | undefined {
  for (const source of sources) {
    const template = lookupCatalog(source, key, suffix);
    if (template !== undefined) {
      return template;
    }
  }
  return undefined;
}

function catalogTemplate(
  config: ValidationConfig,
  locale: string,
  key: string,
  context: MessageContext,
): string | undefined {
  return lookupSources(
    [
      config.messages?.[locale],
      config.messages?.[DEFAULT_LOCALE],
      validationMessages[locale],
      validationMessages[DEFAULT_LOCALE],
      validationMessages.en,
    ],
    key,
    pluralSuffix(locale, context),
  );
}

function builtinTemplate(
  locale: string,
  key: string,
  context: MessageContext,
): string | undefined {
  return lookupSources(
    [
      validationMessages[locale],
      validationMessages[DEFAULT_LOCALE],
      validationMessages.en,
    ],
    key,
    pluralSuffix(locale, context),
  );
}

export function resolveMessage(
  context: MessageContext,
  config: ValidationConfig,
): string {
  const locale = config.locale ?? DEFAULT_LOCALE;
  if (typeof context.message === "function") {
    const produced: unknown = context.message({ ...context, locale });
    if (isThenable(produced)) {
      throw new Error(ASYNC_RESOLVER_ERROR);
    }
    return produced as string;
  }
  if (typeof context.message === "string") {
    return interpolate(context.message, context);
  }
  const key = context.messageKey ?? context.key;
  const resolved = config.resolve?.({ ...context, key, locale });
  if (isThenable(resolved)) {
    throw new Error(ASYNC_RESOLVER_ERROR);
  }
  if (resolved !== undefined) {
    return interpolate(resolved, context);
  }
  const template = catalogTemplate(config, locale, key, context);
  if (template !== undefined) {
    return interpolate(template, context);
  }
  return `${context.label}: ${key}`;
}

export async function resolveMessageAsync(
  context: MessageContext,
  config: ValidationConfig,
): Promise<string> {
  const locale = config.locale ?? DEFAULT_LOCALE;
  if (typeof context.message === "function") {
    const produced: unknown = await context.message({ ...context, locale });
    if (isThenable(produced)) {
      throw new Error(ASYNC_RESOLVER_ERROR);
    }
    return produced as string;
  }
  if (typeof context.message === "string") {
    return interpolate(context.message, context);
  }
  const key = context.messageKey ?? context.key;
  const resolved = await config.resolve?.({ ...context, key, locale });
  if (resolved !== undefined) {
    return interpolate(resolved, context);
  }
  const template = catalogTemplate(config, locale, key, context);
  if (template !== undefined) {
    return interpolate(template, context);
  }
  return `${context.label}: ${key}`;
}

export interface I18nextLike {
  t(key: string, options?: Readonly<Record<string, unknown>>): string;
}

export function createI18nextResolver(
  i18n: I18nextLike,
  options?: { readonly keyPrefix?: string },
): MessageResolver {
  const keyPrefix = options?.keyPrefix ?? "";
  return (context) => {
    const key = `${keyPrefix}${context.key}`;
    const defaultValue = builtinTemplate(context.locale, context.key, context)
      ?? key;
    const translated = i18n.t(key, {
      ...context.params,
      label: context.label,
      defaultValue,
    });
    if (translated.trim().length === 0 || translated === key) {
      return undefined;
    }
    return translated;
  };
}
