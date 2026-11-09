import { getViewMeta } from "./component.js";
import { getViewInstances } from "./registry.js";
import type { AnyComponent, ViewMeta } from "./types.js";

export function hmrUpdate(
  moduleId: string,
  namespace: Record<string, unknown>,
): void {
  for (const instance of getViewInstances(moduleId)) {
    const candidate = namespace[instance.name];
    if (typeof candidate !== "function") {
      continue;
    }
    const nextComponent = candidate as AnyComponent;
    const nextMeta: ViewMeta = getViewMeta(nextComponent) ?? instance.meta;
    instance.rerender(nextComponent, nextMeta);
  }
}

export function hmrInvalidate(
  moduleId: string,
  namespace?: Record<string, unknown> | readonly Record<string, unknown>[],
): void {
  const updated = Array.isArray(namespace) ? namespace[0] : namespace;
  for (const instance of getViewInstances(moduleId)) {
    const vm = instance.meta.vm;
    const vmName = typeof vm === "function" ? vm.name : "";
    const preloaderName = instance.meta.preloaderName;
    const nextVm = vmName !== "" ? updated?.[vmName] : undefined;
    const nextPreloader =
      preloaderName !== undefined ? updated?.[preloaderName] : undefined;
    if (typeof nextPreloader === "function") {
      instance.updatePreloader(nextPreloader);
    }
    if (nextVm !== undefined || typeof nextPreloader !== "function") {
      void instance.recreateVm(nextVm);
    }
  }
}
