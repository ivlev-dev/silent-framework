import type { AnyComponent, ViewMeta } from "./types.js";

export interface ViewInstance {
  readonly id?: number;
  readonly moduleId: string;
  readonly name: string;
  readonly hydrated?: boolean;
  readonly component: AnyComponent;
  readonly meta: ViewMeta;
  readonly props: Record<string, unknown>;
  rerender(component: AnyComponent, meta: ViewMeta): void;
  replaceVm(vm: object): void;
  recreateVm(nextVm?: unknown): Promise<void>;
  updatePreloader(preloader: import("./types.js").Preloader): void;
  dispose(): void;
}

type Registry = Map<string, Set<ViewInstance>>;

const REGISTRY_KEY = Symbol.for("silent.hmr.registry");

function getRegistry(): Registry {
  const host = globalThis as unknown as Record<PropertyKey, unknown>;
  const existing = host[REGISTRY_KEY];
  if (existing instanceof Map) {
    return existing as Registry;
  }
  const registry: Registry = new Map();
  host[REGISTRY_KEY] = registry;
  return registry;
}

export function registerView(instance: ViewInstance): () => void {
  const registry = getRegistry();
  let set = registry.get(instance.moduleId);
  if (set === undefined) {
    set = new Set();
    registry.set(instance.moduleId, set);
  }
  set.add(instance);
  return () => {
    set?.delete(instance);
    if (set !== undefined && set.size === 0) {
      registry.delete(instance.moduleId);
    }
  };
}

export function getViewInstances(moduleId: string): readonly ViewInstance[] {
  return [...(getRegistry().get(moduleId) ?? [])];
}

export function getAllViewInstances(): readonly ViewInstance[] {
  const result: ViewInstance[] = [];
  for (const set of getRegistry().values()) {
    result.push(...set);
  }
  return result;
}

export function getViewRegistryStats(): { readonly modules: number; readonly views: number } {
  let modules = 0;
  let views = 0;
  for (const set of getRegistry().values()) {
    if (set.size === 0) {
      continue;
    }
    modules += 1;
    views += set.size;
  }
  return { modules, views };
}

export function disposeModuleViews(moduleId: string): void {
  const instances = getViewInstances(moduleId);
  for (const instance of instances) {
    instance.dispose();
  }
}
