import type {
  RuleDecorator,
  RuleDefinition,
  RuleOptions,
} from "../types.js";
import { ruleDecorator } from "../rule.js";

type Collection = readonly unknown[] | ReadonlySet<unknown>;

function isCollection(value: unknown): value is Collection {
  return Array.isArray(value) || value instanceof Set;
}

function sizeOf(value: unknown): number | undefined {
  if (Array.isArray(value)) {
    return value.length;
  }
  if (value instanceof Set) {
    return value.size;
  }
  return undefined;
}

function numericParam(value: unknown): number {
  return typeof value === "number" ? value : Number.NaN;
}

function isPropertyKey(value: unknown): value is PropertyKey {
  return (
    typeof value === "string"
    || typeof value === "number"
    || typeof value === "symbol"
  );
}

function hasKey(value: unknown, key: unknown): boolean {
  if (!isPropertyKey(key)) {
    return false;
  }
  if (value instanceof Map) {
    return value.has(key);
  }
  if (
    typeof value !== "object"
    || value === null
    || Array.isArray(value)
    || value instanceof Set
  ) {
    return false;
  }
  return Object.hasOwn(value, key);
}

function isUnique(value: Collection): boolean {
  const seen = new Set<unknown>();
  for (const item of value) {
    if (seen.has(item)) {
      return false;
    }
    seen.add(item);
  }
  return true;
}

export const collectionRules = {
  arrayMinSize: {
    name: "arrayMinSize",
    params: { min: 0 },
    check: (value, context) => {
      const size = sizeOf(value);
      return size !== undefined && size >= numericParam(context.params.min);
    },
  } satisfies RuleDefinition,
  arrayMaxSize: {
    name: "arrayMaxSize",
    params: { max: Number.MAX_SAFE_INTEGER },
    check: (value, context) => {
      const size = sizeOf(value);
      return size !== undefined && size <= numericParam(context.params.max);
    },
  } satisfies RuleDefinition,
  arrayNotEmpty: {
    name: "arrayNotEmpty",
    params: {},
    check: (value) => {
      const size = sizeOf(value);
      return size !== undefined && size > 0;
    },
  } satisfies RuleDefinition,
  arrayUnique: {
    name: "arrayUnique",
    params: {},
    check: (value) => isCollection(value) && isUnique(value),
  } satisfies RuleDefinition,
  hasKey: {
    name: "hasKey",
    params: { key: "" },
    check: (value, context) => hasKey(value, context.params.key),
  } satisfies RuleDefinition,
  nested: {
    name: "nested",
    params: {},
    nested: "object",
    check: (value) =>
      typeof value === "object" && value !== null && !Array.isArray(value),
  } satisfies RuleDefinition,
  each: {
    name: "each",
    params: {},
    nested: "each",
    check: (value) => Array.isArray(value) || value instanceof Set,
  } satisfies RuleDefinition,
};

export function ArrayMinSize(
  min: number,
  options?: RuleOptions,
): RuleDecorator {
  return ruleDecorator(
    { ...collectionRules.arrayMinSize, params: { min } },
    options,
  );
}

export function ArrayMaxSize(
  max: number,
  options?: RuleOptions,
): RuleDecorator {
  return ruleDecorator(
    { ...collectionRules.arrayMaxSize, params: { max } },
    options,
  );
}

export function ArrayNotEmpty(options?: RuleOptions): RuleDecorator {
  return ruleDecorator(collectionRules.arrayNotEmpty, options);
}

export function ArrayUnique(options?: RuleOptions): RuleDecorator {
  return ruleDecorator(collectionRules.arrayUnique, options);
}

export function HasKey(
  key: PropertyKey,
  options?: RuleOptions,
): RuleDecorator {
  return ruleDecorator(
    { ...collectionRules.hasKey, params: { key } },
    options,
  );
}

export function Nested(options?: RuleOptions): RuleDecorator {
  return ruleDecorator(collectionRules.nested, options);
}

export function Each(options?: RuleOptions): RuleDecorator {
  return ruleDecorator(collectionRules.each, options);
}
