import { DEFAULT_LOCALE, getValidationConfig, resolveMessage } from "./messages.js";
import { validationStateFor } from "./registry.js";
import { AsyncRuleError, ValidationException } from "./types.js";
import type {
  FieldKey,
  FieldRuleEntry,
  FieldSlot,
  MessageContext,
  RuleCheck,
  RuleRunContext,
  ValidationConfig,
  ValidationError,
  ValidationOptions,
  ValidationResult,
} from "./types.js";

interface RuntimeState {
  readonly errors: ValidationError[];
  readonly config: ValidationConfig;
  readonly locale: string;
  readonly labels: Readonly<Record<string, string>> | undefined;
  readonly callGroups: readonly string[] | undefined;
  readonly stopAtFirst: boolean;
  readonly visiting: WeakSet<object>;
  stopped: boolean;
}

interface RuleCall {
  readonly target: object;
  readonly slot: FieldSlot;
  readonly entry: FieldRuleEntry;
  readonly value: unknown;
  readonly path: string;
  readonly index: number | undefined;
  readonly state: RuntimeState;
}

function assertInstance(instance: unknown): asserts instance is object {
  if (typeof instance !== "object" || instance === null) {
    throw new TypeError("Валидируемое значение должно быть объектом");
  }
}

function createConfig(options: ValidationOptions | undefined): ValidationConfig {
  const base = getValidationConfig();
  const locale = options?.locale ?? base.locale;
  const resolve = options?.resolve ?? base.resolve;
  const messages = options?.messages ?? base.messages;
  return {
    ...(locale === undefined ? {} : { locale }),
    ...(resolve === undefined ? {} : { resolve }),
    ...(messages === undefined ? {} : { messages }),
  };
}

function createState(options: ValidationOptions | undefined): RuntimeState {
  const config = createConfig(options);
  return {
    errors: [],
    config,
    locale: config.locale ?? DEFAULT_LOCALE,
    labels: options?.labels,
    callGroups: options?.groups,
    stopAtFirst: options?.stopAtFirst === true,
    visiting: new WeakSet<object>(),
    stopped: false,
  };
}

function readField(target: object, field: FieldKey): unknown {
  return (target as Record<FieldKey, unknown>)[field];
}

function isThenable(value: unknown): boolean {
  return (
    typeof value === "object"
    && value !== null
    && typeof (value as { then?: unknown }).then === "function"
  );
}

function toItems(value: unknown): readonly unknown[] | undefined {
  if (Array.isArray(value)) {
    return value;
  }
  if (value instanceof Set) {
    return Array.from(value);
  }
  return undefined;
}

