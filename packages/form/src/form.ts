import { createSignal, getComputed, storeFor } from "@ivlev-dev/silent-reactivity";
import { validateAsync, validatePropertyAsync } from "@ivlev-dev/silent-validation";
import type { ValidationOptions } from "@ivlev-dev/silent-validation";
import {
  fieldMetadataFor,
  registerFieldBinder,
  registerValidationInvalidator,
  unregisterFieldBinder,
  unregisterValidationInvalidator,
} from "./metadata.js";
import type { FieldMetadata } from "./metadata.js";
import type {
  FieldEventLike,
  FieldPath,
  FieldProps,
  FormOptions,
  ValidateOnMode,
} from "./types.js";

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

type SetValuesInput<T> = {
  [K in keyof T as K extends keyof Form
    ? never
    : T[K] extends (...args: never[]) => unknown
      ? never
      : K]?: T[K] extends Form
    ? T[K] | SetValuesInput<T[K]>
    : T[K];
};

type FieldValue<T, P extends string> = P extends `${infer Head}.${infer Rest}`
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

interface EventTargetLike {
  readonly value?: unknown;
  readonly checked?: unknown;
  readonly type?: unknown;
  readonly multiple?: unknown;
  readonly selectedOptions?: unknown;
  readonly options?: unknown;
}

function asInstance(value: object): FormInstance {
  return value as unknown as FormInstance;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof (value as { readonly then?: unknown }).then === "function"
  );
}

/**
 * Глубокая копия снимка значения: массивы и plain-объекты клонируются
 * рекурсивно, `Map`/`Set`/`Date` — копируются, экземпляры классов
 * (включая вложенные формы) возвращаются как есть.
 */
function cloneValue(value: unknown, seen = new WeakMap<object, unknown>()): unknown {
  if (Array.isArray(value)) {
    const cached = seen.get(value);
    if (cached !== undefined) {
      return cached;
    }
    const copy: unknown[] = [];
    seen.set(value, copy);
    for (const item of value) {
      copy.push(cloneValue(item, seen));
    }
    return copy;
  }
  if (value instanceof Date) {
    return new Date(value.getTime());
  }
  if (value instanceof Map) {
    return new Map(value);
  }
  if (value instanceof Set) {
    return new Set(value);
  }
  if (isPlainObject(value)) {
    const cached = seen.get(value);
    if (cached !== undefined) {
      return cached;
    }
    const copy: Record<string, unknown> = {};
    seen.set(value, copy);
    for (const [key, item] of Object.entries(value)) {
      copy[key] = cloneValue(item, seen);
    }
    return copy;
  }
  return value;
}

function rootSegment(path: string): string {
  let index = 0;
  while (index < path.length) {
    const char = path[index];
    if (char === "." || char === "[") {
      break;
    }
    index += 1;
  }
  return path.slice(0, index);
}

function lastSegment(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? path : path.slice(dot + 1);
}

function freezeMap(map: Record<string, readonly string[]>): ErrorsMap {
  return Object.freeze(map);
}

function eventTarget(event: FieldEventLike): EventTargetLike | undefined {
  const current = event.currentTarget ?? event.target;
  if (typeof current !== "object" || current === null) {
    return undefined;
  }
  return current;
}

function coerceValue(current: unknown, raw: unknown): unknown {
  if (typeof current === "number" && typeof raw === "string") {
    if (raw.trim() === "") {
      return raw;
    }
    return Number(raw);
  }
  return raw;
}

function isIterable(value: unknown): value is Iterable<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { readonly [Symbol.iterator]?: unknown })[Symbol.iterator] ===
      "function"
  );
}

function optionValues(
  options: Iterable<unknown>,
  onlySelected: boolean,
): readonly string[] {
  const values: string[] = [];
  for (const option of options) {
    if (typeof option !== "object" || option === null) {
      continue;
    }
    const record = option as { readonly value?: unknown; readonly selected?: unknown };
    if (onlySelected && record.selected !== true) {
      continue;
    }
    if (typeof record.value === "string") {
      values.push(record.value);
    }
  }
  return values;
}

function selectedValues(target: EventTargetLike): readonly string[] | undefined {
  if (isIterable(target.selectedOptions)) {
    return optionValues(target.selectedOptions, false);
  }
  if (isIterable(target.options)) {
    return optionValues(target.options, true);
  }
  return undefined;
}

function isRequiredEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

