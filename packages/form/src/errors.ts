import {
  EMPTY_ERRORS,
  EMPTY_ERRORS_MAP,
  isFieldKey,
  rootSegment,
  sameMessages,
} from "./utils.js";

export type ErrorMap = ReadonlyMap<string, readonly string[]>;

export interface ErrorStoreCallbacks {
  /** Сообщает форме, что карты ошибок изменились (для реактивности). */
  readonly onChange: () => void;
}

/**
 * Хранилище ошибок формы: validation/external карты, индекс по корню поля
 * и быстрая проверка изменений поля. Без сигналов — реактивность снаружи.
 */
export class ErrorStore {
  private validation: ErrorMap = EMPTY_ERRORS_MAP;
  private external: ErrorMap = EMPTY_ERRORS_MAP;
  private readonly validationKeyCounts = new Map<string, number>();
  private indexCache:
    | {
        readonly validationVersion: number;
        readonly externalVersion: number;
        readonly index: ErrorMap;
      }
    | undefined;
  private validationVersion = 0;
  private externalVersion = 0;

  constructor(private readonly callbacks: ErrorStoreCallbacks) {}

  get validationMap(): ErrorMap {
    return this.validation;
  }

  get externalMap(): ErrorMap {
    return this.external;
  }

  get validationSize(): number {
    return this.validation.size;
  }

  get externalSize(): number {
    return this.external.size;
  }

  setValidation(map: ErrorMap): void {
    this.validation = map;
    this.validationVersion += 1;
    this.recountValidationKeys(map);
    this.callbacks.onChange();
  }

  clearValidation(): void {
    if (this.validation.size === 0) {
      return;
    }
    this.setValidation(EMPTY_ERRORS_MAP);
  }

  setExternal(name: string, messages: readonly string[]): void {
    const current = this.external;
    if (messages.length === 0) {
      if (!current.has(name)) {
        return;
      }
      const next = new Map(current);
      next.delete(name);
      this.commitExternal(next);
      return;
    }
    const before = current.get(name) ?? EMPTY_ERRORS;
    if (sameMessages(before, messages)) {
      return;
    }
    const next = new Map(current);
    next.set(name, Object.freeze([...messages]));
    this.commitExternal(next);
  }

  removeExternal(name: string): void {
    const current = this.external;
    let next: Map<string, readonly string[]> | undefined;
    for (const key of current.keys()) {
      if (isFieldKey(key, name)) {
        if (next === undefined) {
          next = new Map(current);
        }
        next.delete(key);
      }
    }
    if (next !== undefined) {
      this.commitExternal(next);
    }
  }

  clearExternal(): void {
    if (this.external.size === 0) {
      return;
    }
    this.external = EMPTY_ERRORS_MAP;
    this.externalVersion += 1;
    this.callbacks.onChange();
  }

  /**
   * Заменяет ошибки одного поля. Не трогает чужие ключи и не уведомляет,
   * если сообщения не изменились.
   */
  replaceFieldErrors(
    name: string,
    errors: readonly {
      readonly path: string;
      readonly field: string;
      readonly message: string;
    }[],
  ): void {
    const current = this.validation;
    const currentCount = this.validationKeyCounts.get(name) ?? 0;
    if (errors.length === 0) {
      if (currentCount === 0) {
        return;
      }
    } else if (errors.length === 1 && currentCount === 1) {
      const error = errors[0]!;
      const key = error.path === "" ? error.field : error.path;
      const existing = current.get(key);
      if (
        key === name &&
        existing !== undefined &&
        existing.length === 1 &&
        existing[0] === error.message
      ) {
        return;
      }
    }
    const nextValues = new Map<string, string[]>();
    for (const error of errors) {
      const key = error.path === "" ? error.field : error.path;
      const existing = nextValues.get(key);
      if (existing === undefined) {
        nextValues.set(key, [error.message]);
      } else {
        existing.push(error.message);
      }
    }
    let changed = currentCount !== nextValues.size;
    if (!changed) {
      for (const [key, messages] of nextValues) {
        if (!sameMessages(current.get(key) ?? EMPTY_ERRORS, messages)) {
          changed = true;
          break;
        }
      }
    }
    if (!changed) {
      return;
    }
    const next = new Map(current);
    for (const key of [...next.keys()]) {
      if (isFieldKey(key, name)) {
        next.delete(key);
      }
    }
    for (const [key, messages] of nextValues) {
      if (messages.length > 0) {
        next.set(key, Object.freeze(messages));
      }
    }
    this.setValidation(next);
  }

  /** Ошибки поля (validation + external) по индексу корня, O(1). */
  fieldErrors(name: string): readonly string[] {
    return this.index().get(name) ?? EMPTY_ERRORS;
  }

  /**
   * Ошибки ровно по ключу поля, без агрегации дочерних путей
   * (`items[0]` не попадает в `items`, `address.city` — в `address`).
   */
  ownErrors(name: string): readonly string[] {
    const validation = this.validation.get(name);
    const external = this.external.get(name);
    if (validation === undefined) {
      return external ?? EMPTY_ERRORS;
    }
    if (external === undefined) {
      return validation;
    }
    return Object.freeze([...validation, ...external]);
  }

  /** Сообщения validation-ошибок конкретного поля (для проверки изменений). */
  validationFieldErrors(name: string): readonly string[] {
    return this.validation.get(name) ?? EMPTY_ERRORS;
  }

  private commitExternal(map: ErrorMap): void {
    this.external = map;
    this.externalVersion += 1;
    this.callbacks.onChange();
  }

  private recountValidationKeys(map: ErrorMap): void {
    this.validationKeyCounts.clear();
    for (const key of map.keys()) {
      const root = rootSegment(key);
      this.validationKeyCounts.set(root, (this.validationKeyCounts.get(root) ?? 0) + 1);
    }
  }

  private index(): ErrorMap {
    const cached = this.indexCache;
    if (
      cached !== undefined &&
      cached.validationVersion === this.validationVersion &&
      cached.externalVersion === this.externalVersion
    ) {
      return cached.index;
    }
    const merged = new Map<string, string[]>();
    const push = (map: ErrorMap): void => {
      for (const [key, messages] of map) {
        if (messages.length === 0) {
          continue;
        }
        const root = rootSegment(key);
        const existing = merged.get(root);
        if (existing === undefined) {
          merged.set(root, [...messages]);
        } else {
          existing.push(...messages);
        }
      }
    };
    push(this.validation);
    push(this.external);
    const index = new Map<string, readonly string[]>();
    for (const [root, messages] of merged) {
      index.set(root, Object.freeze(messages));
    }
    this.indexCache = {
      validationVersion: this.validationVersion,
      externalVersion: this.externalVersion,
      index,
    };
    return index;
  }
}
