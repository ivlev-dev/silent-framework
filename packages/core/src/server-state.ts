import type { ServerBackend, ServerHole } from "./server-backend.js";

export interface ServerRuntime {
  getServerBackend(): ServerBackend | null;
  isServerHole(value: unknown): value is ServerHole;
  serializeServerValue(value: unknown): string;
  setServerHoleValue(hole: unknown, value: unknown): boolean;
}

const fallback: ServerRuntime = {
  getServerBackend: () => null,
  isServerHole: (_value: unknown): _value is ServerHole => false,
  serializeServerValue: () => "",
  setServerHoleValue: () => false,
};

let runtime: ServerRuntime = fallback;

export function registerServerRuntime(next: ServerRuntime): void {
  runtime = next;
}

export function getServerRuntime(): ServerRuntime {
  return runtime;
}