function normalizeErrorMessages(
  errors: string | readonly (string | { readonly message: string })[],
): readonly string[] {
  if (typeof errors === "string") {
    return [errors];
  }
  const messages: string[] = [];
  for (const entry of errors) {
    if (typeof entry === "string") {
      messages.push(entry);
      continue;
    }
    if (
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as { readonly message?: unknown }).message === "string"
    ) {
      messages.push((entry as { readonly message: string }).message);
      continue;
    }
    throw new TypeError("Ошибка поля должна быть строкой или объектом с полем message");
  }
  return messages;
}

/**
 * Базовый класс реактивной формы.
 *
 * Поля объявляются через `@Field()` (или `@FormField()` для вложенной формы).
 * Значения, ошибки и флаги доступны реактивно через `getFieldProps`.
 */
export abstract class Form {
  private readonly options: ResolvedFormOptions;

  private readonly validationErrors = createSignal<ErrorsMap>({});
  private readonly externalErrors = createSignal<ErrorsMap>({});
  private readonly touchedFields = createSignal<ReadonlySet<string>>(new Set());
  private readonly dirtyFields = createSignal<ReadonlySet<string>>(new Set());
  private readonly readyFields = createSignal<Readonly<Record<string, boolean>>>({});
  private readonly validatingFields = createSignal<ReadonlySet<string>>(new Set());
  private readonly validatingForm = createSignal(0);
  private readonly submittingSignal = createSignal(false);

