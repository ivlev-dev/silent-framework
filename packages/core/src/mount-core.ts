import { createRoot } from "@ivlev-dev/silent-reactivity";
import { createComponentLight, getViewMeta } from "./component-lite.js";
import {
  ViewRuntimeUnavailableError,
  setComponentCreator,
  type ComponentResult,
  type RuntimeOptions,
} from "./component-state.js";
import type { AnyComponent } from "./types.js";
import type { MountHandle, MountOptions } from "./mount.js";

declare const __SILENT_VIEW__: boolean | undefined;

export const viewEnabled =
  typeof __SILENT_VIEW__ === "undefined" || __SILENT_VIEW__;

export type ComponentFactory = (
  component: AnyComponent,
  props: Record<string, unknown>,
  options: RuntimeOptions,
) => ComponentResult;

export function resolveTarget(target: Element | string): Element {
  if (typeof target === "string") {
    const element = document.querySelector(target);
    if (element === null) {
      throw new Error(`Не найден корневой элемент ${target}`);
    }
    return element;
  }
  return target;
}

export function handleFor(result: ComponentResult, rootDispose: () => void): MountHandle {
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

export async function loadViewFactory(): Promise<ComponentFactory> {
  if (!viewEnabled) {
    throw new ViewRuntimeUnavailableError();
  }
  const view = await import("./component-view.js");
  setComponentCreator(view.createComponentView);
  return view.createComponentView;
}

export function componentFactoryFor(
  app: AnyComponent,
): ComponentFactory | Promise<ComponentFactory> {
  if (!viewEnabled) {
    if (getViewMeta(app) !== null) {
      throw new ViewRuntimeUnavailableError();
    }
    return createComponentLight;
  }
  if (getViewMeta(app) === null) {
    return createComponentLight;
  }
  return loadViewFactory();
}

export function createRootResult(
  app: AnyComponent,
  options: MountOptions,
  runtimeOptions: RuntimeOptions,
  create: ComponentFactory,
): { readonly result: ComponentResult; readonly dispose: () => void } {
  let rootDispose: () => void = () => {};
  const holder: { value: ComponentResult | null } = { value: null };

  createRoot((dispose) => {
    rootDispose = dispose;
    holder.value = create(app, options.props ?? {}, runtimeOptions);
    return null;
  });

  const created = holder.value;
  if (created === null) {
    rootDispose();
    throw new Error("Не удалось создать корневой компонент");
  }
  return { result: created, dispose: rootDispose };
}
