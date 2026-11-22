import { validateAsync, validatePropertyAsync } from "@ivlev-dev/silent-validation";
import type { ValidationOptions } from "@ivlev-dev/silent-validation";
import type { ErrorStore } from "./errors.js";
import type { FieldMetadata } from "./metadata.js";
import type { Form } from "./form.js";
import { rootSegment } from "./utils.js";

/** Настройки формы, нужные оркестратору проверок. */
export interface ValidationHostOptions {
  readonly validateNested: boolean;
}

/** Внутренний хост оркестрации проверок (реализуется `Form`). */
export interface ValidationHost {
  readonly instance: object;
  readonly metadata: ReadonlyMap<string, FieldMetadata>;
  readonly options: ValidationHostOptions;
  readonly errorStore: ErrorStore;
  readonly disposed: boolean;
  readonly validationGeneration: number;
  readonly isValid: boolean;
  readonly baseValidationOptions: ValidationOptions | undefined;
  readonly labels: Readonly<Record<string, string>>;
  readonly validationTokens: Map<string, number>;
  ensureInitialized(): void;
  syncChildren(): void;
  clearTimers(): void;
  clearValidatingFields(): void;
  setValidatingForm(value: number): void;
  getValidationRunCount(): number;
  setValidationRunCount(value: number): void;
  childFor(name: string): Form | undefined;
  requireChild(name: string): Form;
  arrayItems(name: string): Form[] | undefined;
  requireArrayItem(root: string, index: number): Form;
  validateChildAt(child: Form, path: string, options?: ValidationOptions): Promise<boolean>;
  validateChildSubmitFields(child: Form): Promise<void>;
  locate(path: string): { root: string; index: number | undefined; rest: string | undefined };
  reportUnregisteredField(root: string, path: string): void;
  markAllTouched(): void;
  markTouched(name: string): void;
  isFieldActiveForValidation(metadata: FieldMetadata): boolean;
  addValidating(name: string): void;
  removeValidating(name: string): void;
  runFieldValidation(name: string, options?: ValidationOptions): Promise<boolean>;
}

export function validationOptions(
  host: ValidationHost,
  options?: ValidationOptions,
): ValidationOptions | undefined {
  if (options === undefined) {
    return host.baseValidationOptions;
  }
  const localLabels = host.labels;
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
  return Object.keys(labels).length > 0 ? { ...options, labels } : options;
}

export function childValidationOptions(
  host: ValidationHost,
  root: string,
  options?: ValidationOptions,
): ValidationOptions | undefined {
  return nestedValidationOptions(host, root, options);
}

