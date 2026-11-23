import { ProtocolError, schemaError } from "./errors.js";
import { Reader, pathWith, type PathPart } from "./reader.js";
import { Writer } from "./writer.js";
import {
  classLabel,
  compareUtf8,
  getSchema,
  schemaRevisionValue,
  type NormalizedSchema,
  type NormalizedVariant,
} from "./schema.js";
import {
  PROTOCOL_CODEC,
  type TypeSchema,
  type WireTypeName,
} from "./types.js";

type OptionalType = readonly ["optional", TypeSchema];

function isOptionalType(type: TypeSchema): type is OptionalType {
  return Array.isArray(type) && type[0] === "optional";
}

function isArrayType(type: TypeSchema): type is readonly ["array", TypeSchema] {
  return Array.isArray(type) && type[0] === "array";
}

function isTupleType(type: TypeSchema): type is readonly ["tuple", readonly TypeSchema[]] {
  return Array.isArray(type) && type[0] === "tuple";
}

function isMapType(type: TypeSchema): type is readonly ["map", TypeSchema, TypeSchema] {
  return Array.isArray(type) && type[0] === "map";
}

function isSetType(type: TypeSchema): type is readonly ["set", TypeSchema] {
  return Array.isArray(type) && type[0] === "set";
}

function isRecordType(type: TypeSchema): type is readonly ["record", TypeSchema] {
  return Array.isArray(type) && type[0] === "record";
}

function isEnumType(type: TypeSchema): type is readonly ["enum", readonly (string | number)[]] {
  return Array.isArray(type) && type[0] === "enum";
}

function isLiteralType(type: TypeSchema): type is readonly ["literal", string | number | boolean | null] {
  return Array.isArray(type) && type[0] === "literal";
}

function isClassType(type: TypeSchema): type is readonly ["class", () => Function] {
  return Array.isArray(type) && type[0] === "class";
}

export interface ValueCodec {
  readonly encode: (
    writer: Writer,
    value: unknown,
    context: EncodeContext,
    path: string,
  ) => void;
  readonly decode: (
    reader: Reader,
    context: DecodeContext,
    path: string,
  ) => unknown;
}

export class EncodeContext {
  private maxDepth: number;
  private ancestors: object[] = [];
  private depth = -1;

  public constructor(maxDepth: number) {
    this.maxDepth = maxDepth;
  }

  public reset(maxDepth: number): void {
    this.maxDepth = maxDepth;
    this.depth = -1;
    this.ancestors.length = 0;
  }

  public enter(value: object, path: string): void {
    const ancestors = this.ancestors;
    for (let index = 0; index < ancestors.length; index += 1) {
      if (ancestors[index] === value) {
        throw new ProtocolError("cycle", "обнаружен цикл объектов", path);
      }
    }
    if (this.depth >= this.maxDepth) {
      throw new ProtocolError("depth", `превышен лимит глубины ${this.maxDepth}`, path);
    }
    this.depth += 1;
    ancestors.push(value);
  }

  public leave(_value: object): void {
    this.ancestors.pop();
    this.depth -= 1;
  }
}

export class DecodeContext {
  private maxDepth: number;
  private depth = -1;

  public constructor(maxDepth: number) {
    this.maxDepth = maxDepth;
  }

  public reset(maxDepth: number): void {
    this.maxDepth = maxDepth;
    this.depth = -1;
  }

  public enter(path: string, part?: PathPart, index?: number): void {
    if (this.depth >= this.maxDepth) {
      throw new ProtocolError(
        "depth",
        `превышен лимит глубины ${this.maxDepth}`,
        pathWith(path, part, index),
      );
    }
    this.depth += 1;
  }

  public leave(): void {
    this.depth -= 1;
  }
}

export interface StaticCodec<T extends object = object> {
  write(value: T, writer: Writer, context: EncodeContext, path: string): void;
  read(reader: Reader, context: DecodeContext, path: string): T;
}

function staticCodecFor(ctor: Function): StaticCodec | undefined {
  const candidate = (ctor as unknown as Record<symbol, unknown>)[PROTOCOL_CODEC];
  if (candidate === undefined || candidate === null) {
    return undefined;
  }
  if (typeof candidate !== "object") {
    throw schemaError("статический кодек должен быть объектом", classLabel(ctor));
  }
  const codec = candidate as Partial<StaticCodec>;
  if (typeof codec.write !== "function" || typeof codec.read !== "function") {
    throw schemaError("статический кодек требует write и read", classLabel(ctor));
  }
  return codec as StaticCodec;
}

export function writeMessage(
  ctor: Function,
  value: object,
  writer: Writer,
  context: EncodeContext,
  path: string,
): void {
  const codec = staticCodecFor(ctor);
  context.enter(value, path);
  try {
    if (codec !== undefined) {
      codec.write(value, writer, context, path);
      return;
    }
    encodeMessage(codecFor(ctor), writer, value, context, path);
  } finally {
    context.leave(value);
  }
}

export function readMessage<T extends object>(
  ctor: new () => T,
  reader: Reader,
  context: DecodeContext,
  path: string,
): T {
  const codec = staticCodecFor(ctor);
  context.enter(path);
  try {
    if (codec !== undefined) {
      return codec.read(reader, context, path) as T;
    }
    const target = new ctor();
    return decodeMessage(codecFor(ctor), reader, target, context, path) as T;
  } finally {
    context.leave();
  }
}

function valueError(message: string, path: string): ProtocolError {
  return new ProtocolError("value", message, path);
}

function rangeError(message: string, path: string): ProtocolError {
  return new ProtocolError("range", message, path);
}

function requireNumber(value: unknown, path: string): number {
  if (typeof value !== "number") {
    throw valueError(`ожидалось number, получено ${typeof value}`, path);
  }
  return value;
}

function requireBigInt(value: unknown, path: string): bigint {
  if (typeof value !== "bigint") {
    throw valueError(`ожидалось bigint, получено ${typeof value}`, path);
  }
  return value;
}

function requireInteger(
  value: unknown,
  min: number,
  max: number,
  path: string,
): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw valueError("ожидалось целое число", path);
  }
  if (value < min || value > max) {
    throw rangeError(`значение ${value} вне диапазона [${min}, ${max}]`, path);
  }
  return value;
}

const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;
const UINT32_MAX = 4294967295;
const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;
const UINT64_MAX = 2n ** 64n - 1n;

