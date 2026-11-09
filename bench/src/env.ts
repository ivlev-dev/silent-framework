import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
});

const globals: ReadonlyArray<readonly [string, unknown]> = [
  ["window", dom.window],
  ["document", dom.window.document],
  ["Node", dom.window.Node],
  ["Element", dom.window.Element],
  ["HTMLElement", dom.window.HTMLElement],
  ["Text", dom.window.Text],
  ["Comment", dom.window.Comment],
  ["DocumentFragment", dom.window.DocumentFragment],
  ["SVGElement", dom.window.SVGElement],
  ["NodeFilter", dom.window.NodeFilter],
  ["MutationObserver", dom.window.MutationObserver],
];

for (const [name, value] of globals) {
  Object.defineProperty(globalThis, name, {
    value,
    configurable: true,
    writable: true,
  });
}

export const documentRef: Document = dom.window.document;

export function createHost(): HTMLElement {
  return documentRef.createElement("div");
}
