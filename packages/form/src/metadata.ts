import { reactive } from "@ivlev-dev/silent-core";
import {
  Label as ValidationLabel,
  Required as ValidationRequired,
} from "@ivlev-dev/silent-validation";
import type { RuleDecorator, RuleOptions } from "@ivlev-dev/silent-validation";
import type { ValidateOnMode } from "./types.js";

/** Метаданные поля формы. */
export interface FieldMetadata {
  readonly name: string;
  readonly label?: string | undefined;
  readonly placeholder?: string | undefined;
  readonly hint?: string | undefined;
  readonly required?: boolean | undefined;
  readonly validateOn?: readonly ValidateOnMode[] | undefined;
}

type MetadataPatch = Omit<FieldMetadata, "name">;

const metadataByClass = new WeakMap<Function, Map<string, FieldMetadata>>();
const initialValuesByInstance = new WeakMap<object, Map<string, unknown>>();

function recordInitialValue(instance: object, name: string, value: unknown): void {
  let values = initialValuesByInstance.get(instance);
  if (values === undefined) {
    values = new Map<string, unknown>();
    initialValuesByInstance.set(instance, values);
  }
  if (!values.has(name)) {
    values.set(name, value);
  }
}

/** Исходное значение поля, зафиксированное при инициализации экземпляра. */
export function recordedInitialValue(
  instance: object,
  name: string,
): { readonly found: boolean; readonly value: unknown } {
  const values = initialValuesByInstance.get(instance);
  if (values === undefined || !values.has(name)) {
    return { found: false, value: undefined };
  }
  return { found: true, value: values.get(name) };
}

function initializeField(
  instance: object,
  name: string,
  patch: MetadataPatch,
): void {
  installMetadata(instance.constructor, name, patch);
}

interface AccessorContextLike {
  readonly kind: string;
  readonly name: string | symbol;
  readonly private?: boolean | undefined;
  readonly static?: boolean | undefined;
}

function accessorName(
  context: AccessorContextLike,
  decorator: string,
): string {
  if (context.kind !== "accessor") {
    throw new TypeError(
      `${decorator}: поддерживаются только stage-3 accessor-поля (public accessor)`,
    );
  }
  if (context.private === true) {
    throw new TypeError(`${decorator}: приватные поля не поддерживаются`);
  }
  if (context.static === true) {
    throw new TypeError(`${decorator}: статические поля не поддерживаются`);
  }
  if (typeof context.name !== "string") {
    throw new TypeError(`${decorator}: символьные имена полей не поддерживаются`);
  }
  return context.name;
}

function installMetadata(
  ctor: Function,
  name: string,
  patch: MetadataPatch,
): void {
  let fields = metadataByClass.get(ctor);
  if (fields === undefined) {
    fields = new Map<string, FieldMetadata>();
    metadataByClass.set(ctor, fields);
  }
  const previous = fields.get(name);
  const next: FieldMetadata = {
    name,
    label: patch.label ?? previous?.label,
    placeholder: patch.placeholder ?? previous?.placeholder,
    hint: patch.hint ?? previous?.hint,
    required: patch.required ?? previous?.required,
    validateOn: patch.validateOn ?? previous?.validateOn,
  };
  fields.set(name, next);
}

function normalizeValidateOn(
  mode: ValidateOnMode | readonly ValidateOnMode[],
): readonly ValidateOnMode[] {
  const modes = Array.isArray(mode) ? mode : [mode as ValidateOnMode];
  for (const entry of modes) {
    if (
      entry !== "change" &&
      entry !== "input" &&
      entry !== "blur" &&
      entry !== "submit" &&
      entry !== "none"
    ) {
      throw new TypeError(`ValidateOn: неизвестный режим валидации "${String(entry)}"`);
    }
  }
  return Object.freeze([...modes]);
}

type FieldDecorator = <C extends object, V>(
  target: ClassAccessorDecoratorTarget<C, V>,
  context: ClassAccessorDecoratorContext<C, V>,
) => ClassAccessorDecoratorResult<C, V>;

/**
 * Реактивное поле формы: семантика `@reactive` из core плюс регистрация
 * поля в метаданных формы.
 */
export function Field(): FieldDecorator {
  return ((target: ClassAccessorDecoratorTarget<object, unknown>, context: ClassAccessorDecoratorContext<object, unknown>) => {
    const name = accessorName(context, "Field");
    context.addInitializer(function (this: object): void {
      initializeField(this, name, {});
    });
    const base = reactive(target, context);
    return {
      get(this: object): unknown {
        return base.get?.call(this);
      },
      set(this: object, value: unknown): void {
        base.set?.call(this, value);
      },
      init(this: object, value: unknown): unknown {
        recordInitialValue(this, name, value);
        return base.init === undefined ? value : base.init.call(this, value);
      },
    };
  }) as unknown as FieldDecorator;
}

/** Синоним `@Field()` для вложенной формы. */
export function FormField(): FieldDecorator {
  return Field();
}

/** Подпись поля: используется в UI и в сообщениях валидатора. */
export function Label(label: string): RuleDecorator {
  const validation = ValidationLabel(label);
  return (target, context) => {
    const name = accessorName(context, "Label");
    validation(target, context);
    context.addInitializer(function (this: object): void {
      initializeField(this, name, { label });
    });
  };
}

/** Плейсхолдер поля. */
export function Placeholder(placeholder: string): RuleDecorator {
  return (_target, context) => {
    const name = accessorName(context, "Placeholder");
    context.addInitializer(function (this: object): void {
      initializeField(this, name, { placeholder });
    });
  };
}

/** Подсказка поля. */
export function Hint(hint: string): RuleDecorator {
  return (_target, context) => {
    const name = accessorName(context, "Hint");
    context.addInitializer(function (this: object): void {
      initializeField(this, name, { hint });
    });
  };
}

/**
 * Обязательное поле: применяет правило `required` валидатора и помечает поле
 * обязательным для UI (`isRequired`).
 */
export function Required(options?: RuleOptions): RuleDecorator {
  const validation = ValidationRequired(options);
  return (target, context) => {
    const name = accessorName(context, "Required");
    validation(target, context);
    context.addInitializer(function (this: object): void {
      initializeField(this, name, { required: true });
    });
  };
}

/** Режим автоматической валидации конкретного поля. */
export function ValidateOn(
  mode: ValidateOnMode | readonly ValidateOnMode[],
): RuleDecorator {
  const modes = normalizeValidateOn(mode);
  return (_target, context) => {
    const name = accessorName(context, "ValidateOn");
    context.addInitializer(function (this: object): void {
      initializeField(this, name, { validateOn: modes });
    });
  };
}

/** Метаданные класса с учётом наследования (базовые поля идут первыми). */
export function fieldMetadataFor(ctor: Function): Map<string, FieldMetadata> {
  const chain: Function[] = [];
  let current: unknown = ctor;
  while (typeof current === "function" && current !== Function.prototype) {
    chain.unshift(current);
    current = Object.getPrototypeOf(current);
  }
  const merged = new Map<string, FieldMetadata>();
  for (const entry of chain) {
    const fields = metadataByClass.get(entry);
    if (fields === undefined) {
      continue;
    }
    for (const [name, metadata] of fields) {
      merged.set(name, metadata);
    }
  }
  return merged;
}
