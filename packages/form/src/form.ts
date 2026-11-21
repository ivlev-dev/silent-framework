import { createSignal, getComputed, storeFor } from "@ivlev-dev/silent-reactivity";
import { validateAsync, validatePropertyAsync } from "@ivlev-dev/silent-validation";
import type { ValidationOptions } from "@ivlev-dev/silent-validation";
import { fieldMetadataFor, recordedInitialValue } from "./metadata.js";
import type { FieldMetadata } from "./metadata.js";
import type {
  FieldEventLike,
  FieldPath,
  FieldProps,
  FormOptions,
  ValidateOnMode,
} from "./types.js";

type ErrorsMap = Readonly<Record<string, readonly string[]>>;

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

function snapshotValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return [...value];
  }
  if (isPlainObject(value)) {
    return { ...value };
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

  private initialized = false;
  private disposed = false;
  private parentForm: FormInstance | undefined;
  private parentField: string | undefined;

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
    if (this.options.validateOnInit) {
      queueMicrotask(() => {
        if (this.disposed) {
          return;
        }
        void this.validate().catch((error: unknown) => this.reportError(error));
      });
    }
  }

  /** Форма готова к отправке: нет ошибок, обязательные поля заполнены, нет проверок. */
  get isReady(): boolean {
    return getComputed(this, "isReady", () => {
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
        if (metadata?.required === true && isRequiredEmpty(this.readOwnValue(name))) {
          return false;
        }
        const value = this.readOwnValue(name);
        if (value instanceof Form && !asInstance(value).isReady) {
          return false;
        }
      }
      return Object.keys(this.errors).length === 0;
    });
  }

  /** У формы нет ошибок. */
  get isValid(): boolean {
    return getComputed(this, "isValid", () => Object.keys(this.errors).length === 0);
  }

  /** Хотя бы одно поле менялось пользователем или программно. */
  get isDirty(): boolean {
    return getComputed(this, "isDirty", () => {
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
    return getComputed(this, "errors", () => this.computeErrors());
  }

  /** Реактивный снимок значений; вложенные формы — вложенными объектами. */
  get values(): Record<string, unknown> {
    return getComputed(this, "values", () => {
      this.ensureInitialized();
      this.syncChildren();
      const result: Record<string, unknown> = {};
      for (const name of this.metadata.keys()) {
        const value = this.readOwnValue(name);
        result[name] = value instanceof Form ? asInstance(value).values : value;
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

  /** Проверить одно поле (включая путь вложенной формы). */
  async validateField(field: FieldPath<this>): Promise<boolean> {
    const path = String(field);
    const { root, rest } = this.locate(path);
    if (rest !== undefined) {
      return this.requireChild(root).validateAt(rest);
    }
    if (this.childFor(root) !== undefined) {
      return this.requireChild(root).validate();
    }
    return this.runFieldValidation(root);
  }

  /**
   * Полная проверка формы: помечает все поля посещёнными, собирает ошибки
   * по путям и проверяет вложенные формы.
   */
  async validate(): Promise<boolean> {
    this.ensureInitialized();
    this.syncChildren();
    this.markAllTouched();
    this.validatingForm[1]((count) => count + 1);
    for (const name of this.metadata.keys()) {
      this.validationTokens.set(name, (this.validationTokens.get(name) ?? 0) + 1);
    }
    this.validatingFields[1](new Set());

    try {
      const result = await validateAsync(this, this.validationOptions());
      const map: Record<string, readonly string[]> = {};
      for (const error of result.errors) {
        const key = error.path === "" ? error.field : error.path;
        const root = rootSegment(key);
        if (!this.metadata.has(root)) {
          continue;
        }
        if (this.childFor(root) !== undefined) {
          continue;
        }
        const existing = map[key];
        map[key] = existing === undefined
          ? [error.message]
          : [...existing, error.message];
      }
      this.validationErrors[1](freezeMap(map));

      if (this.options.validateNested) {
        for (const name of this.metadata.keys()) {
          const child = this.childFor(name);
          if (child !== undefined) {
            await child.validate();
          }
        }
      }
      return this.isValid;
    } finally {
      this.validatingForm[1]((count) => Math.max(0, count - 1));
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
        if (this.options.validateOnSubmit) {
          await this.validate();
        } else {
          await this.validateSubmitFields();
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
    if (this.childFor(root) !== undefined) {
      this.setExternalErrors(root, messages);
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
    this.clearTimers();
    this.validationErrors[1]({});
    this.externalErrors[1]({});
    this.touchedFields[1](new Set());
    this.dirtyFields[1](new Set());
    this.validatingFields[1](new Set());
    this.readyFields[1]({});

    for (const name of this.metadata.keys()) {
      const initial = this.initialValues.get(name);
      const current = this.readOwnValue(name);
      if (current instanceof Form && current !== initial) {
        this.detachChild(name, asInstance(current));
      }
      this.writeOwnValue(name, initial);
      if (initial instanceof Form) {
        this.attachChild(name, asInstance(initial));
      }
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
    this.disposed = true;
    this.clearTimers();
    for (const [name, child] of [...this.children]) {
      this.detachChild(name, child);
    }
    if (this.parentForm !== undefined && this.parentField !== undefined) {
      this.parentForm.detachChild(this.parentField, asInstance(this));
    }
    this.parentForm = undefined;
    this.parentField = undefined;
    storeFor(this).dispose();
  }

  private ensureInitialized(): void {
    if (this.initialized) {
      return;
    }
    this.initialized = true;
    for (const [name, metadata] of fieldMetadataFor(this.constructor)) {
      this.metadata.set(name, metadata);
      if (!this.initialValues.has(name)) {
        const recorded = recordedInitialValue(this, name);
        this.initialValues.set(
          name,
          snapshotValue(recorded.found ? recorded.value : this.readOwnValue(name)),
        );
      }
    }
    this.linkNested();
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

  private bindParent(parent: FormInstance, field: string): void {
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
    this.parentForm = parent;
    this.parentField = field;
  }

  private attachChild(name: string, child: FormInstance): void {
    const current = this.children.get(name);
    if (current === child) {
      child.bindParent(asInstance(this), name);
      return;
    }
    if (current !== undefined) {
      this.detachChild(name, current);
    }
    child.bindParent(asInstance(this), name);
    this.children.set(name, child);
  }

  private detachChild(name: string, child: FormInstance): void {
    if (this.children.get(name) === child) {
      this.children.delete(name);
    }
    if (child.parentForm === asInstance(this) && child.parentField === name) {
      child.parentForm = undefined;
      child.parentField = undefined;
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

  private labelForNested(path: string, fallback: string): string {
    return (
      this.options.labels[path] ??
      this.options.labels[lastSegment(path)] ??
      fallback
    );
  }

  private idFor(path: string): string {
    const trimmed = this.options.formId?.trim();
    const prefix = trimmed !== undefined && trimmed !== ""
      ? trimmed
      : this.constructor.name !== ""
        ? this.constructor.name
        : "form";
    return `${prefix}-${path}`;
  }

  /** Внутренний доступ по строковому пути: сужает публичный `FieldPath`. */
  private propsAt(path: string): FieldProps<unknown> {
    return this.getFieldProps(path as never) as unknown as FieldProps<unknown>;
  }

  /** Внутренняя проверка по строковому пути. */
  private validateAt(path: string): Promise<boolean> {
    return this.validateField(path as never);
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
        return self.idFor(name);
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
        return self.idFor(name);
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
        return self.idFor(path);
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
      if (key === name || key.startsWith(`${name}.`)) {
        result.push(...messages);
      }
    }
    for (const [key, messages] of Object.entries(this.externalErrors[0]())) {
      if (key === name || key.startsWith(`${name}.`)) {
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

  private runFieldValidation(name: string): Promise<boolean> {
    const token = (this.validationTokens.get(name) ?? 0) + 1;
    this.validationTokens.set(name, token);
    this.addValidating(name);
    return (async () => {
      try {
        const result = await validatePropertyAsync(
          this,
          name,
          this.validationOptions(),
        );
        if (this.validationTokens.get(name) !== token) {
          return result.valid;
        }
        this.replaceValidationErrors(name, result.errors);
        return result.valid;
      } finally {
        if (this.validationTokens.get(name) === token) {
          this.removeValidating(name);
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
      if (key === name || key.startsWith(`${name}.`)) {
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
    if (previous instanceof Form && previous !== value) {
      this.detachChild(name, asInstance(previous));
    }
    this.writeOwnValue(name, value);
    if (value instanceof Form) {
      this.attachChild(name, asInstance(value));
    }
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
    for (const [name, metadata] of this.metadata) {
      if (metadata.validateOn?.includes("submit") !== true) {
        continue;
      }
      this.markTouched(name);
      if (this.childFor(name) !== undefined) {
        await this.requireChild(name).validate();
      } else {
        await this.runFieldValidation(name);
      }
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
      if (key === name || key.startsWith(`${name}.`)) {
        changed = true;
        continue;
      }
      next[key] = messages;
    }
    if (changed) {
      this.externalErrors[1](freezeMap(next));
    }
  }

  private validationOptions(): ValidationOptions | undefined {
    const labels = this.options.labels;
    return Object.keys(labels).length === 0 ? undefined : { labels };
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
