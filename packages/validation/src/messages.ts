import type {
  MessageContext,
  MessageResolver,
  ValidationConfig,
} from "./types.js";
import { isThenable, suppress } from "./thenable.js";

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
    "validation.minLength_one": "Длина поля {label} должна быть не меньше {min} символ",
    "validation.minLength_few": "Длина поля {label} должна быть не меньше {min} символа",
    "validation.minLength_many": "Длина поля {label} должна быть не меньше {min} символов",
    "validation.minLength_other": "Длина поля {label} должна быть не меньше {min} символов",
    "validation.maxLength": "Длина поля {label} должна быть не больше {max}",
    "validation.maxLength_one": "Длина поля {label} должна быть не больше {max} символ",
    "validation.maxLength_few": "Длина поля {label} должна быть не больше {max} символа",
    "validation.maxLength_many": "Длина поля {label} должна быть не больше {max} символов",
    "validation.maxLength_other": "Длина поля {label} должна быть не больше {max} символов",
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
    "validation.arrayMinSize_one": "В поле {label} должно быть не меньше {min} элемент",
    "validation.arrayMinSize_few": "В поле {label} должно быть не меньше {min} элемента",
    "validation.arrayMinSize_many": "В поле {label} должно быть не меньше {min} элементов",
    "validation.arrayMinSize_other": "В поле {label} должно быть не меньше {min} элементов",
    "validation.arrayMaxSize": "В поле {label} должно быть не больше {max} элементов",
    "validation.arrayMaxSize_one": "В поле {label} должно быть не больше {max} элемент",
    "validation.arrayMaxSize_few": "В поле {label} должно быть не больше {max} элемента",
    "validation.arrayMaxSize_many": "В поле {label} должно быть не больше {max} элементов",
    "validation.arrayMaxSize_other": "В поле {label} должно быть не больше {max} элементов",
    "validation.arrayNotEmpty": "Поле {label} не может быть пустым массивом",
    "validation.arrayUnique": "Элементы поля {label} не должны повторяться",
    "validation.hasKey": "В поле {label} должен быть ключ {key}",
    "validation.equals": "Поле {label} должно быть равно {expected}",
    "validation.notEquals": "Поле {label} не должно быть равно {expected}",
    "validation.isIn": "Поле {label} должно быть одним из: {values}",
    "validation.notIn": "Поле {label} не должно быть одним из: {values}",
    "validation.nested": "Поле {label} содержит некорректный объект",
    "validation.each": "Элемент {index} поля {label} некорректен",
    "validation.eachValue": "Поле {label} должно быть коллекцией",
    "validation.custom": "Поле {label} не прошло проверку",
    "validation.depth": "Поле {label} слишком глубоко вложено",
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
    "validation.eachValue": "{label} must be a collection",
    "validation.custom": "{label} failed validation",
    "validation.depth": "{label} is nested too deeply",
    "validation.type": "{label} must be of type {type}",
  },
};

const ASYNC_RESOLVER_ERROR =
  "Асинхронный резолвер сообщений поддерживается только в validateAsync";

const PLURAL_RULES_CACHE_LIMIT = 50;

const MESSAGE_CACHE_LIMIT = 1024;

const PLURAL_SUFFIX_CACHE_LIMIT = 1024;

const pluralRulesCache = new Map<string, Intl.PluralRules | null>();

const pluralSuffixCache = new Map<string, string>();

const paramsKeys = new WeakMap<object, string | null>();

/**
 * Готовые строки для шаблонов каталога без `{value}`/`{index}`.
 * Пользовательские резолверы и `message` не кэшируются.
 */
const messageCache = new Map<string, string>();

const catalogIds = new WeakMap<object, number>();

let nextCatalogId = 0;

let currentConfig: ValidationConfig = {};

export function configureValidation(config: ValidationConfig): void {
  currentConfig = {
    ...currentConfig,
    ...(config.locale === undefined ? {} : { locale: config.locale }),
    ...(config.resolve === undefined ? {} : { resolve: config.resolve }),
    ...(config.messages === undefined ? {} : { messages: config.messages }),
    ...(config.cascade === undefined ? {} : { cascade: config.cascade }),
  };
  pluralRulesCache.clear();
  pluralSuffixCache.clear();
  messageCache.clear();
}

