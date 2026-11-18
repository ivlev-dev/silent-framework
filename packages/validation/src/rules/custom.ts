import type {
  RuleCheck,
  RuleDecorator,
  RuleDefinition,
  RuleOptions,
} from "../types.js";
import { ruleDecorator } from "../rule.js";

export const customRules = {
  custom: {
    name: "custom",
    params: {},
    check: (_value, _context) => true,
  } satisfies RuleDefinition,
};

export function Custom(check: RuleCheck, options?: RuleOptions): RuleDecorator {
  return ruleDecorator({ ...customRules.custom, check }, options);
}
