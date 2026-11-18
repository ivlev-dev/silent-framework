import type { FieldCondition, InstancePredicate, RuleDecorator } from "./types.js";
import { decorateField } from "./rule.js";
import {
  installCondition,
  installGroups,
  installLabel,
  installOptional,
} from "./registry.js";

export function ValidateIf(
  predicate: InstancePredicate,
): RuleDecorator {
  const token = Symbol("silent.validation.if");
  return decorateField(token, (ctor, entryToken, field, fieldName) => {
    const condition: FieldCondition = (instance) => predicate(instance);
    installCondition(ctor, entryToken, field, fieldName, condition);
  });
}

export function Optional(): RuleDecorator {
  const token = Symbol("silent.validation.optional");
  return decorateField(token, (ctor, entryToken, field, fieldName) => {
    installOptional(ctor, entryToken, field, fieldName);
  });
}

export function Label(label: string): RuleDecorator {
  const token = Symbol("silent.validation.label");
  return decorateField(token, (ctor, entryToken, field, fieldName) => {
    installLabel(ctor, entryToken, field, fieldName, label);
  });
}

export function Groups(...groups: string[]): RuleDecorator {
  const token = Symbol("silent.validation.groups");
  return decorateField(token, (ctor, entryToken, field, fieldName) => {
    installGroups(ctor, entryToken, field, fieldName, groups);
  });
}
