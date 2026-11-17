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

export interface PartSink {
  push(...values: string[]): void;
}

const partsPool: string[][] = [];
let partsDepth = 0;

export function acquireParts(): string[] {
  const depth = partsDepth;
  partsDepth += 1;
  const cached = partsPool[depth];
  if (cached === undefined) {
    const created: string[] = [];
    partsPool[depth] = created;
    return created;
  }
  cached.length = 0;
  return cached;
}

export function releaseParts(parts: string[]): void {
  parts.length = 0;
  partsDepth -= 1;
}

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

function pushAttributes(element: ElementImpl, parts: PartSink): void {
  if (element.attributeCount === 0) {
    return;
  }
  for (const attribute of element.attributes) {
    parts.push(" ", attribute.name, '="', escapeAttribute(attribute.value), '"');
  }
}

function pushElement(element: ElementImpl, parts: PartSink): void {
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
  renderInto?: (parts: PartSink) => void;
  render?: () => string;
}

export function pushNode(node: DomNode, parts: PartSink): void {
  const raw = node as unknown as RenderableNode;
  const render = raw.render;
  if (typeof render === "function") {
    parts.push(render.call(node));
    return;
  }
  const renderInto = raw.renderInto;
  if (typeof renderInto === "function") {
    renderInto.call(node, parts);
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

function pushChildren(node: DomNode, parts: PartSink): void {
  for (const child of node.childNodes) {
    pushNode(child, parts);
  }
}

export function serializeNodeChunks(
  node: DomNode,
  chunkSize: number,
  emit: (chunk: string) => void,
): void {
  const buffer: string[] = [];
  let length = 0;
  const flush = (): void => {
    if (length === 0) {
      return;
    }
    const text = buffer.join("");
    buffer.length = 0;
    length = 0;
    if (text.length <= chunkSize) {
      emit(text);
      return;
    }
    for (let index = 0; index < text.length; index += chunkSize) {
      emit(text.slice(index, index + chunkSize));
    }
  };
  const sink: PartSink = {
    push(...values: string[]): void {
      for (const value of values) {
        if (value.length === 0) {
          continue;
        }
        buffer.push(value);
        length += value.length;
      }
      if (length >= chunkSize) {
        flush();
      }
    },
  };
  pushNode(node, sink);
  flush();
}

export function serializeNode(node: DomNode): string {
  const raw = node as unknown as RenderableNode;
  const render = raw.render;
  if (typeof render === "function") {
    return render.call(node);
  }
  const parts = acquireParts();
  try {
    pushNode(node, parts);
    return parts.join("");
  } finally {
    releaseParts(parts);
  }
}

export function serializeChildren(node: DomNode): string {
  const parts = acquireParts();
  try {
    pushChildren(node, parts);
    return parts.join("");
  } finally {
    releaseParts(parts);
  }
}

export function serializeBetween(start: DomNode, end: DomNode): string {
  const parts = acquireParts();
  try {
    let node = start.nextSibling;
    while (node !== null && node !== end) {
      pushNode(node, parts);
      node = node.nextSibling;
    }
    return parts.join("");
  } finally {
    releaseParts(parts);
  }
}
