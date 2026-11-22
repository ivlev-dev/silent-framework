import type { RenderResult } from "./render.js";
import type { HeadStreamInfo } from "./stream.js";

/**
 * Обработчики, которые worker pool передаёт `renderStream` последним
 * аргументом. `signal` отменяется при cancel/timeout/close пула.
 */
export interface RenderStreamHandlers {
  readonly signal: AbortSignal;
  onHead(head: string, info: HeadStreamInfo): void;
  onShell?(html: string): void;
}

/** Функция `render` из entry-модуля. */
export type RenderEntry<Args extends readonly unknown[] = readonly unknown[]> = (
  ...args: Args
) => RenderResult | Promise<RenderResult>;

/**
 * Функция `renderStream` из entry-модуля: обработчики всегда идут
 * последним аргументом.
 */
export type RenderStreamEntry<
  Args extends readonly unknown[] = readonly unknown[],
> = (
  ...args: [...Args, RenderStreamHandlers]
) => ReadableStream<string> | Promise<ReadableStream<string>>;

/** Модуль, который загружает worker pool. */
export interface ServerEntryModule<
  Args extends readonly unknown[] = readonly unknown[],
> {
  readonly render?: RenderEntry<Args> | undefined;
  readonly renderStream?: RenderStreamEntry<Args> | undefined;
}
