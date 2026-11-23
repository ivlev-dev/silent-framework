import { ProtocolError } from "./errors.js";

const INITIAL_CAPACITY = 128;

const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const ZIGZAG_LIMIT = Math.floor(Number.MAX_SAFE_INTEGER / 2);
const ZIGZAG_LIMIT_BIGINT = BigInt(ZIGZAG_LIMIT);

const utf8Encoder = new TextEncoder();
let utf8Scratch = new Uint8Array(256);

function encodeUtf8(value: string): number {
  const needed = value.length * 3;
  if (needed > utf8Scratch.length) {
    utf8Scratch = new Uint8Array(needed);
  }
  return utf8Encoder.encodeInto(value, utf8Scratch).written;
}

export class Writer {
  private buffer: Uint8Array;
  private view: DataView;
  private length = 0;
  private maxSize: number;

  public constructor(maxSize: number) {
    this.maxSize = maxSize;
    const capacity = Math.min(INITIAL_CAPACITY, maxSize);
    this.buffer = new Uint8Array(capacity);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, capacity);
  }

  public get size(): number {
    return this.length;
  }

  public get capacity(): number {
    return this.buffer.length;
  }

  public reset(maxSize: number): void {
    this.maxSize = maxSize;
    this.length = 0;
  }

  private ensure(extra: number): void {
    const needed = this.length + extra;
    if (needed > this.maxSize) {
      throw new ProtocolError("size", `сообщение превышает лимит ${this.maxSize} байт`);
    }
    if (needed <= this.buffer.length) return;
    let capacity = this.buffer.length === 0 ? INITIAL_CAPACITY : this.buffer.length;
    while (capacity < needed) {
      capacity *= 2;
    }
    if (capacity > this.maxSize) capacity = this.maxSize;
    const next = new Uint8Array(capacity);
    next.set(this.buffer.subarray(0, this.length));
    this.buffer = next;
    this.view = new DataView(next.buffer, next.byteOffset, capacity);
  }

  public byte(value: number): void {
    this.ensure(1);
    this.buffer[this.length] = value;
    this.length += 1;
  }

  public bool(value: boolean): void {
    this.ensure(1);
    this.buffer[this.length] = value ? 1 : 0;
    this.length += 1;
  }

  private varintUnsafe(value: number): void {
    this.ensure(10);
    const buffer = this.buffer;
    let length = this.length;
    let current = value;
    while (current >= 0x80) {
      buffer[length] = (current & 0x7f) | 0x80;
      length += 1;
      current = current < 0x100000000 ? current >>> 7 : Math.floor(current / 128);
    }
    buffer[length] = current;
    this.length = length + 1;
  }

  public varint(value: number | bigint): void {
    if (typeof value === "number") {
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new ProtocolError("range", "varint требует неотрицательное безопасное целое");
      }
      this.varintUnsafe(value);
      return;
    }
    if (value < 0n) {
      throw new ProtocolError("range", "varint не может быть отрицательным");
    }
    if (value <= MAX_SAFE_BIGINT) {
      this.varintUnsafe(Number(value));
      return;
    }
    this.ensure(10);
    const buffer = this.buffer;
    let length = this.length;
    let current = value;
    while (current >= 0x80n) {
      buffer[length] = Number(current & 0x7fn) | 0x80;
      length += 1;
      current >>= 7n;
    }
    buffer[length] = Number(current);
    this.length = length + 1;
  }

  public zigzag(value: number | bigint): void {
    if (typeof value === "number") {
      if (Number.isSafeInteger(value) && value <= ZIGZAG_LIMIT && value >= -ZIGZAG_LIMIT) {
        this.varintUnsafe(value >= 0 ? value * 2 : -value * 2 - 1);
        return;
      }
    } else if (value >= -ZIGZAG_LIMIT_BIGINT && value <= ZIGZAG_LIMIT_BIGINT) {
      const current = Number(value);
      this.varintUnsafe(current >= 0 ? current * 2 : -current * 2 - 1);
      return;
    }
    const current = typeof value === "bigint" ? value : BigInt(value);
    const encoded = current >= 0n ? current << 1n : ((-current) << 1n) - 1n;
    this.varint(encoded);
  }

  public fixed32(value: number): void {
    this.ensure(4);
    this.view.setUint32(this.length, value, true);
    this.length += 4;
  }

  public fixed64(value: bigint): void {
    this.ensure(8);
    this.view.setBigUint64(this.length, BigInt.asUintN(64, value), true);
    this.length += 8;
  }

  public float32(value: number): void {
    this.ensure(4);
    this.view.setFloat32(this.length, value, true);
    this.length += 4;
  }

  public float64(value: number): void {
    this.ensure(8);
    this.view.setFloat64(this.length, value, true);
    this.length += 8;
  }

  public raw(bytes: Uint8Array): void {
    this.ensure(bytes.length);
    this.buffer.set(bytes, this.length);
    this.length += bytes.length;
  }

  public bytes(value: Uint8Array): void {
    this.varintUnsafe(value.length);
    this.raw(value);
  }

  public string(value: string): void {
    const length = value.length;
    if (length > 0xfffffff) {
      this.bytes(utf8Encoder.encode(value));
      return;
    }
    const start = this.length;
    this.varintUnsafe(length);
    const dataStart = this.length;
    this.ensure(length);
    const buffer = this.buffer;
    for (let index = 0; index < length; index += 1) {
      const code = value.charCodeAt(index);
      if (code > 0x7f) {
        this.length = start;
        if (length <= 21845) {
          const written = encodeUtf8(value);
          this.varintUnsafe(written);
          this.ensure(written);
          const target = this.buffer;
          const offset = this.length;
          for (let byte = 0; byte < written; byte += 1) {
            target[offset + byte] = utf8Scratch[byte] ?? 0;
          }
          this.length = offset + written;
          return;
        }
        this.bytes(utf8Encoder.encode(value));
        return;
      }
      buffer[dataStart + index] = code;
    }
    this.length = dataStart + length;
  }

  public bitmap(bits: readonly boolean[]): void {
    const length = (bits.length + 7) >> 3;
    this.ensure(length);
    const buffer = this.buffer;
    const offset = this.length;
    for (let index = 0; index < length; index += 1) {
      buffer[offset + index] = 0;
    }
    for (let index = 0; index < bits.length; index += 1) {
      if (bits[index] !== true) continue;
      const byteIndex = offset + (index >> 3);
      buffer[byteIndex] = (buffer[byteIndex] ?? 0) | (1 << (index & 7));
    }
    this.length = offset + length;
  }

  public bitmapMask(mask: number, count: number): void {
    if (count < 0 || count > 32 || !Number.isInteger(count)) {
      throw new ProtocolError("value", "bitmapMask поддерживает от 0 до 32 бит");
    }
    const length = (count + 7) >> 3;
    if (length === 0) return;
    this.ensure(length);
    const buffer = this.buffer;
    const offset = this.length;
    let current = mask;
    for (let index = 0; index < length; index += 1) {
      buffer[offset + index] = current & 0xff;
      current >>>= 8;
    }
    this.length = offset + length;
  }

  public finish(): Uint8Array {
    return this.buffer.slice(0, this.length);
  }
}
