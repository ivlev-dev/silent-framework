import { ProtocolError } from "./errors.js";

const decoder = new TextDecoder("utf-8");

const ASCII_LIMIT = 128;
const charScratch: number[] = [];

const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE_BIGINT = BigInt(Number.MIN_SAFE_INTEGER);

const EMPTY_BYTES = new Uint8Array(0);

export type PathPart = string | number;

export function pathWith(path: string, part?: PathPart, index?: number): string {
  let result = path;
  if (part !== undefined) {
    result = typeof part === "number" ? `${result}[${part}]` : `${result}${part}`;
  }
  if (index !== undefined) {
    result = `${result}[${index}]`;
  }
  return result;
}

export class Reader {
  private source: Uint8Array;
  private readonly maxSize: number;
  private view: DataView | undefined;
  public offset = 0;

  public constructor(bytes: Uint8Array, maxSize: number) {
    if (bytes.length > maxSize) {
      throw new ProtocolError("size", `сообщение превышает лимит ${maxSize} байт`);
    }
    this.source = bytes;
    this.maxSize = maxSize;
  }

  public reset(bytes: Uint8Array, maxSize: number): void {
    if (bytes.length > maxSize) {
      throw new ProtocolError("size", `сообщение превышает лимит ${maxSize} байт`);
    }
    this.source = bytes;
    this.view = undefined;
    this.offset = 0;
  }

  public release(): void {
    this.source = EMPTY_BYTES;
    this.view = undefined;
    this.offset = 0;
  }

  public get remaining(): number {
    return this.source.length - this.offset;
  }

  private dataView(): DataView {
    let view = this.view;
    if (view === undefined) {
      view = new DataView(this.source.buffer, this.source.byteOffset, this.source.byteLength);
      this.view = view;
    }
    return view;
  }

  private require(length: number, path: string, part?: PathPart, index?: number): void {
    if (length > this.source.length - this.offset) {
      throw new ProtocolError(
        "truncated",
        `ожидалось ${length} байт, доступно ${this.source.length - this.offset}`,
        pathWith(path, part, index),
      );
    }
  }

  public byte(path: string, part?: PathPart, index?: number): number {
    if (this.offset >= this.source.length) {
      throw new ProtocolError(
        "truncated",
        "ожидалось 1 байт, доступно 0",
        pathWith(path, part, index),
      );
    }
    const value = this.source[this.offset] ?? 0;
    this.offset += 1;
    return value;
  }

  public bool(path: string, part?: PathPart, index?: number): boolean {
    return this.byte(path, part, index) !== 0;
  }

  public varint(path: string, part?: PathPart, index?: number): bigint {
    const start = this.offset;
    const source = this.source;
    let result = 0;
    let shift = 0;
    for (let byteIndex = 0; byteIndex < 7; byteIndex += 1) {
      if (start + byteIndex >= source.length) {
        throw new ProtocolError("truncated", "обрезка varint", pathWith(path, part, index));
      }
      const value = source[start + byteIndex] ?? 0;
      if (shift < 28) {
        result |= (value & 0x7f) << shift;
      } else {
        result += (value & 0x7f) * 2 ** shift;
      }
      if ((value & 0x80) === 0) {
        this.offset = start + byteIndex + 1;
        return BigInt(result);
      }
      shift += 7;
    }
    this.offset = start;
    return this.varintBig(path, part, index);
  }

  private varintBig(path: string, part?: PathPart, index?: number): bigint {
    let result = 0n;
    let shift = 0n;
    for (let byteIndex = 0; byteIndex < 10; byteIndex += 1) {
      if (this.offset >= this.source.length) {
        throw new ProtocolError("truncated", "обрезка varint", pathWith(path, part, index));
      }
      const value = this.source[this.offset] ?? 0;
      this.offset += 1;
      if (byteIndex === 9 && value > 1) {
        throw new ProtocolError(
          "invalid_varint",
          "varint выходит за 64 бита",
          pathWith(path, part, index),
        );
      }
      result |= BigInt(value & 0x7f) << shift;
      if ((value & 0x80) === 0) {
        return result;
      }
      shift += 7n;
    }
    throw new ProtocolError("invalid_varint", "слишком длинный varint", pathWith(path, part, index));
  }

