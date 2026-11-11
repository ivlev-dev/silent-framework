import type { Children } from "./jsx.js";
import type { AnyComponent, Preloader, ViewMeta } from "./types.js";
import { collectNodes, disposeNode } from "./dom.js";
import { settleNodes } from "./dom-hydration-state.js";
import { extractMetadata, isMetadataFree } from "./metadata.js";
import { currentWindow, isHydrating } from "./hydration-state.js";
import { isMatchNode } from "./match-node.js";
import {
  COMPONENT_DISPOSE,
  PRELOADER,
  RESOLVED_READY,
  VIEW_META,
  ViewRuntimeUnavailableError,
  getComponentCreator,
  getReady,
  getRuntimeOptions,
  withRuntimeOptions,
  type ComponentResult,
  type RuntimeOptions,
} from "./component-state.js";

interface DisposeHost {
  [COMPONENT_DISPOSE]?: () => void;
}

export function readMeta(component: AnyComponent): ViewMeta | null {
  const candidate = (component as unknown as Record<PropertyKey, unknown>)[
    VIEW_META
  ];
  if (candidate === null || typeof candidate !== "object") {
    return null;
  }
  const meta = candidate as Record<PropertyKey, unknown>;
  const vm = meta["vm"];
  if (vm === undefined) {
    return null;
  }
  const result: {
    vm: unknown;
    preloader?: Preloader;
    preloaderName?: string;
    name?: string;
    moduleId?: string;
  } = { vm };
  const preloader = meta["preloader"];
  if (typeof preloader === "function") {
    result.preloader = preloader as Preloader;
  }
  const preloaderName = meta["preloaderName"];
  if (typeof preloaderName === "string") {
    result.preloaderName = preloaderName;
  }
  const name = meta["name"];
  if (typeof name === "string") {
    result.name = name;
  }
  const moduleId = meta["moduleId"];
  if (typeof moduleId === "string") {
    result.moduleId = moduleId;
  }
  return result;
}

export function getViewMeta(component: AnyComponent): ViewMeta | null {
  return readMeta(component);
}

export function setPreloader<C extends AnyComponent>(
  component: C,
  preloader: Preloader,
): C {
  (component as unknown as Record<PropertyKey, unknown>)[PRELOADER] = preloader;
  return component;
}

export const setFallback = setPreloader;

export function getComponentName(component: AnyComponent): string {
  const meta = readMeta(component);
  if (meta?.name !== undefined) {
    return meta.name;
  }
  return component.name || "Anonymous";
}

export function isViewComponent(componentFn: AnyComponent): boolean {
  return readMeta(componentFn) !== null;
}

export function getComponentDispose(node: Node): (() => void) | null {
  const dispose = (node as DisposeHost)[COMPONENT_DISPOSE];
  return typeof dispose === "function" ? dispose : null;
}

export function normalizeNodes(value: unknown): Node[] {
  return collectNodes(value as Children);
}

export function toNode(value: unknown): Node {
  const nodes = normalizeNodes(value);
  if (nodes.length === 1) {
    const node = nodes[0];
    if (node !== undefined) {
      return node;
    }
  }
  const fragment = document.createDocumentFragment();
  for (const node of nodes) {
    fragment.appendChild(node);
  }
  return fragment;
}

export function component(
  componentFn: AnyComponent,
  props: Record<string, unknown>,
): Node {
  const options = getRuntimeOptions();
  if (readMeta(componentFn) === null) {
    return createComponentLight(componentFn, props, options).node;
  }
  const creator = getComponentCreator();
  if (creator === null) {
    throw new ViewRuntimeUnavailableError();
  }
  return creator(componentFn, props, options).node;
}

export function createComponentLight(
  component: AnyComponent,
  props: Record<string, unknown>,
  options: RuntimeOptions,
): ComponentResult {
  const result = withRuntimeOptions(options, () =>
    (component as unknown as (props: Record<string, unknown>) => unknown)(props),
  );
  if (result instanceof Node) {
    if (result instanceof Comment && isMatchNode(result)) {
      return {
        node: result,
        ready: RESOLVED_READY,
        dispose: () => {},
      };
    }
    if (!(result instanceof DocumentFragment) && isMetadataFree(result)) {
      if (isHydrating()) {
        settleNodes(currentWindow()?.end ?? null, result);
      }
      return {
        node: result,
        ready: getReady(result),
        dispose: () => {
          disposeNode(result);
          result.parentNode?.removeChild(result);
        },
      };
    }
  }
  const normalized = normalizeNodes(result);
  if (isHydrating()) {
    settleNodes(currentWindow()?.end ?? null, result);
  }
  const nodes = extractMetadata(normalized);
  let node: Node;
  if (nodes.length === 1) {
    const single = nodes[0];
    node = single ?? document.createComment("silent-empty");
  } else {
    const fragment = document.createDocumentFragment();
    for (const child of nodes) {
      fragment.appendChild(child);
    }
    node = fragment;
  }
  return {
    node,
    ready: getReady(node),
    dispose: () => {
      for (const child of nodes) {
        disposeNode(child);
        child.parentNode?.removeChild(child);
      }
    },
  };
}
