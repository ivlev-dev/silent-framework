import type {
  FieldCondition,
  InstancePredicate,
  RuleDecorator,
  ValidationOptions,
} from "./types.js";
import { validateProperty } from "./engine.js";
import { decorateField, fieldNameOf } from "./rule.js";
import {
  installCondition,
  installGroups,
  installLabel,
  installOptional,
} from "./registry.js";
import { ValidationException } from "./types.js";

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

export function ValidateOnSet(options?: ValidationOptions): RuleDecorator {
  return <C extends object, V>(
    target: ClassAccessorDecoratorTarget<C, V>,
    context: ClassAccessorDecoratorContext<C, V>,
  ): ClassAccessorDecoratorResult<C, V> => {
    if (context.kind !== "accessor") {
      throw new TypeError(
        "Валидация поддерживает только stage-3 accessor-поля (public accessor)",
      );
    }
    if (context.private === true) {
      throw new TypeError("Приватные поля не поддерживаются валидацией");
    }
    if (context.static === true) {
      throw new TypeError("Статические поля не поддерживаются валидацией");
    }
    const fieldName = fieldNameOf(context.name);
    const set = function (this: C, value: V): void {
      target.set.call(this, value);
      const result = validateProperty(this, fieldName, options);
      if (!result.valid) {
        throw new ValidationException(result);
      }
    };
    return {
      get: target.get,
      set,
      init: (value: V): V => value,
    };
  };
}
