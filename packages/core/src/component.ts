import type { AnyComponent } from "./types.js";
import { createComponentLight, readMeta } from "./component-lite.js";
import { createViewResult } from "./component-view.js";
import type { ComponentResult, RuntimeOptions } from "./component-state.js";

export {
  COMPONENT_DISPOSE,
  COMPONENT_READY,
  PRELOADER,
  VIEW_META,
  getDefaultPreloader,
  getErrorHandler,
  getReady,
  getRuntimeOptions,
  hasPendingWork,
  setDefaultPreloader,
  setErrorHandler,
  setReady,
  trackAsyncWork,
  whenIdle,
  withRuntimeOptions,
  type ComponentResult,
  type RuntimeOptions,
} from "./component-state.js";

export {
  component,
  getComponentDispose,
  getComponentName,
  getViewMeta,
  isViewComponent,
  setFallback,
  setPreloader,
} from "./component-lite.js";

export function createComponent(
  component: AnyComponent,
  props: Record<string, unknown> = {},
  options: RuntimeOptions = {},
): ComponentResult {
  const meta = readMeta(component);
  if (meta === null) {
    return createComponentLight(component, props, options);
  }
  return createViewResult(component, meta, props, options);
}
