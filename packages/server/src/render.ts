import { container as rootContainer } from "@ivlev-dev/silent-di";
import type { Container } from "@ivlev-dev/silent-di";
import {
  createComponent,
  getReady,
  hasPendingWork,
  setMetadataCollector,
  setServerBackend,
  setServerMode,
  whenIdle,
  type AnyComponent,
  type ComponentResult,
  type Preloader,
  type RuntimeOptions,
} from "@ivlev-dev/silent-core";
import { createRoot, flushSync } from "@ivlev-dev/silent-reactivity";
import { createDocument, installDomGlobals } from "./dom/document.js";
import { acquireParts, pushNode, releaseParts, serializeNode } from "./dom/serializer.js";
import { createServerBackend } from "./string-backend.js";
import type { DomNode } from "./dom/types.js";

export interface RenderOptions {
  readonly props?: Record<string, unknown> | undefined;
  readonly container?: Container | undefined;
  readonly preloader?: Preloader | undefined;
  readonly onError?: ((error: unknown, component: AnyComponent) => void) | undefined;
}

export interface RenderResult {
  readonly html: string;
  readonly head: string;
}

const SERVER_DOCUMENT = createDocument();
const SERVER_BACKEND = createServerBackend();

let queue: Promise<void> = Promise.resolve();
let pendingTasks = 0;

function finishTask(): void {
  pendingTasks -= 1;
}

function noop(): void {}

function serializeHead(nodes: readonly Element[]): string {
  if (nodes.length === 0) {
    return "";
  }
  const parts = acquireParts();
  try {
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      if (node !== undefined) {
        pushNode(node as unknown as DomNode, parts);
      }
    }
    const only = parts[0];
    if (only === undefined) {
      return "";
    }
    return parts.length === 1 ? only : parts.join("");
  } finally {
    releaseParts(parts);
  }
}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
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
  return enqueue(() => renderOnce(app, options));
}

async function renderOnce(app: AnyComponent, options: RenderOptions): Promise<RenderResult> {
  const document = SERVER_DOCUMENT;
  const restore = installDomGlobals(document, { keepShape: true });
  setServerMode(true);
  setServerBackend(SERVER_BACKEND);

  let disposeRoot: () => void = noop;
  let failure: unknown = null;
  let failed = false;
  const headNodes: Element[] = [];

  setMetadataCollector((node) => {
    headNodes.push(node);
  });

  const handleError = (error: unknown, component: AnyComponent): void => {
    if (options.onError !== undefined) {
      options.onError(error, component);
      return;
    }
    if (!failed) {
      failed = true;
      failure = error;
    }
  };

  const runtimeOptions: RuntimeOptions = {
    container: options.container ?? rootContainer,
    preloader: options.preloader,
    onError: handleError,
  };

  let result: ComponentResult | null = null;

  try {
    result = createRoot((dispose) => {
      disposeRoot = dispose;
      return createComponent(app, options.props ?? {}, runtimeOptions);
    });

    if (result === null) {
      throw new Error("Не удалось создать корневой компонент");
    }

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

    if (failed) {
      throw failure;
    }

    const head = serializeHead(headNodes);
    return { html: serializeNode(result.node as unknown as DomNode), head };
  } finally {
    setMetadataCollector(null);
    setServerBackend(null);
    restore();
    setServerMode(false);
    result?.dispose();
    disposeRoot();
  }
}