function requireInt64(value: unknown, path: string): bigint {
  const current = requireBigInt(value, path);
  if (current < INT64_MIN || current > INT64_MAX) {
    throw rangeError("значение вне int64", path);
  }
  return current;
}

function requireUint64(value: unknown, path: string): bigint {
  const current = requireBigInt(value, path);
  if (current < 0n || current > UINT64_MAX) {
    throw rangeError("значение вне uint64", path);
  }
  return current;
}

function toBigInt(value: unknown, min: bigint, max: bigint, path: string): bigint {
  let current: bigint;
  if (typeof value === "bigint") {
    current = value;
  } else if (typeof value === "number" && Number.isSafeInteger(value)) {
    current = BigInt(value);
  } else {
    throw valueError("ожидалось целое число", path);
  }
  if (current < min || current > max) {
    throw rangeError(`значение ${current.toString()} вне диапазона`, path);
  }
  return current;
}

function fromBigIntToSafeNumber(value: bigint, path: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw rangeError("значение не представимо number без потери точности", path);
  }
  return Number(value);
}

function readUint32(reader: Reader, path: string): number {
  return reader.varintNumber(path, 0xffffffff);
}

function readInt32(reader: Reader, path: string): number {
  const value = reader.varintNumber(path, 0xffffffff);
  return (value >>> 1) ^ -(value & 1);
}

function boolCodec(): ValueCodec {
  return {
    encode(writer, value, _context, path) {
      if (typeof value !== "boolean") {
        throw valueError("ожидалось boolean", path);
      }
      writer.bool(value);
    },
    decode(reader, _context, path) {
      const value = reader.byte(path);
      if (value !== 0 && value !== 1) {
        throw valueError(`bool должен быть 0 или 1, получено ${value}`, path);
      }
      return value === 1;
    },
  };
}

function int32Codec(): ValueCodec {
  return {
    encode(writer, value, _context, path) {
      writer.zigzag(requireInteger(value, INT32_MIN, INT32_MAX, path));
    },
    decode(reader, _context, path) {
      return readInt32(reader, path);
    },
  };
}

function uint32Codec(): ValueCodec {
  return {
    encode(writer, value, _context, path) {
      writer.varint(requireInteger(value, 0, UINT32_MAX, path));
    },
    decode(reader, _context, path) {
      return readUint32(reader, path);
    },
  };
}

function int64Codec(): ValueCodec {
  return {
    encode(writer, value, _context, path) {
      writer.zigzag(requireInt64(value, path));
    },
    decode(reader, _context, path) {
      return reader.zigzag(path);
    },
  };
}

function uint64Codec(output: "number" | "bigint"): ValueCodec {
  if (output === "bigint") {
    return {
      encode(writer, value, _context, path) {
        writer.varint(requireUint64(value, path));
      },
      decode(reader, _context, path) {
        return reader.varint(path);
      },
    };
  }
  return {
    encode(writer, value, _context, path) {
      writer.varint(toBigInt(value, 0n, BigInt(Number.MAX_SAFE_INTEGER), path));
    },
    decode(reader, _context, path) {
      return fromBigIntToSafeNumber(reader.varint(path), path);
    },
  };
}

function float32Codec(): ValueCodec {
  return {
    encode(writer, value, _context, path) {
      writer.float32(requireNumber(value, path));
    },
    decode(reader, _context, path) {
      return reader.float32(path);
    },
  };
}

function float64Codec(): ValueCodec {
  return {
    encode(writer, value, _context, path) {
      writer.float64(requireNumber(value, path));
    },
    decode(reader, _context, path) {
      return reader.float64(path);
    },
  };
}

function fixed32Codec(): ValueCodec {
  return {
    encode(writer, value, _context, path) {
      if (typeof value === "bigint") {
        if (value < 0n || value > BigInt(UINT32_MAX)) {
          throw rangeError("значение вне fixed32", path);
        }
        writer.fixed32(Number(value));
        return;
      }
      writer.fixed32(requireInteger(value, 0, UINT32_MAX, path));
    },
    decode(reader, _context, path) {
      return reader.fixed32(path);
    },
  };
}

function fixed64Codec(output: "number" | "bigint"): ValueCodec {
  if (output === "bigint") {
    return {
      encode(writer, value, _context, path) {
        writer.fixed64(requireUint64(value, path));
      },
      decode(reader, _context, path) {
        return reader.fixed64(path);
      },
    };
  }
  return {
    encode(writer, value, _context, path) {
      writer.fixed64(toBigInt(value, 0n, BigInt(Number.MAX_SAFE_INTEGER), path));
    },
    decode(reader, _context, path) {
      return fromBigIntToSafeNumber(reader.fixed64(path), path);
    },
  };
}

function dateValue(value: unknown, path: string): number {
  if (!(value instanceof Date)) {
    throw valueError("ожидался Date", path);
  }
  const time = value.getTime();
  if (!Number.isFinite(time)) {
    throw new ProtocolError("range", "невалидная дата", path);
  }
  if (!Number.isSafeInteger(time)) {
    throw new ProtocolError("range", "дата не представима целыми миллисекундами", path);
  }
  return time;
}

function epochMillisValue(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw valueError("ожидалось целое число epoch ms", path);
  }
  return value;
}

function dateCodec(): ValueCodec {
  return {
    encode(writer, value, _context, path) {
      const time = dateValue(value, path);
      writer.zigzag(time);
    },
    decode(reader, _context, path) {
      const time = reader.zigzagNumber(path);
      const date = new Date(time);
      if (Number.isNaN(date.getTime())) {
        throw rangeError("epoch ms вне диапазона Date", path);
      }
      return date;
    },
  };
}

function epochMillisCodec(output: "number" | "bigint" | "date"): ValueCodec {
  if (output === "bigint") {
    return {
      encode(writer, value, _context, path) {
        writer.zigzag(requireInt64(value, path));
      },
      decode(reader, _context, path) {
        return reader.zigzag(path);
      },
    };
  }
  if (output === "date") {
    return dateCodec();
  }
  return {
    encode(writer, value, _context, path) {
      const time = epochMillisValue(value, path);
      writer.zigzag(time);
    },
    decode(reader, _context, path) {
      return reader.zigzagNumber(path);
    },
  };
}

