import {
  PROTOCOL_OPTIONS,
  PROTOCOL_SCHEMA,
  SCHEMA_VERSION,
  type FieldOptions,
  type SchemaInput,
  type TypeSchema,
  type WireTypeName,
} from "./types.js";
import { schemaError } from "./errors.js";

interface RawField {
  readonly name: string;
  readonly type: TypeSchema;
  readonly optional: boolean;
}

interface RawVariant {
  readonly value: number;
  readonly field: string;
  readonly type: TypeSchema | undefined;
}

interface RawOneof {
  readonly name: string;
  readonly enum: () => object;
  readonly variants: readonly RawVariant[];
}

interface RawNodeSchema {
  readonly fields: readonly RawField[];
  readonly oneofs: readonly RawOneof[];
}

export interface NormalizedField {
  readonly name: string;
  readonly type: TypeSchema;
  readonly optional: boolean;
  readonly wire: WireTypeName | undefined;
}

export interface NormalizedVariant {
  readonly value: number;
  readonly field: string;
  readonly type: TypeSchema;
  readonly wire: WireTypeName | undefined;
}

export interface NormalizedOneof {
  readonly name: string;
  readonly enum: () => object;
  readonly variants: readonly NormalizedVariant[];
}

export interface NormalizedSchema {
  readonly fields: readonly NormalizedField[];
  readonly oneofs: readonly NormalizedOneof[];
}

const optionVersions = new WeakMap<Function, number>();

let schemaRevision = 0;

export function schemaRevisionValue(): number {
  return schemaRevision;
}

