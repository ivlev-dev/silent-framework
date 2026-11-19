import { constructorOf } from "./property.js";

export const SCHEMA_SYMBOL: symbol = Symbol.for(
  "silent.validation.schema",
);

export const SCHEMA_VERSION = 1;

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
  | readonly ["tuple", readonly (TypeSchema | null)[], TypeSchema?]
  | readonly ["union", readonly TypeSchema[]]
  | readonly ["intersection", readonly TypeSchema[]]
  | readonly ["literal", string | number | boolean]
  | readonly ["enum", readonly (string | number)[]]
  | readonly ["class", () => Function]
  | readonly ["lazy", () => TypeSchema]
  | readonly ["object", Readonly<Record<string, TypeSchema>>]
  | readonly ["record", TypeSchema]
  | readonly ["mapof", TypeSchema, TypeSchema]
  | readonly ["setof", TypeSchema]
  | readonly ["optional", TypeSchema]
  | readonly ["nullable", TypeSchema];

export type FieldSchemaMap = Readonly<Record<string, TypeSchema>>;

export type ClassSchema = Readonly<{
  version?: number;
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

const MISSING: unique symbol = Symbol("silent.validation.schema.missing");

interface ClassCacheEntry {
  readonly raw: unknown;
  readonly rawFields: unknown;
  readonly rawVersion: unknown;
  readonly schema: ClassSchema | null;
}

const classCache = new WeakMap<Function, ClassCacheEntry>();

interface InstanceCacheEntry {
  readonly nodes: readonly Function[];
  readonly chain: readonly (ClassSchema | null)[];
  readonly fields: FieldSchemaMap | null;
}

const instanceCache = new WeakMap<Function, InstanceCacheEntry>();

function resolveVersion(ctor: Function, version: unknown): number | undefined {
  if (typeof version !== "number") {
    return undefined;
  }
  if (version !== SCHEMA_VERSION) {
    const name = ctor.name.length > 0 ? ctor.name : "anonymous";
    throw new Error(
      `Неподдерживаемая версия схемы ${String(version)} для класса ${name}: поддерживается версия ${SCHEMA_VERSION}`,
    );
  }
  return SCHEMA_VERSION;
}

function className(ctor: Function): string {
  return ctor.name.length > 0 ? ctor.name : "anonymous";
}

function rawSchema(ctor: Function): unknown {
  if (!Object.hasOwn(ctor, SCHEMA_SYMBOL)) {
    return MISSING;
  }
  return holder(ctor)[SCHEMA_SYMBOL];
}

function parseClassSchema(ctor: Function, own: unknown): ClassSchema | null {
  if (typeof own !== "object" || own === null) {
    return null;
  }
  const candidate = own as { readonly fields?: unknown; readonly version?: unknown };
  if (isFieldSchemaMap(candidate.fields)) {
    const version = resolveVersion(ctor, candidate.version);
    return version === undefined
      ? { fields: candidate.fields }
      : { version, fields: candidate.fields };
  }
  if (Object.hasOwn(own, "version") && typeof candidate.version === "number") {
    resolveVersion(ctor, candidate.version);
    throw new Error(
      `Неверный формат схемы для класса ${className(ctor)}: отсутствует карта fields`,
    );
  }
  return { fields: own as FieldSchemaMap };
}

function classCacheValid(cached: ClassCacheEntry, raw: unknown): boolean {
  if (cached.raw !== raw) {
    return false;
  }
  if (typeof raw !== "object" || raw === null) {
    return true;
  }
  const candidate = raw as { readonly fields?: unknown; readonly version?: unknown };
  return cached.rawFields === candidate.fields
    && cached.rawVersion === candidate.version;
}

export function readClassSchema(ctor: Function): ClassSchema | null {
  const raw = rawSchema(ctor);
  const cached = classCache.get(ctor);
  if (cached !== undefined && classCacheValid(cached, raw)) {
    return cached.schema;
  }
  const schema = raw === MISSING ? null : parseClassSchema(ctor, raw);
  const candidate = typeof raw === "object" && raw !== null
    ? raw as { readonly fields?: unknown; readonly version?: unknown }
    : undefined;
  classCache.set(ctor, {
    raw,
    rawFields: candidate?.fields,
    rawVersion: candidate?.version,
    schema,
  });
  return schema;
}

export function readInstanceSchema(instance: object): FieldSchemaMap | null {
  const ctor = constructorOf(instance);
  if (ctor === null) {
    return null;
  }
  const cached = instanceCache.get(ctor);
  if (cached !== undefined) {
    let unchanged = true;
    let current: unknown = ctor;
    let index = cached.nodes.length - 1;
    while (typeof current === "function") {
      if (index < 0 || cached.nodes[index] !== current) {
        unchanged = false;
        break;
      }
      index -= 1;
      current = Object.getPrototypeOf(current);
    }
    if (unchanged && index === -1) {
      for (let nodeIndex = 0; nodeIndex < cached.nodes.length; nodeIndex += 1) {
        const node = cached.nodes[nodeIndex];
        if (node === undefined
          || readClassSchema(node) !== cached.chain[nodeIndex]) {
          unchanged = false;
          break;
        }
      }
    } else {
      unchanged = false;
    }
    if (unchanged) {
      return cached.fields;
    }
  }
  const chain: Function[] = [];
  let current: unknown = ctor;
  while (typeof current === "function") {
    chain.push(current);
    const prototype: unknown = Object.getPrototypeOf(current);
    current = prototype;
  }
  const nodes = [...chain].reverse();
  const schemas: (ClassSchema | null)[] = [];
  for (const node of nodes) {
    schemas.push(readClassSchema(node));
  }
  let merged: Record<string, TypeSchema> | null = null;
  for (const schema of schemas) {
    if (schema === null) {
      continue;
    }
    merged ??= Object.create(null) as Record<string, TypeSchema>;
    for (const key of Object.keys(schema.fields)) {
      const descriptor = Object.getOwnPropertyDescriptor(schema.fields, key);
      if (descriptor === undefined || !("value" in descriptor)) {
        continue;
      }
      Object.defineProperty(merged, key, {
        value: descriptor.value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
  }
  instanceCache.set(ctor, { nodes, chain: schemas, fields: merged });
  return merged;
}

