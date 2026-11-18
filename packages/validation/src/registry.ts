import type {
  ClassValidationState,
  FieldCondition,
  FieldKey,
  FieldRuleEntry,
  FieldSlot,
} from "./types.js";

const states = new WeakMap<Function, ClassValidationState>();

export function classStateFor(ctor: Function): ClassValidationState {
  let state = states.get(ctor);
  if (state === undefined) {
    state = { fields: new Map<FieldKey, FieldSlot>(), tokens: new Set<symbol>() };
    states.set(ctor, state);
  }
  return state;
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
  }
  return slot;
}

function beginToken(
  state: ClassValidationState,
  token: symbol,
): boolean {
  if (state.tokens.has(token)) {
    return false;
  }
  state.tokens.add(token);
  return true;
}

export function installRule(
  ctor: Function,
  token: symbol,
  entry: FieldRuleEntry,
): void {
  const state = classStateFor(ctor);
  if (!beginToken(state, token)) {
    return;
  }
  fieldSlot(state, entry.field, entry.fieldName).rules.push(entry);
}

export function installLabel(
  ctor: Function,
  token: symbol,
  field: FieldKey,
  fieldName: string,
  label: string,
): void {
  const state = classStateFor(ctor);
  if (!beginToken(state, token)) {
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
  if (!beginToken(state, token)) {
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
  if (!beginToken(state, token)) {
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
): void {
  const state = classStateFor(ctor);
  if (!beginToken(state, token)) {
    return;
  }
  fieldSlot(state, field, fieldName).conditions.push(condition);
}

export function validationStateFor(instance: object): ClassValidationState {
  const ctor: unknown = instance.constructor;
  if (typeof ctor !== "function") {
    throw new TypeError("Валидируемое значение должно быть экземпляром класса");
  }
  return classStateFor(ctor);
}
