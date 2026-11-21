import { getRuntimeContextStore } from "./runtime-context-provider.js";

export const STREAM_REGION_START = "silent-stream:";
export const STREAM_REGION_END = "silent-stream-end:";

export interface ServerStreamRegion {
  readonly id: number;
  readonly start: Comment;
  readonly end: Comment;
  resolve(): void;
}

export interface ServerStreamCollector {
  openRegion(): ServerStreamRegion | null;
}

let collector: ServerStreamCollector | null = null;

export function setServerStreamCollector(next: ServerStreamCollector | null): void {
  const store = getRuntimeContextStore();
  if (store !== null) {
    store.stream = next;
    return;
  }
  collector = next;
}

export function getServerStreamCollector(): ServerStreamCollector | null {
  const store = getRuntimeContextStore();
  return store !== null ? store.stream : collector;
}

export function openServerStreamRegion(): ServerStreamRegion | null {
  const target = getServerStreamCollector();
  return target === null ? null : target.openRegion();
}
