import { setServerHoleValue } from "./server-hole.js";
import { registerServerRuntime } from "./server-state.js";

export interface ServerHole {
  readonly parentNode: unknown;
  set(value: string): void;
}

export interface ServerTemplate {
  readonly node: unknown;
  readonly holes: readonly ServerHole[];
  readonly attrs: readonly unknown[];
}

export interface ServerFragment {
  readonly node: unknown;
}

export interface ServerBackend {
  createTemplate(html: string): ServerTemplate | null;
  createRaw?(html: string): unknown;
  serialize(value: unknown): string;
  createFragment?(parts: readonly string[], values: readonly unknown[]): ServerFragment | null;
}

let backend: ServerBackend | null = null;

export function setServerBackend(next: ServerBackend | null): void {
  backend = next;
}

export function getServerBackend(): ServerBackend | null {
  return backend;
}

export function isServerHole(value: unknown): value is ServerHole {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ServerHole).set === "function" &&
    !(value instanceof Node)
  );
}

export function serializeServerValue(value: unknown): string {
  return backend === null ? "" : backend.serialize(value);
}

registerServerRuntime({
  getServerBackend,
  isServerHole,
  serializeServerValue,
  setServerHoleValue,
});
