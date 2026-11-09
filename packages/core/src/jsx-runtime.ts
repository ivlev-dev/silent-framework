import type { Children } from "./jsx.js";
import { applyProps, collectNodes, createElement } from "./dom.js";

export {
  effect,
  fragment,
  insert,
  text,
  attr,
  prop,
  style,
  spread,
  on,
  ref,
  template,
  templateHoles,
  dynamic,
  attachDisposer,
  NODE_DISPOSER,
} from "./dom.js";

export { For, Show } from "./control-flow.js";
export { Suspense, lazy, type SuspenseProps, type LazyOptions } from "./suspense.js";
export {
  component,
  createComponent,
  getReady,
  getViewMeta,
  getComponentName,
  isViewComponent,
  setDefaultPreloader,
  setErrorHandler,
  setFallback,
  setPreloader,
  whenIdle,
  COMPONENT_READY,
  COMPONENT_DISPOSE,
  PRELOADER,
  VIEW_META,
} from "./component.js";

export type { JSX, Children, Child } from "./jsx.js";
export type { AnyComponent, Preloader, ViewMeta, ViewRuntimeContext } from "./types.js";

export const Fragment = Symbol.for("silent.fragment");

const VIEW_META = Symbol.for("silent.view");

type JsxType = string | symbol | ((props: Record<string, unknown>) => Node);
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
        "Компонент использует метаданные silent.view: для его рендера нужен плагин @ivlev98/silent-vite",
      );
    }
    const result = type(props);
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
  for (const node of collectNodes(children as Children)) {
    container.appendChild(node);
  }
  return container;
}
