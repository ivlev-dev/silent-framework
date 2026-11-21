import { createEffect, createRoot, createSignal, getComputed, storeFor } from "@ivlev-dev/silent-reactivity";
import { validateAsync, validatePropertyAsync, ValidationModel } from "@ivlev-dev/silent-validation";
import type { ValidationOptions } from "@ivlev-dev/silent-validation";
import {
  fieldMetadataFor,
  registerFieldBinder,
  registerValidationInvalidator,
  unregisterFieldBinder,
  unregisterValidationInvalidator,
} from "./metadata.js";
import type { FieldMetadata } from "./metadata.js";
import { ErrorStore } from "./errors.js";
import {
  createArrayItemFieldProps,
  createArrayItemProps,
  createDirectProps,
  createFormArrayProps,
  createNestedFieldProps,
  createNestedFormProps,
} from "./field-props.js";
import type { FieldPropsHost } from "./field-props.js";
import { createFieldArray } from "./form-array.js";
import type { FormArrayHost } from "./form-array.js";
import type {
  ArrayFieldPath,
  FieldEventLike,
  FieldPath,
  FieldProps,
  FormArray,
  FormOptions,
  ValidateOnMode,
} from "./types.js";
import {
  cloneValue,
  coerceValue,
  eventTarget,
  isPlainObject,
  isRequiredEmpty,
  isThenable,
  lastSegment,
  normalizeErrorMessages,
  rootSegment,
  selectedValues,
} from "./utils.js";

type ErrorsMap = Readonly<Record<string, readonly string[]>>;

/**
 * Ключи внутренних мемо — символы, чтобы `@computed override get isReady()`
 * не конфликтовал с мемо базового класса.
 */
const MEMO_IS_READY = Symbol("silent.form.isReady");
const MEMO_IS_VALID = Symbol("silent.form.isValid");
const MEMO_IS_DIRTY = Symbol("silent.form.isDirty");
const MEMO_ERRORS = Symbol("silent.form.errors");
const MEMO_VALUES = Symbol("silent.form.values");

type FormInstance = Form;

type ArrayItemOf<T, K extends keyof T> =
  NonNullable<T[K]> extends readonly (infer U)[]
    ? NonNullable<U> extends Form
      ? NonNullable<U>
      : never
    : never;

type SetValuesInput<T> = {
  [K in keyof T as K extends keyof Form
    ? never
    : T[K] extends (...args: never[]) => unknown
      ? never
      : K]?: T[K] extends Form
    ? T[K] | SetValuesInput<T[K]>
    : T[K] extends readonly (infer U)[]
      ? U extends Form
        ? readonly (U | SetValuesInput<U>)[]
        : T[K]
      : T[K];
};

type FieldValue<T, P extends string> = P extends `${infer Head}[${number}].${infer Rest}`
  ? Head extends keyof T
    ? NonNullable<T[Head]> extends readonly (infer U)[]
      ? NonNullable<U> extends Form
        ? FieldValue<NonNullable<U>, Rest>
        : never
      : never
    : never
  : P extends `${infer Head}[${number}]`
    ? Head extends keyof T
      ? NonNullable<T[Head]> extends readonly (infer U)[]
        ? NonNullable<U>
        : never
      : never
    : P extends `${infer Head}.${infer Rest}`
      ? Head extends keyof T
        ? T[Head] extends Form
          ? FieldValue<T[Head], Rest>
          : never
        : never
      : P extends keyof T
        ? T[P]
        : never;

interface ResolvedFormOptions {
  readonly validateOnChange: boolean;
  readonly validateOnBlur: boolean;
  readonly validateOnInput: boolean;
  readonly validateOnSubmit: boolean;
  readonly validateOnInit: boolean;
  readonly validateNested: boolean;
  readonly debounceMs: number;
  readonly clearExternalErrorsOnChange: boolean;
  readonly formId: string | undefined;
  readonly labels: Readonly<Record<string, string>>;
  readonly onError: ((error: unknown) => void) | undefined;
}

function asInstance(value: object): FormInstance {
  return value as unknown as FormInstance;
}

/**
 * Базовый класс реактивной формы.
 *
 * Поля объявляются через `@Field()` (или `@FormField()` для вложенной формы).
 * Значения, ошибки и флаги доступны реактивно через `getFieldProps`.
 */
export abstract class Form extends ValidationModel {
  private readonly options: ResolvedFormOptions;
  private readonly baseValidationOptions: ValidationOptions | undefined;

  private readonly errorsRevision = createSignal(0);
  private readonly errorStore: ErrorStore;
  private readonly propsHost: FieldPropsHost;
  private readonly arrayHost: FormArrayHost;
  private readonly touchedFields = createSignal<ReadonlySet<string>>(new Set());
  private readonly dirtyFields = createSignal<ReadonlySet<string>>(new Set());
  private readonly readyStates = new Map<string, boolean>();
  private readonly readyVersion = createSignal(0);
  private readonly validatingFieldSet = new Set<string>();
  private readonly validatingVersion = createSignal(0);
  private readonly validatingForm = createSignal(0);
  private readonly submittingSignal = createSignal(false);
  private readonly changeVersion = createSignal(0);

  private metadata: ReadonlyMap<string, FieldMetadata> = new Map();
  private readonly initialValues = new Map<string, unknown>();
  private readonly children = new Map<string, FormInstance>();
  private readonly arrayChildren = new Map<string, FormInstance[]>();
  private readonly propsCache = new Map<string, FieldProps<unknown>>();
  private readonly validationTokens = new Map<string, number>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly reportedUnregisteredRoots = new Set<string>();
  private readonly fieldValidationPromises = new Map<
    string,
    { readonly promise: Promise<boolean>; active: boolean }
  >();

  private initialized = false;
  private initialCaptured = false;
  private disposed = false;
  private validationGeneration = 0;
  private validationRunCount = 0;
  private validatePromise: Promise<boolean> | undefined;
  private parentForm: FormInstance | undefined;
  private parentField: string | undefined;
  private readonly ownIdPrefix: string;
  private idPrefix: string;
  private idPath = "";

