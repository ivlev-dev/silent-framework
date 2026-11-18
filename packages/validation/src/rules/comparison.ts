import type {
  RuleDecorator,
  RuleDefinition,
  RuleOptions,
} from "../types.js";
import { ruleDecorator } from "../rule.js";

function readValues(value: unknown): readonly unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

export const comparisonRules = {
  equals: {
    name: "equals",
    params: { expected: undefined },
    check: (value, context) => Object.is(value, context.params.expected),
  } satisfies RuleDefinition,
  notEquals: {
    name: "notEquals",
    params: { expected: undefined },
    check: (value, context) => !Object.is(value, context.params.expected),
  } satisfies RuleDefinition,
  isIn: {
    name: "isIn",
    params: { values: [] },
    check: (value, context) => {
      const values = readValues(context.params.values);
      return values !== undefined && values.includes(value);
    },
  } satisfies RuleDefinition,
  notIn: {
    name: "notIn",
    params: { values: [] },
    check: (value, context) => {
      const values = readValues(context.params.values);
      return values !== undefined && !values.includes(value);
    },
  } satisfies RuleDefinition,
};

export function Equals(
  expected: unknown,
  options?: RuleOptions,
): RuleDecorator {
  return ruleDecorator(
    { ...comparisonRules.equals, params: { expected } },
    options,
  );
}

export function NotEquals(
  expected: unknown,
  options?: RuleOptions,
): RuleDecorator {
  return ruleDecorator(
    { ...comparisonRules.notEquals, params: { expected } },
    options,
  );
}

export function IsIn(
  values: readonly unknown[],
  options?: RuleOptions,
): RuleDecorator {
  return ruleDecorator(
    { ...comparisonRules.isIn, params: { values: [...values] } },
    options,
  );
}

export function NotIn(
  values: readonly unknown[],
  options?: RuleOptions,
): RuleDecorator {
  return ruleDecorator(
    { ...comparisonRules.notIn, params: { values: [...values] } },
    options,
  );
}
