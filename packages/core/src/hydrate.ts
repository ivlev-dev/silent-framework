import { flushSync } from "@ivlev-dev/silent-reactivity";
import {
  HydrationMismatchError,
  HYDRATE_END,
  HYDRATE_START,
  beginHydration,
  endHydration,
  withWindow,
  withoutHydration,
} from "./hydration-state.js";
import {
  RESOLVED_READY,
  ViewRuntimeUnavailableError,
  hasPendingWork,
  whenIdle,
  setDefaultPreloader,
  setErrorHandler,
  type RuntimeOptions,
} from "./component-state.js";
import {
  componentFactoryFor,
  createRootResult,
  handleFor,
  loadViewFactory,
  resolveTarget,
  viewEnabled,
  type ComponentFactory,
} from "./mount-core.js";
import type { MountHandle, MountOptions } from "./mount.js";
import type { AnyComponent } from "./types.js";

let runtimes: Promise<void> | null = null;
let runtimesReady = false;

async function settle(): Promise<void> {
  flushSync();
  while (hasPendingWork()) {
    await whenIdle();
    flushSync();
  }
}

async function finish(ready: Promise<void>): Promise<void> {
  if (ready !== RESOLVED_READY) {
    await ready;
  }
  if (hasPendingWork()) {
    await settle();
    return;
  }
  flushSync();
}

function complete(ready: Promise<void>): Promise<void> | null {
  if (ready !== RESOLVED_READY) {
    return finish(ready);
  }
  if (hasPendingWork()) {
    return settle();
  }
  flushSync();
  return null;
}

function ensureRuntimes(): Promise<void> {
  runtimes ??= (async () => {
    const [hydration, dom] = await Promise.all([
      import("./hydration.js"),
      import("./dom-hydration.js"),
    ]);
    hydration.installHydrationRuntime();
    dom.installDomHydrationRuntime();
    runtimesReady = true;
  })();
  return runtimes;
}

async function hydrateWith(
  element: Element,
  app: AnyComponent,
  options: MountOptions,
  runtimeOptions: RuntimeOptions,
  onMismatch: (error: HydrationMismatchError) => void,
  create: ComponentFactory,
  forceFresh = false,
): Promise<MountHandle> {
  const boundaryStart = document.createComment(HYDRATE_START);
  const boundaryEnd = document.createComment(HYDRATE_END);
  element.insertBefore(boundaryStart, element.firstChild);
  element.appendChild(boundaryEnd);

  let adopted: { readonly result: ReturnType<typeof createRootResult>["result"]; readonly dispose: () => void } | null = null;
  const hasServerMarkup = !forceFresh && boundaryStart.nextSibling !== boundaryEnd;

  try {
    if (hasServerMarkup) {
      beginHydration(onMismatch);
      try {
        adopted = withWindow(
          { start: boundaryStart, end: boundaryEnd, cursor: boundaryStart.nextSibling },
          () => createRootResult(app, options, runtimeOptions, create),
        );
        const pending = complete(adopted.result.ready);
        if (pending !== null) {
          await pending;
        }
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
      const fresh = withoutHydration(() =>
        createRootResult(app, options, runtimeOptions, create),
      );
      const pending = complete(fresh.result.ready);
      if (pending !== null) {
        await pending;
      }
      element.replaceChildren(fresh.result.node);
      return handleFor(fresh.result, fresh.dispose);
    }

    return handleFor(adopted.result, adopted.dispose);
  } finally {
    boundaryStart.remove();
    boundaryEnd.remove();
    endHydration();
  }
}

const defaultOnMismatch = (error: HydrationMismatchError): void => {
  console.warn(`[silent] гидрация: ${error.message}`);
};

const EMPTY_RUNTIME_OPTIONS: RuntimeOptions = {};

export async function hydrate(
  target: Element | string,
  app: AnyComponent,
  options: MountOptions = {},
): Promise<MountHandle> {
  const element = resolveTarget(target);
  if (!runtimesReady) {
    await ensureRuntimes();
  }

  if (options.preloader !== undefined) {
    setDefaultPreloader(options.preloader);
  }
  if (options.onError !== undefined) {
    setErrorHandler(options.onError);
  }

  const runtimeOptions: RuntimeOptions =
    options.container === undefined &&
    options.preloader === undefined &&
    options.onError === undefined
      ? EMPTY_RUNTIME_OPTIONS
      : {
          ...(options.container !== undefined ? { container: options.container } : {}),
          ...(options.preloader !== undefined ? { preloader: options.preloader } : {}),
          ...(options.onError !== undefined ? { onError: options.onError } : {}),
        };

  const onMismatch = options.onMismatch ?? defaultOnMismatch;

  const factory = componentFactoryFor(app);
  let create: ComponentFactory = factory instanceof Promise ? await factory : factory;

  try {
    return await hydrateWith(
      element,
      app,
      options,
      runtimeOptions,
      onMismatch,
      create,
    );
  } catch (error) {
    if (!viewEnabled || !(error instanceof ViewRuntimeUnavailableError)) {
      throw error;
    }
    create = await loadViewFactory();
    return await hydrateWith(
      element,
      app,
      options,
      runtimeOptions,
      onMismatch,
      create,
      true,
    );
  }
}
