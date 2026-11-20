import { DEFAULT_LOCALE, resolveMessage } from "./messages.js";
import { constructorOf, readFieldValue } from "./property.js";
import { readClassSchema, readInstanceSchema } from "./schema.js";
import { isThenable, suppress, suppressThenable } from "./thenable.js";
import type { FieldSchemaMap, TypeSchema } from "./schema.js";
import type {
  MessageContext,
  ValidationConfig,
  ValidationError,
} from "./types.js";

export interface NestedInstance {
  readonly instance: object;
  readonly path: string;
}

interface LazyResolution {
  readonly schema: TypeSchema | null;
  readonly name: string;
}

export interface TypeRuntime {
  readonly visiting: WeakSet<object>;
  lazyActive?: Map<TypeSchema, Set<unknown>> | undefined;
  resolvedClasses?: WeakMap<object, Function | null> | undefined;
  lazyResolutions?: WeakMap<object, LazyResolution> | undefined;
  instanceFields?: WeakMap<Function, FieldSchemaMap | null> | undefined;
  /**
   * Успешно проверенные пары (значение-объект, схема) → минимальная глубина,
   * на которой проверка завершилась без ошибок. Кешируются только пустые
   * результаты: ошибки зависят от пути и labels.
   */
  successCache?: WeakMap<object, Map<TypeSchema, number>> | undefined;
  /** Счётчик срабатываний защиты от циклов; успехи с циклами не кешируются. */
  cycleHits?: number | undefined;
}

export interface TypeValidationContext {
  readonly instance: object;
  readonly field: string;
  readonly label: string;
  readonly path: string;
  readonly config: ValidationConfig;
  readonly labels?: Readonly<Record<string, string>> | undefined;
  readonly visiting?: WeakSet<object>;
  readonly runtime?: TypeRuntime | undefined;
  readonly nested?: NestedInstance[] | undefined;
}

interface ErrorContext {
  readonly instance: object;
  readonly field: string;
  readonly label: string;
  readonly path: string;
  readonly config: ValidationConfig;
  readonly labels: Readonly<Record<string, string>> | undefined;
  readonly locale: string;
  readonly index: number | undefined;
}

interface RunContext extends ErrorContext {
  readonly runtime: TypeRuntime;
  readonly nested: NestedInstance[] | undefined;
}

type InstanceCtor = new (...args: never[]) => unknown;

export const MAX_DEPTH = 256;

const PRIMITIVE_NAMES: Readonly<Record<string, string>> = {
  string: "string",
  number: "number",
  boolean: "boolean",
  bigint: "bigint",
  symbol: "symbol",
  object: "object",
  function: "function",
  undefined: "undefined",
  null: "null",
  void: "void",
  never: "never",
  date: "Date",
  regexp: "RegExp",
  map: "Map",
  set: "Set",
  weakmap: "WeakMap",
  weakset: "WeakSet",
  promise: "Promise",
  error: "Error",
  arraybuffer: "ArrayBuffer",
  sharedarraybuffer: "SharedArrayBuffer",
  dataview: "DataView",
  url: "URL",
  urlsearchparams: "URLSearchParams",
  iterable: "Iterable",
  asynciterable: "AsyncIterable",
  iterator: "Iterator",
  asynciterator: "AsyncIterator",
  int8array: "Int8Array",
  uint8array: "Uint8Array",
  uint8clampedarray: "Uint8ClampedArray",
  int16array: "Int16Array",
  uint16array: "Uint16Array",
  int32array: "Int32Array",
  uint32array: "Uint32Array",
  float32array: "Float32Array",
  float64array: "Float64Array",
  bigint64array: "BigInt64Array",
  biguint64array: "BigUint64Array",
};

const TYPED_ARRAY_GLOBALS: Readonly<Record<string, string>> = {
  int8array: "Int8Array",
  uint8array: "Uint8Array",
  uint8clampedarray: "Uint8ClampedArray",
  int16array: "Int16Array",
  uint16array: "Uint16Array",
  int32array: "Int32Array",
  uint32array: "Uint32Array",
  float32array: "Float32Array",
  float64array: "Float64Array",
  bigint64array: "BigInt64Array",
  biguint64array: "BigUint64Array",
};

