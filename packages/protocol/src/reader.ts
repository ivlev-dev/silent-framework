import { ProtocolError } from "./errors.js";

const decoder = new TextDecoder("utf-8");

const scratchBuffer = new ArrayBuffer(8);
const scratchView = new DataView(scratchBuffer);
const scratchBytes = new Uint8Array(scratchBuffer);

export class Reader {
  private readonly source: Uint8Array;
  private readonly maxSize: number;
  public offset = 0;

  public constructor(bytes: Uint8Array, maxSize: number) {
    if (bytes.length > maxSize) {
      throw new ProtocolError("size", `сообщение превышает лимит ${maxSize} байт`);
    }
    this.source = bytes;
    this.maxSize = maxSize;
  }

  public get remaining(): number {
    return this.source.length - this.offset;
  }

  private require(length: number, path: string): void {
    if (length > this.remaining) {
      throw new ProtocolError("truncated", `ожидалось ${length} байт, доступно ${this.remaining}`, path);
    }
  }

  public byte(path: string): number {
    this.require(1, path);
    const value = this.source[this.offset] ?? 0;
    this.offset += 1;
    return value;
  }

  public bool(path: string): boolean {
    return this.byte(path) !== 0;
  }

  public varint(path: string): bigint {
    let result = 0n;
    let shift = 0n;
    for (let index = 0; index < 10; index += 1) {
      if (this.offset >= this.source.length) {
        throw new ProtocolError("truncated", "обрезка varint", path);
      }
      const value = this.source[this.offset] ?? 0;
      this.offset += 1;
      if (index === 9 && value > 1) {
        throw new ProtocolError("invalid_varint", "varint выходит за 64 бита", path);
      }
      result |= BigInt(value & 0x7f) << shift;
      if ((value & 0x80) === 0) {
        return result;
      }
      shift += 7n;
    }
    throw new ProtocolError("invalid_varint", "слишком длинный varint", path);
  }

  public varintNumber(path: string, max: number): number {
    let result = 0;
    let factor = 1;
    for (let index = 0; index < 10; index += 1) {
      if (this.offset >= this.source.length) {
        throw new ProtocolError("truncated", "обрезка varint", path);
      }
      const value = this.source[this.offset] ?? 0;
      this.offset += 1;
      if (index === 9 && value > 1) {
        throw new ProtocolError("invalid_varint", "varint выходит за 64 бита", path);
      }
      result += (value & 0x7f) * factor;
      if ((value & 0x80) === 0) {
        if (result > max) {
          throw new ProtocolError("range", "varint вне допустимого диапазона", path);
        }
        return result;
      }
      if (index === 9) {
        throw new ProtocolError("invalid_varint", "varint выходит за 64 бита", path);
      }
      factor *= 128;
    }
    throw new ProtocolError("invalid_varint", "слишком длинный varint", path);
  }

  public zigzag(path: string): bigint {
    const value = this.varint(path);
    return (value >> 1n) ^ -(value & 1n);
  }

  public zigzagNumber(path: string): number {
    const start = this.offset;
    let result = 0;
    let factor = 1;
    for (let index = 0; index < 7; index += 1) {
      if (this.offset >= this.source.length) {
        throw new ProtocolError("truncated", "обрезка varint", path);
      }
      const byte = this.source[this.offset] ?? 0;
      this.offset += 1;
      result += (byte & 0x7f) * factor;
      if ((byte & 0x80) === 0) {
        return result % 2 === 1 ? -(result + 1) / 2 : result / 2;
      }
      factor *= 128;
    }
    this.offset = start;
    const value = this.zigzag(path);
    if (value < BigInt(Number.MIN_SAFE_INTEGER) || value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new ProtocolError("range", "значение не представимо number без потери точности", path);
    }
    return Number(value);
  }

  public fixed32(path: string): number {
    this.require(4, path);
    const source = this.source;
    const offset = this.offset;
    const value = (source[offset] ?? 0)
      | ((source[offset + 1] ?? 0) << 8)
      | ((source[offset + 2] ?? 0) << 16)
      | ((source[offset + 3] ?? 0) << 24);
    this.offset += 4;
    return value >>> 0;
  }

  public fixed64(path: string): bigint {
    this.require(8, path);
    let value = 0n;
    for (let index = 7; index >= 0; index -= 1) {
      value = (value << 8n) | BigInt(this.source[this.offset + index] ?? 0);
    }
    this.offset += 8;
    return value;
  }

  public float32(path: string): number {
    this.require(4, path);
    scratchBytes.set(this.source.subarray(this.offset, this.offset + 4));
    this.offset += 4;
    return scratchView.getFloat32(0, true);
  }

  public float64(path: string): number {
    this.require(8, path);
    scratchBytes.set(this.source.subarray(this.offset, this.offset + 8));
    this.offset += 8;
    return scratchView.getFloat64(0, true);
  }

  public readLength(path: string): number {
    const value = this.varintNumber(path, 0xffffffff);
    if (value > this.maxSize) {
      throw new ProtocolError("size", `длина ${value} превышает лимит`, path);
    }
    return value;
  }

  public bytes(path: string): Uint8Array {
    const length = this.readLength(path);
    this.require(length, path);
    const start = this.offset;
    this.offset += length;
    return this.source.subarray(start, start + length);
  }

  public string(path: string): string {
    const value = this.bytes(path);
    return decoder.decode(value);
  }

  public bitmap(count: number, path: string): boolean[] {
    const length = Math.ceil(count / 8);
    this.require(length, path);
    const bits: boolean[] = new Array<boolean>(count).fill(false);
    for (let index = 0; index < count; index += 1) {
      const byte = this.source[this.offset + (index >> 3)] ?? 0;
      bits[index] = (byte & (1 << (index & 7))) !== 0;
    }
    this.offset += length;
    return bits;
  }
}
