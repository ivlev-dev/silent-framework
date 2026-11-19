import type {
  RuleDecorator,
  RuleDefinition,
  RuleOptions,
} from "../types.js";
import { ruleDecorator } from "../rule.js";

function hasContent(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (value instanceof Map || value instanceof Set) {
    return value.size > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === "object") {
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return true;
    }
    return Reflect.ownKeys(value).length > 0;
  }
  return true;
}

export const presenceRules = {
  required: {
    name: "required",
    params: {},
    check: (value: unknown): boolean => (
      value !== undefined && value !== null && value !== ""
    ),
  },
  notNull: {
    name: "notNull",
    params: {},
    check: (value: unknown): boolean => value !== null && value !== undefined,
  },
  notUndefined: {
    name: "notUndefined",
    params: {},
    check: (value: unknown): boolean => value !== undefined,
  },
  isDefined: {
    name: "isDefined",
    params: {},
    check: (value: unknown): boolean => value !== undefined,
  },
  notEmpty: {
    name: "notEmpty",
    params: {},
    check: (value: unknown): boolean => hasContent(value),
  },
} satisfies Record<string, RuleDefinition>;

export function Required(options?: RuleOptions): RuleDecorator {
  return ruleDecorator(presenceRules.required, options);
}

export function NotNull(options?: RuleOptions): RuleDecorator {
  return ruleDecorator(presenceRules.notNull, options);
}

export function NotUndefined(options?: RuleOptions): RuleDecorator {
  return ruleDecorator(presenceRules.notUndefined, options);
}

export function IsDefined(options?: RuleOptions): RuleDecorator {
  return ruleDecorator(presenceRules.isDefined, options);
}

export function NotEmpty(options?: RuleOptions): RuleDecorator {
  return ruleDecorator(presenceRules.notEmpty, options);
}
