import type { AnyComponent } from "@ivlev-dev/silent-core";
import {
  STREAM_REGION_END,
  STREAM_REGION_START,
  setServerStreamCollector,
  type ServerStreamCollector,
  type ServerStreamRegion,
} from "@ivlev-dev/silent-core/server-stream";
import { flushSync } from "@ivlev-dev/silent-reactivity";
import type { RenderOptions } from "./render.js";
import { enqueueRenderTask, settleRender } from "./render.js";
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
  controller: ReadableStreamDefaultController<string> | null;
}

export function renderToStream(
  app: AnyComponent,
  options: StreamOptions = {},
): ReadableStream<string> {
  const chunkSize =
    options.chunkSize !== undefined && options.chunkSize > 0
      ? options.chunkSize
      : DEFAULT_CHUNK_SIZE;
  const state: StreamState = { cancelled: false, controller: null };

  return new ReadableStream<string>({
    start(controller): void {
      state.controller = controller;
      void enqueueRenderTask(() => runStream(app, options, chunkSize, state)).catch(
        (error: unknown) => {
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
      state.cancelled = true;
    },
  });
}

async function runStream(
  app: AnyComponent,
  options: StreamOptions,
  chunkSize: number,
  state: StreamState,
): Promise<void> {
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
    return;
  }
  options.signal?.addEventListener("abort", abortStream, { once: true });

  let regionSeq = 0;
  let runtimeEmitted = false;
  let patchFailed = false;
  let patchError: unknown = null;
  let shellEmitted = false;

  const emit = (html: string): void => {
    const controller = state.controller;
    if (state.cancelled || controller === null || html.length === 0) {
      return;
    }
    if (html.length <= chunkSize) {
      controller.enqueue(html);
      options.onChunk?.(html);
      return;
    }
    for (let index = 0; index < html.length; index += chunkSize) {
      const chunk = html.slice(index, index + chunkSize);
      controller.enqueue(chunk);
      options.onChunk?.(chunk);
    }
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

  const settleRegion = (id: number, start: Comment, end: Comment): void => {
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
    pendingSettles += 1;
    settleChain = settleChain.then(async () => {
      await Promise.resolve();
      settleRegion(id, start, end);
      pendingSettles -= 1;
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

  setServerStreamCollector(collector);
  let session: RenderSession | null = null;
  let streamFailed = false;
  let streamError: unknown = null;

  try {
    session = beginRenderSession(app, options);
    flushSync();
    const trackHead = options.onHead !== undefined;
    const shellHead = trackHead ? session.serializeHead() : "";
    if (trackHead) {
      options.onHead?.(shellHead, { final: false });
    }
    const node = session.result.node as unknown as DomNode;
    if (options.onShell === undefined) {
      serializeNodeChunks(node, chunkSize, emit);
    } else {
      const shell = serializeNode(node);
      options.onShell(shell);
      emit(shell);
    }
    shellEmitted = true;

    await settleRender(session.result);
    await drainSettles();
    flushSync();
    await drainSettles();
    session.throwIfFailed();

    if (patchFailed) {
      throw patchError;
    }

    if (trackHead) {
      const finalHead = session.serializeHead();
      if (finalHead !== shellHead) {
        options.onHead?.(finalHead, { final: true });
      }
    }
  } catch (error) {
    streamFailed = true;
    streamError = error;
  } finally {
    options.signal?.removeEventListener("abort", abortStream);
    setServerStreamCollector(null);
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
    return;
  }
  if (streamFailed) {
    state.controller?.error(streamError);
    return;
  }
  if (patchFailed) {
    state.controller?.error(patchError);
    return;
  }
  state.controller?.close();
}
