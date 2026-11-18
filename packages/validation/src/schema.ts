export const SCHEMA_SYMBOL: symbol = Symbol.for(
  "silent.validation.schema",
);

export type TypeSchema =
  | "string"
  | "number"
  | "boolean"
  | "bigint"
  | "symbol"
  | "object"
  | "function"
  | "undefined"
  | "null"
  | "void"
  | "never"
  | "date"
  | "regexp"
  | "map"
  | "set"
  | "weakmap"
  | "weakset"
  | "promise"
  | "error"
  | "arraybuffer"
  | "sharedarraybuffer"
  | "dataview"
  | "url"
  | "urlsearchparams"
  | "iterable"
  | "asynciterable"
  | "iterator"
  | "asynciterator"
  | "int8array"
  | "uint8array"
  | "uint8clampedarray"
  | "int16array"
  | "uint16array"
  | "int32array"
  | "uint32array"
  | "float32array"
  | "float64array"
  | "bigint64array"
  | "biguint64array"
  | readonly ["array", TypeSchema]
  | readonly ["tuple", readonly (TypeSchema | null)[]]
  | readonly ["union", readonly TypeSchema[]]
  | readonly ["intersection", readonly TypeSchema[]]
  | readonly ["literal", string | number | boolean]
  | readonly ["enum", readonly (string | number)[]]
  | readonly ["class", () => Function]
  | readonly ["object", Readonly<Record<string, TypeSchema>>]
  | readonly ["record", TypeSchema]
  | readonly ["mapof", TypeSchema, TypeSchema]
  | readonly ["setof", TypeSchema]
  | readonly ["optional", TypeSchema]
  | readonly ["nullable", TypeSchema];

export type FieldSchemaMap = Readonly<Record<string, TypeSchema>>;

export type ClassSchema = Readonly<{
  fields: FieldSchemaMap;
}>;

interface SchemaHolder {
  readonly [key: symbol]: ClassSchema | undefined;
}

function holder(value: object): SchemaHolder {
  return value as SchemaHolder;
}

function isFieldSchemaMap(value: unknown): value is FieldSchemaMap {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readClassSchema(ctor: Function): ClassSchema | null {
  const own: unknown = holder(ctor)[SCHEMA_SYMBOL];
  if (typeof own !== "object" || own === null) {
    return null;
  }
  const candidate = own as { readonly fields?: unknown };
  if (isFieldSchemaMap(candidate.fields)) {
    return { fields: candidate.fields };
  }
  return { fields: own as FieldSchemaMap };
}

export function readInstanceSchema(instance: object): FieldSchemaMap | null {
  const ctor: unknown = instance.constructor;
  if (typeof ctor !== "function") {
    return null;
  }
  const chain: Function[] = [];
  let current: unknown = ctor;
  while (typeof current === "function") {
    chain.push(current);
    const prototype: unknown = Object.getPrototypeOf(current);
    current = prototype;
  }
  let merged: Record<string, TypeSchema> | null = null;
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const schema = readClassSchema(chain[index]!);
    if (schema === null) {
      continue;
    }
    merged ??= {};
    Object.assign(merged, schema.fields);
  }
  return merged;
}