function bigintCodec(): ValueCodec {
  return int64Codec();
}

function stringCodec(): ValueCodec {
  return {
    encode(writer, value, _context, path) {
      if (typeof value !== "string") {
        throw valueError("ожидалась строка", path);
      }
      writer.string(value);
    },
    decode(reader, _context, path) {
      return reader.string(path);
    },
  };
}

function bytesValue(value: unknown, path: string): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (typeof SharedArrayBuffer !== "undefined" && value instanceof SharedArrayBuffer) {
    return new Uint8Array(value);
  }
  if (value instanceof DataView) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (ArrayBuffer.isView(value)) {
    return littleEndianBytes(value, path);
  }
  throw valueError("ожидались bytes", path);
}

function littleEndianBytes(value: ArrayBufferView, path: string): Uint8Array {
  if (value instanceof Int8Array || value instanceof Uint8ClampedArray) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof Uint8Array) {
    return value;
  }
  const size = elementSize(value);
  if (size === 0) {
    throw valueError("неподдерживаемый типизированный массив", path);
  }
  const count = value.byteLength / size;
  const output = new Uint8Array(value.byteLength);
  const view = new DataView(output.buffer);
  if (value instanceof Int16Array) {
    for (let index = 0; index < count; index += 1) view.setInt16(index * 2, value[index] ?? 0, true);
    return output;
  }
  if (value instanceof Uint16Array) {
    for (let index = 0; index < count; index += 1) view.setUint16(index * 2, value[index] ?? 0, true);
    return output;
  }
  if (value instanceof Int32Array) {
    for (let index = 0; index < count; index += 1) view.setInt32(index * 4, value[index] ?? 0, true);
    return output;
  }
  if (value instanceof Uint32Array) {
    for (let index = 0; index < count; index += 1) view.setUint32(index * 4, value[index] ?? 0, true);
    return output;
  }
  if (value instanceof Float32Array) {
    for (let index = 0; index < count; index += 1) view.setFloat32(index * 4, value[index] ?? 0, true);
    return output;
  }
  if (value instanceof Float64Array) {
    for (let index = 0; index < count; index += 1) view.setFloat64(index * 8, value[index] ?? 0, true);
    return output;
  }
  if (value instanceof BigInt64Array) {
    for (let index = 0; index < count; index += 1) view.setBigInt64(index * 8, value[index] ?? 0n, true);
    return output;
  }
  if (value instanceof BigUint64Array) {
    for (let index = 0; index < count; index += 1) view.setBigUint64(index * 8, value[index] ?? 0n, true);
    return output;
  }
  throw valueError("неподдерживаемый типизированный массив", path);
}

function elementSize(value: ArrayBufferView): number {
  if (value instanceof Int8Array || value instanceof Uint8Array || value instanceof Uint8ClampedArray) {
    return 1;
  }
  if (value instanceof Int16Array || value instanceof Uint16Array) return 2;
  if (value instanceof Int32Array || value instanceof Uint32Array || value instanceof Float32Array) return 4;
  if (value instanceof Float64Array || value instanceof BigInt64Array || value instanceof BigUint64Array) return 8;
  return 0;
}

function bytesCodec(): ValueCodec {
  return {
    encode(writer, value, _context, path) {
      writer.bytes(bytesValue(value, path));
    },
    decode(reader, _context, path) {
      return reader.bytes(path);
    },
  };
}

function literalCodec(value: string | number | boolean | null): ValueCodec {
  return {
    encode(_writer, current, _context, path) {
      if (!Object.is(current, value)) {
        throw valueError(`ожидался литерал ${String(value)}`, path);
      }
    },
    decode() {
      return value;
    },
  };
}

interface EnumCodec extends ValueCodec {
  readonly compare: ((a: unknown, b: unknown) => number) | undefined;
}

function enumCodec(values: readonly (string | number)[]): EnumCodec {
  if (values.length === 0) {
    throw schemaError("enum требует хотя бы одно значение");
  }
  const numeric = values.every((value) => typeof value === "number");
  const stringValues = values.every((value) => typeof value === "string");
  if (!numeric && !stringValues) {
    throw schemaError("enum не может смешивать строки и числа");
  }
  if (numeric) {
    const set = new Set<number>();
    for (const value of values) {
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 0x7fffffff) {
        throw schemaError("числовые значения enum должны быть uint32");
      }
      if (set.has(value)) {
        throw schemaError(`дубликат значения enum ${value}`);
      }
      set.add(value);
    }
    return {
      compare(a, b) {
        if (typeof a !== "number" || typeof b !== "number") {
          throw new ProtocolError("value", "ключ enum должен быть числом");
        }
        return a - b;
      },
      encode(writer, value, _context, path) {
        if (typeof value !== "number" || !set.has(value)) {
          throw new ProtocolError("unknown_enum", `неизвестное значение enum ${String(value)}`, path);
        }
        writer.varint(value);
      },
      decode(reader, _context, path) {
        const value = readUint32(reader, path);
        if (!set.has(value)) {
          throw new ProtocolError("unknown_enum", `неизвестное значение enum ${value}`, path);
        }
        return value;
      },
    };
  }
  const indexes = new Map<string, number>();
  values.forEach((value, index) => {
    if (typeof value === "string") indexes.set(value, index);
  });
  return {
    compare(a, b) {
      if (typeof a !== "string" || typeof b !== "string") {
        throw new ProtocolError("value", "ключ enum должен быть строкой");
      }
      return (indexes.get(a) ?? -1) - (indexes.get(b) ?? -1);
    },
    encode(writer, value, _context, path) {
      if (typeof value !== "string") {
        throw new ProtocolError("unknown_enum", "значение enum должно быть строкой", path);
      }
      const index = indexes.get(value);
      if (index === undefined) {
        throw new ProtocolError("unknown_enum", `неизвестное значение enum ${value}`, path);
      }
      writer.varint(index);
    },
    decode(reader, _context, path) {
      const index = readUint32(reader, path);
      const value = values[index];
      if (value === undefined || typeof value !== "string") {
        throw new ProtocolError("unknown_enum", `неизвестный индекс enum ${index}`, path);
      }
      return value;
    },
  };
}

export interface CompiledField {
  readonly kind: "field";
  readonly name: string;
  readonly optional: boolean;
  readonly codec: ValueCodec;
}