  private readonly metadata = new Map<string, FieldMetadata>();
  private readonly initialValues = new Map<string, unknown>();
  private readonly children = new Map<string, FormInstance>();
  private readonly propsCache = new Map<string, FieldProps<unknown>>();
  private readonly validationTokens = new Map<string, number>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly reportedUnregisteredRoots = new Set<string>();
  private readonly fieldValidationPromises = new Map<string, Promise<boolean>>();

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
    const trimmed = options?.formId?.trim();
    this.ownIdPrefix = trimmed !== undefined && trimmed !== ""
      ? trimmed
      : this.constructor.name !== ""
        ? this.constructor.name
        : "form";
    this.idPrefix = this.ownIdPrefix;
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
      if (this.validatingFields[0]().size > 0 || this.validatingForm[0]() > 0) {
        return false;
      }
      const ready = this.readyFields[0]();
      for (const name of this.metadata.keys()) {
        if (ready[name] === false) {
          return false;
        }
        const metadata = this.metadata.get(name);
        const value = this.readOwnValue(name);
        const active = metadata === undefined || this.isFieldActive(metadata);
        if (
          metadata !== undefined &&
          this.isRequirementActive(metadata, value, active) &&
          isRequiredEmpty(value)
        ) {
          return false;
        }
        if (active && value instanceof Form && !asInstance(value).isReady) {
          return false;
        }
      }
      return Object.keys(this.errors).length === 0;
    });
  }

  /** У формы нет ошибок. */
  get isValid(): boolean {
    return getComputed(this, MEMO_IS_VALID, () => Object.keys(this.errors).length === 0);
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
        result[name] = value instanceof Form
          ? asInstance(value).values
          : cloneValue(value);
      }
      return result;
    });
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
    const path = String(field);
    const running = this.fieldValidationPromises.get(path);
    if (running !== undefined) {
      return running;
    }
    let resolve!: (value: boolean) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<boolean>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    this.fieldValidationPromises.set(path, promise);
    const release = (): void => {
      if (this.fieldValidationPromises.get(path) === promise) {
        this.fieldValidationPromises.delete(path);
      }
    };
    promise.then(release, release);
    try {
      this.runFieldPath(path, options).then(resolve, reject);
    } catch (error) {
      reject(error);
    }
    return promise;
  }

  private runFieldPath(
    path: string,
    options?: ValidationOptions,
  ): Promise<boolean> {
    const { root, rest } = this.locate(path);
    if (rest !== undefined) {
      return this.requireChild(root).validateAt(
        rest,
        this.childValidationOptions(root, options),
      );
    }
    if (this.childFor(root) !== undefined) {
      return this.runFormFieldValidation(root, options);
    }
    return this.runFieldValidation(root, options);
  }

  /** Правила самого поля-формы, затем проверка ребёнка (если условие активно). */
  private async runFormFieldValidation(
    root: string,
    options?: ValidationOptions,
  ): Promise<boolean> {
    const child = this.requireChild(root);
    const metadata = this.metadata.get(root);
    const active = metadata === undefined || this.isFieldActive(metadata);
    const rootValid = await this.runFieldValidation(root, options);
    if (!active) {
      return rootValid;
    }
    const childValid = await child.validate(
      this.childValidationOptions(root, options),
    );
    return rootValid && childValid;
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
    this.validationRunCount += 1;
    this.validatingForm[1](1);
    for (const name of this.metadata.keys()) {
      this.validationTokens.set(name, (this.validationTokens.get(name) ?? 0) + 1);
    }
    this.validatingFields[1](new Set());

    try {
      const result = await validateAsync(this, this.validationOptions(options));
      if (this.disposed || generation !== this.validationGeneration) {
        return this.isValid;
      }
      const map: Record<string, readonly string[]> = {};
      for (const error of result.errors) {
        const key = error.path === "" ? error.field : error.path;
        const root = rootSegment(key);
        if (
          this.childFor(root) !== undefined &&
          (key.startsWith(`${root}.`) || key.startsWith(`${root}[`))
        ) {
          continue;
        }
        if (!this.metadata.has(root)) {
          this.reportUnregisteredField(root, key);
        }
        const existing = map[key];
        map[key] = existing === undefined
          ? [error.message]
          : [...existing, error.message];
      }
      this.validationErrors[1](freezeMap(map));
      this.markAllTouched();

      if (this.options.validateNested) {
        for (const [name, metadata] of this.metadata) {
          const child = this.childFor(name);
          if (child === undefined || !this.isFieldActive(metadata)) {
            continue;
          }
          await child.validate(this.childValidationOptions(name, options));
        }
        if (this.disposed || generation !== this.validationGeneration) {
          return this.isValid;
        }
      }
      return result.valid && this.isValid;
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
    const { root, rest } = this.locate(path);
    const messages = normalizeErrorMessages(errors);
    if (rest !== undefined) {
      this.requireChild(root).setErrorsAt(rest, messages);
      return;
    }
    this.setExternalErrors(root, messages);
  }

  /**
   * Очистить внешние ошибки поля или всей формы.
   * Ошибки правил остаются и пересчитываются валидацией.
   */
  clearFieldErrors(field?: FieldPath<this>): void {
    this.ensureInitialized();
    this.syncChildren();
    if (field === undefined) {
      this.externalErrors[1]({});
      for (const child of this.children.values()) {
        child.clearFieldErrors();
      }
      return;
    }
    const path = String(field);
    const { root, rest } = this.locate(path);
    if (rest !== undefined) {
      this.requireChild(root).clearErrorsAt(rest);
      return;
    }
    if (this.childFor(root) !== undefined) {
      this.removeExternalErrors(root);
      this.requireChild(root).clearFieldErrors();
      return;
    }
    this.removeExternalErrors(root);
  }

  /** Установить несколько значений. Вложенным формам можно передать объект. */
  setValues(values: SetValuesInput<this>): void {
    this.ensureInitialized();
    this.syncChildren();
    for (const [name, value] of Object.entries(values as unknown as Record<string, unknown>)) {
      if (!this.metadata.has(name)) {
        throw this.unknownFieldError(name);
      }
      const current = this.readOwnValue(name);
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
          this.removeExternalErrors(name);
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
      }
      restorations.push({ name, current, restored });
    }
    this.invalidateValidation();
    this.clearTimers();
    this.validationErrors[1]({});
    this.externalErrors[1]({});
    this.touchedFields[1](new Set());
    this.dirtyFields[1](new Set());
    this.readyFields[1]({});

    for (const { name, current, restored } of restorations) {
      if (current instanceof Form && current !== restored) {
        this.detachChild(name, asInstance(current));
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
    if (this.parentForm !== undefined && this.parentField !== undefined) {
      this.parentForm.detachChild(this.parentField, asInstance(this));
    }
    this.parentForm = undefined;
    this.parentField = undefined;
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
      for (const [name, metadata] of fields) {
        this.metadata.set(name, metadata);
      }
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

  /** Синхронизирует карту вложенных форм с текущими значениями полей. */
  private syncChildren(): void {
    for (const name of this.metadata.keys()) {
      const value = this.readOwnValue(name);
      const current = this.children.get(name);
      if (value instanceof Form) {
        if (current !== value) {
          this.attachChild(name, asInstance(value));
        }
        continue;
      }
      if (current !== undefined) {
        this.detachChild(name, current);
      }
    }
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
    const prefix = `${name}.`;
    for (const key of [...this.propsCache.keys()]) {
      if (key.startsWith(prefix)) {
        this.propsCache.delete(key);
      }
    }
  }

  private locate(path: string): { root: string; rest: string | undefined } {
    this.ensureInitialized();
    this.syncChildren();
    if (path === "") {
      throw new Error("Путь поля не может быть пустым");
    }
    const dot = path.indexOf(".");
    const root = dot === -1 ? path : path.slice(0, dot);
    const rest = dot === -1 ? undefined : path.slice(dot + 1);
    if (!this.metadata.has(root)) {
      throw this.unknownFieldError(path);
    }
    if (rest !== undefined && this.childFor(root) === undefined) {
      throw new Error(
        `Поле "${root}" не является вложенной формой, поэтому путь "${path}" недоступен`,
      );
    }
    return { root, rest };
  }

  private unknownFieldError(path: string): Error {
    const available = this.availablePaths();
    return new Error(
      `Поле "${path}" не зарегистрировано. Доступные поля: ${available.length > 0 ? available.join(", ") : "—"}`,
    );
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
    const hasLocalWork =
      this.validatePromise !== undefined ||
      this.fieldValidationPromises.size > 0 ||
      this.validationRunCount > 0;
    if (hasLocalWork) {
      this.validationGeneration += 1;
      this.validatePromise = undefined;
      this.fieldValidationPromises.clear();
      this.validationRunCount = 0;
      this.validatingFields[1](new Set());
      this.validatingForm[1](0);
    }
    const parent = this.parentForm;
    const field = this.parentField;
    if (parent !== undefined && field !== undefined) {
      // Ошибка уровня поля-формы снимается при изменении любого ребёнка.
      parent.removeExternalErrors(field);
      parent.invalidateValidation();
    }
  }

  /** Активно ли поле с учётом `@ValidateIf` (независимо от `@Required`). */
  private isFieldActive(metadata: FieldMetadata): boolean {
    if (metadata.when === undefined) {
      return true;
    }
    const result: unknown = metadata.when(this);
    if (isThenable(result)) {
      // Асинхронное условие считается активным, как в валидаторе.
      void Promise.resolve(result).catch(() => {});
      return true;
    }
    return result === true;
  }

  /** Активно ли требование непустого значения с учётом `@Optional`/`@ValidateIf`. */
  private isRequirementActive(
    metadata: FieldMetadata,
    value: unknown,
    active = this.isFieldActive(metadata),
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
    const { root, rest } = this.locate(path);
    if (rest !== undefined) {
      return this.createNestedFieldProps(path, root, rest);
    }
    if (this.childFor(root) !== undefined) {
      return this.createNestedFormProps(root);
    }
    return this.createDirectProps(root);
  }

  private createDirectProps(name: string): FieldProps<unknown> {
    const metadata = this.metadata.get(name);
    const id = this.idFor(name);
    const self = this;
    return {
      get value() {
        return self.readOwnValue(name);
      },
      get label() {
        return self.labelFor(name);
      },
      get placeholder() {
        return metadata?.placeholder;
      },
      get hint() {
        return metadata?.hint;
      },
      get error() {
        return self.directErrors(name)[0];
      },
      get errors() {
        return self.directErrors(name);
      },
      get isRequired() {
        return metadata?.required === true;
      },
      get isReady() {
        return self.readyFields[0]()[name] ?? true;
      },
      get isValidating() {
        return self.validatingFields[0]().has(name);
      },
      get touched() {
        return self.touchedFields[0]().has(name);
      },
      get dirty() {
        return self.dirtyFields[0]().has(name);
      },
      get isValid() {
        return self.directErrors(name).length === 0;
      },
      get name() {
        return name;
      },
      get id() {
        return id;
      },
      setValue(value) {
        self.setDirectValue(name, value);
      },
      setReady(ready) {
        self.setReadyFor(name, ready);
      },
      onChange(event) {
        self.handleValueEvent(name, event, "change");
      },
      onInput(event) {
        self.handleValueEvent(name, event, "input");
      },
      onFocus(_event) {
        // Фокус намеренно не меняет состояние: touched ставится на blur.
      },
      onBlur(_event) {
        self.markTouched(name);
        self.validateForEvent(name, "blur");
      },
      validate() {
        return self.runFieldValidation(name);
      },
    };
  }

  private createNestedFormProps(name: string): FieldProps<unknown> {
    const metadata = this.metadata.get(name);
    const id = this.idFor(name);
    const self = this;
    return {
      get value() {
        return self.requireChild(name);
      },
      get label() {
        return self.labelFor(name);
      },
      get placeholder() {
        return metadata?.placeholder;
      },
      get hint() {
        return metadata?.hint;
      },
      get error() {
        return self.nestedFormErrors(name)[0];
      },
      get errors() {
        return self.nestedFormErrors(name);
      },
      get isRequired() {
        return metadata?.required === true;
      },
      get isReady() {
        return self.requireChild(name).isReady;
      },
      get isValidating() {
        return self.requireChild(name).hasValidating();
      },
      get touched() {
        return self.touchedFields[0]().has(name)
          || self.requireChild(name).hasAnyTouched();
      },
      get dirty() {
        return self.dirtyFields[0]().has(name) || self.requireChild(name).isDirty;
      },
      get isValid() {
        return self.requireChild(name).isValid;
      },
      get name() {
        return name;
      },
      get id() {
        return id;
      },
      setValue(value) {
        if (!(value instanceof Form)) {
          throw new TypeError(
            `Поле "${name}" — вложенная форма: ожидался экземпляр Form`,
          );
        }
        self.setDirectValue(name, value);
      },
      setReady(ready) {
        self.setReadyFor(name, ready);
      },
      onChange(_event) {
        self.nestedBindingError(name, "onChange");
      },
      onInput(_event) {
        self.nestedBindingError(name, "onInput");
      },
      onFocus(_event) {
        self.nestedBindingError(name, "onFocus");
      },
      onBlur(_event) {
        self.nestedBindingError(name, "onBlur");
      },
      validate() {
        return self.requireChild(name).validate();
      },
    };
  }

  private createNestedFieldProps(
    path: string,
    root: string,
    rest: string,
  ): FieldProps<unknown> {
    const self = this;
    const id = this.idFor(path);
    const childProps = (): FieldProps<unknown> =>
      self.requireChild(root).propsAt(rest);
    return {
      get value() {
        return childProps().value;
      },
      get label() {
        return self.labelForNested(path, childProps().label);
      },
      get placeholder() {
        return childProps().placeholder;
      },
      get hint() {
        return childProps().hint;
      },
      get error() {
        return childProps().error;
      },
      get errors() {
        return childProps().errors;
      },
      get isRequired() {
        return childProps().isRequired;
      },
      get isReady() {
        return childProps().isReady;
      },
      get isValidating() {
        return childProps().isValidating;
      },
      get touched() {
        return childProps().touched;
      },
      get dirty() {
        return childProps().dirty;
      },
      get isValid() {
        return childProps().isValid;
      },
      get name() {
        return path;
      },
      get id() {
        return id;
      },
      setValue(value) {
        childProps().setValue(value);
      },
      setReady(ready) {
        childProps().setReady(ready);
      },
      onChange(event) {
        childProps().onChange(event);
      },
      onInput(event) {
        childProps().onInput(event);
      },
      onFocus(event) {
        childProps().onFocus(event);
      },
      onBlur(event) {
        childProps().onBlur(event);
      },
      validate() {
        return childProps().validate();
      },
    };
  }

  private nestedBindingError(name: string, handler: string): never {
    throw new Error(
      `Поле "${name}" — вложенная форма: ${handler} не привязан к одному input, используйте путь вложенного поля`,
    );
  }

  private directErrors(name: string): readonly string[] {
    const result: string[] = [];
    for (const [key, messages] of Object.entries(this.validationErrors[0]())) {
      if (
        key === name ||
        key.startsWith(`${name}.`) ||
        key.startsWith(`${name}[`)
      ) {
        result.push(...messages);
      }
    }
    for (const [key, messages] of Object.entries(this.externalErrors[0]())) {
      if (
        key === name ||
        key.startsWith(`${name}.`) ||
        key.startsWith(`${name}[`)
      ) {
        result.push(...messages);
      }
    }
    return result;
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
    for (const [key, messages] of Object.entries(this.validationErrors[0]())) {
      if (messages.length > 0) {
        result[key] = messages;
      }
    }
    for (const [key, messages] of Object.entries(this.externalErrors[0]())) {
      if (messages.length === 0) {
        continue;
      }
      const existing = result[key];
      result[key] = existing === undefined
        ? messages
        : [...existing, ...messages];
    }
    for (const name of this.metadata.keys()) {
      const child = this.childFor(name);
      if (child === undefined) {
        continue;
      }
      for (const [key, messages] of Object.entries(child.errors)) {
        result[`${name}.${key}`] = messages;
      }
    }
    return freezeMap(result);
  }

  private runFieldValidation(
    name: string,
    options?: ValidationOptions,
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
        this.replaceValidationErrors(name, result.errors);
        return result.valid;
      } finally {
        if (!this.disposed && generation === this.validationGeneration) {
          this.validationRunCount = Math.max(0, this.validationRunCount - 1);
          if (this.validationTokens.get(name) === token) {
            this.removeValidating(name);
          }
        }
      }
    })();
  }

  private replaceValidationErrors(
    name: string,
    errors: readonly { readonly path: string; readonly field: string; readonly message: string }[],
  ): void {
    const next: Record<string, readonly string[]> = {
      ...this.validationErrors[0](),
    };
    for (const key of Object.keys(next)) {
      if (
        key === name ||
        key.startsWith(`${name}.`) ||
        key.startsWith(`${name}[`)
      ) {
        delete next[key];
      }
    }
    for (const error of errors) {
      const key = error.path === "" ? error.field : error.path;
      const existing = next[key];
      next[key] = existing === undefined
        ? [error.message]
        : [...existing, error.message];
    }
    this.validationErrors[1](freezeMap(next));
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
      this.removeExternalErrors(name);
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
        if (!this.isFieldActive(metadata)) {
          continue;
        }
        this.markTouched(name);
        await child.validateSubmitFields();
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
    const next = new Set(this.touchedFields[0]());
    for (const name of this.metadata.keys()) {
      next.add(name);
    }
    this.touchedFields[1](next);
    for (const name of this.metadata.keys()) {
      const child = this.childFor(name);
      if (child !== undefined) {
        child.markAllTouched();
      }
    }
  }

  private setReadyFor(name: string, ready: boolean): void {
    const current = this.readyFields[0]();
    if ((current[name] ?? true) === ready) {
      return;
    }
    this.readyFields[1]({ ...current, [name]: ready });
  }

  private addValidating(name: string): void {
    const current = this.validatingFields[0]();
    if (current.has(name)) {
      return;
    }
    const next = new Set(current);
    next.add(name);
    this.validatingFields[1](next);
  }

  private removeValidating(name: string): void {
    const current = this.validatingFields[0]();
    if (!current.has(name)) {
      return;
    }
    const next = new Set(current);
    next.delete(name);
    this.validatingFields[1](next);
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
    if (this.validatingFields[0]().size > 0 || this.validatingForm[0]() > 0) {
      return true;
    }
    for (const child of this.children.values()) {
      if (child.hasValidating()) {
        return true;
      }
    }
    return false;
  }

  private setExternalErrors(name: string, messages: readonly string[]): void {
    const next: Record<string, readonly string[]> = {
      ...this.externalErrors[0](),
    };
    if (messages.length === 0) {
      delete next[name];
    } else {
      next[name] = messages;
    }
    this.externalErrors[1](freezeMap(next));
  }

  private removeExternalErrors(name: string): void {
    const current = this.externalErrors[0]();
    let changed = false;
    const next: Record<string, readonly string[]> = {};
    for (const [key, messages] of Object.entries(current)) {
      if (
        key === name ||
        key.startsWith(`${name}.`) ||
        key.startsWith(`${name}[`)
      ) {
        changed = true;
        continue;
      }
      next[key] = messages;
    }
    if (changed) {
      this.externalErrors[1](freezeMap(next));
    }
  }

  /** labels текущей формы + переданные, с приоритетом переданных. */
  private validationOptions(
    options?: ValidationOptions,
  ): ValidationOptions | undefined {
    const labels = {
      ...this.options.labels,
      ...(options?.labels ?? {}),
    };
    const result: ValidationOptions = {
      ...options,
      ...(Object.keys(labels).length > 0 ? { labels } : {}),
    };
    return Object.keys(result).length === 0 ? undefined : result;
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
    const merged = {
      ...this.options.labels,
      ...(options?.labels ?? {}),
    };
    const labels: Record<string, string> = {};
    const prefix = `${root}.`;
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
