import { HTML_NAMESPACE, NODE_COMMENT, NODE_DOCUMENT_FRAGMENT, NODE_ELEMENT, NODE_TEXT } from "./types.js";
import type { DomNode } from "./types.js";
import { ElementImpl, TextImpl } from "./node.js";
import { splitChunks } from "../chunk.js";

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

const RAW_TEXT_ELEMENTS: ReadonlySet<string> = new Set(["script", "style"]);

const ESCAPE_TEXT = /[&<>]/;
const ESCAPE_ATTRIBUTE = /[&<>"]/;
const REPLACE_TEXT = /[&<>]/g;
const REPLACE_ATTRIBUTE = /[&<>"]/g;

export interface PartSink {
  readonly stream?: boolean | undefined;
  readonly markers?: boolean | undefined;
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

function pushElement(element: ElementImpl, parts: PartSink, markers: boolean): void {
  const tag = element.localName;
  parts.push("<", tag);
  pushAttributes(element, parts);
  parts.push(">");
  if (element.namespaceURI === HTML_NAMESPACE && VOID_ELEMENTS.has(tag)) {
    return;
  }
  if (element.namespaceURI === HTML_NAMESPACE && tag === "select") {
    element.syncSelectOptions();
  }
  if (element.namespaceURI === HTML_NAMESPACE && RAW_TEXT_ELEMENTS.has(tag)) {
    pushRawChildren(element, parts, markers);
  } else {
    pushChildren(element, parts, markers);
  }
  parts.push("</", tag, ">");
}

interface RenderableNode {
  renderInto?: (parts: PartSink) => void;
  render?: () => string;
}

export function pushNode(node: DomNode, parts: PartSink, markers = true): void {
  const raw = node as unknown as RenderableNode;
  const renderInto = raw.renderInto;
  if (parts.stream === true && typeof renderInto === "function") {
    renderInto.call(node, parts);
    return;
  }
  const render = raw.render;
  if (typeof render === "function") {
    parts.push(render.call(node));
    return;
  }
  if (typeof renderInto === "function") {
    renderInto.call(node, parts);
    return;
  }
  switch (node.nodeType) {
    case NODE_ELEMENT:
      if (node instanceof ElementImpl) {
        pushElement(node, parts, markers);
      }
      return;
    case NODE_TEXT:
      if (node instanceof TextImpl) {
        parts.push(escapeText(node.data));
      }
      return;
    case NODE_COMMENT:
      if (node instanceof TextImpl) {
        if (!markers && node.data.startsWith("silent-")) {
          return;
        }
        parts.push("<!--", node.data, "-->");
      }
      return;
    case NODE_DOCUMENT_FRAGMENT:
      pushChildren(node, parts, markers);
      return;
    default:
      return;
  }
}

function pushChildren(node: DomNode, parts: PartSink, markers: boolean): void {
  for (const child of node.childNodes) {
    pushNode(child, parts, markers);
  }
}

function pushRawChildren(node: DomNode, parts: PartSink, markers: boolean): void {
  for (const child of node.childNodes) {
    if (child.nodeType === NODE_TEXT && child instanceof TextImpl) {
      parts.push(child.data);
      continue;
    }
    pushNode(child, parts, markers);
  }
}

export function serializeNodeChunks(
  node: DomNode,
  chunkSize: number,
  emit: (chunk: string) => void,
  markers = true,
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
    for (const chunk of splitChunks(text, chunkSize)) {
      emit(chunk);
    }
  };
  const sink: PartSink = {
    stream: true,
    markers,
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

export function serializeNode(node: DomNode, markers = true): string {
  const raw = node as unknown as RenderableNode;
  if (markers) {
    const render = raw.render;
    if (typeof render === "function") {
      return render.call(node);
    }
  }
  if (!markers) {
    const out: string[] = [];
    const sink: PartSink = {
      stream: true,
      markers: false,
      push(...values: string[]): void {
        for (const value of values) {
          if (value !== "") {
            out.push(value);
          }
        }
      },
    };
    pushNode(node, sink, false);
    return out.join("");
  }
  const parts = acquireParts();
  try {
    pushNode(node, parts, true);
    return parts.join("");
  } finally {
    releaseParts(parts);
  }
}

export function serializeChildren(node: DomNode, markers = true): string {
  const parts = acquireParts();
  try {
    pushChildren(node, parts, markers);
    return parts.join("");
  } finally {
    releaseParts(parts);
  }
}

export function serializeBetween(
  start: DomNode,
  end: DomNode,
  markers = true,
): string {
  const parts = acquireParts();
  try {
    let node = start.nextSibling;
    while (node !== null && node !== end) {
      pushNode(node, parts, markers);
      node = node.nextSibling;
    }
    return parts.join("");
  } finally {
    releaseParts(parts);
  }
}
