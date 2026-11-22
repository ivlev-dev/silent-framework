import type {
  RuleDecorator,
  RuleDefinition,
  RuleOptions,
} from "../types.js";
import { ruleDecorator } from "../rule.js";

const EMAIL_PATTERN =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;
const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const ISO8601_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})?)?$/;
const PHONE_PATTERN = /^\+?[0-9 ()-]{7,20}$/;
const ALPHA_PATTERN = /^\p{L}+$/u;
const ALPHANUMERIC_PATTERN = /^[\p{L}\p{N}]+$/u;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HEX_COLOR_PATTERN =
  /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const BASE64_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function stringLength(value: string): number {
  return Array.from(value).length;
}

function numericParam(value: unknown): number {
  return typeof value === "number" ? value : Number.NaN;
}

function resolvePattern(value: unknown): RegExp | undefined {
  if (value instanceof RegExp) {
    return value;
  }
  if (typeof value === "string") {
    return new RegExp(value);
  }
  return undefined;
}

function testPattern(pattern: RegExp, value: string): boolean {
  pattern.lastIndex = 0;
  try {
    return pattern.test(value);
  } finally {
    pattern.lastIndex = 0;
  }
}

function isHttpUrl(value: string): boolean {
  if (value.trim() !== value) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leap ? 29 : 28;
  }
  if (month === 4 || month === 6 || month === 9 || month === 11) {
    return 30;
  }
  return 31;
}

function isIso8601(value: string): boolean {
  const match = ISO8601_PATTERN.exec(value);
  if (match === null) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return false;
  }
  if (match[4] !== undefined) {
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const second = match[6] === undefined ? 0 : Number(match[6]);
    const endOfDay = hour === 24 && minute === 0 && second === 0;
    if ((hour > 23 && !endOfDay) || minute > 59 || second > 59) {
      return false;
    }
    const zone = match[7];
    if (zone !== undefined && zone !== "Z") {
      const zoneHour = Number(zone.slice(1, 3));
      const zoneMinute = Number(zone.slice(4, 6));
      if (zoneHour > 23 || zoneMinute > 59) {
        return false;
      }
    }
  }
  // Date.parse отсекает невозможные значения (например, месяц 13),
  // но нормализует переполнение дня (2024-02-31 -> 2 марта), поэтому
  // компоненты проверяются выше вручную.
  return !Number.isNaN(Date.parse(value));
}

function isBase64(value: string): boolean {
  if (value.length === 0 || value.length % 4 !== 0) {
    return false;
  }
  return BASE64_PATTERN.test(value);
}

function isJson(value: string): boolean {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

export const stringRules = {
  minLength: {
    name: "minLength",
    params: { min: 0 },
    check: (value, context) =>
      isString(value) && stringLength(value) >= numericParam(context.params.min),
  } satisfies RuleDefinition,
  maxLength: {
    name: "maxLength",
    params: { max: Number.MAX_SAFE_INTEGER },
    check: (value, context) =>
      isString(value) && stringLength(value) <= numericParam(context.params.max),
  } satisfies RuleDefinition,
  length: {
    name: "length",
    params: { length: 0 },
    check: (value, context) =>
      isString(value) && stringLength(value) === numericParam(context.params.length),
  } satisfies RuleDefinition,
  matches: {
    name: "matches",
    params: { pattern: "" },
    check: (value, context) => {
      const pattern = resolvePattern(context.params.pattern);
      return isString(value) && pattern !== undefined && testPattern(pattern, value);
    },
  } satisfies RuleDefinition,
  isEmail: {
    name: "isEmail",
    params: {},
    check: (value) => isString(value) && EMAIL_PATTERN.test(value),
  } satisfies RuleDefinition,
  isUrl: {
    name: "isUrl",
    params: {},
    check: (value) => isString(value) && isHttpUrl(value),
  } satisfies RuleDefinition,
  isUUID: {
    name: "isUUID",
    params: {},
    check: (value) => isString(value) && UUID_PATTERN.test(value),
  } satisfies RuleDefinition,
  isISO8601: {
    name: "isISO8601",
    params: {},
    check: (value) => isString(value) && isIso8601(value),
  } satisfies RuleDefinition,
  isPhone: {
    name: "isPhone",
    params: {},
    check: (value) => isString(value) && PHONE_PATTERN.test(value),
  } satisfies RuleDefinition,
  isAlpha: {
    name: "isAlpha",
    params: {},
    check: (value) => isString(value) && ALPHA_PATTERN.test(value),
  } satisfies RuleDefinition,
  isAlphanumeric: {
    name: "isAlphanumeric",
    params: {},
    check: (value) => isString(value) && ALPHANUMERIC_PATTERN.test(value),
  } satisfies RuleDefinition,
  isSlug: {
    name: "isSlug",
    params: {},
    check: (value) => isString(value) && SLUG_PATTERN.test(value),
  } satisfies RuleDefinition,
  isHexColor: {
    name: "isHexColor",
    params: {},
    check: (value) => isString(value) && HEX_COLOR_PATTERN.test(value),
  } satisfies RuleDefinition,
  isBase64: {
    name: "isBase64",
    params: {},
    check: (value) => isString(value) && isBase64(value),
  } satisfies RuleDefinition,
  isJSON: {
    name: "isJSON",
    params: {},
    check: (value) => isString(value) && isJson(value),
  } satisfies RuleDefinition,
};

export function MinLength(min: number, options?: RuleOptions): RuleDecorator {
  return ruleDecorator({ ...stringRules.minLength, params: { min } }, options);
}

export function MaxLength(max: number, options?: RuleOptions): RuleDecorator {
  return ruleDecorator({ ...stringRules.maxLength, params: { max } }, options);
}

export function Length(length: number, options?: RuleOptions): RuleDecorator {
  return ruleDecorator({ ...stringRules.length, params: { length } }, options);
}

export function Matches(
  pattern: RegExp | string,
  options?: RuleOptions,
): RuleDecorator {
  const compiled = typeof pattern === "string" ? new RegExp(pattern) : pattern;
  return ruleDecorator(
    { ...stringRules.matches, params: { pattern: compiled } },
    options,
  );
}

export function IsEmail(options?: RuleOptions): RuleDecorator {
  return ruleDecorator(stringRules.isEmail, options);
}

export function IsUrl(options?: RuleOptions): RuleDecorator {
  return ruleDecorator(stringRules.isUrl, options);
}

export function IsUUID(options?: RuleOptions): RuleDecorator {
  return ruleDecorator(stringRules.isUUID, options);
}

export function IsISO8601(options?: RuleOptions): RuleDecorator {
  return ruleDecorator(stringRules.isISO8601, options);
}

export function IsPhone(options?: RuleOptions): RuleDecorator {
  return ruleDecorator(stringRules.isPhone, options);
}

export function IsAlpha(options?: RuleOptions): RuleDecorator {
  return ruleDecorator(stringRules.isAlpha, options);
}

export function IsAlphanumeric(options?: RuleOptions): RuleDecorator {
  return ruleDecorator(stringRules.isAlphanumeric, options);
}

export function IsSlug(options?: RuleOptions): RuleDecorator {
  return ruleDecorator(stringRules.isSlug, options);
}

export function IsHexColor(options?: RuleOptions): RuleDecorator {
  return ruleDecorator(stringRules.isHexColor, options);
}

export function IsBase64(options?: RuleOptions): RuleDecorator {
  return ruleDecorator(stringRules.isBase64, options);
}

export function IsJSON(options?: RuleOptions): RuleDecorator {
  return ruleDecorator(stringRules.isJSON, options);
}
