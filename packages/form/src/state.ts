import type { Form } from "./form.js";
import type { ErrorStore } from "./errors.js";
import type { FieldMetadata } from "./metadata.js";
import { cloneValue, isThenable } from "./utils.js";

/** Минимальный контракт сигнала, нужный агрегатам. */
export interface SignalLike<T> {
  0(): T;
  1(value: T | ((previous: T) => T)): void;
}

/** Внутренний хост агрегатов/флагов формы. */
export interface StateHost {
  readonly metadata: ReadonlyMap<string, FieldMetadata>;
  readonly errorStore: ErrorStore;
  readonly touchedFields: SignalLike<ReadonlySet<string>>;
  readonly dirtyFields: SignalLike<ReadonlySet<string>>;
  readonly readyStates: Map<string, boolean>;
  readonly readyVersion: SignalLike<number>;
  readonly validatingFieldSet: Set<string>;
  readonly validatingVersion: SignalLike<number>;
  readonly validatingForm: SignalLike<number>;
  readValue(name: string): unknown;
  isForm(value: unknown): value is Form;
  childFor(name: string): Form | undefined;
  arrayItems(name: string): Form[] | undefined;
  markAllTouchedChild(child: Form): void;
  hasAnyTouchedChild(child: Form): boolean;
  hasValidatingChild(child: Form): boolean;
}

export function isConditionActiveForReady(
  host: StateHost,
  metadata: FieldMetadata,
): boolean {
  if (metadata.when === undefined) {
    return true;
  }
  const result: unknown = metadata.when(host as object);
  if (isThenable(result)) {
    void Promise.resolve(result).catch(() => {});
    return false;
  }
  return result === true;
}

export function isRequirementActive(
  host: StateHost,
  metadata: FieldMetadata,
  value: unknown,
  active = isConditionActiveForReady(host, metadata),
): boolean {
  if (metadata.required !== true) {
    return false;
  }
  if (metadata.optional === true && (value === undefined || value === null)) {
    return false;
  }
  return active;
}

export function computeReady(host: StateHost): boolean {
  host.validatingVersion[0]();
  if (host.validatingFieldSet.size > 0 || host.validatingForm[0]() > 0) {
    return false;
  }
  host.readyVersion[0]();
  for (const [name, metadata] of host.metadata) {
    if (host.readyStates.get(name) === false) {
      return false;
    }
    const value = host.readValue(name);
    const active = isConditionActiveForReady(host, metadata);
    if (
      isRequirementActive(host, metadata, value, active) &&
      (value === undefined || value === null || value === "")
    ) {
      return false;
    }
    if (active && host.isForm(value) && !value.isReady) {
      return false;
    }
    const items = host.arrayItems(name);
    if (active && items !== undefined && !items.every((item) => item.isReady)) {
      return false;
    }
  }
  return host.errorStore.validationSize === 0 && host.errorStore.externalSize === 0;
}

export function computeValid(host: StateHost): boolean {
  if (host.errorStore.validationSize > 0 || host.errorStore.externalSize > 0) {
    return false;
  }
  for (const name of host.metadata.keys()) {
    const child = host.childFor(name);
    if (child !== undefined && !child.isValid) {
      return false;
    }
    const items = host.arrayItems(name);
    if (items !== undefined && !items.every((item) => item.isValid)) {
      return false;
    }
  }
  return true;
}

export function computeDirty(host: StateHost): boolean {
  if (host.dirtyFields[0]().size > 0) {
    return true;
  }
  for (const name of host.metadata.keys()) {
    const child = host.childFor(name);
    if (child !== undefined && child.isDirty) {
      return true;
    }
    const items = host.arrayItems(name);
    if (items !== undefined && items.some((item) => item.isDirty)) {
      return true;
    }
  }
  return false;
}

export function markTouched(host: StateHost, name: string): void {
  const current = host.touchedFields[0]();
  if (current.has(name)) {
    return;
  }
  const next = new Set(current);
  next.add(name);
  host.touchedFields[1](next);
}

