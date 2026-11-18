import type {
  RuleDecorator,
  RuleDefinition,
  RuleOptions,
  RuleRunContext,
} from "../types.js";
import { ruleDecorator } from "../rule.js";

function numericParam(context: RuleRunContext, key: string): number {
  const value = context.params[key];
  return typeof value === "number" ? value : Number.NaN;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export const numberRules = {
  min: {
    name: "min",
    params: { min: 0 },
    check: (value: unknown, context: RuleRunContext): boolean => (
      isFiniteNumber(value) && value >= numericParam(context, "min")
    ),
  },
  max: {
    name: "max",
    params: { max: 0 },
    check: (value: unknown, context: RuleRunContext): boolean => (
      isFiniteNumber(value) && value <= numericParam(context, "max")
    ),
  },
  between: {
    name: "between",
    params: { min: 0, max: 0 },
    check: (value: unknown, context: RuleRunContext): boolean => (
      isFiniteNumber(value)
      && value >= numericParam(context, "min")
      && value <= numericParam(context, "max")
    ),
  },
  positive: {
    name: "positive",
    params: {},
    check: (value: unknown): boolean => isFiniteNumber(value) && value > 0,
  },
  negative: {
    name: "negative",
    params: {},
    check: (value: unknown): boolean => isFiniteNumber(value) && value < 0,
  },
  nonNegative: {
    name: "nonNegative",
    params: {},
    check: (value: unknown): boolean => isFiniteNumber(value) && value >= 0,
  },
  nonPositive: {
    name: "nonPositive",
    params: {},
    check: (value: unknown): boolean => isFiniteNumber(value) && value <= 0,
  },
  multipleOf: {
    name: "multipleOf",
    params: { factor: 1 },
    check: (value: unknown, context: RuleRunContext): boolean => {
      if (!isFiniteNumber(value)) {
        return false;
      }
      const factor = numericParam(context, "factor");
      if (factor === 0 || !Number.isFinite(factor)) {
        return false;
      }
      const ratio = value / factor;
      return Math.abs(ratio - Math.round(ratio)) <= 1e-9;
    },
  },
} satisfies Record<string, RuleDefinition>;

export function Min(limit: number, options?: RuleOptions): RuleDecorator {
  return ruleDecorator({ ...numberRules.min, params: { min: limit } }, options);
}

export function Max(limit: number, options?: RuleOptions): RuleDecorator {
  return ruleDecorator({ ...numberRules.max, params: { max: limit } }, options);
}

export function Between(
  min: number,
  max: number,
  options?: RuleOptions,
): RuleDecorator {
  return ruleDecorator(
    { ...numberRules.between, params: { min, max } },
    options,
  );
}

export function Positive(options?: RuleOptions): RuleDecorator {
  return ruleDecorator(numberRules.positive, options);
}

export function Negative(options?: RuleOptions): RuleDecorator {
  return ruleDecorator(numberRules.negative, options);
}

export function NonNegative(options?: RuleOptions): RuleDecorator {
  return ruleDecorator(numberRules.nonNegative, options);
}

export function NonPositive(options?: RuleOptions): RuleDecorator {
  return ruleDecorator(numberRules.nonPositive, options);
}

export function MultipleOf(
  factor: number,
  options?: RuleOptions,
): RuleDecorator {
  if (!Number.isFinite(factor) || factor === 0) {
    throw new RangeError("Множитель должен быть конечным числом, отличным от нуля");
  }
  return ruleDecorator(
    { ...numberRules.multipleOf, params: { factor } },
    options,
  );
}