function globalCtor(name: string): unknown {
  return (globalThis as unknown as Record<string, unknown>)[name];
}

function isInstanceOf(value: unknown, name: string): boolean {
  const ctor = globalCtor(name);
  if (typeof ctor !== "function") {
    return false;
  }
  return value instanceof (ctor as InstanceCtor);
}

function isInstanceOfCtor(value: unknown, ctor: Function): boolean {
  try {
    return value instanceof (ctor as InstanceCtor);
  } catch {
    return false;
  }
}

function isPlainObject(value: unknown): value is object {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isIterable(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  return typeof (value as { [Symbol.iterator]?: unknown })[Symbol.iterator] === "function";
}

function isAsyncIterable(value: unknown): boolean {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) {
    return false;
  }
  return typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === "function";
}

function isIteratorLike(value: unknown): boolean {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) {
    return false;
  }
  return typeof (value as { next?: unknown }).next === "function";
}

function isAsyncIterator(value: unknown): boolean {
  if (!isIteratorLike(value)) {
    return false;
  }
  if (typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === "function") {
    return true;
  }
  return typeof (value as { [Symbol.iterator]?: unknown })[Symbol.iterator] !== "function";
}

function isValidDate(value: unknown): boolean {
  return isInstanceOf(value, "Date") && Number.isFinite((value as Date).getTime());
}

function matchesPrimitive(value: unknown, schema: string): boolean {
  switch (schema) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "bigint":
      return typeof value === "bigint";
    case "symbol":
      return typeof value === "symbol";
    case "object":
      return typeof value === "object" && value !== null;
    case "function":
      return typeof value === "function";
    case "undefined":
    case "void":
      return value === undefined;
    case "null":
      return value === null;
    case "never":
      return false;
    case "date":
      return isValidDate(value);
    case "regexp":
      return isInstanceOf(value, "RegExp");
    case "map":
      return isInstanceOf(value, "Map");
    case "set":
      return isInstanceOf(value, "Set");
    case "weakmap":
      return isInstanceOf(value, "WeakMap");
    case "weakset":
      return isInstanceOf(value, "WeakSet");
    case "promise":
      return isThenable(value);
    case "error":
      return isInstanceOf(value, "Error");
    case "arraybuffer":
      return isInstanceOf(value, "ArrayBuffer");
    case "sharedarraybuffer":
      return isInstanceOf(value, "SharedArrayBuffer");
    case "dataview":
      return isInstanceOf(value, "DataView");
    case "url":
      return isInstanceOf(value, "URL");
    case "urlsearchparams":
      return isInstanceOf(value, "URLSearchParams");
    case "iterable":
      return isIterable(value);
    case "asynciterable":
      return isAsyncIterable(value);
    case "iterator":
      return isIteratorLike(value);
    case "asynciterator":
      return isAsyncIterator(value);
    default: {
      const globalName = TYPED_ARRAY_GLOBALS[schema];
      return globalName !== undefined && isInstanceOf(value, globalName);
    }
  }
}

type FastPrimitiveSchema =
  | "string"
  | "number"
  | "boolean"
  | "bigint"
  | "symbol"
  | "object"
  | "function";

function isFastPrimitiveName(name: string): name is FastPrimitiveSchema {
  switch (name) {
    case "string":
    case "number":
    case "boolean":
    case "bigint":
    case "symbol":
    case "object":
    case "function":
      return true;
    default:
      return false;
  }
}

export function validateFastPrimitive(
  value: unknown,
  schema: TypeSchema,
  context: TypeValidationContext,
): ValidationError | null | undefined {
  if (typeof schema !== "string" || !isFastPrimitiveName(schema)) {
    return undefined;
  }
  if (matchesPrimitive(value, schema)) {
    return null;
  }
  return createError(value, schema, {
    instance: context.instance,
    field: context.field,
    label: context.label,
    path: context.path,
    config: context.config,
    labels: context.labels,
    locale: context.config.locale ?? DEFAULT_LOCALE,
    index: undefined,
  });
}

