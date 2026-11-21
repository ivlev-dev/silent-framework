import type { Form } from "./form.js";

/** Режим автоматической валидации поля. */
export type ValidateOnMode = "change" | "input" | "blur" | "submit" | "none";

/** Настройки формы. Все поля необязательны. */
export interface FormOptions {
  /** Валидировать поле при событии `change`. По умолчанию `true`. */
  readonly validateOnChange?: boolean;
  /** Валидировать поле при событии `blur`. По умолчанию `true`. */
  readonly validateOnBlur?: boolean;
  /** Валидировать поле при событии `input`. По умолчанию `false`. */
  readonly validateOnInput?: boolean;
  /** Валидировать форму при отправке. По умолчанию `true`. */
  readonly validateOnSubmit?: boolean;
  /** Валидировать форму при инициализации. По умолчанию `false`. */
  readonly validateOnInit?: boolean;
  /** Валидировать вложенные формы при полной проверке. По умолчанию `true`. */
  readonly validateNested?: boolean;
  /** Задержка автоматической валидации поля в миллисекундах. По умолчанию `0`. */
  readonly debounceMs?: number;
  /** Очищать внешние (серверные) ошибки поля при изменении значения. По умолчанию `true`. */
  readonly clearExternalErrorsOnChange?: boolean;
  /** Префикс для DOM-идентификаторов полей. */
  readonly formId?: string;
  /** Ярлыки полей: `имя поля или путь → подпись`. */
  readonly labels?: Readonly<Record<string, string>>;
  /** Обработчик ошибок валидации, отправки и пользовательского колбэка. */
  readonly onError?: (error: unknown) => void;
}

/**
 * Событие поля. Достаточно структурно совместимо с DOM `Event`:
 * значение читается из `currentTarget`.
 */
export interface FieldEventLike {
  readonly currentTarget?: unknown;
  readonly target?: unknown;
}

/** Свойства поля, которые передаются в разметку. */
export interface FieldProps<Value = unknown> {
  /** Текущее значение поля (для вложенного объекта — значение его формы). */
  readonly value: Value;
  /** Подпись поля. */
  readonly label: string;
  /** Плейсхолдер поля. */
  readonly placeholder: string | undefined;
  /** Подсказка поля. */
  readonly hint: string | undefined;
  /** Первая ошибка поля. */
  readonly error: string | undefined;
  /** Все ошибки поля. */
  readonly errors: readonly string[];
  /** Поле помечено `@Required`. */
  readonly isRequired: boolean;
  /** Поле готово к отправке: `setReady(true)` и вложенная форма готова. */
  readonly isReady: boolean;
  /** Для поля выполняется асинхронная проверка. */
  readonly isValidating: boolean;
  /** Поле посещено (потеряло фокус или проверено целиком). */
  readonly touched: boolean;
  /** Значение поля менялось пользователем или программно. */
  readonly dirty: boolean;
  /** У поля нет ошибок. */
  readonly isValid: boolean;
  /** Полный путь поля, например `address.city`. */
  readonly name: string;
  /** DOM-идентификатор: `префикс-путь`, где префикс — `formId` или имя класса формы. */
  readonly id: string;
  /** Установить значение без автоматической проверки. */
  setValue(value: Value): void;
  /** Установить признак готовности поля. */
  setReady(ready: boolean): void;
  /** Обработать `change`, привести значение и проверить по режимам. */
  onChange(event: FieldEventLike): void;
  /** Обработать `input` и проверить по режимам. */
  onInput(event: FieldEventLike): void;
  /** Обработать `focus` (зарезервировано для расширений). */
  onFocus(event?: FieldEventLike): void;
  /** Пометить поле посещённым и проверить по режимам. */
  onBlur(event?: FieldEventLike): void;
  /** Проверить только это поле. */
  validate(): Promise<boolean>;
}

/** Служебные члены `Form`, которые не являются путями полей. */
type FormMemberKey =
  | "isReady"
  | "isValid"
  | "isDirty"
  | "isSubmitting"
  | "errors"
  | "values"
  | "getFieldProps"
  | "getFieldArray"
  | "validateField"
  | "validate"
  | "onSubmit"
  | "setFieldErrors"
  | "setErrors"
  | "clearFieldErrors"
  | "setValues"
  | "autoSave"
  | "reset"
  | "dispose";

/**
 * Допустимые пути полей формы.
 *
 * Для класса формы с accessor-полями `name`, `age` и `address`
 * (вложенная форма) тип содержит `"name"`, `"age"`, `"address"`,
 * `"address.city"` и остальные поля вложенной формы.
 * Методы и служебные члены `Form` в пути не попадают.
 */
export type FieldPath<T> = [T] extends [never]
  ? string
  : {
      [K in keyof T & string]: K extends FormMemberKey
        ? never
        : T[K] extends (...args: never[]) => unknown
          ? never
          : T[K] extends readonly (infer U)[]
            ? NonNullable<U> extends Form
              ? | K
                | `${K}[${number}]`
                | `${K}[${number}].${FieldPath<NonNullable<U>>}`
              : K
            : T[K] extends Form
              ? K | `${K}.${FieldPath<T[K]>}`
              : K;
    }[keyof T & string];

/**
 * Пути полей-массивов повторяемых форм:
 * `items: ItemForm[]` → `"items"`.
 */
export type ArrayFieldPath<T> = [T] extends [never]
  ? never
  : {
      [K in keyof T & string]: K extends FormMemberKey
        ? never
        : T[K] extends (...args: never[]) => unknown
          ? never
          : T[K] extends readonly (infer U)[]
            ? NonNullable<U> extends Form
              ? K
              : never
            : never;
    }[keyof T & string];

/** Массив повторяемых форм с реактивными агрегатами. */
export interface FormArray<T extends Form> {
  /** Текущие элементы. */
  readonly items: readonly T[];
  /** Количество элементов. */
  readonly length: number;
  /** Ошибки элементов по плоским путям (`items[0].name`) и самого поля `items`. */
  readonly errors: Readonly<Record<string, readonly string[]>>;
  /** Ошибки уровня поля `items` (правила массива). */
  readonly ownErrors: readonly string[];
  /** Все элементы готовы к отправке. */
  readonly isReady: boolean;
  /** Хотя бы один элемент изменён. */
  readonly isDirty: boolean;
  /** Элемент по индексу. */
  at(index: number): T | undefined;
  /** Добавить элемент в конец (без аргумента — из фабрики). */
  add(item?: T): T;
  /** Вставить элемент по индексу (без аргумента — из фабрики). */
  insert(index: number, item?: T): T;
  /** Удалить и освободить элемент. */
  remove(index: number): void;
  /** Переместить элемент. */
  move(from: number, to: number): void;
  /** Удалить и освободить все элементы. */
  clear(): void;
}
