import { expect } from "vitest";
import {
  ProtocolError,
  defineProtocol,
  type FieldSchema,
  type OneofDefinition,
  type ProtocolErrorCode,
  type TypeSchema,
} from "../src/index.js";

export interface Box {
  value: unknown;
}

export function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function bytesOf(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

export function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function box(type: TypeSchema, optional = false): new () => Box {
  class BoxModel {
    public value: unknown = undefined;
  }
  defineProtocol(BoxModel, { fields: [{ name: "value", type, optional }] });
  return BoxModel;
}

export function model(
  fields: readonly FieldSchema[],
  oneofs?: readonly OneofDefinition[],
): new () => Record<string, unknown> {
  class DynamicModel {}
  defineProtocol(DynamicModel, oneofs === undefined ? { fields } : { fields, oneofs });
  return DynamicModel as unknown as new () => Record<string, unknown>;
}

export function expectProtocolError(
  action: () => unknown,
  code: ProtocolErrorCode,
): ProtocolError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(ProtocolError);
    const protocol = error as ProtocolError;
    expect(protocol.code).toBe(code);
    return protocol;
  }
  throw new Error(`ожидалась ProtocolError с кодом ${code}`);
}