  constructor(options?: FormOptions) {
    super();
    this.options = {
      validateOnChange: options?.validateOnChange ?? true,
      validateOnBlur: options?.validateOnBlur ?? true,
      validateOnInput: options?.validateOnInput ?? false,
      validateOnSubmit: options?.validateOnSubmit ?? true,
      validateOnInit: options?.validateOnInit ?? false,
      validateNested: options?.validateNested ?? true,
      debounceMs: options?.debounceMs ?? 0,
      clearExternalErrorsOnChange: options?.clearExternalErrorsOnChange ?? true,
      formId: options?.formId,
      labels: options?.labels ?? {},
      onError: options?.onError,
    };
    this.errorStore = new ErrorStore({
      onChange: () => this.errorsRevision[1]((version) => version + 1),
    });
    this.propsHost = {
      labels: this.options.labels,
      readValue: (name) => this.readOwnValue(name),
      metadata: (name) => this.metadata.get(name),
      labelFor: (name) => this.labelFor(name),
      metadataLabelFor: (path) => this.metadataLabelFor(path),
      directErrors: (name) => this.directErrors(name),
      nestedFormErrors: (name) => this.nestedFormErrors(name),
      readyState: (name) => {
        this.readyVersion[0]();
        return this.readyStates.get(name) ?? true;
      },
      isValidatingField: (name) => {
        this.validatingVersion[0]();
        return this.validatingFieldSet.has(name);
      },
      isTouched: (name) => this.touchedFields[0]().has(name),
      isDirtyField: (name) => this.dirtyFields[0]().has(name),
      idFor: (path) => this.idFor(path),
      setValue: (name, value) => this.setDirectValue(name, value),
      setReady: (name, ready) => this.setReadyFor(name, ready),
      handleEvent: (name, event, mode) =>
        this.handleValueEvent(name, event, mode),
      markTouched: (name) => this.markTouched(name),
      validateForEvent: (name, mode) => this.validateForEvent(name, mode),
      runFieldValidation: (name) => this.runFieldValidation(name),
      requireChild: (name) => this.requireChild(name),
      childProps: (child, path) => child.propsAt(path),
      hasAnyTouched: (child) => child.hasAnyTouched(),
      hasValidating: (child) => child.hasValidating(),
      nestedBindingError: (name, handler) =>
        this.nestedBindingError(name, handler),
      isFormInstance: (value): value is Form => value instanceof Form,
      arrayItems: (name) => this.arrayItems(name),
      requireArrayItem: (root, index) => this.requireArrayItem(root, index),
      requireArrayItems: (name) => this.requireArrayItems(name),
      arrayErrors: (name) => this.arrayErrors(name),
      arrayItemExternalErrors: (path) => this.errorStore.externalMap.get(path),
      replaceArray: (name, value) => this.replaceArray(name, value),
      commitArray: (name, next, removed) =>
        this.commitArray(name, next, removed),
      runFormArrayValidation: (name) => this.runFormArrayValidation(name),
    };
    this.arrayHost = {
      items: (name) => this.arrayItems(name),
      requireItems: (name) => this.requireArrayItems(name),
      directErrors: (name) => this.directErrors(name),
      arrayErrors: (name) => this.arrayErrors(name),
      isTouched: (name) => this.touchedFields[0]().has(name),
      isDirtyField: (name) => this.dirtyFields[0]().has(name),
      ensureCanBind: (item, name, index) => {
        item.ensureCanBind(asInstance(this), `${name}[${index}]`);
      },
      commit: (name, next, removed) => {
        this.commitArray(name, next, removed);
      },
      isBaseline: (item) => this.isBaselineArrayItem(item),
    };
    const trimmed = options?.formId?.trim();
    this.ownIdPrefix = trimmed !== undefined && trimmed !== ""
      ? trimmed
      : this.constructor.name !== ""
        ? this.constructor.name
        : "form";
    this.idPrefix = this.ownIdPrefix;
    this.baseValidationOptions = Object.keys(this.options.labels).length > 0
      ? { labels: this.options.labels }
      : undefined;
    registerValidationInvalidator(this, () => this.invalidateValidation());
    registerFieldBinder(this, (name, value) => this.bindInitialField(name, value));
    queueMicrotask(() => {
      if (this.disposed || this.initialCaptured) {
        return;
      }
      try {
        this.ensureInitialized();
        this.captureInitialValues();
      } catch {
        // Ошибка метаданных проявится при первом обращении к форме.
      }
    });
    if (this.options.validateOnInit) {
      const generation = this.validationGeneration;
      queueMicrotask(() => {
        if (this.disposed || generation !== this.validationGeneration) {
          return;
        }
        void this.validate().catch((error: unknown) => this.reportError(error));
      });
    }
  }

  /** Форма готова к отправке: нет ошибок, обязательные поля заполнены, нет проверок. */
  get isReady(): boolean {
    return getComputed(this, MEMO_IS_READY, () => {
      this.ensureInitialized();
      this.syncChildren();
      this.validatingVersion[0]();
      if (this.validatingFieldSet.size > 0 || this.validatingForm[0]() > 0) {
        return false;
      }
      this.readyVersion[0]();
      const ready = this.readyStates;
      for (const [name, metadata] of this.metadata) {
        if (ready.get(name) === false) {
          return false;
        }
        const value = this.readOwnValue(name);
        const active = this.isConditionActiveForReady(metadata);
        if (
          this.isRequirementActive(metadata, value, active) &&
          isRequiredEmpty(value)
        ) {
          return false;
        }
        if (active && value instanceof Form && !asInstance(value).isReady) {
          return false;
        }
        const arrayItems = this.arrayChildren.get(name);
        if (
          active &&
          arrayItems !== undefined &&
          !arrayItems.every((item) => item.isReady)
        ) {
          return false;
        }
      }
      return (
        this.validationMap().size === 0 &&
        this.externalMap().size === 0
      );
    });
  }

  /** У формы нет ошибок. */
  get isValid(): boolean {
    return getComputed(this, MEMO_IS_VALID, () => {
      this.ensureInitialized();
      this.syncChildren();
      if (this.validationMap().size > 0 || this.externalMap().size > 0) {
        return false;
      }
      for (const child of this.children.values()) {
        if (!child.isValid) {
          return false;
        }
      }
      for (const items of this.arrayChildren.values()) {
        for (const item of items) {
          if (!item.isValid) {
            return false;
          }
        }
      }
      return true;
    });
  }

  /** Хотя бы одно поле менялось пользователем или программно. */
  get isDirty(): boolean {
    return getComputed(this, MEMO_IS_DIRTY, () => {
      this.ensureInitialized();
      this.syncChildren();
      if (this.dirtyFields[0]().size > 0) {
        return true;
      }
      for (const child of this.children.values()) {
        if (child.isDirty) {
          return true;
        }
      }
      for (const items of this.arrayChildren.values()) {
        for (const item of items) {
          if (item.isDirty) {
            return true;
          }
        }
      }
      return false;
    });
  }

  /** Идёт отправка формы. */
  get isSubmitting(): boolean {
    return this.submittingSignal[0]();
  }

  /** Ошибки по плоским путям, включая вложенные формы: `address.city`. */
  get errors(): Readonly<Record<string, readonly string[]>> {
    return getComputed(this, MEMO_ERRORS, () => this.computeErrors());
  }

  /** Реактивный снимок значений; вложенные формы — вложенными объектами. */
  get values(): Record<string, unknown> {
    return getComputed(this, MEMO_VALUES, () => {
      this.ensureInitialized();
      this.syncChildren();
      const result: Record<string, unknown> = {};
      for (const name of this.metadata.keys()) {
        const value = this.readOwnValue(name);
        if (value instanceof Form) {
          result[name] = asInstance(value).values;
          continue;
        }
        if (
          Array.isArray(value) &&
          (this.arrayChildren.has(name) ||
            (value.length > 0 && value.every((item) => item instanceof Form)))
        ) {
          result[name] = value.map((item) =>
            item instanceof Form ? asInstance(item).values : cloneValue(item)
          );
          continue;
        }
        result[name] = cloneValue(value);
      }
      return result;
    });
  }

  /**
   * Массив повторяемых форм: элементы, ошибки, готовность и операции
   * add/insert/remove/move/clear.
   */
  getFieldArray<K extends ArrayFieldPath<this>>(
    field: K,
  ): FormArray<ArrayItemOf<this, K>> {
    const name = field as string;
    this.ensureInitialized();
    this.ensureArrayItems(name);
    return createFieldArray<Form>(this.arrayHost, name) as unknown as FormArray<
      ArrayItemOf<this, K>
    >;
  }

  /** Записывает новый массив, перепривязывает элементы и пути/id. */
  private commitArray(
    name: string,
    next: FormInstance[],
    removed: FormInstance[],
  ): void {
    this.setDirectValue(name, next);
    this.arrayChildren.set(name, next);
    for (const item of removed) {
      if (item.parentForm === asInstance(this)) {
        item.parentForm = undefined;
        item.parentField = undefined;
        item.refreshIdContext(item.ownIdPrefix, "");
      }
    }
    for (let index = 0; index < next.length; index += 1) {
      this.assignArrayItem(next[index]!, name, index);
    }
    this.invalidateProps(name);
  }

  private setArrayValues(name: string, entries: readonly unknown[]): void {
    const items = this.requireArrayItems(name);
    const limit = Math.min(items.length, entries.length);
    const next = [...items];
    const removed: FormInstance[] = [];
    let replaced = false;
    let changed = false;
    for (let index = 0; index < limit; index += 1) {
      const entry = entries[index];
      const current = items[index]!;
      if (entry instanceof Form) {
        if (entry === current) {
          continue;
        }
        entry.ensureCanBind(asInstance(this), `${name}[${index}]`);
        next[index] = asInstance(entry);
        removed.push(current);
        replaced = true;
        changed = true;
        continue;
      }
      if (isPlainObject(entry)) {
        current.setValues(entry);
        changed = true;
        continue;
      }
      throw new TypeError(
        `Элемент "${name}[${index}]" должен быть Form или plain-объектом`,
      );
    }
    if (replaced) {
      this.commitArray(name, next, removed);
    } else if (changed) {
      this.invalidateValidation();
      this.markDirty(name);
      if (this.options.clearExternalErrorsOnChange) {
        this.errorStore.removeExternal(name);
      }
    }
  }