export interface CompiledVariant {
  readonly value: number;
  readonly field: string;
  readonly codec: ValueCodec;
  readonly unit: boolean;
}

export interface CompiledOneof {
  readonly kind: "oneof";
  readonly name: string;
  readonly variants: readonly CompiledVariant[];
  readonly byValue: ReadonlyMap<number, CompiledVariant>;
}

export type CompiledEntry = CompiledField | CompiledOneof;

export interface CompiledMessage {
  readonly ctor: Function;
  readonly entries: readonly CompiledEntry[];
  readonly optionalCount: number;
}

interface CodecCacheEntry {
  readonly schema: NormalizedSchema;
  readonly revision: number;
  readonly message: CompiledMessage;
}

const codecCache = new WeakMap<Function, CodecCacheEntry>();

function optionalInner(type: TypeSchema): TypeSchema | undefined {
  return isOptionalType(type) ? type[1] : undefined;
}

function compileWire(
  wire: WireTypeName,
  declared: TypeSchema,
  path: string,
): ValueCodec {
  const inner = optionalInner(declared) ?? declared;
  const kind = typeof inner === "string" ? inner : "";
  const isBigInt = kind === "bigint" || kind === "int64" || kind === "uint64" || kind === "fixed64";
  const output = isBigInt ? "bigint" : "number";
  switch (wire) {
    case "int32":
      return int32Codec();
    case "uint32":
      return uint32Codec();
    case "int64":
      return int64Codec();
    case "uint64":
      return uint64Codec(output);
    case "float32":
      return float32Codec();
    case "fixed32":
      return fixed32Codec();
    case "fixed64":
      return fixed64Codec(output);
    case "epochMillis":
      if (kind === "date") return dateCodec();
      return epochMillisCodec(isBigInt ? "bigint" : "number");
    default:
      throw schemaError(`неизвестный wire-тип ${String(wire)}`, path);
  }
}

function compileValue(
  type: TypeSchema,
  wire: WireTypeName | undefined,
  path: string,
): ValueCodec {
  if (wire !== undefined) {
    return compileWire(wire, type, path);
  }
  if (type === null || type === "null") {
    return literalCodec(null);
  }
  if (typeof type === "string") {
    switch (type) {
      case "bool":
        return boolCodec();
      case "int32":
        return int32Codec();
      case "uint32":
        return uint32Codec();
      case "int64":
        return int64Codec();
      case "uint64":
        return uint64Codec("bigint");
      case "float32":
        return float32Codec();
      case "float64":
        return float64Codec();
      case "fixed32":
        return fixed32Codec();
      case "fixed64":
        return fixed64Codec("bigint");
      case "string":
        return stringCodec();
      case "bytes":
        return bytesCodec();
      case "date":
        return dateCodec();
      case "bigint":
        return bigintCodec();
      case "epochMillis":
        return epochMillisCodec("number");
      default:
        throw schemaError(`неизвестный тип ${type}`, path);
    }
  }
  if (isLiteralType(type)) {
    return literalCodec(type[1]);
  }
  if (isEnumType(type)) {
    return enumCodec(type[1]);
  }
  if (isClassType(type)) {
    return classCodec(type[1]);
  }
  if (isArrayType(type)) {
    return arrayCodec(type[1]);
  }
  if (isTupleType(type)) {
    return tupleCodec(type[1], path);
  }
  if (isMapType(type)) {
    return mapCodec(type[1], type[2], path);
  }
  if (isSetType(type)) {
    return setCodec(type[1], path);
  }
  if (isRecordType(type)) {
    return recordCodec(type[1]);
  }
  if (isOptionalType(type)) {
    return compileValue(type[1], undefined, path);
  }
  throw schemaError("неизвестное описание типа", path);
}

export function codecFor(ctor: Function): CompiledMessage {
  const revision = schemaRevisionValue();
  const cached = codecCache.get(ctor);
  if (cached !== undefined && cached.revision === revision) {
    return cached.message;
  }
  const schema = getSchema(ctor);
  if (cached !== undefined && cached.schema === schema) {
    codecCache.set(ctor, { schema, revision, message: cached.message });
    return cached.message;
  }
  const message = compileMessage(ctor, schema);
  codecCache.set(ctor, { schema, revision, message });
  return message;
}

function compileMessage(ctor: Function, schema: NormalizedSchema): CompiledMessage {
  const fields: CompiledField[] = schema.fields.map((field) => ({
    kind: "field",
    name: field.name,
    optional: field.optional,
    codec: compileValue(field.type, field.wire, `${classLabel(ctor)}.${field.name}`),
  }));
  const oneofs: CompiledOneof[] = schema.oneofs.map((oneof) => {
    const variants: CompiledVariant[] = oneof.variants.map((variant) =>
      compileVariant(ctor, variant));
    return {
      kind: "oneof",
      name: oneof.name,
      variants,
      byValue: new Map(variants.map((variant) => [variant.value, variant])),
    };
  });
  const entries: CompiledEntry[] = [];
  let fieldIndex = 0;
  let oneofIndex = 0;
  while (fieldIndex < fields.length || oneofIndex < oneofs.length) {
    const field = fields[fieldIndex];
    const oneof = oneofs[oneofIndex];
    if (field === undefined) {
      if (oneof !== undefined) entries.push(oneof);
      oneofIndex += 1;
      continue;
    }
    if (oneof === undefined || compareUtf8(field.name, oneof.name) < 0) {
      entries.push(field);
      fieldIndex += 1;
      continue;
    }
    entries.push(oneof);
    oneofIndex += 1;
  }
  const optionalCount = fields.reduce((count, field) => count + (field.optional ? 1 : 0), 0);
  return { ctor, entries, optionalCount };
}

function compileVariant(ctor: Function, variant: NormalizedVariant): CompiledVariant {
  return {
    value: variant.value,
    field: variant.field,
    codec: compileValue(variant.type, variant.wire, `${classLabel(ctor)}.${variant.field}`),
    unit: isUnitType(variant.type),
  };
}

function isUnitType(type: TypeSchema): boolean {
  return type === null || type === "null" || isLiteralType(type);
}

function classCodec(getter: () => Function): ValueCodec {
  return {
    encode(writer, value, context, path) {
      if (typeof value !== "object" || value === null) {
        throw valueError("ожидался объект", path);
      }
      writeMessage(resolveConstructor(getter, path), value, writer, context, path);
    },
    decode(reader, context, path) {
      const ctor = resolveConstructor(getter, path) as new () => object;
      return readMessage(ctor, reader, context, path);
    },
  };
}