function formatLiteral(value: string | number | boolean): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

function ctorName(getCtor: () => Function): string {
  try {
    const produced: unknown = getCtor();
    if (isThenable(produced)) {
      suppress(produced);
      return "object";
    }
    return typeof produced === "function" && produced.name.length > 0
      ? produced.name
      : "object";
  } catch {
    return "object";
  }
}

function tupleName(items: readonly (TypeSchema | null)[], rest: TypeSchema | undefined, depth: number): string {
  const parts = items.map((item) => (item === null ? "?" : typeNameAt(item, depth + 1)));
  if (rest !== undefined) {
    parts.push(`...${typeNameAt(rest, depth + 1)}[]`);
  }
  return `[${parts.join(", ")}]`;
}

const MAX_NAME_DEPTH = 8;

function typeNameAt(schema: TypeSchema, depth: number): string {
  if (typeof schema === "string") {
    return PRIMITIVE_NAMES[schema] ?? schema;
  }
  if (!Array.isArray(schema)) {
    return "unknown";
  }
  switch (schema[0]) {
    case "array":
      return `Array<${typeNameAt(schema[1], depth + 1)}>`;
    case "tuple":
      return tupleName(schema[1], schema[2], depth);
    case "union":
      return schema[1].map((branch) => typeNameAt(branch, depth + 1)).join(" | ");
    case "intersection":
      return schema[1].map((branch) => typeNameAt(branch, depth + 1)).join(" & ");
    case "literal":
      return formatLiteral(schema[1]);
    case "enum":
      return schema[1].map((item) => formatLiteral(item)).join(" | ");
    case "class":
      return ctorName(schema[1]);
    case "lazy": {
      if (depth >= MAX_NAME_DEPTH) {
        return "object";
      }
      try {
        const produced: unknown = schema[1]();
        if (isThenable(produced)) {
          suppress(produced);
          return "unknown";
        }
        if (typeof produced !== "string" && !Array.isArray(produced)) {
          return "unknown";
        }
        return typeNameAt(produced as TypeSchema, depth + 1);
      } catch {
        return "object";
      }
    }
    case "object":
      return "object";
    case "record":
      return `Record<string, ${typeNameAt(schema[1], depth + 1)}>`;
    case "mapof":
      return `Map<${typeNameAt(schema[1], depth + 1)}, ${typeNameAt(schema[2], depth + 1)}>`;
    case "setof":
      return `Set<${typeNameAt(schema[1], depth + 1)}>`;
    case "optional":
    case "nullable":
      return typeNameAt(schema[1], depth + 1);
    default:
      return "unknown";
  }
}

export function typeName(schema: TypeSchema): string {
  return typeNameAt(schema, 0);
}

function labelFor(ctx: ErrorContext): string {
  const labels = ctx.labels;
  if (labels !== undefined && Object.hasOwn(labels, ctx.path)) {
    const exact = labels[ctx.path];
    if (typeof exact === "string") {
      return exact;
    }
  }
  return ctx.label;
}

function buildError(
  value: unknown,
  params: Readonly<Record<string, unknown>>,
  ctx: ErrorContext,
  key = "validation.type",
): ValidationError {
  const label = labelFor(ctx);
  const context: MessageContext = {
    rule: "type",
    key,
    field: ctx.field,
    label,
    value,
    params,
    locale: ctx.locale,
    instance: ctx.instance,
    path: ctx.path,
    ...(ctx.index === undefined ? {} : { index: ctx.index }),
  };
  return {
    field: ctx.field,
    rule: "type",
    message: resolveMessage(context, ctx.config),
    params,
    value,
    path: ctx.path,
    label,
    ...(ctx.index === undefined ? {} : { index: ctx.index }),
  };
}

function createError(
  value: unknown,
  schema: TypeSchema,
  ctx: ErrorContext,
  name?: string,
): ValidationError {
  const params: Readonly<Record<string, unknown>> = {
    type: name ?? typeName(schema),
  };
  return buildError(value, params, ctx);
}

