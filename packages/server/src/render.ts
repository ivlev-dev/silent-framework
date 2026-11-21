import type { AnyComponent } from "@ivlev-dev/silent-core";
import {
  getReady,
  hasPendingWork,
  whenIdle,
  type ComponentResult,
  type Preloader,
} from "@ivlev-dev/silent-core";
import {
  getRuntimeContextStore,
  hasRuntimeContextProvider,
} from "@ivlev-dev/silent-core/runtime-context-provider";
import type { Container } from "@ivlev-dev/silent-di";
import { flushSync } from "@ivlev-dev/silent-reactivity";
import { serializeNode } from "./dom/serializer.js";
import type { DomNode } from "./dom/types.js";
import { ensureRuntimeContext } from "./runtime-context.js";
import { beginRenderSession } from "./session.js";

export interface RenderOptions {
  readonly props?: Record<string, unknown> | undefined;
  readonly container?: Container | undefined;
  readonly preloader?: Preloader | undefined;
  readonly onError?: ((error: unknown, component: AnyComponent) => void) | undefined;
  readonly markers?: boolean | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly timeoutMs?: number | undefined;
}

export interface SettleOptions {
  readonly signal?: AbortSignal | undefined;
  readonly timeoutMs?: number | undefined;
}

const MAX_SETTLE_CYCLES = 1000;

export interface RenderResult {
  readonly html: string;
  readonly head: string;
}

let queue: Promise<void> = Promise.resolve();
let pendingTasks = 0;

function finishTask(): void {
  pendingTasks -= 1;
}

export function enqueueRenderTask<T>(task: () => Promise<T>): Promise<T> {
  pendingTasks += 1;
  const previous = pendingTasks === 1 ? Promise.resolve() : queue;
  const run = previous.then(task, task);
  queue = run.then(finishTask, finishTask);
  return run;
}

function abortFailure(): DOMException {
  return new DOMException("Рендер отменён", "AbortError");
}

function timeoutFailure(timeoutMs: number): DOMException {
  return new DOMException(`Рендер превысил таймаут ${timeoutMs} мс`, "TimeoutError");
}

/** Ошибка вложенного рендера. Не экспортируется из пакета: ловится по `name`. */
export class RenderReentrancyError extends Error {
  constructor() {
    super(
      "Вложенный рендер: renderToString/renderToStream вызван внутри активного рендера; дождитесь завершения внешнего рендера",
    );
    this.name = "RenderReentrancyError";
  }
}

/**
 * Рендер внутри уже активного store означал бы ожидание задачи в очереди,
 * которую держит текущий рендер, то есть deadlock. Возвращает ошибку заранее.
 */
export function activeRenderError(): RenderReentrancyError | null {
  return getRuntimeContextStore() === null ? null : new RenderReentrancyError();
}

interface SettleControl {
  wait<T>(work: Promise<T>): Promise<T>;
  throwIfFailed(): void;
  dispose(): void;
}

function createSettleControl(options: SettleOptions): SettleControl {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let failed = false;
  let failure: unknown = null;
  let rejectGuard: ((reason: unknown) => void) | null = null;
  const guard = new Promise<never>((_resolve, reject) => {
    rejectGuard = reject;
  });
  void guard.catch(() => undefined);

  const fail = (reason: unknown): void => {
    if (failed) {
      return;
    }
    failed = true;
    failure = reason;
    rejectGuard?.(reason);
  };

  const signal = options.signal;
  const onAbort = (): void => {
    fail(abortFailure());
  };
  if (signal !== undefined) {
    if (signal.aborted) {
      fail(abortFailure());
    } else {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  }

  const timeoutMs = options.timeoutMs;
  if (timeoutMs !== undefined && Number.isFinite(timeoutMs) && timeoutMs >= 0) {
    timer = setTimeout(() => {
      fail(timeoutFailure(timeoutMs));
    }, timeoutMs);
    const handle = timer as { unref?: () => void };
    handle.unref?.();
  }

  return {
    wait<T>(work: Promise<T>): Promise<T> {
      void work.catch(() => undefined);
      if (failed) {
        return guard;
      }
      return Promise.race([work, guard]);
    },
    throwIfFailed(): void {
      if (failed) {
        throw failure;
      }
    },
    dispose(): void {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

export function renderToString(
  app: AnyComponent,
  options: RenderOptions = {},
): Promise<RenderResult> {
  if (options.signal?.aborted === true) {
    return Promise.reject(abortFailure());
  }
  const nested = activeRenderError();
  if (nested !== null) {
    return Promise.reject(nested);
  }
  return enqueueRenderTask(async () => {
    // После первой инициализации провайдер уже зарегистрирован: лишний await
    // на каждом рендере не нужен (в fallback остаётся прежний путь).
    if (!hasRuntimeContextProvider()) {
      await ensureRuntimeContext();
    }
    return renderOnce(app, options);
  });
}

export async function settleRender(
  result: ComponentResult,
  options: SettleOptions = {},
): Promise<void> {
  const control = createSettleControl(options);
  try {
    control.throwIfFailed();
    const ready = result.ready;
    const synchronous = ready === getReady(result.node);
    const idleAfterCreate = !hasPendingWork();

    if (!synchronous) {
      await control.wait(ready);
    }
    control.throwIfFailed();
    flushSync();
    if (!synchronous || !idleAfterCreate || hasPendingWork()) {
      let cycles = 0;
      while (hasPendingWork()) {
        control.throwIfFailed();
        await control.wait(whenIdle());
        control.throwIfFailed();
        flushSync();
        cycles += 1;
        if (cycles >= MAX_SETTLE_CYCLES && hasPendingWork()) {
          throw new DOMException(
            `Рендер не завершился за ${MAX_SETTLE_CYCLES} циклов: асинхронная работа перерегистрируется без прогресса`,
            "TimeoutError",
          );
        }
      }
      await control.wait(Promise.resolve());
      control.throwIfFailed();
      flushSync();
    }
  } finally {
    control.dispose();
  }
}

async function renderOnce(
  app: AnyComponent,
  options: RenderOptions,
): Promise<RenderResult> {
  if (options.signal?.aborted === true) {
    throw abortFailure();
  }
  const session = beginRenderSession(app, options);
  let rendered: RenderResult | null = null;
  let renderError: unknown = null;
  let renderFailed = false;

  try {
    await session.run(async () => {
      await settleRender(session.result, {
        signal: options.signal,
        timeoutMs: options.timeoutMs,
      });
      session.throwIfFailed();
      const head = session.serializeHead();
      const html = serializeNode(
        session.result.node as unknown as DomNode,
        options.markers !== false,
      );
      rendered = { html, head };
    });
  } catch (error) {
    renderFailed = true;
    renderError = error;
  } finally {
    try {
      session.dispose();
    } catch (error) {
      if (!renderFailed) {
        renderFailed = true;
        renderError = error;
      }
    }
  }

  if (renderFailed) {
    throw renderError;
  }
  if (rendered === null) {
    throw new Error("Не удалось создать корневой компонент");
  }
  return rendered;
}
