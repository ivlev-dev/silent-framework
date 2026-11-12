import { HTML_NAMESPACE, NODE_COMMENT, NODE_DOCUMENT_FRAGMENT, NODE_ELEMENT, NODE_TEXT } from "./types.js";
import type { DomNode } from "./types.js";
import { ElementImpl, TextImpl } from "./node.js";

const VOID_ELEMENTS: ReadonlySet<string> = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const ESCAPE_TEXT = /[&<>]/;
const ESCAPE_ATTRIBUTE = /[&<>"]/;
const REPLACE_TEXT = /[&<>]/g;
const REPLACE_ATTRIBUTE = /[&<>"]/g;

function replaceText(char: string): string {
  if (char === "&") {
    return "&amp;";
  }
  return char === "<" ? "&lt;" : "&gt;";
}

function replaceAttribute(char: string): string {
  if (char === "&") {
    return "&amp;";
  }
  if (char === "<") {
    return "&lt;";
  }
  return char === ">" ? "&gt;" : "&quot;";
}

export function escapeText(value: string): string {
  if (!ESCAPE_TEXT.test(value)) {
    return value;
  }
  return value.replace(REPLACE_TEXT, replaceText);
}

export function escapeAttribute(value: string): string {
  if (!ESCAPE_ATTRIBUTE.test(value)) {
    return value;
  }
  return value.replace(REPLACE_ATTRIBUTE, replaceAttribute);
}

function pushAttributes(element: ElementImpl, parts: string[]): void {
  if (element.attributeCount === 0) {
    return;
  }
  for (const attribute of element.attributes) {
    parts.push(" ", attribute.name, '="', escapeAttribute(attribute.value), '"');
  }
}

function pushElement(element: ElementImpl, parts: string[]): void {
  const tag = element.localName;
  parts.push("<", tag);
  pushAttributes(element, parts);
  parts.push(">");
  if (element.namespaceURI === HTML_NAMESPACE && VOID_ELEMENTS.has(tag)) {
    return;
  }
  pushChildren(element, parts);
  parts.push("</", tag, ">");
}

interface RenderableNode {
  renderInto?: (parts: string[]) => void;
  render?: () => string;
}

export function pushNode(node: DomNode, parts: string[]): void {
  const raw = node as unknown as RenderableNode;
  const renderInto = raw.renderInto;
  if (typeof renderInto === "function") {
    renderInto.call(node, parts);
    return;
  }
  const render = raw.render;
  if (typeof render === "function") {
    parts.push(render.call(node));
    return;
  }
  switch (node.nodeType) {
    case NODE_ELEMENT:
      if (node instanceof ElementImpl) {
        pushElement(node, parts);
      }
      return;
    case NODE_TEXT:
      if (node instanceof TextImpl) {
        parts.push(escapeText(node.data));
      }
      return;
    case NODE_COMMENT:
      if (node instanceof TextImpl) {
        parts.push("<!--", node.data, "-->");
      }
      return;
    case NODE_DOCUMENT_FRAGMENT:
      pushChildren(node, parts);
      return;
    default:
      return;
  }
}

function pushChildren(node: DomNode, parts: string[]): void {
  for (const child of node.childNodes) {
    pushNode(child, parts);
  }
}

export function serializeNode(node: DomNode): string {
  const parts: string[] = [];
  pushNode(node, parts);
  return parts.join("");
}

export function serializeChildren(node: DomNode): string {
  const parts: string[] = [];
  pushChildren(node, parts);
  return parts.join("");
}
