import type { Container } from "@ivlev-dev/silent-di";
import {
  ViewRuntimeUnavailableError,
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
import type { HydrationMismatchError } from "./hydration.js";
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

  const factory = componentFactoryFor(app);
  let create: ComponentFactory = factory instanceof Promise ? await factory : factory;
  let created: ReturnType<typeof createRootResult>;
  try {
    created = createRootResult(app, options, runtimeOptions, create);
  } catch (error) {
    if (!viewEnabled || !(error instanceof ViewRuntimeUnavailableError)) {
      throw error;
    }
    create = await loadViewFactory();
    created = createRootResult(app, options, runtimeOptions, create);
  }

  if (options.clear !== false) {
    element.replaceChildren();
  }
  element.appendChild(created.result.node);

  await created.result.ready;

  return handleFor(created.result, created.dispose);
}