function resolveConstructor(getter: () => Function, path: string): Function {
  const ctor = getter();
  if (typeof ctor !== "function") {
    throw schemaError("class-тип должен возвращать конструктор", path);
  }
  return ctor;
}

function arrayCodec(element: TypeSchema): ValueCodec {
  const inner = optionalInner(element);
  const codec = compileValue(inner ?? element, undefined, "array");
  const optional = inner !== undefined;
  return {
    encode(writer, value, context, path) {
      if (!Array.isArray(value)) {
        throw valueError("ожидался массив", path);
      }
      context.enter(value, path);
      try {
        writer.varint(value.length);
        if (optional) {
          if (value.length <= 32) {
            let mask = 0;
            for (let index = 0; index < value.length; index += 1) {
              if (!isAbsent(value[index])) mask |= 1 << index;
            }
            writer.bitmapMask(mask, value.length);
          } else {
            writer.bitmap(value.map((item) => !isAbsent(item)));
          }
        }
        for (let index = 0; index < value.length; index += 1) {
          const item = value[index];
          if (optional && isAbsent(item)) continue;
          codec.encode(writer, item, context, `${path}[${index}]`);
        }
      } finally {
        context.leave(value);
      }
    },
    decode(reader, context, path) {
      context.enter(path);
      try {
        const count = reader.readLength(path);
        const items: unknown[] = new Array<unknown>(count);
        if (optional) {
          if (count <= 32) {
            const mask = reader.bitmapMask(count, path);
            for (let index = 0; index < count; index += 1) {
              items[index] = (mask & (1 << index)) !== 0
                ? codec.decode(reader, context, `${path}[${index}]`)
                : undefined;
            }
            return items;
          }
          const bits = reader.bitmap(count, path);
          for (let index = 0; index < count; index += 1) {
            items[index] = bits[index] === true
              ? codec.decode(reader, context, `${path}[${index}]`)
              : undefined;
          }
          return items;
        }
        for (let index = 0; index < count; index += 1) {
          items[index] = codec.decode(reader, context, `${path}[${index}]`);
        }
        return items;
      } finally {
        context.leave();
      }
    },
  };
}

function tupleCodec(elements: readonly TypeSchema[], parentPath: string): ValueCodec {
  const codecs = elements.map((element, index) => {
    const inner = optionalInner(element);
    return {
      codec: compileValue(inner ?? element, undefined, `${parentPath}[${index}]`),
      optional: inner !== undefined,
    };
  });
  const optional = codecs.some((slot) => slot.optional);
  const optionalCount = codecs.reduce((count, slot) => count + (slot.optional ? 1 : 0), 0);
  return {
    encode(writer, value, context, path) {
      if (!Array.isArray(value)) {
        throw valueError("ожидался кортеж", path);
      }
      if (value.length !== codecs.length) {
        throw valueError(`кортеж должен содержать ${codecs.length} элементов`, path);
      }
      context.enter(value, path);
      try {
        if (optional) {
          if (optionalCount <= 32) {
            let mask = 0;
            let bit = 0;
            for (let index = 0; index < codecs.length; index += 1) {
              const slot = codecs[index] as { readonly optional: boolean };
              if (!slot.optional) continue;
              if (!isAbsent(value[index])) mask |= 1 << bit;
              bit += 1;
            }
            writer.bitmapMask(mask, optionalCount);
          } else {
            const bits: boolean[] = [];
            codecs.forEach((slot, index) => {
              if (slot.optional) bits.push(!isAbsent(value[index]));
            });
            writer.bitmap(bits);
          }
        }
        codecs.forEach((slot, index) => {
          const item = value[index];
          if (slot.optional && isAbsent(item)) return;
          slot.codec.encode(writer, item, context, `${path}[${index}]`);
        });
      } finally {
        context.leave(value);
      }
    },
    decode(reader, context, path) {
      context.enter(path);
      try {
        const mask = optional && optionalCount <= 32
          ? reader.bitmapMask(optionalCount, path)
          : undefined;
        const bits = optionalCount > 32 ? reader.bitmap(optionalCount, path) : undefined;
        let bitIndex = 0;
        return codecs.map((slot, index) => {
          if (slot.optional) {
            const present = mask !== undefined
              ? (mask & (1 << bitIndex)) !== 0
              : bits?.[bitIndex] === true;
            bitIndex += 1;
            if (!present) return undefined;
          }
          return slot.codec.decode(reader, context, `${path}[${index}]`);
        });
      } finally {
        context.leave();
      }
    },
  };
}

type Comparator = (a: unknown, b: unknown) => number;

interface KeyCodec {
  readonly codec: ValueCodec;
  readonly compare: Comparator;
}

function compileKey(type: TypeSchema, path: string): KeyCodec {
  if (typeof type === "string") {
    switch (type) {
      case "string":
        return { codec: stringCodec(), compare: compareStrings };
      case "bool":
        return { codec: boolCodec(), compare: compareBooleans };
      case "int32":
      case "uint32":
      case "epochMillis":
        return { codec: compileValue(type, undefined, path), compare: compareNumbers };
      case "int64":
      case "uint64":
      case "fixed64":
      case "bigint":
        return { codec: compileValue(type, undefined, path), compare: compareBigInts };
      case "fixed32":
        return { codec: fixed32Codec(), compare: compareNumbers };
      default:
        throw schemaError(`недопустимый тип ключа map: ${type}`, path);
    }
  }
  if (isEnumType(type)) {
    const codec = enumCodec(type[1]);
    const compare = codec.compare;
    if (compare === undefined) throw schemaError("недопустимый enum-ключ", path);
    return { codec, compare };
  }
  throw schemaError("ключ map должен быть string, целым, bool или enum", path);
}

function compareStrings(a: unknown, b: unknown): number {
  return compareUtf8(String(a), String(b));
}

function compareBooleans(a: unknown, b: unknown): number {
  const left = a === true ? 1 : 0;
  const right = b === true ? 1 : 0;
  return left - right;
}

function compareNumbers(a: unknown, b: unknown): number {
  const left = typeof a === "bigint" ? Number(a) : Number(a);
  const right = typeof b === "bigint" ? Number(b) : Number(b);
  return left - right;
}