export function resetValidationConfig(): void {
  currentConfig = {};
  pluralRulesCache.clear();
  pluralSuffixCache.clear();
  messageCache.clear();
}

export function getValidationConfig(): ValidationConfig {
  return currentConfig;
}

/** @internal Размер кэша сообщений (для тестов). */
export function validationMessageCacheSize(): number {
  return messageCache.size;
}

function catalogIdOf(
  messages: ValidationConfig["messages"],
): number {
  if (messages === undefined) {
    return 0;
  }
  let id = catalogIds.get(messages);
  if (id === undefined) {
    nextCatalogId += 1;
    id = nextCatalogId;
    catalogIds.set(messages, id);
  }
  return id;
}

function scalarParamsKey(
  params: Readonly<Record<string, unknown>>,
): string | undefined {
  const cached = paramsKeys.get(params);
  if (cached !== undefined) {
    return cached ?? undefined;
  }
  const parts: string[] = [];
  for (const key of Object.keys(params).sort()) {
    const value = params[key];
    if (value === null) {
      parts.push(JSON.stringify([key, "null"]));
      continue;
    }
    if (value === undefined) {
      parts.push(JSON.stringify([key, "undefined"]));
      continue;
    }
    const type = typeof value;
    if (type === "string" || type === "number" || type === "boolean") {
      parts.push(JSON.stringify([key, type, String(value)]));
      continue;
    }
    // Объекты, массивы, функции и символы не сериализуем: такие сообщения
    // не кэшируем, чтобы не получить ложное попадание.
    paramsKeys.set(params, null);
    return undefined;
  }
  const encoded = JSON.stringify(parts);
  paramsKeys.set(params, encoded);
  return encoded;
}

function messageCacheKey(
  locale: string,
  catalogId: number,
  key: string,
  suffix: string | undefined,
  field: string,
  label: string,
  paramsKey: string,
): string {
  return `${locale}\u0000${catalogId}\u0000${key}\u0000${suffix ?? ""}\u0000${field}\u0000${label}\u0000${paramsKey}`;
}

function cachedMessage(key: string): string | undefined {
  const cached = messageCache.get(key);
  if (cached === undefined) {
    return undefined;
  }
  // Обновляем позицию: Map хранит порядок вставки, получаем LRU.
  messageCache.delete(key);
  messageCache.set(key, cached);
  return cached;
}

function storeMessage(key: string, message: string): void {
  if (messageCache.size >= MESSAGE_CACHE_LIMIT) {
    const oldest = messageCache.keys().next().value;
    if (oldest !== undefined) {
      messageCache.delete(oldest);
    }
  }
  messageCache.set(key, message);
}

function templateDependsOnValue(template: string): boolean {
  return template.includes("{value}") || template.includes("{index}");
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
  if (pluralRulesCache.size >= PLURAL_RULES_CACHE_LIMIT) {
    pluralRulesCache.clear();
  }
  pluralRulesCache.set(locale, rules);
  return rules;
}

