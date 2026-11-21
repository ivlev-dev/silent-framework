import { constructorOf } from "./property.js";
import type {
  ClassValidationState,
  FieldCondition,
  FieldKey,
  FieldRuleEntry,
  FieldSlot,
  RuleDefinition,
  RuleOptions,
} from "./types.js";

const states = new WeakMap<Function, ClassValidationState>();

const conditionIdentities = new WeakMap<FieldCondition, unknown>();

export function classStateFor(ctor: Function): ClassValidationState {
  let state = states.get(ctor);
  if (state === undefined) {
    state = { fields: new Map<FieldKey, FieldSlot>(), tokens: new Map<symbol, Set<FieldKey>>(), revision: 0 };
    states.set(ctor, state);
  }
  return state;
}

export function classStateRevision(ctor: Function): number {
  return classStateFor(ctor).revision;
}

export function fieldSlot(
  state: ClassValidationState,
  field: FieldKey,
  fieldName: string,
): FieldSlot {
  let slot = state.fields.get(field);
  if (slot === undefined) {
    slot = {
      field,
      fieldName,
      rules: [],
      optional: false,
      conditions: [],
    };
    state.fields.set(field, slot);
    state.revision += 1;
  }
  return slot;
}

function beginToken(
  state: ClassValidationState,
  token: symbol,
  field: FieldKey,
): boolean {
  let fields = state.tokens.get(token);
  if (fields === undefined) {
    fields = new Set<FieldKey>();
    state.tokens.set(token, fields);
  }
  if (fields.has(field)) {
    return false;
  }
  fields.add(field);
  state.revision += 1;
  return true;
}

function sameValue(
  a: unknown,
  b: unknown,
  seen: Map<object, Set<object>>,
): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (typeof a !== "object" || a === null || typeof b !== "object" || b === null) {
    return false;
  }
  if (a instanceof RegExp || b instanceof RegExp) {
    return a instanceof RegExp
      && b instanceof RegExp
      && a.source === b.source
      && a.flags === b.flags;
  }
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date
      && b instanceof Date
      && a.getTime() === b.getTime();
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    for (let index = 0; index < a.length; index += 1) {
      if (!sameValue(a[index], b[index], seen)) {
        return false;
      }
    }
    return true;
  }
  if (a instanceof Map || b instanceof Map || a instanceof Set || b instanceof Set) {
    return false;
  }
  const proto = Object.getPrototypeOf(a);
  if (proto !== Object.getPrototypeOf(b) || (proto !== Object.prototype && proto !== null)) {
    return false;
  }
  let matched = seen.get(a);
  if (matched?.has(b) === true) {
    return true;
  }
  if (matched === undefined) {
    matched = new Set<object>();
    seen.set(a, matched);
  }
  matched.add(b);
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) {
    return false;
  }
  for (const key of keysA) {
    if (!Object.hasOwn(b, key)) {
      return false;
    }
    const left = (a as Readonly<Record<string, unknown>>)[key];
    const right = (b as Readonly<Record<string, unknown>>)[key];
    if (!sameValue(left, right, seen)) {
      return false;
    }
  }
  return true;
}

function sameGroups(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  const leftEmpty = left === undefined || left.length === 0;
  const rightEmpty = right === undefined || right.length === 0;
  if (leftEmpty || rightEmpty) {
    return leftEmpty && rightEmpty;
  }
  return left.length === right.length
    && left.every((group, index) => group === right[index]);
}

function sameOptions(left: RuleOptions, right: RuleOptions): boolean {
  return left.message === right.message
    && left.messageKey === right.messageKey
    && left.label === right.label
    && left.when === right.when
    && left.each === right.each
    && sameGroups(left.groups, right.groups);
}

function sameRule(left: RuleDefinition, right: RuleDefinition): boolean {
  if (left === right) {
    return true;
  }
  if (left.name !== right.name || left.nested !== right.nested || left.check !== right.check) {
    return false;
  }
  return sameValue(left.params, right.params, new Map<object, Set<object>>());
}

function hasSameRule(slot: FieldSlot, entry: FieldRuleEntry): boolean {
  return slot.rules.some((existing) => (
    sameRule(existing.rule, entry.rule) && sameOptions(existing.options, entry.options)
  ));
}

export function installRule(
  ctor: Function,
  token: symbol,
  entry: FieldRuleEntry,
): void {
  const state = classStateFor(ctor);
  if (!beginToken(state, token, entry.field)) {
    return;
  }
  const slot = fieldSlot(state, entry.field, entry.fieldName);
  if (hasSameRule(slot, entry)) {
    return;
  }
  slot.rules.push(entry);
}

export function installLabel(
  ctor: Function,
  token: symbol,
  field: FieldKey,
  fieldName: string,
  label: string,
): void {
  const state = classStateFor(ctor);
  if (!beginToken(state, token, field)) {
    return;
  }
  fieldSlot(state, field, fieldName).label = label;
}

export function installGroups(
  ctor: Function,
  token: symbol,
  field: FieldKey,
  fieldName: string,
  groups: readonly string[],
): void {
  const state = classStateFor(ctor);
  if (!beginToken(state, token, field)) {
    return;
  }
  fieldSlot(state, field, fieldName).groups = groups;
}

export function installOptional(
  ctor: Function,
  token: symbol,
  field: FieldKey,
  fieldName: string,
): void {
  const state = classStateFor(ctor);
  if (!beginToken(state, token, field)) {
    return;
  }
  fieldSlot(state, field, fieldName).optional = true;
}

export function installCondition(
  ctor: Function,
  token: symbol,
  field: FieldKey,
  fieldName: string,
  condition: FieldCondition,
  identity?: unknown,
): void {
  const state = classStateFor(ctor);
  if (!beginToken(state, token, field)) {
    return;
  }
  const slot = fieldSlot(state, field, fieldName);
  const key = identity ?? condition;
  const existing = slot.conditions.some((candidate) => (
    (conditionIdentities.get(candidate) ?? candidate) === key
  ));
  if (existing) {
    return;
  }
  conditionIdentities.set(condition, key);
  slot.conditions.push(condition);
}

export function validationStateFor(instance: object): ClassValidationState {
  const ctor = constructorOf(instance);
  if (ctor === null) {
    throw new TypeError("Валидируемое значение должно быть экземпляром класса");
  }
  return classStateFor(ctor);
}