  /**
   * Стабильный (кэшированный) набор свойств поля.
   * Для пути вложенной формы (`address.city`) делегирует вложенной форме,
   * но `name`/`id` содержат полный путь.
   */
  getFieldProps<K extends FieldPath<this>>(
    field: K,
  ): FieldProps<FieldValue<this, K>> {
    const path = String(field);
    this.ensureInitialized();
    const cached = this.propsCache.get(path);
    if (cached !== undefined) {
      return cached as unknown as FieldProps<FieldValue<this, K>>;
    }
    const created = this.createProps(path);
    this.propsCache.set(path, created);
    return created as unknown as FieldProps<FieldValue<this, K>>;
  }

  /**
   * Проверить одно поле (включая путь вложенной формы).
   * Параллельные вызовы для одного пути возвращают один и тот же промис.
   */
  validateField(
    field: FieldPath<this>,
    options?: ValidationOptions,
  ): Promise<boolean> {
    const path = field as string;
    const running = this.fieldValidationPromises.get(path);
    if (running !== undefined) {
      if (running.active) {
        return running.promise;
      }
      this.fieldValidationPromises.delete(path);
    }
    const entry: { promise: Promise<boolean>; active: boolean } = {
      promise: Promise.resolve(false),
      active: true,
    };
    const onSettled = (): void => {
      entry.active = false;
      if (this.fieldValidationPromises.get(path) === entry) {
        this.fieldValidationPromises.delete(path);
      }
    };
    let promise: Promise<boolean>;
    try {
      promise = this.runFieldPath(path, options, onSettled);
    } catch (error) {
      entry.active = false;
      promise = Promise.reject(error);
    }
    entry.promise = promise;
    this.fieldValidationPromises.set(path, entry);
    return promise;
  }

  private settleNested(
    promise: Promise<boolean>,
    onSettled: (() => void) | undefined,
  ): Promise<boolean> {
    if (onSettled === undefined) {
      return promise;
    }
    return promise.then(
      (value) => {
        onSettled();
        return value;
      },
      (error: unknown) => {
        onSettled();
        throw error;
      },
    );
  }

  private runFieldPath(
    path: string,
    options?: ValidationOptions,
    onSettled?: () => void,
  ): Promise<boolean> {
    const { root, index, rest } = this.locate(path);
    if (index !== undefined) {
      const item = this.requireArrayItem(root, index);
      if (rest !== undefined) {
        return this.settleNested(
          item.validateAt(
            rest,
            this.nestedValidationOptions(`${root}[${index}]`, options),
          ),
          onSettled,
        );
      }
      return this.settleNested(item.validate(options), onSettled);
    }
    if (rest !== undefined) {
      return this.settleNested(
        this.requireChild(root).validateAt(
          rest,
          this.childValidationOptions(root, options),
        ),
        onSettled,
      );
    }
    if (this.childFor(root) !== undefined) {
      return this.runFormFieldValidation(root, options, onSettled);
    }
    if (this.arrayItems(root) !== undefined) {
      return this.runFormArrayValidation(root, options, onSettled);
    }
    return this.runFieldValidation(root, options, onSettled);
  }

  /** Правила поля-массива, затем проверка всех элементов. */
  private async runFormArrayValidation(
    root: string,
    options?: ValidationOptions,
    onSettled?: () => void,
  ): Promise<boolean> {
    const metadata = this.metadata.get(root);
    const active = metadata === undefined || this.isFieldActiveForValidation(metadata);
    try {
      const rootValid = await this.runFieldValidation(root, options);
      if (!active) {
        return rootValid;
      }
      const items = this.arrayItems(root) ?? [];
      const results = await Promise.all(
        items.map((item, index) =>
          item.validate(
            this.nestedValidationOptions(`${root}[${index}]`, options),
          ),
        ),
      );
      return rootValid && results.every(Boolean);
    } finally {
      onSettled?.();
    }
  }

  /** Правила самого поля-формы, затем проверка ребёнка (если условие активно). */
  private async runFormFieldValidation(
    root: string,
    options?: ValidationOptions,
    onSettled?: () => void,
  ): Promise<boolean> {
    const child = this.requireChild(root);
    const metadata = this.metadata.get(root);
    const active = metadata === undefined || this.isFieldActiveForValidation(metadata);
    try {
      const rootValid = await this.runFieldValidation(root, options);
      if (!active) {
        return rootValid;
      }
      const childValid = await child.validate(
        this.childValidationOptions(root, options),
      );
      return rootValid && childValid;
    } finally {
      onSettled?.();
    }
  }

  /**
   * Полная проверка формы: помечает все поля посещёнными, собирает ошибки
   * по путям и проверяет вложенные формы.
   * Повторный вызов во время идущей проверки возвращает тот же промис.
   */
  validate(options?: ValidationOptions): Promise<boolean> {
    const running = this.validatePromise;
    if (running !== undefined) {
      return running;
    }
    let resolve!: (value: boolean) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<boolean>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    this.validatePromise = promise;
    const release = (): void => {
      if (this.validatePromise === promise) {
        this.validatePromise = undefined;
      }
    };
    promise.then(release, release);
    this.runValidation(options).then(resolve, reject);
    return promise;
  }

  private async runValidation(options?: ValidationOptions): Promise<boolean> {
    this.ensureInitialized();
    this.syncChildren();
    this.clearTimers();
    const generation = this.validationGeneration;
    const hadFieldRuns = this.validationRunCount > 0;
    this.validationRunCount += 1;
    this.validatingForm[1](1);
    if (hadFieldRuns) {
      for (const name of this.metadata.keys()) {
        this.validationTokens.set(name, (this.validationTokens.get(name) ?? 0) + 1);
      }
    }
    this.clearValidatingFields();

    try {
      const result = await validateAsync(this, this.validationOptions(options));
      if (this.disposed || generation !== this.validationGeneration) {
        return this.isValid;
      }
      const map = new Map<string, string[]>();
      for (const error of result.errors) {
        const key = error.path === "" ? error.field : error.path;
        const root = rootSegment(key);
        if (
          this.childFor(root) !== undefined &&
          (key.startsWith(`${root}.`) || key.startsWith(`${root}[`))
        ) {
          continue;
        }
        if (
          this.arrayItems(root) !== undefined &&
          key.startsWith(`${root}[`)
        ) {
          continue;
        }
        if (!this.metadata.has(root)) {
          this.reportUnregisteredField(root, key);
        }
        const existing = map.get(key);
        if (existing === undefined) {
          map.set(key, [error.message]);
        } else {
          existing.push(error.message);
        }
      }
      this.errorStore.setValidation(map);
      this.markAllTouched();

      if (this.options.validateNested) {
        const pending: Promise<boolean>[] = [];
        for (const [name, metadata] of this.metadata) {
          const child = this.childFor(name);
          if (child !== undefined) {
            if (!this.isFieldActiveForValidation(metadata)) {
              continue;
            }
            pending.push(
              child.validate(this.childValidationOptions(name, options)),
            );
            continue;
          }
          const items = this.arrayItems(name);
          if (items === undefined || !this.isFieldActiveForValidation(metadata)) {
            continue;
          }
          for (let index = 0; index < items.length; index += 1) {
            const item = items[index]!;
            pending.push(
              item.validate(
                this.nestedValidationOptions(`${name}[${index}]`, options),
              ),
            );
          }
        }
        const results = await Promise.all(pending);
        if (this.disposed || generation !== this.validationGeneration) {
          return this.isValid;
        }
        const ownValid =
          this.validationMap().size === 0 &&
          this.externalMap().size === 0;
        return result.valid && ownValid && results.every(Boolean);
      }
      const ownValid =
        this.validationMap().size === 0 &&
        this.externalMap().size === 0;
      return result.valid && ownValid && this.isValid;
    } finally {
      if (!this.disposed && generation === this.validationGeneration) {
        this.validationRunCount = Math.max(0, this.validationRunCount - 1);
        this.validatingForm[1](0);
      }
    }
  }

