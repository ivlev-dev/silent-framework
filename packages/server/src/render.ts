import { container as rootContainer } from "@ivlev-dev/silent-di";
import type { Container } from "@ivlev-dev/silent-di";
import {
  createComponent,
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
import { serializeNode } from "./dom/serializer.js";
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

let queue: Promise<void> = Promise.resolve();
let pendingTasks = 0;

function ignore(): void {}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  if (pendingTasks === 0) {
    pendingTasks = 1;
    const run = task();
    queue = run.then(ignore, ignore);
    void run.then(ignore, ignore).finally(() => {
      pendingTasks -= 1;
    });
    return run;
  }
  pendingTasks += 1;
  const run = queue.then(task, task);
  queue = run.then(ignore, ignore);
  void run.then(ignore, ignore).finally(() => {
    pendingTasks -= 1;
  });
  return run;
}

export function renderToString(
  app: AnyComponent,
  options: RenderOptions = {},
): Promise<RenderResult> {
  return enqueue(() => renderOnce(app, options));
}

async function renderOnce(app: AnyComponent, options: RenderOptions): Promise<RenderResult> {
  const document = createDocument();
  const restore = installDomGlobals(document);
  setServerMode(true);
  setServerBackend(createServerBackend());

  const holder: { value: ComponentResult | null } = { value: null };
  let disposeRoot: () => void = () => {};
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

  try {
    createRoot((dispose) => {
      disposeRoot = dispose;
      holder.value = createComponent(app, options.props ?? {}, runtimeOptions);
      return null;
    });

    const result = holder.value;
    if (result === null) {
      throw new Error("Не удалось создать корневой компонент");
    }

    await result.ready;
    flushSync();
    while (hasPendingWork()) {
      await whenIdle();
      flushSync();
    }
    await Promise.resolve();
    flushSync();

    if (failed) {
      throw failure;
    }

    const fragment = document.createDocumentFragment();
    fragment.appendChild(result.node as unknown as DomNode);
    const head = headNodes
      .map((node) => serializeNode(node as unknown as DomNode))
      .join("");
    return { html: serializeNode(fragment as unknown as DomNode), head };
  } finally {
    setMetadataCollector(null);
    setServerBackend(null);
    restore();
    setServerMode(false);
    holder.value?.dispose();
    disposeRoot();
  }
}
