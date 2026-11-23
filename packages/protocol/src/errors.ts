export type ProtocolErrorCode =
  | "truncated"
  | "invalid_varint"
  | "schema"
  | "depth"
  | "cycle"
  | "range"
  | "unknown_enum"
  | "trailing"
  | "size"
  | "validation"
  | "value"
  | "oneof";

export class ProtocolError extends Error {
  public readonly code: ProtocolErrorCode;
  public readonly path: string | undefined;

  public constructor(
    code: ProtocolErrorCode,
    message: string,
    path?: string,
  ) {
    super(path === undefined || path.length === 0 ? message : `${path}: ${message}`);
    this.name = "ProtocolError";
    this.code = code;
    this.path = path;
  }
}

export function schemaError(message: string, path?: string): ProtocolError {
  return new ProtocolError("schema", message, path);
}
