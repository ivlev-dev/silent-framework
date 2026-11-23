import { ProtocolError, schemaError } from "./errors.js";
import { decodeValue, encodeValue } from "./codec.js";
import {
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_SIZE,
  type DecodeOptions,
  type EncodeOptions,
} from "./types.js";
import { runValidation } from "./validation.js";

export { ProtocolError } from "./errors.js";
export type { ProtocolErrorCode } from "./errors.js";
export {
  defineProtocol,
  getSchema,
  registerFieldOption,
  compareUtf8,
} from "./schema.js";
export type {
  NormalizedField,
  NormalizedOneof,
  NormalizedSchema,
  NormalizedVariant,
} from "./schema.js";
export {
  OneOf,
  Int32,
  Uint32,
  Int64,
  Uint64,
  Float32,
  Fixed32,
  Fixed64,
  EpochMillis,
} from "./decorators.js";
export type { ProtocolAccessorDecorator } from "./decorators.js";
export { VALIDATION_HOOK } from "./validation.js";
export {
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_SIZE,
  PROTOCOL_OPTIONS,
  PROTOCOL_SCHEMA,
  SCHEMA_VERSION,
} from "./types.js";
export type {
  DecodeOptions,
  EncodeOptions,
  FieldEntry,
  FieldOptions,
  FieldSchema,
  LiteralValue,
  OneofEntry,
  OneofSchema,
  OneofDefinition,
  PrimitiveType,
  ProtocolConstructor,
  Schema,
  SchemaDefinition,
  SchemaEntry,
  SchemaInput,
  SchemaObject,
  TypeSchema,
  ValidateHook,
  ValidateResult,
  Variant,
  VariantDefinition,
  WireTypeName,
} from "./types.js";

export class ProtocolModel {}

function positiveLimit(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value <= 0) {
    throw schemaError(`${name} должен быть положительным числом`);
  }
  return Math.floor(value);
}

export function encode(value: object, options: EncodeOptions = {}): Uint8Array {
  if (typeof value !== "object" || value === null) {
    throw new ProtocolError("value", "encode ожидает объект");
  }
  const maxSize = positiveLimit(options.maxSize, DEFAULT_MAX_SIZE, "maxSize");
  const maxDepth = positiveLimit(options.maxDepth, DEFAULT_MAX_DEPTH, "maxDepth");
  runValidation(value, options.validate);
  return encodeValue(value, maxSize, maxDepth);
}

export function decode<T extends object>(
  ctor: new (...args: never[]) => T,
  bytes: Uint8Array,
  options: DecodeOptions = {},
): T {
  if (!(bytes instanceof Uint8Array)) {
    throw new ProtocolError("value", "decode ожидает Uint8Array");
  }
  const maxSize = positiveLimit(options.maxSize, DEFAULT_MAX_SIZE, "maxSize");
  const maxDepth = positiveLimit(options.maxDepth, DEFAULT_MAX_DEPTH, "maxDepth");
  const value = decodeValue(ctor, bytes, maxSize, maxDepth, options.allowTrailing === true);
  runValidation(value, options.validate);
  return value;
}
