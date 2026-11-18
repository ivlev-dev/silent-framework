import { DEFAULT_LOCALE, resolveMessage } from "./messages.js";
import { readClassSchema, readInstanceSchema } from "./schema.js";
import type { FieldSchemaMap, TypeSchema } from "./schema.js";
import type {
  MessageContext,
  ValidationConfig,
  ValidationError,
} from "./types.js";

export interface TypeValidationContext {
  readonly instance: object;
  readonly field: string;
  readonly label: string;
  readonly path: string;
  readonly config: ValidationConfig;
  readonly visiting?: WeakSet<object>;
}

interface RunContext {
  readonly instance: object;
  readonly field: string;
  readonly label: string;
  readonly path: string;
  readonly config: ValidationConfig;
  readonly locale: string;
  readonly visiting: WeakSet<object>;
  readonly index: number | undefined;
}

type InstanceCtor = new (...args: never[]) => unknown;

const MAX_DEPTH = 256;

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
  return value instanceof (ctor as InstanceCtor);
}

function isThenable(value: unknown): boolean {
  if (typeof value !== "object" && typeof value !== "function") {
    return false;
  }
  if (value === null) {
    return false;
  }
  return typeof (value as { then?: unknown }).then === "function";
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

function formatLiteral(value: string | number | boolean): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

function ctorName(getCtor: () => Function): string {
  try {
    const ctor = getCtor();
    return typeof ctor === "function" && ctor.name.length > 0 ? ctor.name : "object";
  } catch {
    return "object";
  }
}

function tupleName(items: readonly (TypeSchema | null)[]): string {
  const parts = items.map((item) => (item === null ? "?" : typeName(item)));
  return `[${parts.join(", ")}]`;
}

export function typeName(schema: TypeSchema): string {
  if (typeof schema === "string") {
    return PRIMITIVE_NAMES[schema] ?? schema;
  }
  switch (schema[0]) {
    case "array":
      return `Array<${typeName(schema[1])}>`;
    case "tuple":
      return tupleName(schema[1]);
    case "union":
      return schema[1].map((branch) => typeName(branch)).join(" | ");
    case "intersection":
      return schema[1].map((branch) => typeName(branch)).join(" & ");
    case "literal":
      return formatLiteral(schema[1]);
    case "enum":
      return schema[1].map((item) => formatLiteral(item)).join(" | ");
    case "class":
      return ctorName(schema[1]);
    case "object":
      return "object";
    case "record":
      return `Record<string, ${typeName(schema[1])}>`;
    case "mapof":
      return `Map<${typeName(schema[1])}, ${typeName(schema[2])}>`;
    case "setof":
      return `Set<${typeName(schema[1])}>`;
    case "optional":
    case "nullable":
      return typeName(schema[1]);
    default:
      return "unknown";
  }
}

function messageContext(
  value: unknown,
  schema: TypeSchema,
  ctx: RunContext,
): MessageContext {
  const params: Readonly<Record<string, unknown>> = { type: typeName(schema) };
  return {
    rule: "type",
    key: "validation.type",
    field: ctx.field,
    label: ctx.label,
    value,
    params,
    locale: ctx.locale,
    instance: ctx.instance,
    path: ctx.path,
    ...(ctx.index === undefined ? {} : { index: ctx.index }),
  };
}

function createError(
  value: unknown,
  schema: TypeSchema,
  ctx: RunContext,
): ValidationError {
  const context = messageContext(value, schema, ctx);
  return {
    field: ctx.field,
    rule: "type",
    message: resolveMessage(context, ctx.config),
    params: context.params,
    value,
    path: ctx.path,
    label: ctx.label,
    ...(ctx.index === undefined ? {} : { index: ctx.index }),
  };
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

function enter(value: object, ctx: RunContext): boolean {
  if (ctx.visiting.has(value)) {
    return false;
  }
  ctx.visiting.add(value);
  return true;
}

function leave(value: object, ctx: RunContext): void {
  ctx.visiting.delete(value);
}

function readProp(target: object, key: string): unknown {
  return (target as Record<string, unknown>)[key];
}

function classFields(value: object, ctor: Function): FieldSchemaMap | null {
  const instanceSchema = readInstanceSchema(value);
  if (instanceSchema !== null) {
    return instanceSchema;
  }
  const own = readClassSchema(ctor);
  return own === null ? null : own.fields;
}

function validateFields(
  owner: object,
  fields: FieldSchemaMap,
  ctx: RunContext,
  depth: number,
): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const [key, fieldSchema] of Object.entries(fields)) {
    const path = `${ctx.path}.${key}`;
    errors.push(
      ...validateSchema(
        readProp(owner, key),
        fieldSchema,
        childContext(ctx, path, key, undefined),
        depth + 1,
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

function validateTuple(
  value: readonly unknown[],
  items: readonly (TypeSchema | null)[],
  schema: TypeSchema,
  ctx: RunContext,
  depth: number,
): ValidationError[] {
  const required = items.filter((item) => item !== null).length;
  if (value.length < required || value.length > items.length) {
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
  } finally {
    leave(value, ctx);
  }
  return errors;
}

function validateSchema(
  value: unknown,
  schema: TypeSchema,
  ctx: RunContext,
  depth: number,
): ValidationError[] {
  if (depth > MAX_DEPTH) {
    return [];
  }
  if (typeof schema === "string") {
    return matchesPrimitive(value, schema) ? [] : [createError(value, schema, ctx)];
  }
  switch (schema[0]) {
    case "optional":
      return value === undefined ? [] : validateSchema(value, schema[1], ctx, depth + 1);
    case "nullable":
      return value === null ? [] : validateSchema(value, schema[1], ctx, depth + 1);
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
      return validateTuple(value as readonly unknown[], items, schema, ctx, depth);
    }
    case "union": {
      const branches = schema[1];
      for (const branch of branches) {
        if (validateSchema(value, branch, ctx, depth + 1).length === 0) {
          return [];
        }
      }
      return [createError(value, schema, ctx)];
    }
    case "intersection": {
      const errors: ValidationError[] = [];
      for (const branch of schema[1]) {
        errors.push(...validateSchema(value, branch, ctx, depth + 1));
      }
      return errors;
    }
    case "literal":
      return Object.is(value, schema[1]) ? [] : [createError(value, schema, ctx)];
    case "enum": {
      const allowed: readonly unknown[] = schema[1];
      return allowed.includes(value) ? [] : [createError(value, schema, ctx)];
    }
    case "class": {
      const getCtor = schema[1];
      let ctor: Function | undefined;
      try {
        ctor = getCtor();
      } catch {
        ctor = undefined;
      }
      if (ctor === undefined || !isInstanceOfCtor(value, ctor)) {
        return [createError(value, schema, ctx)];
      }
      const target = value as object;
      const fields = classFields(target, ctor);
      if (fields === null || depth + 1 > MAX_DEPTH) {
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
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
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
    locale: context.config.locale ?? DEFAULT_LOCALE,
    visiting: context.visiting ?? new WeakSet<object>(),
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