function compareBigInts(a: unknown, b: unknown): number {
  const left = typeof a === "bigint" ? a : BigInt(Number(a));
  const right = typeof b === "bigint" ? b : BigInt(Number(b));
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareByteArrays(a: Uint8Array, b: Uint8Array): number {
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    if (left !== right) return left - right;
  }
  return a.length - b.length;
}

interface MapEntry {
  readonly key: unknown;
  readonly value: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function mapEntries(value: unknown, stringKeys: boolean, path: string): MapEntry[] {
  if (value instanceof Map) {
    return [...value.entries()].map(([key, item]) => ({ key, value: item }));
  }
  if (stringKeys && isPlainObject(value)) {
    return Object.entries(value).map(([key, item]) => ({ key, value: item }));
  }
  throw valueError("ожидалась Map", path);
}

function mapCodec(keyType: TypeSchema, valueType: TypeSchema, path: string): ValueCodec {
  const key = compileKey(keyType, `${path}.key`);
  const optionalValue = optionalInner(valueType);
  const value = compileValue(optionalValue ?? valueType, undefined, `${path}.value`);
  const stringKeys = keyType === "string";
  return {
    encode(writer, current, context, path_) {
      const entries = mapEntries(current, stringKeys, path_);
      if (typeof current === "object" && current !== null) {
        context.enter(current, path_);
      }
      try {
        entries.sort((a, b) => key.compare(a.key, b.key));
        writer.varint(entries.length);
        if (optionalValue !== undefined) {
          writer.bitmap(entries.map((entry) => !isAbsent(entry.value)));
        }
        entries.forEach((entry, index) => {
          key.codec.encode(writer, entry.key, context, `${path_}.keys[${index}]`);
          if (optionalValue !== undefined && isAbsent(entry.value)) return;
          value.encode(writer, entry.value, context, `${path_}.values[${index}]`);
        });
      } finally {
        if (typeof current === "object" && current !== null) {
          context.leave(current);
        }
      }
    },
    decode(reader, context, path_) {
      context.enter(path_);
      try {
        const count = reader.readLength(path_);
        const bits = optionalValue === undefined ? undefined : reader.bitmap(count, path_);
        const result = new Map<unknown, unknown>();
        for (let index = 0; index < count; index += 1) {
          const entryKey = key.codec.decode(reader, context, `${path_}.keys[${index}]`);
          const entryValue = optionalValue !== undefined && bits?.[index] !== true
            ? undefined
            : value.decode(reader, context, `${path_}.values[${index}]`);
          result.set(entryKey, entryValue);
        }
        return result;
      } finally {
        context.leave();
      }
    },
  };
}

function recordCodec(valueType: TypeSchema): ValueCodec {
  const optionalValue = optionalInner(valueType);
  const value = compileValue(optionalValue ?? valueType, undefined, "record");
  return {
    encode(writer, current, context, path) {
      const entries = mapEntries(current, true, path);
      if (typeof current === "object" && current !== null) {
        context.enter(current, path);
      }
      try {
        entries.sort((a, b) => compareUtf8(String(a.key), String(b.key)));
        writer.varint(entries.length);
        if (optionalValue !== undefined) {
          writer.bitmap(entries.map((entry) => !isAbsent(entry.value)));
        }
        entries.forEach((entry, index) => {
          if (typeof entry.key !== "string") {
            throw valueError("ключ record должен быть строкой", `${path}.keys[${index}]`);
          }
          writer.string(entry.key);
          if (optionalValue !== undefined && isAbsent(entry.value)) return;
          value.encode(writer, entry.value, context, `${path}.${entry.key}`);
        });
      } finally {
        if (typeof current === "object" && current !== null) {
          context.leave(current);
        }
      }
    },
    decode(reader, context, path) {
      context.enter(path);
      try {
        const count = reader.readLength(path);
        const bits = optionalValue === undefined ? undefined : reader.bitmap(count, path);
        const result: Record<string, unknown> = {};
        for (let index = 0; index < count; index += 1) {
          const key = reader.string(`${path}.keys[${index}]`);
          const item = optionalValue !== undefined && bits?.[index] !== true
            ? undefined
            : value.decode(reader, context, `${path}.${key}`);
          Object.defineProperty(result, key, {
            value: item,
            enumerable: true,
            configurable: true,
            writable: true,
          });
        }
        return result;
      } finally {
        context.leave();
      }
    },
  };
}

type SetElementSort = {
  readonly compare: Comparator;
  readonly codec: ValueCodec;
};

function compileSetElement(type: TypeSchema, path: string): SetElementSort | undefined {
  if (typeof type === "string") {
    switch (type) {
      case "string":
        return { codec: stringCodec(), compare: compareStrings };
      case "bool":
        return { codec: boolCodec(), compare: compareBooleans };
      case "int32":
      case "uint32":
      case "fixed32":
      case "float64":
      case "epochMillis":
        return { codec: compileValue(type, undefined, path), compare: compareNumbers };
      case "int64":
      case "uint64":
      case "fixed64":
      case "bigint":
        return { codec: compileValue(type, undefined, path), compare: compareBigInts };
      case "date":
        return {
          codec: dateCodec(),
          compare(a, b) {
            return (a instanceof Date ? a.getTime() : 0) - (b instanceof Date ? b.getTime() : 0);
          },
        };
      default:
        return undefined;
    }
  }
  if (isEnumType(type)) {
    const codec = enumCodec(type[1]);
    const compare = codec.compare;
    return compare === undefined ? undefined : { codec, compare };
  }
  return undefined;
}

function setCodec(element: TypeSchema, path: string): ValueCodec {
  if (isOptionalType(element)) {
    throw schemaError("optional-элементы set не поддерживаются", path);
  }
  const codec = compileValue(element, undefined, path);
  const sortable = compileSetElement(element, path);
  return {
    encode(writer, value, context, path_) {
      if (!(value instanceof Set)) {
        throw valueError("ожидался Set", path_);
      }
      context.enter(value, path_);
      try {
        const items = [...value];
        if (sortable !== undefined) {
          items.sort((a, b) => sortable.compare(a, b));
          writer.varint(items.length);
          items.forEach((item, index) => {
            codec.encode(writer, item, context, `${path_}[${index}]`);
          });
          return;
        }
        const encoded = items.map((item) => {
          const buffer = new Writer(Number.MAX_SAFE_INTEGER);
          codec.encode(buffer, item, context, path_);
          return buffer.finish();
        });
        encoded.sort(compareByteArrays);
        writer.varint(encoded.length);
        for (const bytes of encoded) {
          writer.raw(bytes);
        }
      } finally {
        context.leave(value);
      }
    },
    decode(reader, context, path_) {
      context.enter(path_);
      try {
        const count = reader.readLength(path_);
        const result = new Set<unknown>();
        for (let index = 0; index < count; index += 1) {
          result.add(codec.decode(reader, context, `${path_}[${index}]`));
        }
        return result;
      } finally {
        context.leave();
      }
    },
  };
}

function isAbsent(value: unknown): boolean {
  return value === undefined || value === null;
}

type SortKey = number | string;

function compareSortKeys(left: SortKey, right: SortKey): number {
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }
  return compareUtf8(String(left), String(right));
}