  public varintNumber(path: string, max: number, part?: PathPart, index?: number): number {
    const source = this.source;
    const start = this.offset;
    const first = source[start];
    if (first === undefined) {
      throw new ProtocolError("truncated", "обрезка varint", pathWith(path, part, index));
    }
    if (first < 0x80) {
      if (first > max) {
        throw new ProtocolError(
          "range",
          "varint вне допустимого диапазона",
          pathWith(path, part, index),
        );
      }
      this.offset = start + 1;
      return first;
    }
    let result = first & 0x7f;
    let shift = 7;
    for (let byteIndex = 1; byteIndex < 8; byteIndex += 1) {
      const offset = start + byteIndex;
      if (offset >= source.length) {
        throw new ProtocolError("truncated", "обрезка varint", pathWith(path, part, index));
      }
      const value = source[offset] ?? 0;
      if (shift < 28) {
        result |= (value & 0x7f) << shift;
      } else {
        result += (value & 0x7f) * 2 ** shift;
      }
      if ((value & 0x80) === 0) {
        if (result > max) {
          throw new ProtocolError(
            "range",
            "varint вне допустимого диапазона",
            pathWith(path, part, index),
          );
        }
        this.offset = offset + 1;
        return result;
      }
      shift += 7;
    }
    this.offset = start;
    return this.varintNumberSlow(path, max, part, index);
  }

  private varintNumberSlow(
    path: string,
    max: number,
    part?: PathPart,
    index?: number,
  ): number {
    let result = 0;
    let factor = 1;
    for (let byteIndex = 0; byteIndex < 10; byteIndex += 1) {
      if (this.offset >= this.source.length) {
        throw new ProtocolError("truncated", "обрезка varint", pathWith(path, part, index));
      }
      const value = this.source[this.offset] ?? 0;
      this.offset += 1;
      if (byteIndex === 9 && value > 1) {
        throw new ProtocolError(
          "invalid_varint",
          "varint выходит за 64 бита",
          pathWith(path, part, index),
        );
      }
      result += (value & 0x7f) * factor;
      if ((value & 0x80) === 0) {
        if (result > max) {
          throw new ProtocolError(
            "range",
            "varint вне допустимого диапазона",
            pathWith(path, part, index),
          );
        }
        return result;
      }
      if (byteIndex === 9) {
        throw new ProtocolError(
          "invalid_varint",
          "varint выходит за 64 бита",
          pathWith(path, part, index),
        );
      }
      factor *= 128;
    }
    throw new ProtocolError("invalid_varint", "слишком длинный varint", pathWith(path, part, index));
  }

  public zigzag(path: string, part?: PathPart, index?: number): bigint {
    const value = this.varint(path, part, index);
    if (value >= MIN_SAFE_BIGINT && value <= MAX_SAFE_BIGINT) {
      const current = Number(value);
      return BigInt(current % 2 === 1 ? -(current + 1) / 2 : current / 2);
    }
    return (value >> 1n) ^ -(value & 1n);
  }

  public zigzagNumber(path: string, part?: PathPart, index?: number): number {
    const source = this.source;
    const start = this.offset;
    const first = source[start];
    if (first === undefined) {
      throw new ProtocolError("truncated", "обрезка varint", pathWith(path, part, index));
    }
    if (first < 0x80) {
      this.offset = start + 1;
      return (first >>> 1) ^ -(first & 1);
    }
    let result = first & 0x7f;
    let shift = 7;
    for (let byteIndex = 1; byteIndex < 7; byteIndex += 1) {
      const offset = start + byteIndex;
      if (offset >= source.length) {
        throw new ProtocolError("truncated", "обрезка varint", pathWith(path, part, index));
      }
      const value = source[offset] ?? 0;
      if (shift < 28) {
        result |= (value & 0x7f) << shift;
      } else {
        result += (value & 0x7f) * 2 ** shift;
      }
      if ((value & 0x80) === 0) {
        this.offset = offset + 1;
        return result <= 0xffffffff
          ? (result >>> 1) ^ -(result & 1)
          : result % 2 === 1 ? -(result + 1) / 2 : result / 2;
      }
      shift += 7;
    }
    this.offset = start;
    const value = this.zigzagBig(path, part, index);
    if (value < MIN_SAFE_BIGINT || value > MAX_SAFE_BIGINT) {
      throw new ProtocolError(
        "range",
        "значение не представимо number без потери точности",
        pathWith(path, part, index),
      );
    }
    return Number(value);
  }

