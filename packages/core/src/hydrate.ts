import { flushSync } from "@ivlev-dev/silent-reactivity";
import {
  HydrationMismatchError,
  HYDRATE_END,
  HYDRATE_START,
  beginHydration,
  countClientNodes,
  drainHydrationTasks,
  endHydration,
  withWindow,
  withoutHydration,
  type HydrationContext,
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
import { resetIds } from "./id.js";
import { emitDevtoolsError } from "./devtools-events.js";
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
import { getViewMeta } from "./component-lite.js";
import type { AnyComponent } from "./types.js";

declare const __SILENT_HYDRATE__: boolean | undefined;

const HYDRATE =
  typeof __SILENT_HYDRATE__ === "undefined" || __SILENT_HYDRATE__;

let runtimes: Promise<void> | null = null;
let runtimesReady = false;
let hydrationQueue: Promise<void> = /*#__PURE__*/ Promise.resolve();

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

/**
 * Ставит задачу в общую FIFO-очередь гидрации. Хвост очереди захватывается
 * синхронно при входе, поэтому даже третий вызов, пришедший во время
 * выполнения второго, встаёт за ним, а не запускает `hydrateRoot` параллельно
 * и не перезаписывает контекст гидрации.
 */
async function serialized<T>(task: () => Promise<T>): Promise<T> {
  const previous = hydrationQueue;
  let release: () => void = () => {};
  hydrationQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await task();
  } finally {
    release();
  }
}

async function drain(hydration: HydrationContext): Promise<void> {
  await drainHydrationTasks(hydration);
  if (hasPendingWork()) {
    const pending = complete(RESOLVED_READY);
    if (pending !== null) {
      await pending;
    }
    await drainHydrationTasks(hydration);
  }
}

type AdoptedRoot = ReturnType<typeof createRootResult>;

function disposeAdopted(adopted: AdoptedRoot | null): void {
  if (adopted === null) {
    return;
  }
  try {
    adopted.result.dispose();
  } finally {
    adopted.dispose();
  }
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
  resetIds();
  const boundaryStart = document.createComment(HYDRATE_START);
  const boundaryEnd = document.createComment(HYDRATE_END);
  element.insertBefore(boundaryStart, element.firstChild);
  element.appendChild(boundaryEnd);

  let adopted: AdoptedRoot | null = null;
  let handedOff = false;
  const lightRoot = getViewMeta(app) === null;
  const hasServerMarkup = !forceFresh && boundaryStart.nextSibling !== boundaryEnd;

  try {
    if (hasServerMarkup) {
      const context: HydrationContext = beginHydration(onMismatch);
      try {
        const window = {
          start: boundaryStart,
          end: boundaryEnd,
          cursor: boundaryStart.nextSibling,
        };
        adopted = withWindow(
          window,
          () => createRootResult(app, options, runtimeOptions, create),
        );
        const pending = complete(adopted.result.settled);
        if (pending !== null) {
          await pending;
        }
        await drain(context);
        if (
          lightRoot
          && (countClientNodes() > 0 || window.cursor !== boundaryEnd)
        ) {
          disposeAdopted(adopted);
          adopted = null;
        }
      } catch (error) {
        if (!(error instanceof HydrationMismatchError)) {
          throw error;
        }
        disposeAdopted(adopted);
        adopted = null;
        emitDevtoolsError({
          name: null,
          moduleId: null,
          phase: "hydration",
          message: error.message,
        });
        onMismatch(error);
      } finally {
        endHydration(context);
      }
    }

    if (adopted === null) {
      resetIds();
      const fresh = withoutHydration(() =>
        createRootResult(app, options, runtimeOptions, create),
      );
      const pending = complete(fresh.result.settled);
      if (pending !== null) {
        await pending;
      }
      element.replaceChildren(fresh.result.node);
      handedOff = true;
      return handleFor(fresh.result, fresh.dispose);
    }

    handedOff = true;
    return handleFor(adopted.result, adopted.dispose);
  } finally {
    boundaryStart.remove();
    boundaryEnd.remove();
    if (!handedOff) {
      disposeAdopted(adopted);
    }
  }
}