function depthError(value: unknown, ctx: ErrorContext): ValidationError {
  return buildError(value, { type: "depth" }, ctx, "validation.depth");
}

function childContext(
  ctx: RunContext,
  path: string,
  label: string | undefined,
  index: number | undefined,
): RunContext {
  return {
    ...ctx,
    path,
    label: label ?? ctx.label,
    index,
  };
}

function cycleHit(runtime: TypeRuntime): void {
  runtime.cycleHits = (runtime.cycleHits ?? 0) + 1;
}

function enter(value: object, ctx: RunContext): boolean {
  const visiting = ctx.runtime.visiting;
  if (visiting.has(value)) {
    cycleHit(ctx.runtime);
    return false;
  }
  visiting.add(value);
  return true;
}

function isLazyActive(
  runtime: TypeRuntime,
  schema: TypeSchema,
  value: unknown,
): boolean {
  if (!Array.isArray(schema) || schema[0] !== "lazy") {
    return false;
  }
  const active = runtime.lazyActive?.get(schema);
  return active !== undefined && active.has(value);
}

function lookupSuccess(
  runtime: TypeRuntime,
  value: object,
  schema: TypeSchema,
  depth: number,
): boolean {
  const stored = runtime.successCache?.get(value)?.get(schema);
  return stored !== undefined && depth <= stored;
}

function recordSuccess(
  runtime: TypeRuntime,
  value: object,
  schema: TypeSchema,
  depth: number,
): void {
  const cache = runtime.successCache ??= new WeakMap<object, Map<TypeSchema, number>>();
  let entry = cache.get(value);
  if (entry === undefined) {
    entry = new Map<TypeSchema, number>();
    cache.set(value, entry);
  }
  const stored = entry.get(schema);
  if (stored === undefined || depth < stored) {
    entry.set(schema, depth);
  }
}

function leave(value: object, ctx: RunContext): void {
  ctx.runtime.visiting.delete(value);
}

function classFields(
  value: object,
  ctor: Function,
  runtime: TypeRuntime,
): FieldSchemaMap | null {
  const actual = constructorOf(value);
  if (actual !== null) {
    const cache = runtime.instanceFields ??= new WeakMap();
    const cached = cache.get(actual);
    const instanceSchema = cached !== undefined
      ? cached
      : readInstanceSchema(value);
    if (cached === undefined) {
      cache.set(actual, instanceSchema);
    }
    if (instanceSchema !== null) {
      return instanceSchema;
    }
  }
  const own = readClassSchema(ctor);
  return own === null ? null : own.fields;
}

function validateFields(
  owner: object,
  fields: FieldSchemaMap,
  ctx: RunContext,
  childDepth: number,
): ValidationError[] {
  const errors: ValidationError[] = [];
  if (fields === undefined || fields === null) {
    return errors;
  }
  for (const [key, fieldSchema] of Object.entries(fields)) {
    if (fieldSchema === undefined) {
      continue;
    }
    const path = `${ctx.path}.${key}`;
    errors.push(
      ...validateSchema(
        readFieldValue(owner, key),
        fieldSchema,
        childContext(ctx, path, key, undefined),
        childDepth,
      ),
    );
  }
  return errors;
}

function validateArray(
  value: readonly unknown[],
  itemSchema: TypeSchema,
  ctx: RunContext,
  depth: number,
): ValidationError[] {
  if (!enter(value, ctx)) {
    return [];
  }
  const errors: ValidationError[] = [];
  try {
    for (let index = 0; index < value.length; index += 1) {
      const path = `${ctx.path}[${index}]`;
      errors.push(
        ...validateSchema(
          value[index],
          itemSchema,
          childContext(ctx, path, undefined, index),
          depth + 1,
        ),
      );
    }
  } finally {
    leave(value, ctx);
  }
  return errors;
}