  private zigzagBig(path: string, part?: PathPart, index?: number): bigint {
    const value = this.varintBig(path, part, index);
    return (value >> 1n) ^ -(value & 1n);
  }

  public fixed32(path: string, part?: PathPart, index?: number): number {
    this.require(4, path, part, index);
    const source = this.source;
    const offset = this.offset;
    const value = (source[offset] ?? 0)
      | ((source[offset + 1] ?? 0) << 8)
      | ((source[offset + 2] ?? 0) << 16)
      | ((source[offset + 3] ?? 0) << 24);
    this.offset = offset + 4;
    return value >>> 0;
  }

  public fixed64(path: string, part?: PathPart, index?: number): bigint {
    this.require(8, path, part, index);
    const value = this.dataView().getBigUint64(this.offset, true);
    this.offset += 8;
    return value;
  }

  public float32(path: string, part?: PathPart, index?: number): number {
    this.require(4, path, part, index);
    const value = this.dataView().getFloat32(this.offset, true);
    this.offset += 4;
    return value;
  }

  public float64(path: string, part?: PathPart, index?: number): number {
    this.require(8, path, part, index);
    const value = this.dataView().getFloat64(this.offset, true);
    this.offset += 8;
    return value;
  }

  public readLength(path: string, part?: PathPart, index?: number): number {
    const value = this.varintNumber(path, 0xffffffff, part, index);
    if (value > this.maxSize) {
      throw new ProtocolError("size", `длина ${value} превышает лимит`, pathWith(path, part, index));
    }
    return value;
  }

  public bytes(path: string, part?: PathPart, index?: number): Uint8Array {
    const length = this.readLength(path, part, index);
    this.require(length, path, part, index);
    const start = this.offset;
    this.offset = start + length;
    return this.source.subarray(start, start + length);
  }

  public string(path: string, part?: PathPart, index?: number): string {
    const length = this.readLength(path, part, index);
    this.require(length, path, part, index);
    const start = this.offset;
    this.offset = start + length;
    const source = this.source;
    if (length === 0) return "";
    if (length === 1) {
      const single = source[start] ?? 0;
      if (single < 0x80) return String.fromCharCode(single);
      return decoder.decode(source.subarray(start, start + 1));
    }
    if (length === 2) {
      const first = source[start] ?? 0;
      const second = source[start + 1] ?? 0;
      if (first < 0x80 && second < 0x80) {
        return String.fromCharCode(first, second);
      }
      return decoder.decode(source.subarray(start, start + 2));
    }
    if (length <= ASCII_LIMIT) {
      const first = source[start] ?? 0;
      if (first < 0x80) {
        const scratch = charScratch;
        scratch.length = length;
        scratch[0] = first;
        let ascii = true;
        for (let charIndex = 1; charIndex < length; charIndex += 1) {
          const code = source[start + charIndex] ?? 0;
          if (code > 0x7f) {
            ascii = false;
            break;
          }
          scratch[charIndex] = code;
        }
        if (ascii) {
          return String.fromCharCode.apply(null, scratch);
        }
      }
    }
    return decoder.decode(source.subarray(start, start + length));
  }

  public bitmap(count: number, path: string, part?: PathPart, index?: number): boolean[] {
    const length = (count + 7) >> 3;
    this.require(length, path, part, index);
    const offset = this.offset;
    const bits: boolean[] = new Array<boolean>(count);
    for (let bit = 0; bit < count; bit += 1) {
      const byte = this.source[offset + (bit >> 3)] ?? 0;
      bits[bit] = (byte & (1 << (bit & 7))) !== 0;
    }
    this.offset = offset + length;
    return bits;
  }

  public bitmapMask(count: number, path: string, part?: PathPart, index?: number): number {
    if (count < 0 || count > 32 || !Number.isInteger(count)) {
      throw new ProtocolError(
        "value",
        "bitmapMask поддерживает от 0 до 32 бит",
        pathWith(path, part, index),
      );
    }
    const length = (count + 7) >> 3;
    if (length === 0) return 0;
    this.require(length, path, part, index);
    const offset = this.offset;
    let mask = 0;
    for (let byteIndex = 0; byteIndex < length; byteIndex += 1) {
      mask |= (this.source[offset + byteIndex] ?? 0) << (byteIndex * 8);
    }
    this.offset = offset + length;
    return mask >>> 0;
  }
}
