import { ProtocolError } from "./errors.js";

const INITIAL_CAPACITY = 64;

const utf8Encoder = new TextEncoder();

const scratchBuffer = new ArrayBuffer(8);
const scratchView = new DataView(scratchBuffer);
const scratchBytes = new Uint8Array(scratchBuffer);

export class Writer {
  private buffer: Uint8Array;
  private length = 0;
  private readonly maxSize: number;

  public constructor(maxSize: number) {
    this.maxSize = maxSize;
    this.buffer = new Uint8Array(Math.min(INITIAL_CAPACITY, maxSize));
  }

  public get size(): number {
    return this.length;
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
  }

  public byte(value: number): void {
    this.ensure(1);
    this.buffer[this.length] = value;
    this.length += 1;
  }

  public bool(value: boolean): void {
    this.byte(value ? 1 : 0);
  }

  public varint(value: number | bigint): void {
    if (typeof value === "number") {
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new ProtocolError("range", "varint требует неотрицательное безопасное целое");
      }
      this.ensure(10);
      let current = value;
      while (current >= 0x80) {
        this.buffer[this.length] = (current % 0x80) | 0x80;
        this.length += 1;
        current = Math.floor(current / 0x80);
      }
      this.buffer[this.length] = current;
      this.length += 1;
      return;
    }
    let current = value;
    if (current < 0n) {
      throw new ProtocolError("range", "varint не может быть отрицательным");
    }
    this.ensure(10);
    while (current >= 0x80n) {
      this.buffer[this.length] = Number(current & 0x7fn) | 0x80;
      this.length += 1;
      current >>= 7n;
    }
    this.buffer[this.length] = Number(current);
    this.length += 1;
  }

  public zigzag(value: number | bigint): void {
    if (typeof value === "number") {
      const limit = Number.MAX_SAFE_INTEGER / 2;
      if (Number.isSafeInteger(value) && value <= limit && value >= -limit) {
        this.varint(value >= 0 ? value * 2 : -value * 2 - 1);
        return;
      }
    }
    const current = typeof value === "bigint" ? value : BigInt(value);
    const encoded = current >= 0n ? current << 1n : ((-current) << 1n) - 1n;
    this.varint(encoded);
  }

  public fixed32(value: number): void {
    this.ensure(4);
    this.buffer[this.length] = value & 0xff;
    this.buffer[this.length + 1] = (value >>> 8) & 0xff;
    this.buffer[this.length + 2] = (value >>> 16) & 0xff;
    this.buffer[this.length + 3] = (value >>> 24) & 0xff;
    this.length += 4;
  }

  public fixed64(value: bigint): void {
    this.ensure(8);
    let current = value;
    for (let index = 0; index < 8; index += 1) {
      this.buffer[this.length + index] = Number(current & 0xffn);
      current >>= 8n;
    }
    this.length += 8;
  }

  public float32(value: number): void {
    this.ensure(4);
    scratchView.setFloat32(0, value, true);
    this.buffer.set(scratchBytes.subarray(0, 4), this.length);
    this.length += 4;
  }

  public float64(value: number): void {
    this.ensure(8);
    scratchView.setFloat64(0, value, true);
    this.buffer.set(scratchBytes, this.length);
    this.length += 8;
  }

  public raw(bytes: Uint8Array): void {
    this.ensure(bytes.length);
    this.buffer.set(bytes, this.length);
    this.length += bytes.length;
  }

  public bytes(value: Uint8Array): void {
    this.varint(value.length);
    this.raw(value);
  }

  public string(value: string): void {
    const length = value.length;
    let ascii = true;
    for (let index = 0; index < length; index += 1) {
      if (value.charCodeAt(index) > 0x7f) {
        ascii = false;
        break;
      }
    }
    if (ascii) {
      this.varint(length);
      this.ensure(length);
      for (let index = 0; index < length; index += 1) {
        this.buffer[this.length + index] = value.charCodeAt(index);
      }
      this.length += length;
      return;
    }
    this.bytes(utf8Encoder.encode(value));
  }

  public bitmap(bits: readonly boolean[]): void {
    const length = Math.ceil(bits.length / 8);
    this.ensure(length);
    for (let index = 0; index < length; index += 1) {
      this.buffer[this.length + index] = 0;
    }
    bits.forEach((present, index) => {
      if (!present) return;
      const byteIndex = this.length + (index >> 3);
      this.buffer[byteIndex] = (this.buffer[byteIndex] ?? 0) | (1 << (index & 7));
    });
    this.length += length;
  }

  public finish(): Uint8Array {
    return this.buffer.slice(0, this.length);
  }
}