function validateMap(
  value: Map<unknown, unknown>,
  keySchema: TypeSchema,
  valueSchema: TypeSchema,
  ctx: RunContext,
  depth: number,
): ValidationError[] {
  if (!enter(value, ctx)) {
    return [];
  }
  const errors: ValidationError[] = [];
  try {
    let index = 0;
    for (const [key, entryValue] of value) {
      const keyLabel = typeof key === "string" || typeof key === "number" || typeof key === "bigint"
        ? String(key)
        : String(index);
      const path = `${ctx.path}[${keyLabel}]`;
      errors.push(
        ...validateSchema(
          entryValue,
          valueSchema,
          childContext(ctx, path, undefined, index),
          depth + 1,
        ),
      );
      errors.push(
        ...validateSchema(
          key,
          keySchema,
          childContext(ctx, `${path}.key`, "key", index),
          depth + 1,
        ),
      );
      index += 1;
    }
  } finally {
    leave(value, ctx);
  }
  return errors;
}

function validateSet(
  value: Set<unknown>,
  itemSchema: TypeSchema,
  ctx: RunContext,
  depth: number,
): ValidationError[] {
  if (!enter(value, ctx)) {
    return [];
  }
  const errors: ValidationError[] = [];
  try {
    let index = 0;
    for (const item of value) {
      const path = `${ctx.path}[${index}]`;
      errors.push(
        ...validateSchema(item, itemSchema, childContext(ctx, path, undefined, index), depth + 1),
      );
      index += 1;
    }
  } finally {
    leave(value, ctx);
  }
  return errors;
}

function isOptionalSchema(schema: TypeSchema | null | undefined): boolean {
  return Array.isArray(schema) && schema[0] === "optional";
}

function validateTuple(
  value: readonly unknown[],
  items: readonly (TypeSchema | null)[],
  rest: TypeSchema | undefined,
  schema: TypeSchema,
  ctx: RunContext,
  depth: number,
): ValidationError[] {
  let required = 0;
  for (const item of items) {
    if (item === null || item === undefined || isOptionalSchema(item)) {
      continue;
    }
    required += 1;
  }
  if (rest === undefined) {
    if (value.length < required || value.length > items.length) {
      return [createError(value, schema, ctx)];
    }
  } else if (value.length < required) {
    return [createError(value, schema, ctx)];
  }
  if (!enter(value, ctx)) {
    return [];
  }
  const errors: ValidationError[] = [];
  try {
    const limit = Math.min(items.length, value.length);
    for (let index = 0; index < limit; index += 1) {
      const itemSchema = items[index];
      if (itemSchema === null || itemSchema === undefined) {
        continue;
      }
      const path = `${ctx.path}[${index}]`;
      errors.push(
        ...validateSchema(value[index], itemSchema, childContext(ctx, path, undefined, index), depth + 1),
      );
    }
    if (rest !== undefined) {
      for (let index = items.length; index < value.length; index += 1) {
        const path = `${ctx.path}[${index}]`;
        errors.push(
          ...validateSchema(value[index], rest, childContext(ctx, path, undefined, index), depth + 1),
        );
      }
    }
  } finally {
    leave(value, ctx);
  }
  return errors;
}

function errorKey(error: ValidationError): string {
  return `${error.rule}\u0000${error.path}\u0000${String(error.index ?? "")}\u0000${String(error.params["type"] ?? "")}\u0000${error.message}`;
}

function dedupeErrors(errors: readonly ValidationError[]): ValidationError[] {
  if (errors.length <= 1) {
    return [...errors];
  }
  const seen = new Set<string>();
  const unique: ValidationError[] = [];
  for (const error of errors) {
    const key = errorKey(error);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(error);
  }
  return unique;
}

function resolveLazy(
  runtime: TypeRuntime,
  schema: readonly ["lazy", () => TypeSchema],
): LazyResolution {
  const cache = runtime.lazyResolutions ??= new WeakMap<object, LazyResolution>();
  const cached = cache.get(schema);
  if (cached !== undefined) {
    return cached;
  }
  const getSchema = schema[1];
  let resolution: LazyResolution;
  try {
    const produced: unknown = getSchema();
    if (isThenable(produced)) {
      suppressThenable(produced);
      resolution = { schema: null, name: "unknown" };
    } else if (typeof produced === "string" || Array.isArray(produced)) {
      resolution = { schema: produced as TypeSchema, name: "" };
    } else {
      resolution = { schema: null, name: "unknown" };
    }
  } catch {
    resolution = { schema: null, name: "object" };
  }
  cache.set(schema, resolution);
  return resolution;
}