  /**
   * Возвращает обработчик отправки: вызывает `preventDefault`, проверяет форму,
   * при готовности вызывает `callback` с этим же экземпляром.
   */
  onSubmit(
    callback: (form: this) => unknown | Promise<unknown>,
  ): (event?: { preventDefault?: () => void }) => Promise<void> {
    return async (event) => {
      event?.preventDefault?.();
      if (this.submittingSignal[0]()) {
        return;
      }
      this.submittingSignal[1](true);
      try {
        const generation = this.validationGeneration;
        if (this.options.validateOnSubmit) {
          await this.validate();
        } else {
          await this.validateSubmitFields();
        }
        if (this.disposed || generation !== this.validationGeneration) {
          return;
        }
        if (!this.isReady) {
          return;
        }
        await callback(this);
      } catch (error) {
        this.reportError(error);
      } finally {
        this.submittingSignal[1](false);
      }
    };
  }

  /** Установить внешние (серверные) ошибки поля. */
  setFieldErrors(
    field: FieldPath<this>,
    errors: string | readonly (string | { readonly message: string })[],
  ): void {
    const path = String(field);
    const { root, index, rest } = this.locate(path);
    const messages = normalizeErrorMessages(errors);
    if (index !== undefined) {
      const item = this.requireArrayItem(root, index);
      if (rest !== undefined) {
        item.setErrorsAt(rest, messages);
      } else {
        this.errorStore.setExternal(path, messages);
      }
      return;
    }
    if (rest !== undefined) {
      this.requireChild(root).setErrorsAt(rest, messages);
      return;
    }
    this.errorStore.setExternal(root, messages);
  }

  /**
   * Полностью заменить внешние (серверные) ошибки формы.
   * Принимает плоские пути: `email`, `address.city`, `items[0].name`.
   * Ошибки, отсутствующие в новом наборе, удаляются.
   */
  setErrors(
    errors: Readonly<Record<string, string | readonly string[]>>,
  ): void {
    this.clearFieldErrors();
    for (const [field, messages] of Object.entries(errors)) {
      this.setFieldErrors(field as never, messages);
    }
  }

  /**
   * Очистить внешние ошибки поля или всей формы.
   * Ошибки правил остаются и пересчитываются валидацией.
   */
  clearFieldErrors(field?: FieldPath<this>): void {
    if (field === undefined) {
      this.ensureInitialized();
      this.syncChildren();
      if (this.externalMap().size > 0) {
        this.errorStore.clearExternal();
      }
      for (const child of this.children.values()) {
        child.clearFieldErrors();
      }
      for (const items of this.arrayChildren.values()) {
        for (const item of items) {
          item.clearFieldErrors();
        }
      }
      return;
    }
    const path = String(field);
    const { root, index, rest } = this.locate(path);
    if (index !== undefined) {
      const item = this.requireArrayItem(root, index);
      if (rest !== undefined) {
        item.clearErrorsAt(rest);
      } else {
        this.errorStore.removeExternal(path);
        item.clearFieldErrors();
      }
      return;
    }
    if (rest !== undefined) {
      this.requireChild(root).clearErrorsAt(rest);
      return;
    }
    if (this.childFor(root) !== undefined) {
      this.errorStore.removeExternal(root);
      this.requireChild(root).clearFieldErrors();
      return;
    }
    if (this.arrayItems(root) !== undefined) {
      this.errorStore.removeExternal(root);
      for (const item of this.requireArrayItems(root)) {
        item.clearFieldErrors();
      }
      return;
    }
    this.errorStore.removeExternal(root);
  }

  /**
   * Автосохранение: вызывает обработчик после изменений с debounce.
   * По умолчанию — только для dirty и валидной формы; `validate:true`
   * дополнительно запускает async-проверку перед вызовом.
   */
  autoSave(
    handler: (form: this) => unknown | Promise<unknown>,
    options?: { readonly debounceMs?: number; readonly validate?: boolean },
  ): () => void {
    const debounceMs = options?.debounceMs ?? 300;
    const runValidation = options?.validate === true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const dispose = createRoot((disposeRoot) => {
      createEffect(() => {
        this.changeVersion[0]();
        const dirty = this.isDirty;
        const valid = this.isValid;
        if (stopped || !dirty || !valid) {
          return;
        }
        if (timer !== undefined) {
          clearTimeout(timer);
        }
        timer = setTimeout(() => {
          timer = undefined;
          if (stopped) {
            return;
          }
          const run = async (): Promise<void> => {
            try {
              if (runValidation && !(await this.validate())) {
                return;
              }
              if (stopped || !this.isDirty || !this.isValid) {
                return;
              }
              await handler(this);
            } catch (error) {
              this.reportError(error);
            }
          };
          void run();
        }, debounceMs);
      });
      return disposeRoot;
    });
    return () => {
      stopped = true;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      dispose();
    };
  }

  /** Установить несколько значений. Вложенным формам можно передать объект. */
  setValues(values: SetValuesInput<this>): void {
    this.ensureInitialized();
    for (const [name, value] of Object.entries(values as unknown as Record<string, unknown>)) {
      if (!this.metadata.has(name)) {
        throw this.unknownFieldError(name);
      }
      const current = this.readOwnValue(name);
      if (Array.isArray(value) && this.arrayChildren.has(name)) {
        this.setArrayValues(name, value);
        continue;
      }
      if (value instanceof Form) {
        this.setDirectValue(name, value);
        continue;
      }
      if (current instanceof Form && isPlainObject(value)) {
        this.invalidateValidation();
        const child = asInstance(current);
        child.setValues(value);
        this.markDirty(name);
        if (this.options.clearExternalErrorsOnChange) {
          this.errorStore.removeExternal(name);
        }
        continue;
      }
      this.setDirectValue(name, value);
    }
  }

  /** Вернуть исходные значения, очистить ошибки, touched/dirty и таймеры. */
  reset(): void {
    this.ensureInitialized();
    this.syncChildren();
    const restorations: Array<{
      readonly name: string;
      readonly current: unknown;
      readonly restored: unknown;
    }> = [];
    for (const name of this.metadata.keys()) {
      const initial = this.initialValues.get(name);
      const restored = initial instanceof Form ? initial : cloneValue(initial);
      const current = this.readOwnValue(name);
      if (restored instanceof Form && current !== restored) {
        asInstance(restored).ensureCanBind(asInstance(this), name);
      } else if (Array.isArray(restored)) {
        for (let index = 0; index < restored.length; index += 1) {
          const item = restored[index];
          if (item instanceof Form && item.parentForm !== asInstance(this)) {
            item.ensureCanBind(asInstance(this), `${name}[${index}]`);
          }
        }
      }
      restorations.push({ name, current, restored });
    }
    this.invalidateValidation();
    this.clearTimers();
    if (this.validationMap().size > 0) {
      this.errorStore.clearValidation();
    }
    if (this.externalMap().size > 0) {
      this.errorStore.clearExternal();
    }
    this.touchedFields[1](new Set());
    this.dirtyFields[1](new Set());
    if (this.readyStates.size > 0) {
      this.readyStates.clear();
      this.readyVersion[1]((version) => version + 1);
    }

    for (const { name, current, restored } of restorations) {
      if (current instanceof Form && current !== restored) {
        this.detachChild(name, asInstance(current));
      }
      if (Array.isArray(restored)) {
        this.restoreArray(name, restored, current);
        continue;
      }
      this.writeOwnValue(name, restored);
      if (restored instanceof Form) {
        asInstance(restored).bindParent(asInstance(this), name);
        this.children.set(name, asInstance(restored));
      }
      this.invalidateProps(name);
    }
    for (const child of this.children.values()) {
      child.reset();
    }
    for (const items of this.arrayChildren.values()) {
      for (const item of items) {
        item.reset();
      }
    }
  }

  /** Элемент входит в эталонный массив из `initialValues`. */
  private isBaselineArrayItem(item: FormInstance): boolean {
    for (const value of this.initialValues.values()) {
      if (Array.isArray(value) && value.includes(item)) {
        return true;
      }
    }
    return false;
  }

