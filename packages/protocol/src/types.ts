export const PROTOCOL_SCHEMA: symbol = Symbol.for("silent.protocol.schema");

export const PROTOCOL_OPTIONS: symbol = Symbol.for("silent.protocol.options");

export const PROTOCOL_CODEC: unique symbol = Symbol.for("silent.protocol.codec");

export const SCHEMA_VERSION = 1;

export const DEFAULT_MAX_DEPTH = 256;

export const DEFAULT_MAX_SIZE = 64 * 1024 * 1024;

export type PrimitiveType =
  | "bool"
  | "int32"
  | "uint32"
  | "int64"
  | "uint64"
  | "float32"
  | "float64"
  | "fixed32"
  | "fixed64"
  | "string"
  | "bytes"
  | "date"
  | "bigint"
  | "epochMillis"
  | "null";

export type LiteralValue = string | number | boolean | null;

export type TypeSchema =
  | PrimitiveType
  | readonly ["literal", LiteralValue]
  | readonly ["enum", readonly (string | number)[]]
  | readonly ["class", () => Function]
  | readonly ["array", TypeSchema]
  | readonly ["tuple", readonly TypeSchema[]]
  | readonly ["map", TypeSchema, TypeSchema]
  | readonly ["set", TypeSchema]
  | readonly ["record", TypeSchema]
  | readonly ["optional", TypeSchema]
  | null;

export interface FieldSchema {
  readonly name: string;
  readonly type: TypeSchema;
  readonly optional?: boolean | undefined;
}

export interface Variant {
  readonly value: number;
  readonly field: string;
  readonly type: TypeSchema;
}

export interface OneofSchema {
  readonly name: string;
  readonly enum: () => object;
  readonly variants: readonly Variant[];
}

export type FieldEntry = FieldSchema & { readonly kind: "field" };
export type OneofEntry = OneofSchema & { readonly kind: "oneof" };

export type SchemaEntry = FieldEntry | OneofEntry;

export interface SchemaObject {
  readonly version?: number | undefined;
  readonly fields: readonly FieldSchema[] | Readonly<Record<string, TypeSchema>>;
  readonly oneofs?: readonly OneofSchema[] | undefined;
}

export type Schema = readonly SchemaEntry[] | SchemaObject;

export interface VariantDefinition {
  readonly value: number;
  readonly field: string;
  readonly type?: TypeSchema | undefined;
}

export interface OneofDefinition {
  readonly name: string;
  readonly enum: () => object;
  readonly variants: readonly VariantDefinition[];
}

export interface SchemaDefinition {
  readonly version?: number | undefined;
  readonly fields: readonly FieldSchema[] | Readonly<Record<string, TypeSchema>>;
  readonly oneofs?: readonly OneofDefinition[] | undefined;
}

export type SchemaInput = readonly SchemaEntry[] | SchemaDefinition;

export type ValidateResult =
  | boolean
  | { readonly valid: boolean; readonly errors?: readonly unknown[] | undefined };

export type ValidateHook = (value: object) => ValidateResult;

export interface EncodeOptions {
  readonly validate?: boolean | ValidateHook | undefined;
  readonly maxSize?: number | undefined;
  readonly maxDepth?: number | undefined;
}

export interface DecodeOptions {
  readonly validate?: boolean | ValidateHook | undefined;
  readonly maxSize?: number | undefined;
  readonly maxDepth?: number | undefined;
  readonly allowTrailing?: boolean | undefined;
}

export type ProtocolConstructor<T extends object = object> =
  new (...args: never[]) => T;

export type WireTypeName =
  | "int32"
  | "uint32"
  | "int64"
  | "uint64"
  | "float32"
  | "fixed32"
  | "fixed64"
  | "epochMillis";

export interface FieldOptions {
  readonly wire?: WireTypeName | undefined;
  readonly oneof?: number | undefined;
}
