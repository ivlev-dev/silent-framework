import type { AnyComponent } from "@ivlev-dev/silent-core";
import {
  STREAM_REGION_END,
  STREAM_REGION_START,
  type ServerStreamCollector,
  type ServerStreamRegion,
} from "@ivlev-dev/silent-core/server-stream";
import { flushSync } from "@ivlev-dev/silent-reactivity";
import { hasRuntimeContextProvider } from "@ivlev-dev/silent-core/runtime-context-provider";
import { forEachChunk } from "./chunk.js";
import type { RenderOptions } from "./render.js";
import { activeRenderError, enqueueRenderTask, settleRender } from "./render.js";
import { ensureRuntimeContext } from "./runtime-context.js";
import { beginRenderSession, type RenderSession } from "./session.js";
import { serializeBetween, serializeNode, serializeNodeChunks } from "./dom/serializer.js";
import type { DomNode } from "./dom/types.js";
import {
  STREAM_RUNTIME_SCRIPT,
  streamPatch,
  streamRuntimeTag,
} from "./stream-runtime.js";

export interface HeadStreamInfo {
  readonly final: boolean;
}

export interface StreamOptions extends RenderOptions {
  readonly chunkSize?: number;
  readonly onHead?: ((head: string, info: HeadStreamInfo) => void) | undefined;
  readonly onShell?: ((html: string) => void) | undefined;
  readonly onChunk?: ((chunk: string) => void) | undefined;
  readonly nonce?: string | undefined;
  readonly signal?: AbortSignal | undefined;
}

const DEFAULT_CHUNK_SIZE = 16 * 1024;

interface StreamState {
  cancelled: boolean;
  finished: boolean;
  controller: ReadableStreamDefaultController<string> | null;
  /** Внутренний abort: отмена читателя должна прервать рендер и освободить очередь. */
  readonly abort: AbortController;
}

/**
 * Комбинирует пользовательский и внутренний сигналы отмены.
 * `AbortSignal.any` не подходит: он оставляет слушателей на долгоживущем
 * пользовательском сигнале после завершения конкретного рендера.
 */
function combineSignals(
  external: AbortSignal | undefined,
  internal: AbortSignal,
): { readonly signal: AbortSignal; dispose(): void } {
  if (external === undefined) {
    return { signal: internal, dispose: () => void 0 };
  }
  const controller = new AbortController();
  const onExternal = (): void => {
    controller.abort(external.reason);
    dispose();
  };
  const onInternal = (): void => {
    controller.abort(internal.reason);
    dispose();
  };
  const dispose = (): void => {
    external.removeEventListener("abort", onExternal);
    internal.removeEventListener("abort", onInternal);
  };
  if (external.aborted) {
    controller.abort(external.reason);
  } else if (internal.aborted) {
    controller.abort(internal.reason);
  } else {
    external.addEventListener("abort", onExternal, { once: true });
    internal.addEventListener("abort", onInternal, { once: true });
  }
  return { signal: controller.signal, dispose };
}

export function renderToStream(
  app: AnyComponent,
  options: StreamOptions = {},
): ReadableStream<string> {
  const nested = activeRenderError();
  if (nested !== null) {
    throw nested;
  }
  const chunkSize =
    options.chunkSize !== undefined && options.chunkSize > 0
      ? options.chunkSize
      : DEFAULT_CHUNK_SIZE;
  const state: StreamState = {
    cancelled: false,
    finished: false,
    controller: null,
    abort: new AbortController(),
  };

  return new ReadableStream<string>({
    start(controller): void {
      state.controller = controller;
      const task = enqueueRenderTask(async () => {
        if (!hasRuntimeContextProvider()) {
          await ensureRuntimeContext();
        }
        await runStream(app, options, chunkSize, state);
      });
      void task.then(
        () => {
          state.finished = true;
        },
        (error: unknown) => {
          state.finished = true;
          if (!state.cancelled) {
            try {
              controller.error(error);
            } catch {
              void error;
            }
          }
        },
      );
    },
    cancel(): void {
      // Идемпотентно: повторная отмена и отмена после завершения — no-op.
      if (state.cancelled || state.finished) {
        return;
      }
      state.cancelled = true;
      state.abort.abort();
    },
  });
}

