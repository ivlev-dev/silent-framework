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
  collector = next;
}

export function getServerStreamCollector(): ServerStreamCollector | null {
  return collector;
}

export function openServerStreamRegion(): ServerStreamRegion | null {
  return collector === null ? null : collector.openRegion();
}
