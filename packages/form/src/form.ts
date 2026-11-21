import { createEffect, createRoot, createSignal, getComputed, storeFor } from "@ivlev-dev/silent-reactivity";
import { ValidationModel } from "@ivlev-dev/silent-validation";
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
import {
  runFieldPath,
  runFieldValidation,
  runFormArrayValidation,
  runFullValidation,
  validateSubmitFields,
} from "./validation.js";
import type { ValidationHost } from "./validation.js";
import {
  assignArrayItem,
  attachChild,
  bindArrayChildren,
  bindInitialField,
  bindParent,
  detachArray,
  detachChild,
  ensureCanBind,
  refreshIdContext,
  registerNestedLink,
  syncChildren,
} from "./nested.js";
import type { NestedLink } from "./nested.js";
import {
  arrayErrors,
  arrayItems,
  commitArray,
  ensureArrayItems,
  isBaselineArrayItem,
  replaceArray,
  requireArrayItem,
  requireArrayItems,
  restoreArray,
  setArrayValues,
} from "./array-state.js";
import type { ArrayStateHost } from "./array-state.js";
import {
  addValidating,
  clearValidatingFields,
  computeDirty,
  computeReady,
  computeValid,
  hasAnyTouched,
  hasValidating,
  isConditionActiveForReady,
  isRequirementActive,
  markAllTouched,
  markDirty,
  markTouched,
  removeValidating,
  setReadyFor,
} from "./state.js";
import type { StateHost } from "./state.js";
import { computeErrors, computeValues } from "./state.js";
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
  private readonly validationHost: ValidationHost;
  private readonly nestedLink: NestedLink;
  private readonly arrayStateHost: ArrayStateHost;
  private readonly stateHost: StateHost;
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
  private readonly arrayFactories = new Map<string, () => FormInstance>();
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
    const self = this;
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
      runFieldValidation: (name) => runFieldValidation(this.validationHost, name),
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
      runFormArrayValidation: (name) =>
        runFormArrayValidation(this.validationHost, name),
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
      createItem: (name) => {
        const factory = this.arrayFactories.get(name) ?? this.metadata.get(name)?.arrayFactory;
        return factory?.() as FormInstance | undefined;
      },
    };
    this.validationHost = {
      instance: this,
      get metadata() {
        return self.metadata;
      },
      get options() {
        return self.options;
      },
      get errorStore() {
        return self.errorStore;
      },
      get disposed() {
        return self.disposed;
      },
      get validationGeneration() {
        return self.validationGeneration;
      },
      get isValid() {
        return self.isValid;
      },
      get baseValidationOptions() {
        return self.baseValidationOptions;
      },
      get labels() {
        return self.options.labels;
      },
      validationTokens: this.validationTokens,
      ensureInitialized: () => self.ensureInitialized(),
      syncChildren: () => self.syncChildren(),
      clearTimers: () => self.clearTimers(),
      clearValidatingFields: () => self.clearValidatingFields(),
      setValidatingForm: (value) => self.validatingForm[1](value),
      getValidationRunCount: () => self.validationRunCount,
      setValidationRunCount: (value) => {
        self.validationRunCount = value;
      },
      childFor: (name) => self.childFor(name),
      requireChild: (name) => self.requireChild(name),
      arrayItems: (name) => self.arrayItems(name),
      requireArrayItem: (root, index) => self.requireArrayItem(root, index),
      validateChildAt: (child, path, validationOptions) =>
        child.validateField(path as never, validationOptions),
      validateChildSubmitFields: (child) => child.validateSubmitFields(),
      locate: (path) => self.locate(path),
      reportUnregisteredField: (root, path) =>
        self.reportUnregisteredField(root, path),
      markAllTouched: () => self.markAllTouched(),
      markTouched: (name) => self.markTouched(name),
      isFieldActiveForValidation: (metadata) =>
        self.isFieldActiveForValidation(metadata),
      addValidating: (name) => self.addValidating(name),
      removeValidating: (name) => self.removeValidating(name),
      runFieldValidation: (name, validationOptions) =>
        runFieldValidation(self.validationHost, name, validationOptions),
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
    this.nestedLink = {
      form: this,
      ownIdPrefix: this.ownIdPrefix,
      children: this.children,
      arrayChildren: this.arrayChildren,
      get metadata() {
        return self.metadata;
      },
      get parentForm() {
        return self.parentForm;
      },
      set parentForm(value) {
        self.parentForm = value;
      },
      get parentField() {
        return self.parentField;
      },
      set parentField(value) {
        self.parentField = value;
      },
      get idPrefix() {
        return self.idPrefix;
      },
      set idPrefix(value) {
        self.idPrefix = value;
      },
      get idPath() {
        return self.idPath;
      },
      set idPath(value) {
        self.idPath = value;
      },
      readValue: (name) => self.readOwnValue(name),
      invalidateProps: (name) => self.invalidateProps(name),
      clearProps: () => self.propsCache.clear(),
    };
    registerNestedLink(this, this.nestedLink);
    this.stateHost = {
      get metadata() {
        return self.metadata;
      },
      get errorStore() {
        return self.errorStore;
      },
      touchedFields: this.touchedFields,
      dirtyFields: this.dirtyFields,
      readyStates: this.readyStates,
      readyVersion: this.readyVersion,
      validatingFieldSet: this.validatingFieldSet,
      validatingVersion: this.validatingVersion,
      validatingForm: this.validatingForm,
      readValue: (name) => self.readOwnValue(name),
      isForm: (value): value is Form => value instanceof Form,
      childFor: (name) => self.childFor(name),
      arrayItems: (name) => self.arrayItems(name),
      markAllTouchedChild: (child) => child.markAllTouched(),
      hasAnyTouchedChild: (child) => child.hasAnyTouched(),
      hasValidatingChild: (child) => child.hasValidating(),
    };
    this.arrayStateHost = {
      get link() {
        return self.nestedLink;
      },
      get metadata() {
        return self.metadata;
      },
      get initialValues() {
        return self.initialValues;
      },
      get arrayChildren() {
        return self.arrayChildren;
      },
      get clearExternalOnChange() {
        return self.options.clearExternalErrorsOnChange;
      },
      readValue: (name) => self.readOwnValue(name),
      writeValue: (name, value) => self.writeOwnValue(name, value),
      setDirectValue: (name, value) => self.setDirectValue(name, value),
      invalidateValidation: () => self.invalidateValidation(),
      markDirty: (name) => self.markDirty(name),
      clearExternal: (name) => self.errorStore.removeExternal(name),
      invalidateProps: (name) => self.invalidateProps(name),
      ensureCanBind: (item, name, index) => {
        item.ensureCanBind(asInstance(self), `${name}[${index}]`);
      },
      createItem: (name) => {
        const factory = self.arrayFactories.get(name) ?? self.metadata.get(name)?.arrayFactory;
        return factory?.() as FormInstance | undefined;
      },
      hasFactory: (name) =>
        self.arrayFactories.has(name) || self.metadata.get(name)?.arrayFactory !== undefined,
    };
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
      this.errorsRevision[0]();
      return computeReady(this.stateHost);
    });
  }

  /** У формы нет ошибок. */
  get isValid(): boolean {
    return getComputed(this, MEMO_IS_VALID, () => {
      this.ensureInitialized();
      this.syncChildren();
      this.errorsRevision[0]();
      return computeValid(this.stateHost);
    });
  }

  /** Хотя бы одно поле менялось пользователем или программно. */
  get isDirty(): boolean {
    return getComputed(this, MEMO_IS_DIRTY, () => {
      this.ensureInitialized();
      this.syncChildren();
      return computeDirty(this.stateHost);
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
      return computeValues(this.stateHost);
    });
  }

  /**
   * Массив повторяемых форм: элементы, ошибки, готовность и операции
   * add/insert/remove/move/clear.
   */
  getFieldArray<K extends ArrayFieldPath<this>>(
    field: K,
    factory?: () => ArrayItemOf<this, K>,
  ): FormArray<ArrayItemOf<this, K>> {
    const name = field as string;
    this.ensureInitialized();
    if (factory !== undefined) {
      this.arrayFactories.set(name, factory as () => FormInstance);
    }
    this.ensureArrayItems(name);
    return createFieldArray<Form>(this.arrayHost, name) as unknown as FormArray<
      ArrayItemOf<this, K>
    >;
  }

  private commitArray(
    name: string,
    next: FormInstance[],
    removed: FormInstance[],
  ): void {
    commitArray(this.arrayStateHost, name, next, removed);
  }

  private setArrayValues(name: string, entries: readonly unknown[]): void {
    setArrayValues(this.arrayStateHost, name, entries);
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
      promise = runFieldPath(this.validationHost, path, options, onSettled);
    } catch (error) {
      entry.active = false;
      promise = Promise.reject(error);
    }
    entry.promise = promise;
    this.fieldValidationPromises.set(path, entry);
    return promise;
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
    runFullValidation(this.validationHost, options).then(resolve, reject);
    return promise;
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
          await validateSubmitFields(this.validationHost);
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
      if (
        Array.isArray(value) &&
        (this.arrayChildren.has(name) ||
          this.metadata.get(name)?.arrayFactory !== undefined)
      ) {
        this.ensureArrayItems(name);
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

  private isBaselineArrayItem(item: FormInstance): boolean {
    return isBaselineArrayItem(this.arrayStateHost, item);
  }

  private restoreArray(name: string, restored: readonly unknown[], current: unknown): void {
    restoreArray(this.arrayStateHost, name, restored, current);
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

  private syncChildren(): void {
    syncChildren(this.nestedLink);
  }

  private bindArrayChildren(name: string, items: FormInstance[]): void {
    bindArrayChildren(this.nestedLink, name, items);
  }

  private assignArrayItem(item: FormInstance, name: string, index: number): void {
    assignArrayItem(this.nestedLink, item, name, index);
  }

  private detachArray(name: string): void {
    detachArray(this.nestedLink, name);
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
    return arrayItems(this.arrayStateHost, name);
  }

  private requireArrayItem(root: string, index: number): FormInstance {
    return requireArrayItem(this.arrayStateHost, root, index);
  }

  private requireArrayItems(name: string): FormInstance[] {
    return requireArrayItems(this.arrayStateHost, name);
  }

  private ensureArrayItems(name: string): FormInstance[] {
    return ensureArrayItems(this.arrayStateHost, name);
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
    ensureCanBind(this, parent, field);
  }

  private bindInitialField(name: string, value: unknown): void {
    bindInitialField(this.nestedLink, name, value);
  }

  private bindParent(parent: FormInstance, field: string): void {
    bindParent(this, parent, field);
  }

  private refreshIdContext(prefix: string, path: string): void {
    refreshIdContext(this, prefix, path);
  }

  private attachChild(name: string, child: FormInstance): void {
    attachChild(this.nestedLink, name, child);
  }

  private detachChild(name: string, child: FormInstance): void {
    detachChild(this.nestedLink, name, child);
  }

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

  private isConditionActiveForReady(metadata: FieldMetadata): boolean {
    return isConditionActiveForReady(this.stateHost, metadata);
  }

  private isRequirementActive(
    metadata: FieldMetadata,
    value: unknown,
    active = this.isConditionActiveForReady(metadata),
  ): boolean {
    return isRequirementActive(this.stateHost, metadata, value, active);
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
    return arrayErrors(this.arrayStateHost, name, this.errors);
  }

  private replaceArray(name: string, value: unknown): void {
    replaceArray(this.arrayStateHost, name, value);
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
    this.errorsRevision[0]();
    return computeErrors(this.stateHost);
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
      void runFieldValidation(this.validationHost, name).catch((error: unknown) => {
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
      void runFieldValidation(this.validationHost, name).catch((error: unknown) => {
        this.reportError(error);
      });
    }, delay);
    this.timers.set(name, timer);
  }

  private validateSubmitFields(): Promise<void> {
    return validateSubmitFields(this.validationHost);
  }

  private markTouched(name: string): void {
    markTouched(this.stateHost, name);
  }

  private markDirty(name: string): void {
    markDirty(this.stateHost, name);
  }

  private markAllTouched(): void {
    markAllTouched(this.stateHost);
  }

  private setReadyFor(name: string, ready: boolean): void {
    setReadyFor(this.stateHost, name, ready);
  }

  private addValidating(name: string): void {
    addValidating(this.stateHost, name);
  }

  private removeValidating(name: string): void {
    removeValidating(this.stateHost, name);
  }

  private clearValidatingFields(): void {
    clearValidatingFields(this.stateHost);
  }

  private hasAnyTouched(): boolean {
    this.ensureInitialized();
    this.syncChildren();
    return hasAnyTouched(this.stateHost);
  }

  private hasValidating(): boolean {
    this.ensureInitialized();
    this.syncChildren();
    return hasValidating(this.stateHost);
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