export function writeArray<T>(
  items: readonly T[],
  writer: Writer,
  context: EncodeContext,
  path: string,
  writeItem: (item: T, index: number) => void,
): void {
  context.enter(items, path);
  try {
    writer.varint(items.length);
    for (let index = 0; index < items.length; index += 1) {
      writeItem(items[index] as T, index);
    }
  } finally {
    context.leave(items);
  }
}

export function writeOptionalArray<T>(
  items: readonly (T | undefined)[],
  writer: Writer,
  context: EncodeContext,
  path: string,
  writeItem: (item: T, index: number) => void,
): void {
  context.enter(items, path);
  try {
    writer.varint(items.length);
    const count = items.length;
    if (count <= 32) {
      let mask = 0;
      for (let index = 0; index < count; index += 1) {
        if (!isAbsent(items[index])) mask |= 1 << index;
      }
      writer.bitmapMask(mask, count);
    } else {
      writer.bitmap(items.map((item) => !isAbsent(item)));
    }
    for (let index = 0; index < count; index += 1) {
      const item = items[index];
      if (isAbsent(item)) continue;
      writeItem(item as T, index);
    }
  } finally {
    context.leave(items);
  }
}

export function readArray<T>(
  reader: Reader,
  context: DecodeContext,
  path: string,
  readItem: (index: number) => T,
  part?: PathPart,
): T[] {
  context.enter(path, part);
  try {
    const count = reader.readLength(path, part);
    const items: T[] = new Array<T>(count);
    for (let index = 0; index < count; index += 1) {
      items[index] = readItem(index);
    }
    return items;
  } finally {
    context.leave();
  }
}

export function readOptionalArray<T>(
  reader: Reader,
  context: DecodeContext,
  path: string,
  readItem: (index: number) => T,
  part?: PathPart,
): (T | undefined)[] {
  context.enter(path, part);
  try {
    const count = reader.readLength(path, part);
    if (count <= 32) {
      const mask = reader.bitmapMask(count, path, part);
      const items: (T | undefined)[] = new Array<T | undefined>(count);
      for (let index = 0; index < count; index += 1) {
        items[index] = (mask & (1 << index)) !== 0 ? readItem(index) : undefined;
      }
      return items;
    }
    const bits = reader.bitmap(count, path, part);
    const items: (T | undefined)[] = new Array<T | undefined>(count);
    for (let index = 0; index < count; index += 1) {
      items[index] = bits[index] === true ? readItem(index) : undefined;
    }
    return items;
  } finally {
    context.leave();
  }
}

export function writeMap<K, V>(
  map: ReadonlyMap<K, V>,
  writer: Writer,
  context: EncodeContext,
  path: string,
  sortKey: (key: K) => number | string,
  writeKey: (key: K) => void,
  writeValue: (value: V) => void,
): void {
  context.enter(map, path);
  try {
    const entries = [...map.entries()].sort((left, right) =>
      compareSortKeys(sortKey(left[0]), sortKey(right[0])));
    writer.varint(entries.length);
    for (const [key, entryValue] of entries) {
      writeKey(key);
      writeValue(entryValue);
    }
  } finally {
    context.leave(map);
  }
}

export function readMap<K, V>(
  reader: Reader,
  context: DecodeContext,
  path: string,
  readKey: () => K,
  readValue: () => V,
): Map<K, V> {
  context.enter(path);
  try {
    const count = reader.readLength(path);
    const result = new Map<K, V>();
    for (let index = 0; index < count; index += 1) {
      const key = readKey();
      result.set(key, readValue());
    }
    return result;
  } finally {
    context.leave();
  }
}

export function writeSet<T>(
  set: ReadonlySet<T>,
  writer: Writer,
  context: EncodeContext,
  path: string,
  sortKey: (value: T) => number | string,
  writeValue: (value: T) => void,
): void {
  context.enter(set, path);
  try {
    const items = [...set].sort((left, right) =>
      compareSortKeys(sortKey(left), sortKey(right)));
    writer.varint(items.length);
    for (const item of items) {
      writeValue(item);
    }
  } finally {
    context.leave(set);
  }
}

export function readSet<T>(
  reader: Reader,
  context: DecodeContext,
  path: string,
  readValue: () => T,
): Set<T> {
  context.enter(path);
  try {
    const count = reader.readLength(path);
    const result = new Set<T>();
    for (let index = 0; index < count; index += 1) {
      result.add(readValue());
    }
    return result;
  } finally {
    context.leave();
  }
}

function fieldValue(target: object, name: string): unknown {
  return (target as Record<string, unknown>)[name];
}

