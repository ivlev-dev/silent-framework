export type FieldKey = string | symbol;

export interface RuleRunContext {
  readonly instance: object;
  readonly field: string;
  readonly label: string;
  readonly path: string;
  readonly params: Readonly<Record<string, unknown>>;
}

export type RuleCheck = (
  value: unknown,
  context: RuleRunContext,
) => boolean | Promise<boolean>;

export type NestedMode = "object" | "each";

export interface RuleDefinition {
  readonly name: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly check: RuleCheck;
  readonly nested?: NestedMode | undefined;
}

export interface MessageContext {
  readonly rule: string;
  readonly key: string;
  readonly field: string;
  readonly label: string;
  readonly value: unknown;
  readonly params: Readonly<Record<string, unknown>>;
  readonly locale: string;
  readonly instance: object;
  readonly path: string;
  readonly index?: number | undefined;
  readonly message?: string | MessageFactory | undefined;
  readonly messageKey?: string | undefined;
}

export type MessageFactory = (context: MessageContext) => string;

export type MessageResolver = (
  context: MessageContext,
) => string | undefined | Promise<string | undefined>;

export type InstancePredicate = {
  bivarianceHack(instance: object): boolean;
}["bivarianceHack"];

export interface RuleOptions {
  readonly message?: string | MessageFactory | undefined;
  readonly messageKey?: string | undefined;
  readonly label?: string | undefined;
  readonly groups?: readonly string[] | undefined;
  readonly when?: InstancePredicate | undefined;
  readonly each?: boolean | undefined;
}

export interface ValidationConfig {
  readonly cascade?: boolean | undefined;
  readonly locale?: string | undefined;
  readonly resolve?: MessageResolver | undefined;
  readonly messages?: Readonly<Record<string, Readonly<Record<string, string>>>> | undefined;
}

export interface ValidationOptions extends ValidationConfig {
  readonly cascade?: boolean | undefined;
  readonly groups?: readonly string[] | undefined;
  readonly stopAtFirst?: boolean | undefined;
  readonly labels?: Readonly<Record<string, string>> | undefined;
  readonly types?: boolean | undefined;
}

export interface ValidationError {
  readonly field: string;
  readonly rule: string;
  readonly message: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly value: unknown;
  readonly path: string;
  readonly label: string;
  readonly index?: number | undefined;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ValidationError[];
}

export type SafeParseSuccess<T extends object> = {
  readonly success: true;
  readonly data: T;
  readonly errors: readonly [];
};

export type SafeParseFailure = {
  readonly success: false;
  readonly errors: readonly ValidationError[];
};

export type SafeParseResult<T extends object> = SafeParseSuccess<T> | SafeParseFailure;

export interface FieldRuleEntry {
  readonly field: FieldKey;
  readonly fieldName: string;
  readonly rule: RuleDefinition;
  readonly options: RuleOptions;
}

export type FieldCondition = (instance: object, value: unknown) => boolean;

export interface FieldSlot {
  readonly field: FieldKey;
  readonly fieldName: string;
  readonly rules: FieldRuleEntry[];
  label?: string | undefined;
  groups?: readonly string[] | undefined;
  optional: boolean;
  readonly conditions: FieldCondition[];
}

export interface ClassValidationState {
  readonly fields: Map<FieldKey, FieldSlot>;
  readonly tokens: Map<symbol, Set<FieldKey>>;
  revision: number;
}

export type RuleDecorator = <C extends object, V>(
  value: ClassAccessorDecoratorTarget<C, V>,
  context: ClassAccessorDecoratorContext<C, V>,
) => void;

export class ValidationException extends Error {
  readonly errors: readonly ValidationError[];
  readonly result: ValidationResult;

  constructor(result: ValidationResult) {
    super(
      result.errors[0]?.message
      ?? "Проверка не пройдена",
    );
    this.name = "ValidationException";
    this.errors = result.errors;
    this.result = result;
  }
}

export class AsyncRuleError extends Error {
  readonly field: string;
  readonly rule: string;

  constructor(field: string, rule: string) {
    super(
      `Правило ${rule} для поля ${field} асинхронное: используйте validateAsync`,
    );
    this.name = "AsyncRuleError";
    this.field = field;
    this.rule = rule;
  }
}
