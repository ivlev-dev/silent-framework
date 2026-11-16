import type { Children } from "./jsx.js";
import { applyProps, collectNodes, createElement } from "./dom.js";

export {
  effect,
  fragment,
  insert,
  ssrRaw,
  ssrValue,
  text,
  attr,
  prop,
  innerHtml,
  style,
  spread,
  on,
  ref,
  template,
  templateHoles,
  dynamic,
  bindValue,
  bindChecked,
  bindSource,
  attachDisposer,
  NODE_DISPOSER,
} from "./dom.js";

export {
  classNames,
  normalizeClass,
  normalizeStyle,
  styleValue,
  type ClassDictionary,
  type ClassNameValue,
  type StyleInput,
  type StyleObject,
  type StylePrimitive,
} from "./class-style.js";
export { updateProps, type PropsUpdater } from "./props-update.js";

export { For, Show, type ForProps } from "./control-flow.js";
export { Keyed, mapKeyed, type KeyedProps, type KeyedRender, type KeySelector } from "./keyed.js";
export { Index, type IndexProps } from "./index-list.js";
export { Match, Switch, type MatchProps, type SwitchProps } from "./switch.js";
export { ErrorBoundary, type ErrorBoundaryProps } from "./error-boundary.js";
export { Suspense, lazy, type SuspenseProps, type LazyOptions } from "./suspense.js";
export {
  Head,
  type HeadProps,
  type HeadMetaProps,
  type HeadLinkProps,
  type HeadStyleProps,
  type HeadValue,
} from "./head.js";
export {
  ResourceCache,
  clearResourceCache,
  createResource,
  createResourceCache,
  sharedResourceCache,
  type Resource,
  type ResourceFetchContext,
  type ResourceFetcher,
  type ResourceOptions,
  type ResourceStatus,
} from "./resource.js";
export {
  component,
  createComponent,
  getOwnReady,
  getReady,
  getViewMeta,
  getComponentName,
  isViewComponent,
  setDefaultPreloader,
  setErrorHandler,
  setFallback,
  setPreloader,
  whenIdle,
  whenSettled,
  COMPONENT_READY,
  COMPONENT_DISPOSE,
  PRELOADER,
  VIEW_META,
} from "./component.js";

export type { JSX, Children, Child } from "./jsx.js";
export type { AnyComponent, Preloader, ViewMeta, ViewRuntimeContext } from "./types.js";

export const Fragment = Symbol.for("silent.fragment");

const VIEW_META = Symbol.for("silent.view");

type JsxComponent = (props: never) => Node;
type JsxType = string | symbol | JsxComponent;
type JsxProps = Record<string, unknown> | null | undefined;

export function jsx(type: JsxType, props: JsxProps, key?: string | number): Node {
  const source: Record<string, unknown> = props ?? {};
  if (typeof key !== "string" && typeof key !== "number") {
    return jsxValue(type, source);
  }
  const rest: Record<string, unknown> = { ...source };
  delete rest["key"];
  return jsxValue(type, rest);
}

export function jsxs(type: JsxType, props: JsxProps, key?: string | number): Node {
  return jsx(type, props, key);
}

export const jsxDEV = jsx;

function jsxValue(type: JsxType, props: Record<string, unknown>): Node {
  if (typeof type === "string") {
    const element = createElement(type);
    applyProps(element, props);
    return element;
  }
  if (type === Fragment) {
    return fragmentValue(props);
  }
  if (typeof type === "function") {
    const meta = (type as { [VIEW_META]?: unknown })[VIEW_META];
    if (meta !== undefined) {
      throw new Error(
        "Компонент использует метаданные silent.view: для его рендера нужен плагин @ivlev-dev/silent-vite",
      );
    }
    const result = (type as (props: Record<string, unknown>) => Node)(props);
    return result ?? document.createComment("silent-empty");
  }
  throw new Error("Неизвестный тип JSX-элемента");
}

function fragmentValue(props: Record<string, unknown>): Node {
  const container = document.createDocumentFragment();
  const children = props["children"];
  if (children === undefined) {
    return container;
  }
  const nodes = collectNodes(children as Children);
  for (let index = 0; index < nodes.length; index += 1) {
    container.appendChild(nodes[index]!);
  }
  return container;
}