async function runStream(
  app: AnyComponent,
  options: StreamOptions,
  chunkSize: number,
  state: StreamState,
): Promise<void> {
  if (state.cancelled) {
    state.finished = true;
    return;
  }
  const markers = options.markers !== false;
  const combined = combineSignals(options.signal, state.abort.signal);
  const abortStream = (): void => {
    state.cancelled = true;
    try {
      state.controller?.error(new DOMException("Streaming aborted", "AbortError"));
    } catch {
      void 0;
    }
  };
  if (options.signal?.aborted === true) {
    abortStream();
    combined.dispose();
    state.finished = true;
    return;
  }
  options.signal?.addEventListener("abort", abortStream, { once: true });

  let regionSeq = 0;
  let runtimeEmitted = false;
  let patchFailed = false;
  let patchError: unknown = null;
  let shellEmitted = false;

  const enqueue = (chunk: string): void => {
    const controller = state.controller;
    if (state.cancelled || controller === null || chunk.length === 0) {
      return;
    }
    controller.enqueue(chunk);
    options.onChunk?.(chunk);
  };

  const emit = (html: string): void => {
    if (state.cancelled || html.length === 0) {
      return;
    }
    if (html.length <= chunkSize) {
      enqueue(html);
      return;
    }
    forEachChunk(html, chunkSize, enqueue);
  };

  const emitPatch = (id: number, html: string): void => {
    if (state.cancelled) {
      return;
    }
    if (!runtimeEmitted) {
      runtimeEmitted = true;
      emit(streamRuntimeTag(STREAM_RUNTIME_SCRIPT, options.nonce));
    }
    emit(streamPatch(id, html, options.nonce));
  };

  const removeNode = (node: DomNode): void => {
    const parent = node.parentNode;
    if (parent !== null) {
      parent.removeChild(node);
    }
  };

  let settleChain: Promise<void> = Promise.resolve();
  let pendingSettles = 0;
  /**
   * После отмены/ошибки рендера сессия освобождается, поэтому отложенные
   * settle-задачи не должны трогать её DOM и сериализатор: иначе дорогая работа
   * выполнялась бы по освобождённым ресурсам и могла бы пересечься со следующим
   * рендером в глобальной очереди.
   */
  let settleStopped = false;

  const isStopped = (): boolean =>
    state.cancelled || state.finished || settleStopped;

  const settleRegion = (id: number, start: Comment, end: Comment): void => {
    if (isStopped()) {
      return;
    }
    try {
      flushSync();
      const html = serializeBetween(
        start as unknown as DomNode,
        end as unknown as DomNode,
      );
      emitPatch(id, html);
      removeNode(start as unknown as DomNode);
      removeNode(end as unknown as DomNode);
    } catch (error) {
      if (!patchFailed) {
        patchFailed = true;
        patchError = error;
      }
    }
  };

  const scheduleSettle = (id: number, start: Comment, end: Comment): void => {
    if (isStopped()) {
      // Маркеры остаются в отброшенном дереве: удалять их значило бы мутировать
      // DOM уже освобождённой сессии.
      return;
    }
    pendingSettles += 1;
    settleChain = settleChain.then(async () => {
      await Promise.resolve();
      try {
        settleRegion(id, start, end);
      } finally {
        pendingSettles -= 1;
      }
    });
  };

  const drainSettles = async (): Promise<void> => {
    while (pendingSettles > 0) {
      await settleChain;
    }
  };

  const collector: ServerStreamCollector = {
    openRegion(): ServerStreamRegion {
      regionSeq += 1;
      const id = regionSeq;
      const start = document.createComment(STREAM_REGION_START + id);
      const end = document.createComment(STREAM_REGION_END + id);
      let settled = false;
      return {
        id,
        start,
        end,
        resolve: (): void => {
          if (settled) {
            return;
          }
          settled = true;
          if (isStopped()) {
            return;
          }
          if (!shellEmitted) {
            removeNode(start as unknown as DomNode);
            removeNode(end as unknown as DomNode);
            return;
          }
          scheduleSettle(id, start, end);
        },
      };
    },
  };

  let session: RenderSession | null = null;
  let streamFailed = false;
  let streamError: unknown = null;

  try {
    const active = beginRenderSession(app, options, {
      stream: markers ? collector : null,
    });
    session = active;
    await active.run(async () => {
      flushSync();
      const trackHead = options.onHead !== undefined;
      const shellHead = trackHead ? active.serializeHead() : "";
      if (trackHead) {
        options.onHead?.(shellHead, { final: false });
      }
      const node = active.result.node as unknown as DomNode;
      if (options.onShell === undefined) {
        serializeNodeChunks(node, chunkSize, enqueue, markers);
      } else {
        const shell = serializeNode(node, markers);
        options.onShell(shell);
        emit(shell);
      }
      shellEmitted = true;

      await settleRender(active.result, {
        // Внутренний сигнал (cancel читателя) дополняет пользовательский:
        // без него зависший ресурс держал бы глобальную очередь рендеров.
        signal: combined.signal,
        timeoutMs: options.timeoutMs,
      });
      if (state.cancelled) {
        return;
      }
      await drainSettles();
      if (state.cancelled) {
        return;
      }
      flushSync();
      if (state.cancelled) {
        return;
      }
      await drainSettles();
      if (state.cancelled) {
        return;
      }
      active.throwIfFailed();

      if (patchFailed) {
        throw patchError;
      }

      if (trackHead) {
        const finalHead = active.serializeHead();
        if (finalHead !== shellHead) {
          options.onHead?.(finalHead, { final: true });
        }
      }
    });
  } catch (error) {
    streamFailed = true;
    streamError = error;
  } finally {
    options.signal?.removeEventListener("abort", abortStream);
    combined.dispose();
    if (state.cancelled || streamFailed || patchFailed) {
      // Останавливаем отложенную settle-работу до dispose сессии.
      settleStopped = true;
    }
    // Сливаем очередь settle-задач до освобождения сессии: после остановки они
    // ничего не делают, но ни одна не должна работать по её DOM.
    try {
      await drainSettles();
    } catch {
      // Ошибки settle-задач уже учтены через patchFailed; dispose важнее.
    }
    try {
      session?.dispose();
    } catch (error) {
      if (!streamFailed) {
        streamFailed = true;
        streamError = error;
      }
    }
  }

  if (state.cancelled) {
    state.finished = true;
    return;
  }
  if (streamFailed) {
    state.finished = true;
    state.controller?.error(streamError);
    return;
  }
  if (patchFailed) {
    state.finished = true;
    state.controller?.error(patchError);
    return;
  }
  state.finished = true;
  state.controller?.close();
}
