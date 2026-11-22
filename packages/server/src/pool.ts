import {
  createPool,
  type EntryCapabilities,
  type PoolErrorInfo,
  type PoolEvent,
  type PoolRenderOptions,
  type PoolState,
  type PoolStats,
  type PoolStreamOptions,
  type PoolWorkersStats,
  type RenderPool,
  type RenderPoolOptions,
  type StreamHandle,
  type StreamSummary,
} from "./pool/pool.js";

/**
 * Инфраструктурная ошибка пула. Ошибки entry-модуля приходят как обычные
 * `Error` с сохранёнными `name`/`message`/`code`, поэтому `instanceof`
 * отличает сбои пула от сбоев приложения.
 */
export { PoolError } from "./pool/errors.js";
export type { PoolErrorCode } from "./pool/errors.js";

export type {
  EntryCapabilities,
  PoolErrorInfo,
  PoolEvent,
  PoolRenderOptions,
  PoolState,
  PoolStats,
  PoolStreamOptions,
  PoolWorkersStats,
  RenderPool,
  RenderPoolOptions,
  StreamHandle,
  StreamSummary,
};

/**
 * Создаёт opt-in worker pool для SSR. Entry-модуль должен экспортировать
 * `render` и/или `renderStream`; основной путь `renderToString`/`renderToStream`
 * не меняется.
 */
export function createRenderPool<
  Args extends readonly unknown[] = readonly unknown[],
>(
  entry: string | URL,
  options: RenderPoolOptions = {},
): RenderPool<Args> {
  return createPool<Args>(entry, options);
}