  private restoreArray(name: string, restored: readonly unknown[], current: unknown): void {
    const tracked = this.arrayChildren.get(name);
    const previous = tracked ?? (Array.isArray(current)
      ? current.filter((item): item is Form => item instanceof Form).map((item) => asInstance(item))
      : []);
    const isFormArray = tracked !== undefined ||
      (restored.length > 0 && restored.every((item) => item instanceof Form));
    if (!isFormArray) {
      this.writeOwnValue(name, restored);
      this.invalidateProps(name);
      return;
    }
    const items: FormInstance[] = [];
    for (const item of restored) {
      if (!(item instanceof Form)) {
        throw new TypeError(`Массив "${name}" должен содержать только Form`);
      }
      items.push(asInstance(item));
    }
    const nextSet = new Set<object>(items);
    for (const item of previous) {
      if (!nextSet.has(item)) {
        if (item.parentForm === asInstance(this)) {
          item.parentForm = undefined;
          item.parentField = undefined;
          item.refreshIdContext(item.ownIdPrefix, "");
        }
        if (!this.isBaselineArrayItem(item)) {
          item.dispose();
        }
      }
    }
    this.writeOwnValue(name, [...items]);
    this.arrayChildren.set(name, items);
    for (let index = 0; index < items.length; index += 1) {
      this.assignArrayItem(items[index]!, name, index);
    }
    this.invalidateProps(name);
  }