function paramCount(context: MessageContext): number | undefined {
  for (const name of ["count", "min", "max", "length"] as const) {
    const value = context.params[name];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function valueSize(value: unknown): number | undefined {
  if (typeof value === "string") {
    return Array.from(value).length;
  }
  if (Array.isArray(value)) {
    return value.length;
  }
  if (value instanceof Set) {
    return value.size;
  }
  return undefined;
}

function pluralCount(context: MessageContext): number | undefined {
  const fromParams = paramCount(context);
  if (fromParams !== undefined) {
    return fromParams;
  }
  if (typeof context.value === "number" && Number.isFinite(context.value)) {
    return context.value;
  }
  return valueSize(context.value);
}

const COUNT_RULE_NAMES: ReadonlySet<string> = new Set([
  "arrayMinSize",
  "arrayMaxSize",
  "arrayNotEmpty",
  "arrayUnique",
  "length",
  "minLength",
  "maxLength",
  "each",
  "eachValue",
]);

function resolverCount(context: MessageContext): number | undefined {
  const fromParams = paramCount(context);
  if (fromParams !== undefined) {
    return fromParams;
  }
  if (!COUNT_RULE_NAMES.has(context.rule)) {
    return undefined;
  }
  return valueSize(context.value);
}

function pluralSuffix(
  locale: string,
  context: MessageContext,
): string | undefined {
  const count = pluralCount(context);
  if (count === undefined) {
    return undefined;
  }
  const cacheKey = `${locale}\u0000${count}`;
  const cached = pluralSuffixCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  const rules = pluralRulesFor(locale);
  if (rules === null) {
    return undefined;
  }
  const suffix = rules.select(count);
  if (pluralSuffixCache.size >= PLURAL_SUFFIX_CACHE_LIMIT) {
    pluralSuffixCache.clear();
  }
  pluralSuffixCache.set(cacheKey, suffix);
  return suffix;
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
    if (!Object.hasOwn(context.params, name)) {
      return match;
    }
    const value = context.params[name];
    return value === undefined ? match : formatValue(value);
  });
}

type MessageCatalog = Readonly<Record<string, string>>;

function ownTemplate(
  catalog: MessageCatalog | undefined,
  key: string,
): string | undefined {
  if (catalog === undefined || !Object.hasOwn(catalog, key)) {
    return undefined;
  }
  const template = catalog[key];
  return typeof template === "string" ? template : undefined;
}

function variantKeys(key: string, suffix: string | undefined): readonly string[] {
  if (suffix === undefined) {
    return [key];
  }
  if (suffix === "other") {
    return [`${key}_other`, key];
  }
  return [`${key}_${suffix}`, `${key}_other`, key];
}

function lookupSources(
  sources: readonly (MessageCatalog | undefined)[],
  key: string,
  suffix: string | undefined,
): string | undefined {
  for (const source of sources) {
    for (const candidate of variantKeys(key, suffix)) {
      const template = ownTemplate(source, candidate);
      if (template !== undefined) {
        return template;
      }
    }
  }
  return undefined;
}

function catalogTemplate(
  config: ValidationConfig,
  locale: string,
  key: string,
  suffix: string | undefined,
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
    suffix,
  );
}

function resolveCatalogMessage(
  context: MessageContext,
  config: ValidationConfig,
  locale: string,
  key: string,
): string {
  const suffix = pluralSuffix(locale, context);
  const paramsKey = config.resolve === undefined
    ? scalarParamsKey(context.params)
    : undefined;
  const cacheKey = paramsKey === undefined
    ? undefined
    : messageCacheKey(
      locale,
      catalogIdOf(config.messages),
      key,
      suffix,
      context.field,
      context.label,
      paramsKey,
    );
  if (cacheKey !== undefined) {
    const cached = cachedMessage(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
  }
  const template = catalogTemplate(config, locale, key, suffix);
  if (template === undefined) {
    return `${context.label}: ${key}`;
  }
  const message = interpolate(template, context);
  if (cacheKey !== undefined && !templateDependsOnValue(template)) {
    storeMessage(cacheKey, message);
  }
  return message;
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
      suppress(produced);
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
    suppress(resolved);
    throw new Error(ASYNC_RESOLVER_ERROR);
  }
  if (resolved !== undefined) {
    return interpolate(resolved, context);
  }
  return resolveCatalogMessage(context, config, locale, key);
}

export async function resolveMessageAsync(
  context: MessageContext,
  config: ValidationConfig,
): Promise<string> {
  const locale = config.locale ?? DEFAULT_LOCALE;
  if (typeof context.message === "function") {
    const produced: unknown = await context.message({ ...context, locale });
    if (isThenable(produced)) {
      suppress(produced);
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
  return resolveCatalogMessage(context, config, locale, key);
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
    const count = resolverCount(context);
    const translated: unknown = i18n.t(key, {
      ...context.params,
      label: context.label,
      lng: context.locale,
      defaultValue,
      ...(count === undefined ? {} : { count }),
    });
    if (typeof translated !== "string") {
      return undefined;
    }
    if (translated.trim().length === 0 || translated === key) {
      return undefined;
    }
    return translated;
  };
}
