import type {
  RuleDecorator,
  RuleDefinition,
  RuleOptions,
  RuleRunContext,
} from "../types.js";
import { ruleDecorator } from "../rule.js";

export type EnumSource = readonly unknown[] | Record<string, unknown>;

export type AnyConstructor = abstract new (...args: never[]) => unknown;

function enumValues(source: unknown): readonly unknown[] {
  if (Array.isArray(source)) {
    return source;
  }
  if (source !== null && typeof source === "object") {
    const values: unknown[] = [];
    for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
      if (/^(?:0|[1-9]\d*)$/.test(key)) {
        continue;
      }
      values.push(value);
    }
    return values;
  }
  return [];
}

function enumParam(context: RuleRunContext): readonly unknown[] {
  return enumValues(context.params["values"]);
}

function constructorParam(context: RuleRunContext): AnyConstructor | undefined {
  const ctor = context.params["ctor"];
  return typeof ctor === "function" ? (ctor as AnyConstructor) : undefined;
}

export const typeRules = {
  isString: {
    name: "isString",
    params: {},
    check: (value: unknown): boolean => typeof value === "string",
  },
  isBoolean: {
    name: "isBoolean",
    params: {},
    check: (value: unknown): boolean => typeof value === "boolean",
  },
  isInt: {
    name: "isInt",
    params: {},
    check: (value: unknown): boolean => Number.isInteger(value),
  },
  isFloat: {
    name: "isFloat",
    params: {},
    check: (value: unknown): boolean => (
      typeof value === "number"
      && Number.isFinite(value)
      && !Number.isInteger(value)
    ),
  },
  isNumber: {
    name: "isNumber",
    params: {},
    check: (value: unknown): boolean => (
      typeof value === "number" && Number.isFinite(value)
    ),
  },
  isArray: {
    name: "isArray",
    params: {},
    check: (value: unknown): boolean => Array.isArray(value),
  },
  isDate: {
    name: "isDate",
    params: {},
    check: (value: unknown): boolean => (
      value instanceof Date && !Number.isNaN(value.getTime())
    ),
  },
  isFunction: {
    name: "isFunction",
    params: {},
    check: (value: unknown): boolean => typeof value === "function",
  },
  isObject: {
    name: "isObject",
    params: {},
    check: (value: unknown): boolean => (
      typeof value === "object" && value !== null && !Array.isArray(value)
    ),
  },
  isEnum: {
    name: "isEnum",
    params: { values: [] },
    check: (value: unknown, context: RuleRunContext): boolean => (
      enumParam(context).includes(value)
    ),
  },
  isInstanceOf: {
    name: "isInstanceOf",
    params: { type: "" },
    check: (value: unknown, context: RuleRunContext): boolean => {
      const ctor = constructorParam(context);
      if (ctor === undefined) {
        return false;
      }
      try {
        return value instanceof ctor;
      } catch {
        return false;
      }
    },
  },
} satisfies Record<string, RuleDefinition>;

export function IsString(options?: RuleOptions): RuleDecorator {
  return ruleDecorator(typeRules.isString, options);
}

export function IsBoolean(options?: RuleOptions): RuleDecorator {
  return ruleDecorator(typeRules.isBoolean, options);
}

export function IsInt(options?: RuleOptions): RuleDecorator {
  return ruleDecorator(typeRules.isInt, options);
}

export function IsFloat(options?: RuleOptions): RuleDecorator {
  return ruleDecorator(typeRules.isFloat, options);
}

export function IsNumber(options?: RuleOptions): RuleDecorator {
  return ruleDecorator(typeRules.isNumber, options);
}

export function IsArray(options?: RuleOptions): RuleDecorator {
  return ruleDecorator(typeRules.isArray, options);
}

export function IsDate(options?: RuleOptions): RuleDecorator {
  return ruleDecorator(typeRules.isDate, options);
}

export function IsFunction(options?: RuleOptions): RuleDecorator {
  return ruleDecorator(typeRules.isFunction, options);
}

export function IsObject(options?: RuleOptions): RuleDecorator {
  return ruleDecorator(typeRules.isObject, options);
}

export function IsEnum(
  values: EnumSource,
  options?: RuleOptions,
): RuleDecorator {
  return ruleDecorator(
    { ...typeRules.isEnum, params: { values: enumValues(values) } },
    options,
  );
}

export function IsInstanceOf(
  ctor: AnyConstructor,
  options?: RuleOptions,
): RuleDecorator {
  return ruleDecorator(
    { ...typeRules.isInstanceOf, params: { type: ctor.name, ctor } },
    options,
  );
}