export function classLabel(ctor: Function): string {
  return ctor.name.length > 0 ? ctor.name : "anonymous";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOwn<T>(ctor: Function, symbol: symbol): T | undefined {
  if (!Object.hasOwn(ctor, symbol)) {
    return undefined;
  }
  return (ctor as unknown as Record<symbol, T>)[symbol];
}

export function ownFieldOptions(ctor: Function): ReadonlyMap<string, FieldOptions> {
  const value = readOwn<unknown>(ctor, PROTOCOL_OPTIONS);
  return value instanceof Map
    ? value as ReadonlyMap<string, FieldOptions>
    : new Map();
}

export function optionsVersion(ctor: Function): number {
  return optionVersions.get(ctor) ?? 0;
}

export function registerFieldOption(
  ctor: Function,
  field: string,
  options: FieldOptions,
): void {
  const existing = readOwn<unknown>(ctor, PROTOCOL_OPTIONS);
  let map: Map<string, FieldOptions>;
  if (existing instanceof Map) {
    map = existing as Map<string, FieldOptions>;
  } else {
    map = new Map();
    Object.defineProperty(ctor, PROTOCOL_OPTIONS, {
      value: map,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  }
  const previous = map.get(field);
  const wire = options.wire ?? previous?.wire;
  const oneof = options.oneof ?? previous?.oneof;
  if (previous !== undefined && previous.wire === wire && previous.oneof === oneof) {
    return;
  }
  map.set(field, { wire, oneof });
  optionVersions.set(ctor, optionsVersion(ctor) + 1);
  schemaRevision += 1;
}

export function defineProtocol<T extends object>(
  ctor: new (...args: never[]) => T,
  schema: SchemaInput,
): void {
  Object.defineProperty(ctor, PROTOCOL_SCHEMA, {
    value: schema,
    enumerable: false,
    configurable: true,
    writable: true,
  });
  schemaRevision += 1;
}

function isVariant(value: unknown): value is {
  readonly value: number;
  readonly field: string;
  readonly type?: unknown;
} {
  return isRecord(value) && typeof value["value"] === "number"
    && typeof value["field"] === "string";
}

function isTypeTuple(value: unknown): value is readonly [string, ...unknown[]] {
  return Array.isArray(value) && typeof value[0] === "string";
}

function parseType(value: unknown, path: string): TypeSchema {
  if (value === null) {
    return null;
  }
  if (typeof value === "string") {
    return value as TypeSchema;
  }
  if (!isTypeTuple(value)) {
    throw schemaError("неверное описание типа", path);
  }
  const kind = value[0];
  switch (kind) {
    case "literal":
      if (value.length !== 2) throw schemaError("literal требует одно значение", path);
      return value as unknown as TypeSchema;
    case "enum":
      if (value.length !== 2 || !Array.isArray(value[1])) {
        throw schemaError("enum требует список значений", path);
      }
      return value as unknown as TypeSchema;
    case "class":
      if (value.length !== 2 || typeof value[1] !== "function") {
        throw schemaError("class требует функцию-конструктор", path);
      }
      return value as unknown as TypeSchema;
    case "array":
    case "set":
    case "record":
    case "optional":
      if (value.length !== 2) throw schemaError(`${kind} требует один тип`, path);
      return value as unknown as TypeSchema;
    case "tuple":
      if (value.length !== 2 || !Array.isArray(value[1])) {
        throw schemaError("tuple требует список типов", path);
      }
      return value as unknown as TypeSchema;
    case "map":
      if (value.length !== 3) throw schemaError("map требует два типа", path);
      return value as unknown as TypeSchema;
    default:
      throw schemaError(`неизвестный тип ${String(kind)}`, path);
  }
}

function parseField(value: unknown, path: string): RawField {
  if (!isRecord(value)) throw schemaError("поле должно быть объектом", path);
  const name = value["name"];
  if (typeof name !== "string" || name.length === 0) {
    throw schemaError("имя поля должно быть непустой строкой", path);
  }
  if (!("type" in value)) throw schemaError("у поля отсутствует type", `${path}.${name}`);
  let type = parseType(value["type"], `${path}.${name}`);
  let optional = value["optional"] === true;
  if (Array.isArray(type) && type[0] === "optional") {
    type = parseType(type[1], `${path}.${name}`);
    optional = true;
  }
  return { name, type, optional };
}

function parseVariant(value: unknown, path: string): RawVariant {
  if (!isVariant(value)) {
    throw schemaError("вариант oneof требует value и field", path);
  }
  if (!Number.isInteger(value.value) || value.value < 0 || value.value > 0x7fffffff) {
    throw schemaError("значение варианта oneof вне uint32", path);
  }
  const type = value.type === undefined ? undefined : parseType(value.type, `${path}.${value.field}`);
  return { value: value.value, field: value.field, type };
}

function parseOneof(value: unknown, path: string): RawOneof {
  if (!isRecord(value)) throw schemaError("oneof должен быть объектом", path);
  const name = value["name"];
  if (typeof name !== "string" || name.length === 0) {
    throw schemaError("имя oneof должно быть непустой строкой", path);
  }
  if (typeof value["enum"] !== "function") {
    throw schemaError("oneof требует enum-функцию", `${path}.${name}`);
  }
  const variants = value["variants"];
  if (!Array.isArray(variants)) {
    throw schemaError("oneof требует список variants", `${path}.${name}`);
  }
  const parsed = variants.map((variant, index) =>
    parseVariant(variant, `${path}.${name}.variants[${index}]`));
  return {
    name,
    enum: value["enum"] as () => object,
    variants: parsed,
  };
}

function parseFieldList(value: unknown, path: string): RawField[] {
  if (Array.isArray(value)) {
    return value.map((item, index) => parseField(item, `${path}[${index}]`));
  }
  if (isRecord(value)) {
    const fields: RawField[] = [];
    for (const [name, type] of Object.entries(value)) {
      fields.push(parseField({ name, type }, `${path}.${name}`));
    }
    return fields;
  }
  throw schemaError("fields должен быть массивом или объектом", path);
}

function parseOneofList(value: unknown, path: string): RawOneof[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) {
    return value.map((item, index) => parseOneof(item, `${path}[${index}]`));
  }
  if (isRecord(value)) {
    const oneofs: RawOneof[] = [];
    for (const [name, item] of Object.entries(value)) {
      if (!isRecord(item)) throw schemaError("oneof должен быть объектом", `${path}.${name}`);
      oneofs.push(parseOneof({ ...item, name: item["name"] ?? name }, `${path}.${name}`));
    }
    return oneofs;
  }
  throw schemaError("oneofs должен быть массивом", path);
}

function parseEntryList(
  value: readonly unknown[],
  ctor: Function,
): RawNodeSchema {
  const label = classLabel(ctor);
  const fields: RawField[] = [];
  const oneofs: RawOneof[] = [];
  value.forEach((entry, index) => {
    const path = `${label}.schema[${index}]`;
    if (isRecord(entry) && entry["kind"] === "oneof") {
      oneofs.push(parseOneof(entry, path));
      return;
    }
    if (isRecord(entry) && entry["kind"] === "field") {
      fields.push(parseField(entry, path));
      return;
    }
    if (isRecord(entry) && entry["variants"] !== undefined) {
      oneofs.push(parseOneof(entry, path));
      return;
    }
    fields.push(parseField(entry, path));
  });
  return { fields, oneofs };
}

function parseRawNode(raw: unknown, ctor: Function): RawNodeSchema {
  const label = classLabel(ctor);
  if (Array.isArray(raw)) {
    return parseEntryList(raw, ctor);
  }
  if (!isRecord(raw)) {
    throw schemaError(`схема класса ${label} должна быть массивом или объектом`);
  }
  if (raw["version"] !== undefined) {
    if (raw["version"] !== SCHEMA_VERSION) {
      throw schemaError(
        `неподдерживаемая версия схемы ${String(raw["version"])} для класса ${label}: ожидается ${SCHEMA_VERSION}`,
      );
    }
  }
  if (Array.isArray(raw["entries"])) {
    return parseEntryList(raw["entries"], ctor);
  }
  if (!("fields" in raw)) {
    throw schemaError(`в схеме класса ${label} отсутствует fields`);
  }
  return {
    fields: parseFieldList(raw["fields"], `${label}.schema.fields`),
    oneofs: parseOneofList(raw["oneofs"], `${label}.schema.oneofs`),
  };
}

function assertUniqueFields(fields: readonly RawField[], ctor: Function): void {
  const names = new Set<string>();
  for (const field of fields) {
    if (names.has(field.name)) {
      throw schemaError(`дубликат поля ${field.name}`, classLabel(ctor));
    }
    names.add(field.name);
  }
}

function assertUniqueOneofs(oneofs: readonly RawOneof[], ctor: Function): void {
  const names = new Set<string>();
  for (const oneof of oneofs) {
    if (names.has(oneof.name)) {
      throw schemaError(`дубликат oneof ${oneof.name}`, classLabel(ctor));
    }
    names.add(oneof.name);
    const values = new Set<number>();
    const fields = new Set<string>();
    for (const variant of oneof.variants) {
      if (values.has(variant.value)) {
        throw schemaError(`дубликат значения ${variant.value} в oneof ${oneof.name}`, classLabel(ctor));
      }
      if (fields.has(variant.field)) {
        throw schemaError(`дубликат поля ${variant.field} в oneof ${oneof.name}`, classLabel(ctor));
      }
      values.add(variant.value);
      fields.add(variant.field);
    }
  }
}

function parseNode(raw: unknown, ctor: Function): RawNodeSchema {
  const node = parseRawNode(raw, ctor);
  assertUniqueFields(node.fields, ctor);
  assertUniqueOneofs(node.oneofs, ctor);
  return node;
}

function chainOf(ctor: Function): Function[] {
  const chain: Function[] = [];
  let current: unknown = ctor;
  while (typeof current === "function" && current !== Function.prototype) {
    chain.push(current);
    current = Object.getPrototypeOf(current);
  }
  return chain.reverse();
}

interface CacheEntry {
  readonly nodes: readonly Function[];
  readonly raws: readonly unknown[];
  readonly versions: readonly number[];
  readonly schema: NormalizedSchema;
}

const schemaCache = new WeakMap<Function, CacheEntry>();

function unwrapOptional(type: TypeSchema): TypeSchema {
  if (Array.isArray(type) && type[0] === "optional") {
    return type[1];
  }
  return type;
}

const NUMBER_TYPES = new Set<string>([
  "float64",
  "int32",
  "uint32",
  "float32",
  "fixed32",
]);

const BIGINT_TYPES = new Set<string>([
  "bigint",
  "int64",
  "uint64",
  "fixed64",
]);

function checkWire(type: TypeSchema, wire: WireTypeName, path: string): void {
  const inner = unwrapOptional(type);
  if (typeof inner !== "string") {
    throw schemaError("wire-декораторы применимы только к числовым полям", path);
  }
  if (wire === "epochMillis") {
    if (!NUMBER_TYPES.has(inner) && !BIGINT_TYPES.has(inner) && inner !== "date") {
      throw schemaError("epochMillis применим только к числовым полям и Date", path);
    }
    return;
  }
  if (wire === "int64") {
    if (!BIGINT_TYPES.has(inner)) {
      throw schemaError("int64 требует bigint, а не number", path);
    }
    return;
  }
  if (wire === "uint64" || wire === "fixed64") {
    if (!NUMBER_TYPES.has(inner) && !BIGINT_TYPES.has(inner)) {
      throw schemaError(`${wire} применим только к числовым полям`, path);
    }
    return;
  }
  if (!NUMBER_TYPES.has(inner)) {
    throw schemaError(`${wire} применим только к number-полям`, path);
  }
}

function mergeSchema(ctor: Function): NormalizedSchema {
  const nodes = chainOf(ctor);
  const raws: unknown[] = [];
  const versions: number[] = [];
  const fields = new Map<string, NormalizedField>();
  const oneofs = new Map<string, RawOneof>();
  const options = new Map<string, FieldOptions>();

  for (const node of nodes) {
    raws.push(readOwn<unknown>(node, PROTOCOL_SCHEMA));
    versions.push(optionsVersion(node));
    for (const [field, value] of ownFieldOptions(node)) {
      options.set(field, { ...options.get(field), ...value });
    }
  }

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    const raw = raws[index];
    if (node === undefined || raw === undefined) continue;
    const parsed = parseNode(raw, node);
    for (const field of parsed.fields) {
      fields.set(field.name, {
        name: field.name,
        type: field.type,
        optional: field.optional,
        wire: undefined,
      });
    }
    for (const oneof of parsed.oneofs) {
      oneofs.set(oneof.name, oneof);
    }
  }

  const fieldNames = new Set(fields.keys());
  for (const name of oneofs.keys()) {
    if (fieldNames.has(name)) {
      throw schemaError(`имя oneof ${name} совпадает с именем поля`, classLabel(ctor));
    }
  }

  const resolvedOneofs: NormalizedOneof[] = [];
  const variantFields = new Set<string>();
  for (const [name, oneof] of oneofs) {
    const variants: NormalizedVariant[] = [];
    for (const variant of oneof.variants) {
      if (variantFields.has(variant.field)) {
        throw schemaError(`поле ${variant.field} уже занято другим oneof`, classLabel(ctor));
      }
      variantFields.add(variant.field);
      const field = fields.get(variant.field);
      const type = variant.type === undefined ? field?.type : variant.type;
      if (type === undefined) {
        throw schemaError(`у варианта ${variant.field} не указан тип`, classLabel(ctor));
      }
      variants.push({
        value: variant.value,
        field: variant.field,
        type,
        wire: options.get(variant.field)?.wire,
      });
    }
    resolvedOneofs.push({ name, enum: oneof.enum, variants });
  }

  for (const name of variantFields) {
    fields.delete(name);
  }

  for (const [name, field] of fields) {
    const wire = options.get(name)?.wire;
    if (wire !== undefined) {
      checkWire(field.type, wire, `${classLabel(ctor)}.${name}`);
      fields.set(name, { ...field, wire });
    }
  }

  for (const oneof of resolvedOneofs) {
    for (const variant of oneof.variants) {
      if (variant.wire !== undefined) {
        checkWire(variant.type, variant.wire, `${classLabel(ctor)}.${variant.field}`);
      }
      const option = options.get(variant.field)?.oneof;
      if (option !== undefined && option !== variant.value) {
        throw schemaError(
          `значение oneof для ${variant.field} не совпадает со схемой`,
          classLabel(ctor),
        );
      }
    }
  }

  const sortedFields = [...fields.values()].sort((a, b) => compareUtf8(a.name, b.name));
  const sortedOneofs = [...resolvedOneofs].sort((a, b) => compareUtf8(a.name, b.name));
  return { fields: sortedFields, oneofs: sortedOneofs };
}

export function getSchema(ctor: Function): NormalizedSchema {
  const nodes = chainOf(ctor);
  const raws = nodes.map((node) => readOwn<unknown>(node, PROTOCOL_SCHEMA));
  const versions = nodes.map((node) => optionsVersion(node));
  const cached = schemaCache.get(ctor);
  if (
    cached !== undefined
    && cached.nodes.length === nodes.length
    && cached.nodes.every((node, index) => node === nodes[index])
    && cached.raws.every((raw, index) => raw === raws[index])
    && cached.versions.every((version, index) => version === versions[index])
  ) {
    return cached.schema;
  }
  const hasSchema = raws.some((raw) => raw !== undefined);
  if (!hasSchema) {
    throw schemaError(
      `для класса ${classLabel(ctor)} не задана схема: используйте defineProtocol или плагин`,
    );
  }
  const schema = mergeSchema(ctor);
  schemaCache.set(ctor, { nodes, raws, versions, schema });
  return schema;
}

export function compareUtf8(a: string, b: string): number {
  if (a === b) return 0;
  let left = 0;
  let right = 0;
  while (left < a.length && right < b.length) {
    const leftCode = a.codePointAt(left);
    const rightCode = b.codePointAt(right);
    if (leftCode === undefined) return -1;
    if (rightCode === undefined) return 1;
    if (leftCode !== rightCode) {
      if ((leftCode >= 0xd800 && leftCode <= 0xdfff)
        || (rightCode >= 0xd800 && rightCode <= 0xdfff)) {
        return compareBytes(encodeUtf8(a), encodeUtf8(b));
      }
      return leftCode < rightCode ? -1 : 1;
    }
    left += leftCode > 0xffff ? 2 : 1;
    right += rightCode > 0xffff ? 2 : 1;
  }
  return a.length - left < b.length - right ? -1 : 1;
}

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const l = left[index] ?? 0;
    const r = right[index] ?? 0;
    if (l !== r) return l < r ? -1 : 1;
  }
  return left.length < right.length ? -1 : 1;
}

const utf8Encoder = new TextEncoder();

export function encodeUtf8(value: string): Uint8Array {
  return utf8Encoder.encode(value);
}
