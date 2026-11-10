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

function escapeText(value: string): string {
  if (!ESCAPE_TEXT.test(value)) {
    return value;
  }
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttribute(value: string): string {
  if (!ESCAPE_ATTRIBUTE.test(value)) {
    return value;
  }
  return escapeText(value).replace(/"/g, "&quot;");
}

function serializeAttributes(element: ElementImpl): string {
  let result = "";
  for (const attribute of element.attributes) {
    result += ` ${attribute.name}="${escapeAttribute(attribute.value)}"`;
  }
  return result;
}

function serializeElement(element: ElementImpl): string {
  const tag = element.localName;
  const opening = `<${tag}${serializeAttributes(element)}>`;
  if (element.namespaceURI === HTML_NAMESPACE && VOID_ELEMENTS.has(tag)) {
    return opening;
  }
  return `${opening}${serializeChildren(element)}</${tag}>`;
}

export function serializeNode(node: DomNode): string {
  switch (node.nodeType) {
    case NODE_ELEMENT:
      return node instanceof ElementImpl ? serializeElement(node) : "";
    case NODE_TEXT:
      return node instanceof TextImpl ? escapeText(node.data) : "";
    case NODE_COMMENT:
      return node instanceof TextImpl ? `<!--${node.data}-->` : "";
    case NODE_DOCUMENT_FRAGMENT:
      return serializeChildren(node);
    default:
      return "";
  }
}

export function serializeChildren(node: DomNode): string {
  const parts: string[] = [];
  for (const child of node.childNodes) {
    parts.push(serializeNode(child));
  }
  return parts.join("");
}
