import { getServerRuntime } from "./server-state.js";
import type { ServerBackend, ServerHole } from "./server-backend.js";

export function getServerBackend(): ServerBackend | null {
  return getServerRuntime().getServerBackend();
}

export function isServerHole(value: unknown): value is ServerHole {
  return getServerRuntime().isServerHole(value);
}

export function serializeServerValue(value: unknown): string {
  return getServerRuntime().serializeServerValue(value);
}

export function setServerHoleValue(hole: unknown, value: unknown): boolean {
  return getServerRuntime().setServerHoleValue(hole, value);
}
