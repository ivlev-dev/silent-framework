import { container as rootContainer } from "@silent/di";
import type { Container } from "@silent/di";
import {
  createComponent,
  setServerMode,
  whenIdle,
  type AnyComponent,
  type ComponentResult,
  type Preloader,
  type RuntimeOptions,
} from "@silent/core";
import { createRoot, flushSync } from "@silent/reactivity";
import { createDocument, installDomGlobals } from "./dom/document.js";
import { serializeNode } from "./dom/serializer.js";
import type { DomNode } from "./dom/types.js";

export interface RenderOptions {
  readonly props?: Record<string, unknown> | undefined;
  readonly container?: Container | undefined;
  readonly preloader?: Preloader | undefined;
  readonly onError?: ((error: unknown, component: AnyComponent) => void) | undefined;
}

export interface RenderResult {
  readonly html: string;
}

let queue: Promise<void> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
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

  const holder: { value: ComponentResult | null } = { value: null };
  let disposeRoot: () => void = () => {};
  let failure: unknown = null;
  let failed = false;

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
    await whenIdle();
    flushSync();
    await whenIdle();
    flushSync();
    for (let index = 0; index < 3; index += 1) {
      await Promise.resolve();
      flushSync();
    }
    await whenIdle();
    flushSync();

    if (failed) {
      throw failure;
    }

    const fragment = document.createDocumentFragment();
    fragment.appendChild(result.node as unknown as DomNode);
    return { html: serializeNode(fragment as unknown as DomNode) };
  } finally {
    restore();
    setServerMode(false);
    holder.value?.dispose();
    disposeRoot();
  }
}
