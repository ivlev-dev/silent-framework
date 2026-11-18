import { DEFAULT_LOCALE, getValidationConfig, resolveMessage, resolveMessageAsync } from "./messages.js";
import { classStateRevision, validationStateFor } from "./registry.js";
import { readInstanceSchema } from "./schema.js";
import { isThenable, suppress } from "./thenable.js";
import { validateFastPrimitive, validateType } from "./type-validation.js";
import { AsyncRuleError, ValidationException } from "./types.js";
import type { NestedInstance } from "./type-validation.js";
import type { FieldSchemaMap, TypeSchema } from "./schema.js";
import type {
  FieldKey,
  FieldRuleEntry,
  FieldSlot,
  MessageContext,
  RuleCheck,
  RuleRunContext,
  SafeParseResult,
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
  readonly cascade: boolean;
  readonly types: boolean;
  readonly visiting: WeakSet<object>;
  readonly nestedSeen: WeakMap<object, Set<string>>;
  stopped: boolean;
}

interface FieldRun {
  readonly key: FieldKey;
  readonly fieldName: string;
  readonly slot: FieldSlot | undefined;
  readonly schema: TypeSchema | undefined;
}

interface PlanCache {
  readonly revision: number;
  readonly schema: FieldSchemaMap | null | undefined;
  readonly withSchema: readonly FieldRun[] | undefined;
  readonly plain: readonly FieldRun[] | undefined;
}

const planCache = new WeakMap<Function, PlanCache>();

const EMPTY_NESTED: readonly NestedInstance[] = [];

interface PreparedField {
  readonly value: unknown;
  readonly path: string;
  readonly nested: readonly NestedInstance[];
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
  const cascade = options?.cascade ?? base.cascade;
  return {
    ...(locale === undefined ? {} : { locale }),
    ...(resolve === undefined ? {} : { resolve }),
    ...(messages === undefined ? {} : { messages }),
    ...(cascade === undefined ? {} : { cascade }),
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
    cascade: options?.cascade ?? config.cascade ?? true,
    types: options?.types !== false,
    visiting: new WeakSet<object>(),
    nestedSeen: new WeakMap<object, Set<string>>(),
    stopped: false,
  };
}