function isNestedObject(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function groupsMatch(
  ruleGroups: readonly string[] | undefined,
  callGroups: readonly string[] | undefined,
): boolean {
  if (callGroups === undefined || callGroups.length === 0) {
    return true;
  }
  if (ruleGroups === undefined || ruleGroups.length === 0) {
    return true;
  }
  return ruleGroups.some((group) => callGroups.includes(group));
}

function labelOf(call: RuleCall): string {
  return (
    call.entry.options.label
    ?? call.slot.label
    ?? call.state.labels?.[call.slot.fieldName]
    ?? call.slot.fieldName
  );
}

function buildMessage(call: RuleCall, label: string): string {
  const rule = call.entry.rule;
  const options = call.entry.options;
  const context: MessageContext = {
    rule: rule.name,
    key: `validation.${rule.name}`,
    field: call.slot.fieldName,
    label,
    value: call.value,
    params: rule.params,
    locale: call.state.locale,
    instance: call.target,
    path: call.path,
    ...(call.index === undefined ? {} : { index: call.index }),
    ...(options.message === undefined ? {} : { message: options.message }),
    ...(options.messageKey === undefined ? {} : { messageKey: options.messageKey }),
  };
  return resolveMessage(context, call.state.config);
}

function createError(call: RuleCall): ValidationError {
  const label = labelOf(call);
  return {
    field: call.slot.fieldName,
    rule: call.entry.rule.name,
    message: buildMessage(call, label),
    params: call.entry.rule.params,
    value: call.value,
    path: call.path,
    label,
    ...(call.index === undefined ? {} : { index: call.index }),
  };
}

function pushError(call: RuleCall): void {
  call.state.errors.push(createError(call));
  if (call.state.stopAtFirst) {
    call.state.stopped = true;
  }
}

function createRunContext(call: RuleCall): RuleRunContext {
  return {
    instance: call.target,
    field: call.slot.fieldName,
    label: labelOf(call),
    path: call.path,
    params: call.entry.rule.params,
  };
}

function evaluateSync(
  check: RuleCheck,
  value: unknown,
  call: RuleCall,
): boolean {
  const result = check(value, createRunContext(call));
  if (isThenable(result)) {
    throw new AsyncRuleError(call.slot.fieldName, call.entry.rule.name);
  }
  return result === true;
}

async function evaluateAsync(
  check: RuleCheck,
  value: unknown,
  call: RuleCall,
): Promise<boolean> {
  return (await check(value, createRunContext(call))) === true;
}

function isRunnable(entry: FieldRuleEntry, slot: FieldSlot, target: object, state: RuntimeState): boolean {
  if (entry.options.when !== undefined && !entry.options.when(target)) {
    return false;
  }
  return groupsMatch(entry.options.groups ?? slot.groups, state.callGroups);
}

function callFor(
  target: object,
  slot: FieldSlot,
  entry: FieldRuleEntry,
  value: unknown,
  path: string,
  index: number | undefined,
  state: RuntimeState,
): RuleCall {
  return { target, slot, entry, value, path, index, state };
}

function runFieldSync(
  target: object,
  slot: FieldSlot,
  prefix: string,
  state: RuntimeState,
): void {
  const value = readField(target, slot.field);
  if (slot.optional && (value === null || value === undefined)) {
    return;
  }
  for (const condition of slot.conditions) {
    if (!condition(target, value)) {
      return;
    }
  }
  const path = `${prefix}${slot.fieldName}`;
  for (let index = slot.rules.length - 1; index >= 0; index -= 1) {
    if (state.stopped) {
      return;
    }
    const entry = slot.rules[index];
    if (entry === undefined) {
      continue;
    }
    runRuleSync(target, slot, entry, value, path, state);
  }
}

function runRuleSync(
  target: object,
  slot: FieldSlot,
  entry: FieldRuleEntry,
  value: unknown,
  path: string,
  state: RuntimeState,
): void {
  if (!isRunnable(entry, slot, target, state)) {
    return;
  }
  const rule = entry.rule;
  if (entry.options.each === true) {
    const items = toItems(value);
    if (items === undefined) {
      pushError(callFor(target, slot, entry, value, path, undefined, state));
      return;
    }
    for (let index = 0; index < items.length; index += 1) {
      if (state.stopped) {
        return;
      }
      const item = items[index];
      const itemCall = callFor(target, slot, entry, item, `${path}[${index}]`, index, state);
      if (!evaluateSync(rule.check, item, itemCall)) {
        pushError(itemCall);
      }
    }
    return;
  }
  if (rule.nested === "object") {
    if (!evaluateSync(rule.check, value, callFor(target, slot, entry, value, path, undefined, state))) {
      pushError(callFor(target, slot, entry, value, path, undefined, state));
      return;
    }
    if (isNestedObject(value)) {
      runInstanceSync(value, `${path}.`, state);
    } else {
      pushError(callFor(target, slot, entry, value, path, undefined, state));
    }
    return;
  }
  if (rule.nested === "each") {
    const items = toItems(value);
    if (items === undefined) {
      pushError(callFor(target, slot, entry, value, path, undefined, state));
      return;
    }
    for (let index = 0; index < items.length; index += 1) {
      if (state.stopped) {
        return;
      }
      const item = items[index];
      const itemPath = `${path}[${index}]`;
      if (isNestedObject(item)) {
        runInstanceSync(item, `${itemPath}.`, state);
      } else {
        pushError(callFor(target, slot, entry, item, itemPath, index, state));
      }
    }
    return;
  }
  const call = callFor(target, slot, entry, value, path, undefined, state);
  if (!evaluateSync(rule.check, value, call)) {
    pushError(call);
  }
}

function runInstanceSync(target: object, prefix: string, state: RuntimeState): void {
  if (state.visiting.has(target)) {
    return;
  }
  state.visiting.add(target);
  try {
    const validation = validationStateFor(target);
    for (const slot of validation.fields.values()) {
      if (state.stopped) {
        return;
      }
      runFieldSync(target, slot, prefix, state);
    }
  } finally {
    state.visiting.delete(target);
  }
}

async function runFieldAsync(
  target: object,
  slot: FieldSlot,
  prefix: string,
  state: RuntimeState,
): Promise<void> {
  const value = readField(target, slot.field);
  if (slot.optional && (value === null || value === undefined)) {
    return;
  }
  for (const condition of slot.conditions) {
    if (!condition(target, value)) {
      return;
    }
  }
  const path = `${prefix}${slot.fieldName}`;
  for (let index = slot.rules.length - 1; index >= 0; index -= 1) {
    if (state.stopped) {
      return;
    }
    const entry = slot.rules[index];
    if (entry === undefined) {
      continue;
    }
    await runRuleAsync(target, slot, entry, value, path, state);
  }
}

async function runRuleAsync(
  target: object,
  slot: FieldSlot,
  entry: FieldRuleEntry,
  value: unknown,
  path: string,
  state: RuntimeState,
): Promise<void> {
  if (!isRunnable(entry, slot, target, state)) {
    return;
  }
  const rule = entry.rule;
  if (entry.options.each === true) {
    const items = toItems(value);
    if (items === undefined) {
      pushError(callFor(target, slot, entry, value, path, undefined, state));
      return;
    }
    for (let index = 0; index < items.length; index += 1) {
      if (state.stopped) {
        return;
      }
      const item = items[index];
      const itemCall = callFor(target, slot, entry, item, `${path}[${index}]`, index, state);
      if (!(await evaluateAsync(rule.check, item, itemCall))) {
        pushError(itemCall);
      }
    }
    return;
  }
  if (rule.nested === "object") {
    const call = callFor(target, slot, entry, value, path, undefined, state);
    if (!(await evaluateAsync(rule.check, value, call))) {
      pushError(call);
      return;
    }
    if (isNestedObject(value)) {
      await runInstanceAsync(value, `${path}.`, state);
    } else {
      pushError(call);
    }
    return;
  }
  if (rule.nested === "each") {
    const items = toItems(value);
    if (items === undefined) {
      pushError(callFor(target, slot, entry, value, path, undefined, state));
      return;
    }
    for (let index = 0; index < items.length; index += 1) {
      if (state.stopped) {
        return;
      }
      const item = items[index];
      const itemPath = `${path}[${index}]`;
      if (isNestedObject(item)) {
        await runInstanceAsync(item, `${itemPath}.`, state);
      } else {
        pushError(callFor(target, slot, entry, item, itemPath, index, state));
      }
    }
    return;
  }
  const call = callFor(target, slot, entry, value, path, undefined, state);
  if (!(await evaluateAsync(rule.check, value, call))) {
    pushError(call);
  }
}

async function runInstanceAsync(
  target: object,
  prefix: string,
  state: RuntimeState,
): Promise<void> {
  if (state.visiting.has(target)) {
    return;
  }
  state.visiting.add(target);
  try {
    const validation = validationStateFor(target);
    for (const slot of validation.fields.values()) {
      if (state.stopped) {
        return;
      }
      await runFieldAsync(target, slot, prefix, state);
    }
  } finally {
    state.visiting.delete(target);
  }
}

function makeResult(state: RuntimeState): ValidationResult {
  return { valid: state.errors.length === 0, errors: state.errors };
}

export function validate(instance: object, options?: ValidationOptions): ValidationResult {
  assertInstance(instance);
  const state = createState(options);
  runInstanceSync(instance, "", state);
  return makeResult(state);
}

export async function validateAsync(
  instance: object,
  options?: ValidationOptions,
): Promise<ValidationResult> {
  assertInstance(instance);
  const state = createState(options);
  await runInstanceAsync(instance, "", state);
  return makeResult(state);
}

export function validateOrThrow(instance: object, options?: ValidationOptions): void {
  const result = validate(instance, options);
  if (!result.valid) {
    throw new ValidationException(result);
  }
}

export async function validateOrThrowAsync(
  instance: object,
  options?: ValidationOptions,
): Promise<void> {
  const result = await validateAsync(instance, options);
  if (!result.valid) {
    throw new ValidationException(result);
  }
}