function assign(target: object, name: string, value: unknown, path: string): void {
  try {
    (target as Record<string, unknown>)[name] = value;
    return;
  } catch {
    if (Reflect.set(target, name, value)) return;
  }
  try {
    Object.defineProperty(target, name, {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  } catch {
    throw valueError(`не удалось записать поле ${name}`, path);
  }
}

function encodeMessage(
  message: CompiledMessage,
  writer: Writer,
  value: object,
  context: EncodeContext,
  path: string,
): void {
  if (message.optionalCount > 0) {
    if (message.optionalCount <= 32) {
      let mask = 0;
      let bit = 0;
      for (const entry of message.entries) {
        if (entry.kind !== "field" || !entry.optional) continue;
        if (!isAbsent(fieldValue(value, entry.name))) mask |= 1 << bit;
        bit += 1;
      }
      writer.bitmapMask(mask, message.optionalCount);
    } else {
      const bits: boolean[] = [];
      for (const entry of message.entries) {
        if (entry.kind === "field" && entry.optional) {
          bits.push(!isAbsent(fieldValue(value, entry.name)));
        }
      }
      writer.bitmap(bits);
    }
  }
  for (const entry of message.entries) {
    if (entry.kind === "oneof") {
      encodeOneof(entry, writer, value, context, path);
      continue;
    }
    const current = fieldValue(value, entry.name);
    if (entry.optional && isAbsent(current)) continue;
    entry.codec.encode(writer, current, context, `${path}.${entry.name}`);
  }
}

function encodeOneof(
  oneof: CompiledOneof,
  writer: Writer,
  value: object,
  context: EncodeContext,
  path: string,
): void {
  const discriminator = fieldValue(value, oneof.name);
  if (typeof discriminator !== "number" || !Number.isInteger(discriminator)) {
    throw new ProtocolError("oneof", `дискриминатор ${oneof.name} должен быть целым числом`, path);
  }
  const variant = oneof.byValue.get(discriminator);
  if (variant === undefined) {
    throw new ProtocolError(
      "unknown_enum",
      `неизвестное значение oneof ${discriminator}`,
      `${path}.${oneof.name}`,
    );
  }
  for (const candidate of oneof.variants) {
    if (candidate === variant) continue;
    if (!isAbsent(fieldValue(value, candidate.field))) {
      throw new ProtocolError(
        "oneof",
        `установлено более одного варианта oneof ${oneof.name}`,
        `${path}.${candidate.field}`,
      );
    }
  }
  const payload = fieldValue(value, variant.field);
  if (!variant.unit && isAbsent(payload)) {
    throw new ProtocolError(
      "oneof",
      `вариант ${variant.field} не имеет значения`,
      `${path}.${variant.field}`,
    );
  }
  writer.varint(discriminator);
  if (variant.unit) return;
  variant.codec.encode(writer, payload, context, `${path}.${variant.field}`);
}

function decodeMessage(
  message: CompiledMessage,
  reader: Reader,
  target: object,
  context: DecodeContext,
  path: string,
): object {
  const mask = message.optionalCount > 0 && message.optionalCount <= 32
    ? reader.bitmapMask(message.optionalCount, path)
    : undefined;
  const bits = message.optionalCount > 32
    ? reader.bitmap(message.optionalCount, path)
    : undefined;
  let optionalIndex = 0;
  for (const entry of message.entries) {
    if (entry.kind === "oneof") {
      decodeOneof(entry, reader, target, context, path);
      continue;
    }
    if (entry.optional) {
      const present = mask !== undefined
        ? (mask & (1 << optionalIndex)) !== 0
        : bits?.[optionalIndex] === true;
      optionalIndex += 1;
      if (!present) {
        assign(target, entry.name, undefined, `${path}.${entry.name}`);
        continue;
      }
    }
    const value = entry.codec.decode(reader, context, `${path}.${entry.name}`);
    assign(target, entry.name, value, `${path}.${entry.name}`);
  }
  return target;
}

function decodeOneof(
  oneof: CompiledOneof,
  reader: Reader,
  target: object,
  context: DecodeContext,
  path: string,
): void {
  const raw = reader.varintNumber(`${path}.${oneof.name}`, 0xffffffff);
  if (raw > 0x7fffffff) {
    throw new ProtocolError("unknown_enum", "значение oneof вне uint32", `${path}.${oneof.name}`);
  }
  const value = raw;
  const variant = oneof.byValue.get(value);
  if (variant === undefined) {
    throw new ProtocolError(
      "unknown_enum",
      `неизвестное значение oneof ${value}`,
      `${path}.${oneof.name}`,
    );
  }
  for (const candidate of oneof.variants) {
    assign(target, candidate.field, undefined, `${path}.${candidate.field}`);
  }
  assign(target, oneof.name, value, `${path}.${oneof.name}`);
  const payload = variant.codec.decode(reader, context, `${path}.${variant.field}`);
  assign(target, variant.field, payload, `${path}.${variant.field}`);
}

const POOL_CAPACITY_LIMIT = 64 * 1024;

let writerPool: Writer | undefined;
let encoderContextPool: EncodeContext | undefined;
let readerPool: Reader | undefined;
let decoderContextPool: DecodeContext | undefined;

export function encodeValue(
  value: object,
  maxSize: number,
  maxDepth: number,
): Uint8Array {
  const ctor = value.constructor;
  if (typeof ctor !== "function") {
    throw new ProtocolError("schema", "не удалось определить конструктор значения");
  }
  const writer = writerPool ?? new Writer(maxSize);
  writerPool = undefined;
  writer.reset(maxSize);
  const context = encoderContextPool ?? new EncodeContext(maxDepth);
  encoderContextPool = undefined;
  context.reset(maxDepth);
  try {
    writeMessage(ctor, value, writer, context, classLabel(ctor));
    return writer.finish();
  } finally {
    if (writer.capacity <= POOL_CAPACITY_LIMIT && writerPool === undefined) {
      writerPool = writer;
    }
    if (encoderContextPool === undefined) {
      encoderContextPool = context;
    }
  }
}

export function decodeValue<T extends object>(
  ctor: new (...args: never[]) => T,
  bytes: Uint8Array,
  maxSize: number,
  maxDepth: number,
  allowTrailing: boolean,
): T {
  let reader = readerPool;
  if (reader === undefined) {
    reader = new Reader(bytes, maxSize);
  } else {
    readerPool = undefined;
    reader.reset(bytes, maxSize);
  }
  const context = decoderContextPool ?? new DecodeContext(maxDepth);
  decoderContextPool = undefined;
  context.reset(maxDepth);
  try {
    const target = readMessage(ctor, reader, context, classLabel(ctor));
    if (!allowTrailing && reader.remaining > 0) {
      throw new ProtocolError(
        "trailing",
        `после сообщения осталось ${reader.remaining} байт`,
      );
    }
    return target;
  } finally {
    if (readerPool === undefined) {
      reader.release();
      readerPool = reader;
    }
    if (decoderContextPool === undefined) {
      decoderContextPool = context;
    }
  }
}
