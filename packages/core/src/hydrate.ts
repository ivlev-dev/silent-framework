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
  ViewRuntimeUnavailableError,
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

function ensureRuntimes(): Promise<void> {
  runtimes ??= (async () => {
    const [hydration, dom] = await Promise.all([
      import("./hydration.js"),
      import("./dom-hydration.js"),
    ]);
    hydration.installHydrationRuntime();
    dom.installDomHydrationRuntime();
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
): Promise<MountHandle> {
  const boundaryStart = document.createComment(HYDRATE_START);
  const boundaryEnd = document.createComment(HYDRATE_END);
  element.insertBefore(boundaryStart, element.firstChild);
  element.appendChild(boundaryEnd);

  let adopted: { readonly result: ReturnType<typeof createRootResult>["result"]; readonly dispose: () => void } | null = null;
  const hasServerMarkup = boundaryStart.nextSibling !== boundaryEnd;

  try {
    if (hasServerMarkup) {
      beginHydration(onMismatch);
      try {
        adopted = withWindow(
          { start: boundaryStart, end: boundaryEnd, cursor: boundaryStart.nextSibling },
          () => createRootResult(app, options, runtimeOptions, create),
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
      const fresh = withoutHydration(() =>
        createRootResult(app, options, runtimeOptions, create),
      );
      await fresh.result.ready;
      await whenIdle();
      flushSync();
      await whenIdle();
      flushSync();
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

export async function hydrate(
  target: Element | string,
  app: AnyComponent,
  options: MountOptions = {},
): Promise<MountHandle> {
  const element = resolveTarget(target);
  await ensureRuntimes();

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

  const factory = componentFactoryFor(app);
  let create: ComponentFactory = factory instanceof Promise ? await factory : factory;

  const originalMarkup = element.innerHTML;
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
    element.innerHTML = originalMarkup;
    create = await loadViewFactory();
    return await hydrateWith(
      element,
      app,
      options,
      runtimeOptions,
      onMismatch,
      create,
    );
  }
}