export function markDirty(host: StateHost, name: string): void {
  const current = host.dirtyFields[0]();
  if (current.has(name)) {
    return;
  }
  const next = new Set(current);
  next.add(name);
  host.dirtyFields[1](next);
}

export function markAllTouched(host: StateHost): void {
  const current = host.touchedFields[0]();
  let missing = false;
  for (const name of host.metadata.keys()) {
    if (!current.has(name)) {
      missing = true;
      break;
    }
  }
  if (missing) {
    const next = new Set(current);
    for (const name of host.metadata.keys()) {
      next.add(name);
    }
    host.touchedFields[1](next);
  }
  for (const name of host.metadata.keys()) {
    const child = host.childFor(name);
    if (child !== undefined) {
      host.markAllTouchedChild(child);
      continue;
    }
    const items = host.arrayItems(name);
    if (items !== undefined) {
      for (const item of items) {
        host.markAllTouchedChild(item);
      }
    }
  }
}

export function setReadyFor(host: StateHost, name: string, ready: boolean): void {
  if ((host.readyStates.get(name) ?? true) === ready) {
    return;
  }
  host.readyStates.set(name, ready);
  host.readyVersion[1]((version) => version + 1);
}

export function addValidating(host: StateHost, name: string): void {
  if (host.validatingFieldSet.has(name)) {
    return;
  }
  host.validatingFieldSet.add(name);
  host.validatingVersion[1]((version) => version + 1);
}

export function removeValidating(host: StateHost, name: string): void {
  if (!host.validatingFieldSet.delete(name)) {
    return;
  }
  host.validatingVersion[1]((version) => version + 1);
}

export function clearValidatingFields(host: StateHost): void {
  if (host.validatingFieldSet.size === 0) {
    return;
  }
  host.validatingFieldSet.clear();
  host.validatingVersion[1]((version) => version + 1);
}

export function hasAnyTouched(host: StateHost): boolean {
  if (host.touchedFields[0]().size > 0) {
    return true;
  }
  for (const name of host.metadata.keys()) {
    const child = host.childFor(name);
    if (child !== undefined && host.hasAnyTouchedChild(child)) {
      return true;
    }
    const items = host.arrayItems(name);
    if (items !== undefined && items.some((item) => host.hasAnyTouchedChild(item))) {
      return true;
    }
  }
  return false;
}

export function hasValidating(host: StateHost): boolean {
  host.validatingVersion[0]();
  if (host.validatingFieldSet.size > 0 || host.validatingForm[0]() > 0) {
    return true;
  }
  for (const name of host.metadata.keys()) {
    const child = host.childFor(name);
    if (child !== undefined && host.hasValidatingChild(child)) {
      return true;
    }
    const items = host.arrayItems(name);
    if (items !== undefined && items.some((item) => host.hasValidatingChild(item))) {
      return true;
    }
  }
  return false;
}

export function computeErrors(
  host: StateHost,
): Readonly<Record<string, readonly string[]>> {
  const result: Record<string, readonly string[]> = {};
  const merge = (map: ReadonlyMap<string, readonly string[]>): void => {
    for (const [key, messages] of map) {
      if (messages.length === 0) {
        continue;
      }
      const existing = result[key];
      result[key] = existing === undefined ? messages : [...existing, ...messages];
    }
  };
  merge(host.errorStore.validationMap);
  merge(host.errorStore.externalMap);
  for (const name of host.metadata.keys()) {
    const child = host.childFor(name);
    if (child !== undefined) {
      for (const [key, messages] of Object.entries(child.errors)) {
        result[`${name}.${key}`] = messages;
      }
      continue;
    }
    const items = host.arrayItems(name);
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

export function computeValues(host: StateHost): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const name of host.metadata.keys()) {
    const value = host.readValue(name);
    if (host.isForm(value)) {
      result[name] = value.values;
      continue;
    }
    const items = host.arrayItems(name);
    if (items !== undefined) {
      result[name] = items.map((item) => item.values);
      continue;
    }
    result[name] = cloneValue(value);
  }
  return result;
}