function readField(target: object, field: FieldKey): unknown {
  return (target as Record<FieldKey, unknown>)[field];
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

function labelAtPath(
  labels: Readonly<Record<string, string>> | undefined,
  fieldName: string,
  path: string,
): string | undefined {
  if (labels === undefined) {
    return undefined;
  }
  if (Object.hasOwn(labels, path)) {
    const exact = labels[path];
    if (typeof exact === "string") {
      return exact;
    }
  }
  if (path !== fieldName && !path.startsWith(`${fieldName}[`)) {
    return undefined;
  }
  if (!Object.hasOwn(labels, fieldName)) {
    return undefined;
  }
  const short = labels[fieldName];
  return typeof short === "string" ? short : undefined;
}

function labelOf(call: RuleCall): string {
  return (
    call.entry.options.label
    ?? call.slot.label
    ?? labelAtPath(call.state.labels, call.slot.fieldName, call.path)
    ?? call.slot.fieldName
  );
}

function buildMessage(call: RuleCall, label: string): string {
  return resolveMessage(messageContext(call, label), call.state.config);
}

async function buildMessageAsync(call: RuleCall, label: string): Promise<string> {
  return resolveMessageAsync(messageContext(call, label), call.state.config);
}

function messageContext(call: RuleCall, label: string): MessageContext {
  const rule = call.entry.rule;
  const options = call.entry.options;
  const messageKey = options.messageKey
    ?? (rule.name === "each" && call.index === undefined
      ? "validation.eachValue"
      : undefined);
  return {
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
    ...(messageKey === undefined ? {} : { messageKey }),
  };
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

async function createErrorAsync(call: RuleCall): Promise<ValidationError> {
  const label = labelOf(call);
  return {
    field: call.slot.fieldName,
    rule: call.entry.rule.name,
    message: await buildMessageAsync(call, label),
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

async function pushErrorAsync(call: RuleCall): Promise<void> {
  call.state.errors.push(await createErrorAsync(call));
  if (call.state.stopAtFirst) {
    call.state.stopped = true;
  }
}

function withoutResolver(config: ValidationConfig): ValidationConfig {
  return {
    ...(config.locale === undefined ? {} : { locale: config.locale }),
    ...(config.messages === undefined ? {} : { messages: config.messages }),
    ...(config.cascade === undefined ? {} : { cascade: config.cascade }),
  };
}

async function resolveErrorAsync(
  error: ValidationError,
  target: object,
  state: RuntimeState,
): Promise<ValidationError> {
  const key = `validation.${error.rule}`;
  const context: MessageContext = {
    rule: error.rule,
    key,
    field: error.field,
    label: error.label,
    value: error.value,
    params: error.params,
    locale: state.locale,
    instance: target,
    path: error.path,
    ...(error.index === undefined ? {} : { index: error.index }),
  };
  return {
    ...error,
    message: await resolveMessageAsync(context, state.config),
  };
}

async function rerenderErrorsAsync(
  state: RuntimeState,
  start: number,
  target: object,
): Promise<void> {
  for (let index = start; index < state.errors.length; index += 1) {
    const error = state.errors[index];
    if (error === undefined) {
      continue;
    }
    state.errors[index] = await resolveErrorAsync(error, target, state);
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
    suppress(result);
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
  if (entry.options.when !== undefined) {
    const condition: unknown = entry.options.when(target);
    if (isThenable(condition)) {
      suppress(condition);
      throw new AsyncRuleError(slot.fieldName, "when");
    }
    if (!condition) {
      return false;
    }
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

function fieldPlan(target: object, withSchema: boolean): readonly FieldRun[] {
  const ctor: unknown = target.constructor;
  if (typeof ctor !== "function") {
    return buildFieldPlan(target, withSchema);
  }
  const revision = classStateRevision(ctor);
  const schema = withSchema ? readInstanceSchema(target) : undefined;
  let cached = planCache.get(ctor);
  if (cached === undefined || cached.revision !== revision) {
    cached = { revision, schema, withSchema: undefined, plain: undefined };
    planCache.set(ctor, cached);
  } else if (withSchema && cached.schema !== schema) {
    cached = { ...cached, schema, withSchema: undefined };
    planCache.set(ctor, cached);
  }
  const existing = withSchema ? cached.withSchema : cached.plain;
  if (existing !== undefined) {
    return existing;
  }
  const built = buildFieldPlan(target, withSchema, schema);
  cached = {
    revision,
    schema,
    withSchema: withSchema ? built : cached.withSchema,
    plain: withSchema ? cached.plain : built,
  };
  planCache.set(ctor, cached);
  return built;
}

function buildFieldPlan(
  target: object,
  withSchema: boolean,
  schema: FieldSchemaMap | null | undefined = undefined,
): readonly FieldRun[] {
  const validation = validationStateFor(target);
  const byName = new Map<string, FieldSlot>();
  for (const slot of validation.fields.values()) {
    if (typeof slot.field === "string" && !byName.has(slot.fieldName)) {
      byName.set(slot.fieldName, slot);
    }
  }
  const plan: FieldRun[] = [];
  const used = new Set<FieldSlot>();
  if (withSchema) {
    const resolved = schema === undefined ? readInstanceSchema(target) : schema;
    if (resolved !== null) {
      for (const [name, typeSchema] of Object.entries(resolved)) {
        const slot = byName.get(name);
        if (slot !== undefined) {
          for (const candidate of validation.fields.values()) {
            if (typeof candidate.field === "string" && candidate.fieldName === name) {
              used.add(candidate);
            }
          }
        }
        plan.push({
          key: slot?.field ?? name,
          fieldName: name,
          slot,
          schema: typeSchema,
        });
      }
    }
  }
  for (const slot of validation.fields.values()) {
    if (used.has(slot)) {
      continue;
    }
    plan.push({
      key: slot.field,
      fieldName: slot.fieldName,
      slot,
      schema: undefined,
    });
  }
  return plan;
}

function schemaSkips(schema: TypeSchema, value: unknown): boolean {
  let current = schema;
  while (Array.isArray(current)) {
    const tag = current[0];
    if (tag === "optional" && value === undefined) {
      return true;
    }
    if (tag === "nullable" && value === null) {
      return true;
    }
    if (tag !== "optional" && tag !== "nullable") {
      return false;
    }
    current = current[1];
  }
  return false;
}

function uniqueNested(entries: readonly NestedInstance[]): readonly NestedInstance[] {
  if (entries.length <= 1) {
    return entries;
  }
  const seen = new Map<object, Set<string>>();
  const unique: NestedInstance[] = [];
  for (const entry of entries) {
    let paths = seen.get(entry.instance);
    if (paths === undefined) {
      paths = new Set<string>();
      seen.set(entry.instance, paths);
    }
    if (paths.has(entry.path)) {
      continue;
    }
    paths.add(entry.path);
    unique.push(entry);
  }
  return unique;
}

function prepareField(
  target: object,
  run: FieldRun,
  prefix: string,
  state: RuntimeState,
  asyncTypes = false,
): PreparedField | null {
  const value = readField(target, run.key);
  const slot = run.slot;
  if (slot !== undefined && slot.optional && (value === null || value === undefined)) {
    return null;
  }
  if (slot !== undefined) {
    for (const condition of slot.conditions) {
      if (!condition(target, value)) {
        return null;
      }
    }
  }
  const path = `${prefix}${run.fieldName}`;
  if (state.types && run.schema !== undefined) {
    if (schemaSkips(run.schema, value)) {
      return null;
    }
    const typeConfig =
      asyncTypes && state.config.resolve !== undefined
        ? withoutResolver(state.config)
        : state.config;
    const label = slot?.label
      ?? labelAtPath(state.labels, run.fieldName, path)
      ?? run.fieldName;
    let nested: readonly NestedInstance[] = EMPTY_NESTED;
    let failed = false;
    const fast = validateFastPrimitive(value, run.schema, {
      instance: target,
      field: run.fieldName,
      label,
      path,
      config: typeConfig,
    });
    if (fast !== undefined) {
      if (fast !== null) {
        failed = true;
        state.errors.push(fast);
      }
    } else {
      const collected: NestedInstance[] = [];
      const result = validateType(value, run.schema, {
        instance: target,
        field: run.fieldName,
        label,
        path,
        config: typeConfig,
        visiting: state.visiting,
        nested: collected,
      });
      if (result !== null) {
        failed = true;
        const errors = Array.isArray(result) ? result : [result];
        const limit = state.stopAtFirst ? 1 : errors.length;
        for (let index = 0; index < limit; index += 1) {
          const error = errors[index];
          if (error !== undefined) {
            state.errors.push(error);
          }
        }
      }
      nested = uniqueNested(collected);
    }
    if (state.stopAtFirst && failed) {
      state.stopped = true;
      return null;
    }
    if (failed && !state.cascade) {
      return null;
    }
    return { value, path, nested };
  }
  return { value, path, nested: EMPTY_NESTED };
}

function shouldVisitNested(
  instance: object,
  path: string,
  state: RuntimeState,
): boolean {
  const seen = state.nestedSeen.get(instance);
  if (seen?.has(path) === true) {
    return false;
  }
  if (seen === undefined) {
    state.nestedSeen.set(instance, new Set<string>([path]));
  } else {
    seen.add(path);
  }
  return true;
}

function runNestedSync(
  nested: readonly NestedInstance[],
  state: RuntimeState,
): void {
  for (const entry of nested) {
    if (state.stopped) {
      return;
    }
    const path = `${entry.path}.`;
    if (!shouldVisitNested(entry.instance, path, state)) {
      continue;
    }
    runInstanceSync(entry.instance, path, state);
  }
}

async function runNestedAsync(
  nested: readonly NestedInstance[],
  state: RuntimeState,
): Promise<void> {
  for (const entry of nested) {
    if (state.stopped) {
      return;
    }
    const path = `${entry.path}.`;
    if (!shouldVisitNested(entry.instance, path, state)) {
      continue;
    }
    await runInstanceAsync(entry.instance, path, state);
  }
}

function runFieldSync(
  target: object,
  run: FieldRun,
  prefix: string,
  state: RuntimeState,
): void {
  const prepared = prepareField(target, run, prefix, state);
  if (prepared === null) {
    return;
  }
  if (prepared.nested.length > 0) {
    runNestedSync(prepared.nested, state);
    if (state.stopped) {
      return;
    }
  }
  const slot = run.slot;
  if (slot === undefined) {
    return;
  }
  for (let index = slot.rules.length - 1; index >= 0; index -= 1) {
    if (state.stopped) {
      return;
    }
    const entry = slot.rules[index];
    if (entry === undefined) {
      continue;
    }
    runRuleSync(target, slot, entry, prepared.value, prepared.path, state);
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
      if (shouldVisitNested(value, `${path}.`, state)) {
        runInstanceSync(value, `${path}.`, state);
      }
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
        if (shouldVisitNested(item, `${itemPath}.`, state)) {
          runInstanceSync(item, `${itemPath}.`, state);
        }
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
    for (const run of fieldPlan(target, state.types)) {
      if (state.stopped) {
        return;
      }
      runFieldSync(target, run, prefix, state);
    }
  } finally {
    state.visiting.delete(target);
  }
}

async function runFieldAsync(
  target: object,
  run: FieldRun,
  prefix: string,
  state: RuntimeState,
): Promise<void> {
  const start = state.errors.length;
  const prepared = prepareField(target, run, prefix, state, true);
  if (state.config.resolve !== undefined && state.errors.length > start) {
    await rerenderErrorsAsync(state, start, target);
  }
  if (prepared === null) {
    return;
  }
  if (prepared.nested.length > 0) {
    await runNestedAsync(prepared.nested, state);
    if (state.stopped) {
      return;
    }
  }
  const slot = run.slot;
  if (slot === undefined) {
    return;
  }
  for (let index = slot.rules.length - 1; index >= 0; index -= 1) {
    if (state.stopped) {
      return;
    }
    const entry = slot.rules[index];
    if (entry === undefined) {
      continue;
    }
    await runRuleAsync(target, slot, entry, prepared.value, prepared.path, state);
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
      await pushErrorAsync(callFor(target, slot, entry, value, path, undefined, state));
      return;
    }
    for (let index = 0; index < items.length; index += 1) {
      if (state.stopped) {
        return;
      }
      const item = items[index];
      const itemCall = callFor(target, slot, entry, item, `${path}[${index}]`, index, state);
      if (!(await evaluateAsync(rule.check, item, itemCall))) {
        await pushErrorAsync(itemCall);
      }
    }
    return;
  }
  if (rule.nested === "object") {
    const call = callFor(target, slot, entry, value, path, undefined, state);
    if (!(await evaluateAsync(rule.check, value, call))) {
      await pushErrorAsync(call);
      return;
    }
    if (isNestedObject(value)) {
      if (shouldVisitNested(value, `${path}.`, state)) {
        await runInstanceAsync(value, `${path}.`, state);
      }
    } else {
      await pushErrorAsync(call);
    }
    return;
  }
  if (rule.nested === "each") {
    const items = toItems(value);
    if (items === undefined) {
      await pushErrorAsync(callFor(target, slot, entry, value, path, undefined, state));
      return;
    }
    for (let index = 0; index < items.length; index += 1) {
      if (state.stopped) {
        return;
      }
      const item = items[index];
      const itemPath = `${path}[${index}]`;
      if (isNestedObject(item)) {
        if (shouldVisitNested(item, `${itemPath}.`, state)) {
          await runInstanceAsync(item, `${itemPath}.`, state);
        }
      } else {
        await pushErrorAsync(callFor(target, slot, entry, item, itemPath, index, state));
      }
    }
    return;
  }
  const call = callFor(target, slot, entry, value, path, undefined, state);
  if (!(await evaluateAsync(rule.check, value, call))) {
    await pushErrorAsync(call);
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
    for (const run of fieldPlan(target, state.types)) {
      if (state.stopped) {
        return;
      }
      await runFieldAsync(target, run, prefix, state);
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

function runFieldsSync(
  instance: object,
  fields: ReadonlySet<string>,
  options: ValidationOptions | undefined,
): ValidationResult {
  assertInstance(instance);
  const state = createState(options);
  if (fields.size === 0) {
    return makeResult(state);
  }
  for (const run of fieldPlan(instance, state.types)) {
    if (state.stopped) {
      break;
    }
    if (!fields.has(run.fieldName)) {
      continue;
    }
    runFieldSync(instance, run, "", state);
  }
  return makeResult(state);
}

async function runFieldsAsync(
  instance: object,
  fields: ReadonlySet<string>,
  options: ValidationOptions | undefined,
): Promise<ValidationResult> {
  assertInstance(instance);
  const state = createState(options);
  if (fields.size === 0) {
    return makeResult(state);
  }
  for (const run of fieldPlan(instance, state.types)) {
    if (state.stopped) {
      break;
    }
    if (!fields.has(run.fieldName)) {
      continue;
    }
    await runFieldAsync(instance, run, "", state);
  }
  return makeResult(state);
}

export function validateProperty(
  instance: object,
  field: string,
  options?: ValidationOptions,
): ValidationResult {
  return runFieldsSync(instance, new Set([field]), options);
}

export async function validatePropertyAsync(
  instance: object,
  field: string,
  options?: ValidationOptions,
): Promise<ValidationResult> {
  return runFieldsAsync(instance, new Set([field]), options);
}

export function validatePartial(
  instance: object,
  fields: readonly string[],
  options?: ValidationOptions,
): ValidationResult {
  return runFieldsSync(instance, new Set(fields), options);
}

export async function validatePartialAsync(
  instance: object,
  fields: readonly string[],
  options?: ValidationOptions,
): Promise<ValidationResult> {
  return runFieldsAsync(instance, new Set(fields), options);
}

export function safeParse<T extends object>(
  instance: T,
  options?: ValidationOptions,
): SafeParseResult<T> {
  const result = validate(instance, options);
  if (result.valid) {
    return { success: true, data: instance, errors: [] };
  }
  return { success: false, errors: result.errors };
}

export async function safeParseAsync<T extends object>(
  instance: T,
  options?: ValidationOptions,
): Promise<SafeParseResult<T>> {
  const result = await validateAsync(instance, options);
  if (result.valid) {
    return { success: true, data: instance, errors: [] };
  }
  return { success: false, errors: result.errors };
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