export function nestedValidationOptions(
  host: ValidationHost,
  prefixPath: string,
  options?: ValidationOptions,
): ValidationOptions | undefined {
  const merged = {
    ...host.labels,
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

function settleNested(
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

export function runFieldPath(
  host: ValidationHost,
  path: string,
  options?: ValidationOptions,
  onSettled?: () => void,
): Promise<boolean> {
  const { root, index, rest } = host.locate(path);
  if (index !== undefined) {
    const item = host.requireArrayItem(root, index);
    if (rest !== undefined) {
      return settleNested(
        host.validateChildAt(
          item,
          rest,
          nestedValidationOptions(host, `${root}[${index}]`, options),
        ),
        onSettled,
      );
    }
    return settleNested(item.validate(options), onSettled);
  }
  if (rest !== undefined) {
    return settleNested(
      host.validateChildAt(
        host.requireChild(root),
        rest,
        childValidationOptions(host, root, options),
      ),
      onSettled,
    );
  }
  if (host.childFor(root) !== undefined) {
    return runFormFieldValidation(host, root, options, onSettled);
  }
  if (host.arrayItems(root) !== undefined) {
    return runFormArrayValidation(host, root, options, onSettled);
  }
  return runFieldValidation(host, root, options, onSettled);
}

export async function runFormArrayValidation(
  host: ValidationHost,
  root: string,
  options?: ValidationOptions,
  onSettled?: () => void,
): Promise<boolean> {
  const generation = host.validationGeneration;
  const metadata = host.metadata.get(root);
  const active = metadata === undefined || host.isFieldActiveForValidation(metadata);
  try {
    const rootValid = await runFieldValidation(host, root, options);
    if (host.disposed || generation !== host.validationGeneration) {
      return false;
    }
    if (!active) {
      return rootValid;
    }
    const items = host.arrayItems(root) ?? [];
    const results = await Promise.all(
      items.map((item, index) =>
        item.validate(nestedValidationOptions(host, `${root}[${index}]`, options)),
      ),
    );
    if (host.disposed || generation !== host.validationGeneration) {
      return false;
    }
    return rootValid && results.every(Boolean);
  } finally {
    onSettled?.();
  }
}

export async function runFormFieldValidation(
  host: ValidationHost,
  root: string,
  options?: ValidationOptions,
  onSettled?: () => void,
): Promise<boolean> {
  const generation = host.validationGeneration;
  const child = host.requireChild(root);
  const metadata = host.metadata.get(root);
  const active = metadata === undefined || host.isFieldActiveForValidation(metadata);
  try {
    const rootValid = await runFieldValidation(host, root, options);
    if (host.disposed || generation !== host.validationGeneration) {
      return false;
    }
    if (!active) {
      return rootValid;
    }
    const childValid = await child.validate(
      childValidationOptions(host, root, options),
    );
    if (host.disposed || generation !== host.validationGeneration) {
      return false;
    }
    return rootValid && childValid;
  } finally {
    onSettled?.();
  }
}

export async function runFullValidation(
  host: ValidationHost,
  options?: ValidationOptions,
): Promise<boolean> {
  host.ensureInitialized();
  host.syncChildren();
  host.clearTimers();
  const generation = host.validationGeneration;
  const hadFieldRuns = host.getValidationRunCount() > 0;
  host.setValidationRunCount(host.getValidationRunCount() + 1);
  host.setValidatingForm(1);
  if (hadFieldRuns) {
    for (const name of host.metadata.keys()) {
      host.validationTokens.set(name, (host.validationTokens.get(name) ?? 0) + 1);
    }
  }
  host.clearValidatingFields();

  try {
    const result = await validateAsync(host.instance, validationOptions(host, options));
    if (host.disposed || generation !== host.validationGeneration) {
      // Прогон устарел: его ошибки не записаны, а `isValid` уже может
      // относиться к другому поколению значений. Промис обязан быть false.
      return false;
    }
    const map = new Map<string, string[]>();
    for (const error of result.errors) {
      const key = error.path === "" ? error.field : error.path;
      const root = rootSegment(key);
      if (
        host.childFor(root) !== undefined &&
        (key.startsWith(`${root}.`) || key.startsWith(`${root}[`))
      ) {
        continue;
      }
      if (host.arrayItems(root) !== undefined && key.startsWith(`${root}[`)) {
        continue;
      }
      if (!host.metadata.has(root)) {
        host.reportUnregisteredField(root, key);
      }
      const existing = map.get(key);
      if (existing === undefined) {
        map.set(key, [error.message]);
      } else {
        existing.push(error.message);
      }
    }
    host.errorStore.setValidation(map);
    host.markAllTouched();

    if (host.options.validateNested) {
      const pending: Promise<boolean>[] = [];
      for (const [name, metadata] of host.metadata) {
        const child = host.childFor(name);
        if (child !== undefined) {
          if (!host.isFieldActiveForValidation(metadata)) {
            continue;
          }
          pending.push(
            child.validate(childValidationOptions(host, name, options)),
          );
          continue;
        }
        const items = host.arrayItems(name);
        if (items === undefined || !host.isFieldActiveForValidation(metadata)) {
          continue;
        }
        for (let index = 0; index < items.length; index += 1) {
          pending.push(
            items[index]!.validate(
              nestedValidationOptions(host, `${name}[${index}]`, options),
            ),
          );
        }
      }
      const results = await Promise.all(pending);
      if (host.disposed || generation !== host.validationGeneration) {
        return false;
      }
      const ownValid =
        host.errorStore.validationSize === 0 &&
        host.errorStore.externalSize === 0;
      return result.valid && ownValid && results.every(Boolean);
    }
    const ownValid =
      host.errorStore.validationSize === 0 &&
      host.errorStore.externalSize === 0;
    return result.valid && ownValid && host.isValid;
  } finally {
    if (!host.disposed && generation === host.validationGeneration) {
      host.setValidationRunCount(Math.max(0, host.getValidationRunCount() - 1));
      host.setValidatingForm(0);
    }
  }
}

export function runFieldValidation(
  host: ValidationHost,
  name: string,
  options?: ValidationOptions,
  onSettled?: () => void,
): Promise<boolean> {
  const generation = host.validationGeneration;
  const token = (host.validationTokens.get(name) ?? 0) + 1;
  host.validationTokens.set(name, token);
  host.setValidationRunCount(host.getValidationRunCount() + 1);
  host.addValidating(name);
  return (async () => {
    try {
      const result = await validatePropertyAsync(
        host.instance,
        name,
        validationOptions(host, options),
      );
      if (host.disposed || generation !== host.validationGeneration) {
        // Прогон устарел: значение изменилось (или форма уничтожена),
        // поэтому результат относится к прошлому состоянию.
        return false;
      }
      if (host.validationTokens.get(name) === token) {
        host.errorStore.replaceFieldErrors(name, result.errors);
      }
      // Токен мог смениться более поздним прогоном того же поля в рамках
      // одного поколения. Значение то же, поэтому результат актуален:
      // ошибки пишет только последний прогон, а вердикт возвращаем этот.
      return result.valid;
    } finally {
      if (!host.disposed && generation === host.validationGeneration) {
        host.setValidationRunCount(Math.max(0, host.getValidationRunCount() - 1));
        if (host.validationTokens.get(name) === token) {
          host.removeValidating(name);
        }
      }
      onSettled?.();
    }
  })();
}

export async function validateSubmitFields(host: ValidationHost): Promise<void> {
  host.ensureInitialized();
  host.syncChildren();
  const generation = host.validationGeneration;
  for (const [name, metadata] of host.metadata) {
    if (host.disposed || generation !== host.validationGeneration) {
      return;
    }
    const child = host.childFor(name);
    if (child !== undefined) {
      if (!host.isFieldActiveForValidation(metadata)) {
        continue;
      }
      host.markTouched(name);
      await host.validateChildSubmitFields(child);
      continue;
    }
    const items = host.arrayItems(name);
    if (items !== undefined) {
      if (!host.isFieldActiveForValidation(metadata)) {
        continue;
      }
      host.markTouched(name);
      await Promise.all(
        items.map((item) => host.validateChildSubmitFields(item)),
      );
      continue;
    }
    if (metadata.validateOn?.includes("submit") !== true) {
      continue;
    }
    host.markTouched(name);
    await host.runFieldValidation(name);
  }
}