function resolveClass(
  runtime: TypeRuntime,
  schema: readonly ["class", () => Function],
): Function | null {
  const cache = runtime.resolvedClasses ??= new WeakMap<object, Function | null>();
  const cached = cache.get(schema);
  if (cached !== undefined) {
    return cached;
  }
  const getCtor = schema[1];
  let ctor: Function | null;
  try {
    const produced: unknown = getCtor();
    if (isThenable(produced)) {
      suppressThenable(produced);
      ctor = null;
    } else {
      ctor = typeof produced === "function" ? produced : null;
    }
  } catch {
    ctor = null;
  }
  cache.set(schema, ctor);
  return ctor;
}

function validateClass(
  value: unknown,
  schema: readonly ["class", () => Function],
  ctx: RunContext,
  depth: number,
): ValidationError[] {
  const ctor = resolveClass(ctx.runtime, schema);
  if (ctor === null) {
    return [createError(value, schema, ctx, "object")];
  }
  const name = ctor.name.length > 0 ? ctor.name : "object";
  if (!isInstanceOfCtor(value, ctor)) {
    return [createError(value, schema, ctx, name)];
  }
  const target = value as object;
  if (ctx.nested !== undefined) {
    ctx.nested.push({ instance: target, path: ctx.path });
    return [];
  }
  const fields = classFields(target, ctor, ctx.runtime);
  if (fields === null) {
    return [];
  }
  if (!enter(target, ctx)) {
    return [];
  }
  try {
    return validateFields(target, fields, ctx, depth + 1);
  } finally {
    leave(target, ctx);
  }
}

function validateSchema(
  value: unknown,
  schema: TypeSchema,
  ctx: RunContext,
  depth: number,
): ValidationError[] {
  if (depth > MAX_DEPTH) {
    return [depthError(value, ctx)];
  }
  const target = typeof value === "object" && value !== null ? value : undefined;
  const runtime = ctx.runtime;
  if (target !== undefined) {
    // Значение уже в стеке (цикл) или lazy-ветка активна для него —
    // кеш не используем: результат получен через защиту от циклов.
    if (!runtime.visiting.has(target) && !isLazyActive(runtime, schema, value)) {
      if (lookupSuccess(runtime, target, schema, depth)) {
        return [];
      }
    }
  }
  const cyclesBefore = runtime.cycleHits ?? 0;
  const nestedMark = ctx.nested?.length ?? 0;
  const errors = validateSchemaCore(value, schema, ctx, depth);
  if (target !== undefined
    && errors.length === 0
    && (runtime.cycleHits ?? 0) === cyclesBefore
    && (ctx.nested === undefined || ctx.nested.length === nestedMark)) {
    recordSuccess(runtime, target, schema, depth);
  }
  return errors;
}

