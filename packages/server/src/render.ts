import type { AnyComponent } from "@ivlev-dev/silent-core";
import {
  getReady,
  hasPendingWork,
  whenIdle,
  type ComponentResult,
  type Preloader,
} from "@ivlev-dev/silent-core";
import type { Container } from "@ivlev-dev/silent-di";
import { flushSync } from "@ivlev-dev/silent-reactivity";
import { serializeNode } from "./dom/serializer.js";
import type { DomNode } from "./dom/types.js";
import { beginRenderSession } from "./session.js";

export interface RenderOptions {
  readonly props?: Record<string, unknown> | undefined;
  readonly container?: Container | undefined;
  readonly preloader?: Preloader | undefined;
  readonly onError?: ((error: unknown, component: AnyComponent) => void) | undefined;
  readonly markers?: boolean | undefined;
}

const HYDRATION_MARKERS = /<!--silent-[^>]*-->|\sdata-silent-[a-z0-9-]+(?:="[^"]*")?/g;

function stripMarkers(html: string): string {
  return HYDRATION_MARKERS.test(html) ? html.replace(HYDRATION_MARKERS, "") : html;
}

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
  if (pendingTasks === 1) {
    const run = task();
    queue = run.then(finishTask, finishTask);
    return run;
  }
  const run = queue.then(task, task);
  queue = run.then(finishTask, finishTask);
  return run;
}

export function renderToString(
  app: AnyComponent,
  options: RenderOptions = {},
): Promise<RenderResult> {
  return enqueueRenderTask(() => renderOnce(app, options));
}

export async function settleRender(
  result: ComponentResult,
): Promise<void> {
  const ready = result.ready;
  const synchronous = ready === getReady(result.node);
  const idleAfterCreate = !hasPendingWork();

  if (!synchronous) {
    await ready;
  }
  flushSync();
  if (!synchronous || !idleAfterCreate || hasPendingWork()) {
    while (hasPendingWork()) {
      await whenIdle();
      flushSync();
    }
    await Promise.resolve();
    flushSync();
  }
}

async function renderOnce(
  app: AnyComponent,
  options: RenderOptions,
): Promise<RenderResult> {
  const session = beginRenderSession(app, options);
  let rendered: RenderResult | null = null;
  let renderError: unknown = null;
  let renderFailed = false;

  try {
    await settleRender(session.result);
    session.throwIfFailed();
    let head = session.serializeHead();
    let html = serializeNode(session.result.node as unknown as DomNode);
    if (options.markers === false) {
      html = stripMarkers(html);
      head = stripMarkers(head);
    }
    rendered = { html, head };
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
