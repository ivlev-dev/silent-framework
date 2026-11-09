import type { Container } from "@silent/di";
import { createRoot, flushSync, getOwner, runWithOwner } from "@silent/reactivity";
import {
  createComponent,
  setDefaultPreloader,
  setErrorHandler,
  whenIdle,
  type ComponentResult,
  type RuntimeOptions,
} from "./component.js";
import type { AnyComponent, Preloader } from "./types.js";

export interface MountOptions {
  readonly container?: Container | undefined;
  readonly preloader?: Preloader | undefined;
  readonly onError?: ((error: unknown, component: AnyComponent) => void) | undefined;
  readonly props?: Record<string, unknown> | undefined;
  readonly clear?: boolean | undefined;
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

  await created.ready;
  await whenIdle();
  flushSync();
  await whenIdle();
  flushSync();

  element.replaceChildren(created.node);

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
