import type {
  FieldKey,
  RuleDecorator,
  RuleDefinition,
  RuleOptions,
} from "./types.js";
import { installRule } from "./registry.js";

type FieldInstaller = (
  ctor: Function,
  token: symbol,
  field: FieldKey,
  fieldName: string,
) => void;

export function fieldNameOf(field: string | symbol): string {
  return typeof field === "symbol" ? (field.description ?? field.toString()) : field;
}

export function decorateField(
  token: symbol,
  install: FieldInstaller,
): RuleDecorator {
  return <C extends object, V>(
    _value: undefined | ClassAccessorDecoratorTarget<C, V>,
    context:
      | ClassFieldDecoratorContext<C, V>
      | ClassAccessorDecoratorContext<C, V>,
  ): void => {
    if (context.private === true) {
      throw new TypeError("Приватные поля не поддерживаются валидацией");
    }
    if (context.static === true) {
      throw new TypeError("Статические поля не поддерживаются валидацией");
    }
    const field = context.name;
    const fieldName = fieldNameOf(field);
    context.addInitializer(function (this: object): void {
      install(this.constructor, token, field, fieldName);
    });
  };
}

export function ruleDecorator(
  rule: RuleDefinition,
  options: RuleOptions = {},
): RuleDecorator {
  const token = Symbol("silent.validation.rule");
  return decorateField(token, (ctor, entryToken, field, fieldName) => {
    installRule(ctor, entryToken, {
      field,
      fieldName,
      rule,
      options,
    });
  });
}