const defaultOnMismatch = (error: HydrationMismatchError): void => {
  console.warn(`[silent] гидрация: ${error.message}`);
};

const EMPTY_RUNTIME_OPTIONS: RuntimeOptions = {};

async function hydrateRoot(
  target: Element | string,
  app: AnyComponent,
  options: MountOptions,
): Promise<MountHandle> {
  if (!HYDRATE) {
    throw new Error("Сборка собрана с hydrate:false — гидрация недоступна");
  }
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

interface HydratedRoot {
  readonly handle: MountHandle;
  refs: number;
  disposed: boolean;
}

const hydratedRoots = new WeakMap<Element, HydratedRoot>();
const pendingHydrations = new WeakMap<Element, Promise<MountHandle>>();

/**
 * Отдаёт вызывающему собственный handle над общим корнем. Счётчик ссылок
 * не даёт dispose одного handle погасить корень, пока им пользуется другой
 * вызов; фактическое освобождение происходит на последнем dispose.
 */
function borrowHandle(element: Element, root: HydratedRoot): MountHandle {
  root.refs += 1;
  let released = false;
  return {
    ready: root.handle.ready,
    settled: root.handle.settled,
    updateProps: (props: Record<string, unknown>) => {
      if (!root.disposed) {
        root.handle.updateProps(props);
      }
    },
    dispose: () => {
      if (released) {
        return;
      }
      released = true;
      root.refs -= 1;
      if (root.refs > 0 || root.disposed) {
        return;
      }
      root.disposed = true;
      if (hydratedRoots.get(element) === root) {
        hydratedRoots.delete(element);
      }
      root.handle.dispose();
    },
  };
}

async function hydrateOnce(
  element: Element,
  app: AnyComponent,
  options: MountOptions,
): Promise<MountHandle> {
  const inFlight = pendingHydrations.get(element);
  if (inFlight !== undefined) {
    await inFlight;
    const shared = hydratedRoots.get(element);
    if (shared !== undefined && !shared.disposed) {
      return borrowHandle(element, shared);
    }
  }

  const existing = hydratedRoots.get(element);
  if (existing !== undefined && !existing.disposed) {
    return borrowHandle(element, existing);
  }

  let settle: (handle: MountHandle) => void = () => {};
  let fail: (error: unknown) => void = () => {};
  const sharedPromise = new Promise<MountHandle>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  // Первый вызов не ждёт sharedPromise: гасим возможный unhandled rejection,
  // ошибку он получит из собственного await.
  void sharedPromise.catch(() => undefined);
  pendingHydrations.set(element, sharedPromise);

  let handle: MountHandle;
  try {
    handle = await serialized(() => hydrateRoot(element, app, options));
  } catch (error) {
    if (pendingHydrations.get(element) === sharedPromise) {
      pendingHydrations.delete(element);
    }
    fail(error);
    throw error;
  }
  if (pendingHydrations.get(element) === sharedPromise) {
    pendingHydrations.delete(element);
  }
  const root: HydratedRoot = { handle, refs: 0, disposed: false };
  hydratedRoots.set(element, root);
  settle(handle);
  return borrowHandle(element, root);
}

export async function hydrate(
  target: Element | string,
  app: AnyComponent,
  options: MountOptions = {},
): Promise<MountHandle> {
  return hydrateOnce(resolveTarget(target), app, options);
}

export interface IslandMount {
  readonly target: Element | string;
  readonly app: AnyComponent;
  readonly options?: MountOptions | undefined;
}

export async function hydrateIslands(
  islands: readonly IslandMount[],
): Promise<MountHandle[]> {
  const handles: MountHandle[] = [];
  for (const island of islands) {
    handles.push(await hydrate(island.target, island.app, island.options ?? {}));
  }
  return handles;
}