  /** Освободить реактивное хранилище и таймеры. Повторный вызов безопасен. */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.invalidateValidation();
    this.disposed = true;
    this.clearTimers();
    const owned = [...this.children.entries()];
    this.children.clear();
    for (const [name, child] of owned) {
      this.detachChild(name, child);
      child.dispose();
    }
    const ownedArrays = [...this.arrayChildren.entries()];
    this.arrayChildren.clear();
    for (const [name, items] of ownedArrays) {
      for (const item of items) {
        if (item.parentForm === asInstance(this)) {
          item.parentForm = undefined;
          item.parentField = undefined;
          item.refreshIdContext(item.ownIdPrefix, "");
        }
        item.dispose();
      }
      this.invalidateProps(name);
    }
    if (this.parentForm !== undefined && this.parentField !== undefined) {
      this.parentForm.detachChild(this.parentField, asInstance(this));
    }
    this.parentForm = undefined;
    this.parentField = undefined;
    const baselineItems = new Set<FormInstance>();
    for (const value of this.initialValues.values()) {
      if (!Array.isArray(value)) {
        continue;
      }
      for (const item of value) {
        if (item instanceof Form) {
          baselineItems.add(asInstance(item));
        }
      }
    }
    for (const item of baselineItems) {
      if (item.parentForm === undefined || item.parentForm === asInstance(this)) {
        item.dispose();
      }
    }
    this.initialValues.clear();
    this.propsCache.clear();
    unregisterFieldBinder(this);
    unregisterValidationInvalidator(this);
    storeFor(this).dispose();
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      const fields = fieldMetadataFor(this.constructor);
      for (const [name, metadata] of fields) {
        if (metadata.reactive !== true) {
          throw new TypeError(
            `Поле "${name}" должно быть помечено @Field() (или @FormField() для вложенной формы)`,
          );
        }
      }
      this.initialized = true;
      this.metadata = fields;
      this.linkNested();
    }
    if (!this.initialCaptured) {
      this.captureInitialValues();
    }
  }

  /** Снимает эталон значений после завершения конструкции экземпляра. */
  private captureInitialValues(): void {
    if (this.initialCaptured) {
      return;
    }
    this.initialCaptured = true;
    for (const name of this.metadata.keys()) {
      this.initialValues.set(name, cloneValue(this.readOwnValue(name)));
    }
  }

  private linkNested(): void {
    this.syncChildren();
  }

  /** Синхронизирует карты вложенных форм/массивов с текущими значениями. */
  private syncChildren(): void {
    for (const name of this.metadata.keys()) {
      const value = this.readOwnValue(name);
      const current = this.children.get(name);
      if (value instanceof Form) {
        this.detachArray(name);
        if (current !== value) {
          this.attachChild(name, asInstance(value));
        }
        continue;
      }
      const tracked = this.arrayChildren.get(name);
      if (Array.isArray(value)) {
        const items: FormInstance[] = [];
        let isFormArray = tracked !== undefined;
        for (const item of value) {
          if (item instanceof Form) {
            items.push(asInstance(item));
            isFormArray = true;
          } else {
            isFormArray = false;
            break;
          }
        }
        if (isFormArray) {
          if (current !== undefined) {
            this.detachChild(name, current);
          }
          this.bindArrayChildren(name, items);
          continue;
        }
      }
      if (current !== undefined) {
        this.detachChild(name, current);
      }
      this.detachArray(name);
    }
  }

  /** Перепривязывает элементы массива, проверяя владение; старые элементы отцепляет. */
  private bindArrayChildren(name: string, items: FormInstance[]): void {
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index]!;
      if (item.parentForm === asInstance(this)) {
        continue;
      }
      item.ensureCanBind(asInstance(this), `${name}[${index}]`);
    }
    const previous = this.arrayChildren.get(name);
    if (previous !== undefined) {
      for (const item of previous) {
        if (!items.includes(item) && item.parentForm === asInstance(this)) {
          item.parentForm = undefined;
          item.parentField = undefined;
          item.refreshIdContext(item.ownIdPrefix, "");
        }
      }
    }
    this.arrayChildren.set(name, items);
    for (let index = 0; index < items.length; index += 1) {
      this.assignArrayItem(items[index]!, name, index);
    }
    this.invalidateProps(name);
  }

  private assignArrayItem(item: FormInstance, name: string, index: number): void {
    item.parentForm = asInstance(this);
    item.parentField = `${name}[${index}]`;
    const local = `${name}[${index}]`;
    item.refreshIdContext(
      this.idPrefix,
      this.idPath === "" ? local : `${this.idPath}.${local}`,
    );
  }

  private detachArray(name: string): void {
    const items = this.arrayChildren.get(name);
    if (items === undefined) {
      return;
    }
    this.arrayChildren.delete(name);
    for (const item of items) {
      if (item.parentForm === asInstance(this)) {
        item.parentForm = undefined;
        item.parentField = undefined;
        item.refreshIdContext(item.ownIdPrefix, "");
      }
    }
    this.invalidateProps(name);
  }

  private readOwnValue(name: string): unknown {
    return (this as unknown as Record<string, unknown>)[name];
  }

  private writeOwnValue(name: string, value: unknown): void {
    (this as unknown as Record<string, unknown>)[name] = value;
  }

  private childFor(name: string): FormInstance | undefined {
    const value = this.readOwnValue(name);
    return value instanceof Form ? asInstance(value) : undefined;
  }

  private arrayItems(name: string): FormInstance[] | undefined {
    const tracked = this.arrayChildren.get(name);
    if (tracked !== undefined) {
      return tracked;
    }
    const value = this.readOwnValue(name);
    if (!Array.isArray(value) || value.length === 0) {
      return undefined;
    }
    const items: FormInstance[] = [];
    for (const item of value) {
      if (!(item instanceof Form)) {
        return undefined;
      }
      items.push(asInstance(item));
    }
    this.arrayChildren.set(name, items);
    return items;
  }

  private requireArrayItem(root: string, index: number): FormInstance {
    const item = this.arrayItems(root)?.[index];
    if (item === undefined) {
      throw new Error(`Элемент массива "${root}[${index}]" не найден`);
    }
    return item;
  }

  private requireArrayItems(name: string): FormInstance[] {
    const items = this.arrayItems(name);
    if (items === undefined) {
      throw new TypeError(`Поле "${name}" не является массивом форм`);
    }
    return items;
  }

  private ensureArrayItems(name: string): FormInstance[] {
    const tracked = this.arrayChildren.get(name);
    if (tracked !== undefined) {
      return tracked;
    }
    const value = this.readOwnValue(name);
    if (!Array.isArray(value)) {
      throw new TypeError(`Поле "${name}" не является массивом`);
    }
    const items: FormInstance[] = [];
    for (const item of value) {
      if (!(item instanceof Form)) {
        throw new TypeError(`Поле "${name}" не является массивом форм`);
      }
      items.push(asInstance(item));
    }
    this.arrayChildren.set(name, items);
    return items;
  }

  private requireChild(name: string): FormInstance {
    const child = this.childFor(name);
    if (child === undefined) {
      throw new Error(`Поле "${name}" больше не является вложенной формой`);
    }
    return child;
  }

  /**
   * Проверяет владение/цикл без изменения состояния.
   * Бросает, если форму нельзя привязать к `parent.field`.
   */
  private ensureCanBind(parent: FormInstance, field: string): void {
    let cursor: FormInstance | undefined = parent;
    while (cursor !== undefined) {
      if (cursor === asInstance(this)) {
        throw new Error("Вложенная форма не может образовывать цикл");
      }
      cursor = cursor.parentForm;
    }
    if (this.parentForm !== undefined) {
      if (this.parentForm === parent && this.parentField === field) {
        return;
      }
      const owner = this.parentForm.constructor.name;
      const ownerField = this.parentField ?? "?";
      throw new Error(
        `Экземпляр формы ${this.constructor.name} уже используется как поле формы ${owner}.${ownerField}`,
      );
    }
  }

  /**
   * Предварительная привязка ребёнка сразу после инициализатора `@Field`,
   * чтобы id и пути были доступны без первого обращения к родителю.
   * Конфликты владения разрешаются позже в `syncChildren`.
   */
  private bindInitialField(name: string, value: unknown): void {
    if (Array.isArray(value)) {
      if (value.length === 0) {
        return;
      }
      const items: FormInstance[] = [];
      for (const item of value) {
        if (!(item instanceof Form)) {
          return;
        }
        items.push(asInstance(item));
      }
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index]!;
        if (item.parentForm === undefined) {
          item.bindParent(asInstance(this), `${name}[${index}]`);
        } else if (item.parentForm !== asInstance(this)) {
          return;
        }
      }
      const current = this.children.get(name);
      if (current !== undefined) {
        this.detachChild(name, current);
      }
      this.arrayChildren.set(name, items);
      for (let index = 0; index < items.length; index += 1) {
        this.assignArrayItem(items[index]!, name, index);
      }
      this.invalidateProps(name);
      return;
    }
    if (!(value instanceof Form)) {
      return;
    }
    const child = asInstance(value);
    if (child.parentForm !== undefined) {
      return;
    }
    const current = this.children.get(name);
    child.bindParent(asInstance(this), name);
    if (current !== undefined && current !== child) {
      this.detachChild(name, current);
    }
    this.children.set(name, child);
    this.invalidateProps(name);
  }

  private bindParent(parent: FormInstance, field: string): void {
    if (this.parentForm === parent && this.parentField === field) {
      return;
    }
    this.ensureCanBind(parent, field);
    this.parentForm = parent;
    this.parentField = field;
    const path = parent.idPath === "" ? field : `${parent.idPath}.${field}`;
    this.refreshIdContext(parent.idPrefix, path);
  }

  /** Обновляет префикс/путь DOM-id у формы и всех её детей. */
  private refreshIdContext(prefix: string, path: string): void {
    this.idPrefix = prefix;
    this.idPath = path;
    this.propsCache.clear();
    for (const [name, child] of this.children) {
      const childPath = path === "" ? name : `${path}.${name}`;
      child.refreshIdContext(prefix, childPath);
    }
  }

  private attachChild(name: string, child: FormInstance): void {
    const current = this.children.get(name);
    if (current === child) {
      child.bindParent(asInstance(this), name);
      return;
    }
    // Сначала проверка/привязка нового ребёнка: при ошибке старый остаётся.
    child.bindParent(asInstance(this), name);
    if (current !== undefined) {
      this.detachChild(name, current);
    }
    this.children.set(name, child);
    this.invalidateProps(name);
  }

  private detachChild(name: string, child: FormInstance): void {
    if (this.children.get(name) === child) {
      this.children.delete(name);
    }
    if (child.parentForm === asInstance(this) && child.parentField === name) {
      child.parentForm = undefined;
      child.parentField = undefined;
      child.refreshIdContext(child.ownIdPrefix, "");
    }
    this.invalidateProps(name);
  }

  /** Удаляет из кэша props записи поля и всех его вложенных путей. */
  private invalidateProps(name: string): void {
    this.propsCache.delete(name);
    const dotPrefix = `${name}.`;
    const bracketPrefix = `${name}[`;
    for (const key of [...this.propsCache.keys()]) {
      if (key.startsWith(dotPrefix) || key.startsWith(bracketPrefix)) {
        this.propsCache.delete(key);
      }
    }
  }

  private locate(path: string): {
    root: string;
    index: number | undefined;
    rest: string | undefined;
  } {
    this.ensureInitialized();
    if (path === "") {
      throw new Error("Путь поля не может быть пустым");
    }
    const bracket = path.indexOf("[");
    const dot = path.indexOf(".");
    if (bracket !== -1 && (dot === -1 || bracket < dot)) {
      const root = path.slice(0, bracket);
      if (!this.metadata.has(root)) {
        throw this.unknownFieldError(path);
      }
      const close = path.indexOf("]", bracket + 1);
      if (close === -1) {
        throw new Error(`Неверный путь поля "${path}": не закрыт индекс`);
      }
      const token = path.slice(bracket + 1, close);
      if (!/^\d+$/.test(token)) {
        throw new Error(`Неверный индекс в пути поля "${path}"`);
      }
      const index = Number(token);
      const after = path.slice(close + 1);
      let rest: string | undefined;
      if (after !== "") {
        if (!after.startsWith(".")) {
          throw new Error(`Неверный путь поля "${path}"`);
        }
        rest = after.slice(1);
        if (rest === "") {
          throw new Error(`Неверный путь поля "${path}"`);
        }
      }
      const items = this.arrayItems(root);
      if (items === undefined || items[index] === undefined) {
        throw this.unknownFieldError(path);
      }
      return { root, index, rest };
    }
    const root = dot === -1 ? path : path.slice(0, dot);
    const rest = dot === -1 ? undefined : path.slice(dot + 1);
    if (!this.metadata.has(root)) {
      throw this.unknownFieldError(path);
    }
    if (rest !== undefined) {
      if (this.childFor(root) !== undefined) {
        // обычная вложенная форма
      } else if (this.arrayItems(root) !== undefined) {
        throw new Error(
          `Для массива форм "${root}" нужен индекс: "${root}[0].${rest}"`,
        );
      } else {
        throw new Error(
          `Поле "${root}" не является вложенной формой или массивом форм, поэтому путь "${path}" недоступен`,
        );
      }
    }
    return { root, index: undefined, rest };
  }

  private unknownFieldError(path: string): Error {
    const form = this;
    const error = new Error();
    Object.defineProperty(error, "message", {
      configurable: true,
      enumerable: false,
      get(): string {
        const available = form.availablePaths();
        return `Поле "${path}" не зарегистрировано. Доступные поля: ${available.length > 0 ? available.join(", ") : "—"}`;
      },
    });
    return error;
  }

  private availablePaths(visited = new Set<object>()): string[] {
    this.ensureInitialized();
    this.syncChildren();
    if (visited.has(this)) {
      return [];
    }
    visited.add(this);
    const result: string[] = [];
    for (const name of this.metadata.keys()) {
      result.push(name);
      const child = this.childFor(name);
      if (child !== undefined) {
        for (const nested of child.availablePaths(visited)) {
          result.push(`${name}.${nested}`);
        }
        continue;
      }
      const items = this.arrayChildren.get(name);
      if (items !== undefined) {
        for (let index = 0; index < items.length; index += 1) {
          const item = items[index]!;
          for (const nested of item.availablePaths(visited)) {
            result.push(`${name}[${index}].${nested}`);
          }
        }
      }
    }
    return result;
  }

  private labelFor(name: string): string {
    const metadata = this.metadata.get(name);
    return metadata?.label ?? this.options.labels[name] ?? name;
  }

  /** `@Label` на любом уровне пути (без учёта options.labels). */
  private metadataLabelFor(path: string): string | undefined {
    const dot = path.indexOf(".");
    if (dot === -1) {
      return this.metadata.get(path)?.label;
    }
    const root = path.slice(0, dot);
    const child = this.childFor(root);
    if (child === undefined) {
      return undefined;
    }
    return child.metadataLabelFor(path.slice(dot + 1));
  }

  private labelForNested(path: string, fallback: string): string {
    return (
      this.metadataLabelFor(path) ??
      this.options.labels[path] ??
      this.options.labels[lastSegment(path)] ??
      fallback
    );
  }

  private idFor(path: string): string {
    const fullPath = this.idPath === "" ? path : `${this.idPath}.${path}`;
    return `${this.idPrefix}-${fullPath}`;
  }

  private invalidateValidation(): void {
    this.changeVersion[1]((version) => version + 1);
    const hasLocalWork =
      this.validatePromise !== undefined ||
      this.fieldValidationPromises.size > 0 ||
      this.validationRunCount > 0;
    if (hasLocalWork) {
      this.validationGeneration += 1;
      this.validatePromise = undefined;
      this.fieldValidationPromises.clear();
      this.validationRunCount = 0;
      this.clearValidatingFields();
      this.validatingForm[1](0);
    }
    const parent = this.parentForm;
    const field = this.parentField;
    if (parent !== undefined && field !== undefined) {
      // Ошибка уровня поля-формы снимается при изменении любого ребёнка.
      parent.errorStore.removeExternal(field);
      parent.invalidateValidation();
    }
  }

  /**
   * Активно ли поле для проверки. Thenable-условие не пропускаем:
   * окончательное решение принимает валидатор.
   */
  private isFieldActiveForValidation(metadata: FieldMetadata): boolean {
    if (metadata.when === undefined) {
      return true;
    }
    const result: unknown = metadata.when(this);
    if (isThenable(result)) {
      void Promise.resolve(result).catch(() => {});
      return true;
    }
    return result === true;
  }

  /**
   * Активно ли условие для синхронной готовности. Thenable считается
   * оптимистично неактивным: `isReady` не блокируется до `validate()`.
   */
  private isConditionActiveForReady(metadata: FieldMetadata): boolean {
    if (metadata.when === undefined) {
      return true;
    }
    const result: unknown = metadata.when(this);
    if (isThenable(result)) {
      void Promise.resolve(result).catch(() => {});
      return false;
    }
    return result === true;
  }

  /** Активно ли требование непустого значения с учётом `@Optional`/`@ValidateIf`. */
  private isRequirementActive(
    metadata: FieldMetadata,
    value: unknown,
    active = this.isConditionActiveForReady(metadata),
  ): boolean {
    if (metadata.required !== true) {
      return false;
    }
    if (metadata.optional === true && (value === undefined || value === null)) {
      return false;
    }
    return active;
  }

  /** Однократная диагностика правила без зарегистрированного `@Field`. */
  private reportUnregisteredField(root: string, path: string): void {
    if (this.reportedUnregisteredRoots.has(root)) {
      return;
    }
    this.reportedUnregisteredRoots.add(root);
    const message =
      `Поле "${root}" (путь "${path}") имеет правила валидации, но не объявлено через @Field()`;
    const handler = this.options.onError;
    if (handler === undefined) {
      console.warn(message);
      return;
    }
    try {
      handler(new Error(message));
    } catch (handlerError) {
      console.error(handlerError);
    }
  }

  /** Внутренний доступ по строковому пути: сужает публичный `FieldPath`. */
  private propsAt(path: string): FieldProps<unknown> {
    return this.getFieldProps(path as never) as unknown as FieldProps<unknown>;
  }

  /** Внутренняя проверка по строковому пути. */
  private validateAt(
    path: string,
    options?: ValidationOptions,
  ): Promise<boolean> {
    return this.validateField(path as never, options);
  }

  /** Внутренняя установка внешних ошибок по строковому пути. */
  private setErrorsAt(path: string, messages: readonly string[]): void {
    this.setFieldErrors(path as never, messages);
  }

  /** Внутренняя очистка внешних ошибок по строковому пути. */
  private clearErrorsAt(path: string): void {
    this.clearFieldErrors(path as never);
  }

  private createProps(path: string): FieldProps<unknown> {
    const { root, index, rest } = this.locate(path);
    if (index !== undefined) {
      if (rest !== undefined) {
        return createArrayItemFieldProps(
          this.propsHost,
          path,
          root,
          index,
          rest,
        );
      }
      return createArrayItemProps(this.propsHost, path, root, index);
    }
    if (rest !== undefined) {
      return createNestedFieldProps(this.propsHost, path, root, rest);
    }
    if (this.childFor(root) !== undefined) {
      return createNestedFormProps(this.propsHost, root);
    }
    if (this.arrayItems(root) !== undefined) {
      return createFormArrayProps(this.propsHost, root);
    }
    return createDirectProps(this.propsHost, root);
  }

  private arrayErrors(name: string): Readonly<Record<string, readonly string[]>> {
    const prefix = `${name}[`;
    const result: Record<string, readonly string[]> = {};
    for (const [key, messages] of Object.entries(this.errors)) {
      if (key.startsWith(prefix)) {
        result[key] = messages;
      }
    }
    return result;
  }

  private replaceArray(name: string, value: unknown): void {
    if (!Array.isArray(value) || !value.every((item) => item instanceof Form)) {
      throw new TypeError(`Поле "${name}" — массив форм: ожидался массив Form`);
    }
    const items = value.map((item) => asInstance(item as object));
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index]!;
      if (item.parentForm !== asInstance(this)) {
        item.ensureCanBind(asInstance(this), `${name}[${index}]`);
      }
    }
    const previous = this.requireArrayItems(name);
    const nextSet = new Set<object>(items);
    const removed = previous.filter((item) => !nextSet.has(item));
    this.commitArray(name, items, removed);
  }

  private nestedBindingError(name: string, handler: string): never {
    throw new Error(
      `Поле "${name}" — вложенная форма: ${handler} не привязан к одному input, используйте путь вложенного поля`,
    );
  }

  private validationMap(): ReadonlyMap<string, readonly string[]> {
    this.errorsRevision[0]();
    return this.errorStore.validationMap;
  }

  private externalMap(): ReadonlyMap<string, readonly string[]> {
    this.errorsRevision[0]();
    return this.errorStore.externalMap;
  }

  private directErrors(name: string): readonly string[] {
    this.errorsRevision[0]();
    return this.errorStore.fieldErrors(name);
  }

  private nestedFormErrors(name: string): readonly string[] {
    const result: string[] = [];
    for (const [key, messages] of Object.entries(this.errors)) {
      if (key === name || key.startsWith(`${name}.`)) {
        result.push(...messages);
      }
    }
    return result;
  }

  private computeErrors(): ErrorsMap {
    this.ensureInitialized();
    this.syncChildren();
    const result: Record<string, readonly string[]> = {};
    const merge = (map: ReadonlyMap<string, readonly string[]>): void => {
      for (const [key, messages] of map) {
        if (messages.length === 0) {
          continue;
        }
        const existing = result[key];
        result[key] = existing === undefined
          ? messages
          : [...existing, ...messages];
      }
    };
    merge(this.validationMap());
    merge(this.externalMap());
    for (const name of this.metadata.keys()) {
      const child = this.childFor(name);
      if (child !== undefined) {
        for (const [key, messages] of Object.entries(child.errors)) {
          result[`${name}.${key}`] = messages;
        }
        continue;
      }
      const items = this.arrayChildren.get(name);
      if (items === undefined) {
        continue;
      }
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index]!;
        for (const [key, messages] of Object.entries(item.errors)) {
          result[`${name}[${index}].${key}`] = messages;
        }
      }
    }
    return result;
  }

  private runFieldValidation(
    name: string,
    options?: ValidationOptions,
    onSettled?: () => void,
  ): Promise<boolean> {
    const generation = this.validationGeneration;
    const token = (this.validationTokens.get(name) ?? 0) + 1;
    this.validationTokens.set(name, token);
    this.validationRunCount += 1;
    this.addValidating(name);
    return (async () => {
      try {
        const result = await validatePropertyAsync(
          this,
          name,
          this.validationOptions(options),
        );
        if (
          this.disposed ||
          generation !== this.validationGeneration ||
          this.validationTokens.get(name) !== token
        ) {
          return result.valid;
        }
        this.errorStore.replaceFieldErrors(name, result.errors);
        return result.valid;
      } finally {
        if (!this.disposed && generation === this.validationGeneration) {
          this.validationRunCount = Math.max(0, this.validationRunCount - 1);
          if (this.validationTokens.get(name) === token) {
            this.removeValidating(name);
          }
        }
        onSettled?.();
      }
    })();
  }

  private setDirectValue(name: string, value: unknown): void {
    const previous = this.readOwnValue(name);
    if (Object.is(previous, value)) {
      return;
    }
    const nextChild = value instanceof Form ? asInstance(value) : undefined;
    // Проверка владения/цикла — до любых изменений формы и старого ребёнка.
    if (nextChild !== undefined) {
      nextChild.ensureCanBind(asInstance(this), name);
    }
    this.invalidateValidation();
    if (previous instanceof Form) {
      this.detachChild(name, asInstance(previous));
    }
    this.writeOwnValue(name, value);
    if (nextChild !== undefined) {
      nextChild.bindParent(asInstance(this), name);
      this.children.set(name, nextChild);
    }
    this.invalidateProps(name);
    this.markDirty(name);
    if (this.options.clearExternalErrorsOnChange) {
      this.errorStore.removeExternal(name);
    }
  }

  private handleValueEvent(
    name: string,
    event: FieldEventLike,
    mode: ValidateOnMode,
  ): void {
    const target = eventTarget(event);
    if (target === undefined) {
      return;
    }
    const type = typeof target.type === "string" ? target.type : "";
    if (target.multiple === true || type === "select-multiple") {
      const values = selectedValues(target) ?? [];
      this.setDirectValue(name, values);
      this.validateForEvent(name, mode);
      return;
    }
    if (type === "checkbox") {
      this.setDirectValue(name, target.checked === true);
      this.validateForEvent(name, mode);
      return;
    }
    if (type === "radio") {
      if (target.checked !== true) {
        return;
      }
      const value = target.value === undefined
        ? true
        : coerceValue(this.readOwnValue(name), target.value);
      this.setDirectValue(name, value);
      this.validateForEvent(name, mode);
      return;
    }
    const value = coerceValue(this.readOwnValue(name), target.value);
    this.setDirectValue(name, value);
    this.validateForEvent(name, mode);
  }

  private effectiveModes(name: string): readonly ValidateOnMode[] {
    const metadata = this.metadata.get(name);
    if (metadata?.validateOn !== undefined) {
      return metadata.validateOn.filter((mode) => mode !== "none");
    }
    const modes: ValidateOnMode[] = [];
    if (this.options.validateOnChange) {
      modes.push("change");
    }
    if (this.options.validateOnBlur) {
      modes.push("blur");
    }
    if (this.options.validateOnInput) {
      modes.push("input");
    }
    if (this.options.validateOnSubmit) {
      modes.push("submit");
    }
    return modes;
  }

  private validateForEvent(name: string, mode: ValidateOnMode): void {
    if (!this.effectiveModes(name).includes(mode)) {
      return;
    }
    this.scheduleValidation(name);
  }

  private scheduleValidation(name: string): void {
    const delay = this.options.debounceMs;
    if (delay <= 0) {
      void this.runFieldValidation(name).catch((error: unknown) => {
        this.reportError(error);
      });
      return;
    }
    const existing = this.timers.get(name);
    if (existing !== undefined) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      this.timers.delete(name);
      void this.runFieldValidation(name).catch((error: unknown) => {
        this.reportError(error);
      });
    }, delay);
    this.timers.set(name, timer);
  }

  private async validateSubmitFields(): Promise<void> {
    this.ensureInitialized();
    this.syncChildren();
    const generation = this.validationGeneration;
    for (const [name, metadata] of this.metadata) {
      if (this.disposed || generation !== this.validationGeneration) {
        return;
      }
      const child = this.childFor(name);
      if (child !== undefined) {
        if (!this.isFieldActiveForValidation(metadata)) {
          continue;
        }
        this.markTouched(name);
        await child.validateSubmitFields();
        continue;
      }
      const items = this.arrayChildren.get(name);
      if (items !== undefined) {
        if (!this.isFieldActiveForValidation(metadata)) {
          continue;
        }
        this.markTouched(name);
        await Promise.all(items.map((item) => item.validateSubmitFields()));
        continue;
      }
      if (metadata.validateOn?.includes("submit") !== true) {
        continue;
      }
      this.markTouched(name);
      await this.runFieldValidation(name);
    }
  }

  private markTouched(name: string): void {
    const current = this.touchedFields[0]();
    if (current.has(name)) {
      return;
    }
    const next = new Set(current);
    next.add(name);
    this.touchedFields[1](next);
  }

  private markDirty(name: string): void {
    const current = this.dirtyFields[0]();
    if (current.has(name)) {
      return;
    }
    const next = new Set(current);
    next.add(name);
    this.dirtyFields[1](next);
  }

  private markAllTouched(): void {
    this.ensureInitialized();
    const current = this.touchedFields[0]();
    let missing = false;
    for (const name of this.metadata.keys()) {
      if (!current.has(name)) {
        missing = true;
        break;
      }
    }
    if (missing) {
      const next = new Set(current);
      for (const name of this.metadata.keys()) {
        next.add(name);
      }
      this.touchedFields[1](next);
    }
    for (const name of this.metadata.keys()) {
      const child = this.childFor(name);
      if (child !== undefined) {
        child.markAllTouched();
        continue;
      }
      const items = this.arrayChildren.get(name);
      if (items !== undefined) {
        for (const item of items) {
          item.markAllTouched();
        }
      }
    }
  }

  private setReadyFor(name: string, ready: boolean): void {
    if ((this.readyStates.get(name) ?? true) === ready) {
      return;
    }
    this.readyStates.set(name, ready);
    this.readyVersion[1]((version) => version + 1);
  }

  private addValidating(name: string): void {
    if (this.validatingFieldSet.has(name)) {
      return;
    }
    this.validatingFieldSet.add(name);
    this.validatingVersion[1]((version) => version + 1);
  }

  private removeValidating(name: string): void {
    if (!this.validatingFieldSet.delete(name)) {
      return;
    }
    this.validatingVersion[1]((version) => version + 1);
  }

  private clearValidatingFields(): void {
    if (this.validatingFieldSet.size === 0) {
      return;
    }
    this.validatingFieldSet.clear();
    this.validatingVersion[1]((version) => version + 1);
  }

  private hasAnyTouched(): boolean {
    this.ensureInitialized();
    this.syncChildren();
    if (this.touchedFields[0]().size > 0) {
      return true;
    }
    for (const child of this.children.values()) {
      if (child.hasAnyTouched()) {
        return true;
      }
    }
    return false;
  }

  private hasValidating(): boolean {
    this.ensureInitialized();
    this.syncChildren();
    this.validatingVersion[0]();
    if (this.validatingFieldSet.size > 0 || this.validatingForm[0]() > 0) {
      return true;
    }
    for (const child of this.children.values()) {
      if (child.hasValidating()) {
        return true;
      }
    }
    return false;
  }

  /** labels текущей формы + переданные, с приоритетом переданных. */
  private validationOptions(
    options?: ValidationOptions,
  ): ValidationOptions | undefined {
    if (options === undefined) {
      return this.baseValidationOptions;
    }
    const localLabels = this.options.labels;
    const extraLabels = options.labels;
    if (
      Object.keys(localLabels).length === 0 &&
      (extraLabels === undefined || Object.keys(extraLabels).length === 0)
    ) {
      return options;
    }
    const labels = {
      ...localLabels,
      ...(extraLabels ?? {}),
    };
    return Object.keys(labels).length > 0
      ? { ...options, labels }
      : options;
  }

  /**
   * Опции для проверки ребёнка: labels родителя с полным путём
   * (`address.city` → `city`) плюс короткие labels; локальные labels ребёнка
   * добавит его собственный `validationOptions`.
   */
  private childValidationOptions(
    root: string,
    options?: ValidationOptions,
  ): ValidationOptions | undefined {
    return this.nestedValidationOptions(root, options);
  }

  private nestedValidationOptions(
    prefixPath: string,
    options?: ValidationOptions,
  ): ValidationOptions | undefined {
    const merged = {
      ...this.options.labels,
      ...(options?.labels ?? {}),
    };
    const labels: Record<string, string> = {};
    const prefix = `${prefixPath}.`;
    for (const [key, value] of Object.entries(merged)) {
      if (key.startsWith(prefix)) {
        labels[key.slice(prefix.length)] = value;
      } else if (!key.includes(".")) {
        labels[key] = value;
      }
    }
    const result: ValidationOptions = {
      ...options,
      ...(Object.keys(labels).length > 0 ? { labels } : {}),
    };
    return Object.keys(result).length === 0 ? undefined : result;
  }

  private clearTimers(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  private reportError(error: unknown): void {
    const handler = this.options.onError;
    if (handler === undefined) {
      console.error(error);
      return;
    }
    try {
      handler(error);
    } catch (handlerError) {
      console.error(handlerError);
    }
  }
}
