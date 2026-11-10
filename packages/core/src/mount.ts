import type { Container } from "@ivlev-dev/silent-di";
import { createRoot, flushSync, getOwner, runWithOwner } from "@ivlev-dev/silent-reactivity";
import {
  createComponent,
  setDefaultPreloader,
  setErrorHandler,
  whenIdle,
  type ComponentResult,
  type RuntimeOptions,
} from "./component.js";
import {
  HYDRATE_END,
  HYDRATE_START,
  HydrationMismatchError,
  beginHydration,
  endHydration,
  withWindow,
  withoutHydration,
} from "./hydration.js";
import type { AnyComponent, Preloader } from "./types.js";

export interface MountOptions {
  readonly container?: Container | undefined;
  readonly preloader?: Preloader | undefined;
  readonly onError?: ((error: unknown, component: AnyComponent) => void) | undefined;
  readonly props?: Record<string, unknown> | undefined;
  readonly clear?: boolean | undefined;
  readonly onMismatch?: ((error: HydrationMismatchError) => void) | undefined;
}

export interface MountHandle {
  readonly ready: Promise<void>;
  dispose(): void;
}

function resolveTarget(target: Element | string): Element {
  if (typeof target === "string") {
    const element = document.querySelector(target);
    if (element === null) {
      throw new Error(`Не найден корневой элемент ${target}`);
    }
    return element;
  }
  return target;
}

export async function mount(
  target: Element | string,
  app: AnyComponent,
  options: MountOptions = {},
): Promise<MountHandle> {
  const element = resolveTarget(target);

  if (options.preloader !== undefined) {
    setDefaultPreloader(options.preloader);
  }
  if (options.onError !== undefined) {
    setErrorHandler(options.onError);
  }

  const runtimeOptions: RuntimeOptions = {
    ...(options.container !== undefined ? { container: options.container } : {}),
    ...(options.preloader !== undefined ? { preloader: options.preloader } : {}),
    ...(options.onError !== undefined ? { onError: options.onError } : {}),
  };

  let rootDispose: () => void = () => {};
  const holder: { value: ComponentResult | null } = { value: null };

  createRoot((dispose) => {
    rootDispose = dispose;
    const owner = getOwner();
    runWithOwner(owner, () => {
      holder.value = createComponent(app, options.props ?? {}, runtimeOptions);
    });
    return null;
  });

  const created = holder.value;
  if (created === null) {
    rootDispose();
    throw new Error("Не удалось создать корневой компонент");
  }

  if (options.clear !== false) {
    element.replaceChildren();
  }
  element.appendChild(created.node);

  await created.ready;

  let disposed = false;
  return {
    ready: created.ready,
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      created.dispose();
      rootDispose();
      rootDispose = () => {};
    },
  };
}

export async function hydrate(
  target: Element | string,
  app: AnyComponent,
  options: MountOptions = {},
): Promise<MountHandle> {
  const element = resolveTarget(target);

  if (options.preloader !== undefined) {
    setDefaultPreloader(options.preloader);
  }
  if (options.onError !== undefined) {
    setErrorHandler(options.onError);
  }

  const runtimeOptions: RuntimeOptions = {
    ...(options.container !== undefined ? { container: options.container } : {}),
    ...(options.preloader !== undefined ? { preloader: options.preloader } : {}),
    ...(options.onError !== undefined ? { onError: options.onError } : {}),
  };

  const onMismatch =
    options.onMismatch ??
    ((error: HydrationMismatchError) => {
      console.warn(`[silent] гидрация: ${error.message}`);
    });

  const boundaryStart = document.createComment(HYDRATE_START);
  const boundaryEnd = document.createComment(HYDRATE_END);
  element.insertBefore(boundaryStart, element.firstChild);
  element.appendChild(boundaryEnd);

  let adopted: { readonly result: ComponentResult; readonly dispose: () => void } | null = null;
  const hasServerMarkup = boundaryStart.nextSibling !== boundaryEnd;

  if (hasServerMarkup) {
    beginHydration(onMismatch);
    try {
      adopted = withWindow(
        { start: boundaryStart, end: boundaryEnd, cursor: boundaryStart.nextSibling },
        () => createRootResult(app, options, runtimeOptions),
      );
      await adopted.result.ready;
      await whenIdle();
      flushSync();
      await whenIdle();
      flushSync();
    } catch (error) {
      if (!(error instanceof HydrationMismatchError)) {
        throw error;
      }
      onMismatch(error);
      adopted = null;
    } finally {
      endHydration();
    }
  }

  boundaryStart.remove();
  boundaryEnd.remove();

  if (adopted === null) {
    const fresh = withoutHydration(() => createRootResult(app, options, runtimeOptions));
    await fresh.result.ready;
    await whenIdle();
    flushSync();
    await whenIdle();
    flushSync();
    element.replaceChildren(fresh.result.node);
    return handleFor(fresh.result, fresh.dispose);
  }

  return handleFor(adopted.result, adopted.dispose);
}

function handleFor(result: ComponentResult, rootDispose: () => void): MountHandle {
  let disposed = false;
  return {
    ready: result.ready,
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      result.dispose();
      rootDispose();
    },
  };
}

function createRootResult(
  app: AnyComponent,
  options: MountOptions,
  runtimeOptions: RuntimeOptions,
): { readonly result: ComponentResult; readonly dispose: () => void } {
  let rootDispose: () => void = () => {};
  const holder: { value: ComponentResult | null } = { value: null };

  createRoot((dispose) => {
    rootDispose = dispose;
    const owner = getOwner();
    runWithOwner(owner, () => {
      holder.value = createComponent(app, options.props ?? {}, runtimeOptions);
    });
    return null;
  });

  const created = holder.value;
  if (created === null) {
    rootDispose();
    throw new Error("Не удалось создать корневой компонент");
  }
  return { result: created, dispose: rootDispose };
}