function validateSchemaCore(
  value: unknown,
  schema: TypeSchema,
  ctx: RunContext,
  depth: number,
): ValidationError[] {
  if (typeof schema === "string") {
    return matchesPrimitive(value, schema) ? [] : [createError(value, schema, ctx)];
  }
  switch (schema[0]) {
    case "optional":
      return value === undefined ? [] : validateSchema(value, schema[1], ctx, depth);
    case "nullable":
      return value === null ? [] : validateSchema(value, schema[1], ctx, depth);
    case "array": {
      const itemSchema = schema[1];
      if (!Array.isArray(value)) {
        return [createError(value, schema, ctx)];
      }
      return validateArray(value as readonly unknown[], itemSchema, ctx, depth);
    }
    case "tuple": {
      const items = schema[1];
      if (!Array.isArray(value)) {
        return [createError(value, schema, ctx)];
      }
      return validateTuple(value as readonly unknown[], items, schema[2], schema, ctx, depth);
    }
    case "lazy": {
      const resolution = resolveLazy(ctx.runtime, schema);
      const resolved = resolution.schema;
      if (resolved === null) {
        return [createError(value, schema, ctx, resolution.name)];
      }
      const lazyActive = ctx.runtime.lazyActive ??= new Map<TypeSchema, Set<unknown>>();
      const active = lazyActive.get(schema);
      if (active !== undefined && active.has(value)) {
        cycleHit(ctx.runtime);
        return [];
      }
      if (active === undefined) {
        lazyActive.set(schema, new Set<unknown>([value]));
        try {
          return validateSchema(value, resolved, ctx, depth);
        } finally {
          lazyActive.delete(schema);
        }
      }
      active.add(value);
      try {
        return validateSchema(value, resolved, ctx, depth);
      } finally {
        active.delete(value);
      }
    }
    case "union": {
      const branches = schema[1];
      for (const branch of branches) {
        const mark = ctx.nested?.length ?? 0;
        if (validateSchema(value, branch, ctx, depth).length === 0) {
          return [];
        }
        if (ctx.nested !== undefined && ctx.nested.length > mark) {
          ctx.nested.length = mark;
        }
      }
      return [createError(value, schema, ctx)];
    }
    case "intersection": {
      const errors: ValidationError[] = [];
      for (const branch of schema[1]) {
        errors.push(...validateSchema(value, branch, ctx, depth));
      }
      return dedupeErrors(errors);
    }
    case "literal":
      return Object.is(value, schema[1]) ? [] : [createError(value, schema, ctx)];
    case "enum": {
      const allowed: readonly unknown[] = schema[1];
      return allowed.includes(value) ? [] : [createError(value, schema, ctx)];
    }
    case "class":
      return validateClass(value, schema, ctx, depth);
    case "object": {
      const fields = schema[1];
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return [createError(value, schema, ctx)];
      }
      if (!enter(value, ctx)) {
        return [];
      }
      try {
        return validateFields(value, fields, ctx, depth + 1);
      } finally {
        leave(value, ctx);
      }
    }
    case "record": {
      const fieldSchema = schema[1];
      if (!isPlainObject(value)) {
        return [createError(value, schema, ctx)];
      }
      if (!enter(value, ctx)) {
        return [];
      }
      const errors: ValidationError[] = [];
      try {
        for (const [key, entryValue] of Object.entries(value)) {
          errors.push(
            ...validateSchema(
              entryValue,
              fieldSchema,
              childContext(ctx, `${ctx.path}.${key}`, key, undefined),
              depth + 1,
            ),
          );
        }
      } finally {
        leave(value, ctx);
      }
      return errors;
    }
    case "mapof": {
      if (!isInstanceOf(value, "Map")) {
        return [createError(value, schema, ctx)];
      }
      return validateMap(value as Map<unknown, unknown>, schema[1], schema[2], ctx, depth);
    }
    case "setof": {
      if (!isInstanceOf(value, "Set")) {
        return [createError(value, schema, ctx)];
      }
      return validateSet(value as Set<unknown>, schema[1], ctx, depth);
    }
    default:
      return [createError(value, schema, ctx)];
  }
}

export function validateType(
  value: unknown,
  schema: TypeSchema,
  context: TypeValidationContext,
): ValidationError | ValidationError[] | null {
  const ctx: RunContext = {
    instance: context.instance,
    field: context.field,
    label: context.label,
    path: context.path,
    config: context.config,
    labels: context.labels,
    locale: context.config.locale ?? DEFAULT_LOCALE,
    runtime: context.runtime ?? {
      visiting: context.visiting ?? new WeakSet<object>(),
    },
    nested: context.nested,
    index: undefined,
  };
  const errors = validateSchema(value, schema, ctx, 0);
  if (errors.length === 0) {
    return null;
  }
  const [first] = errors;
  if (errors.length === 1 && first !== undefined) {
    return first;
  }
  return errors;
}
