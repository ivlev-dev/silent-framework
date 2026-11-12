import { escapeText, pushNode } from "./serializer.js";
import type { DomNode } from "./types.js";

interface RenderableValue {
  readonly render?: () => string;
  readonly renderInto?: (parts: string[]) => void;
}

export function pushValue(value: unknown, parts: string[]): void {
  const type = typeof value;
  if (type === "string") {
    if (value !== "") {
      parts.push(escapeText(value as string));
    }
    return;
  }
  if (type === "number" || type === "bigint") {
    parts.push(String(value));
    return;
  }
  if (value === null || value === undefined || type === "boolean") {
    return;
  }
  if (type === "function") {
    pushValue((value as () => unknown)(), parts);
    return;
  }
  if (Array.isArray(value)) {
    const items = value as readonly unknown[];
    for (let index = 0; index < items.length; index += 1) {
      pushValue(items[index], parts);
    }
    return;
  }
  const renderable = value as RenderableValue;
  if (typeof renderable.render === "function") {
    const text = renderable.render();
    if (text !== "") {
      parts.push(text);
    }
    return;
  }
  if (typeof renderable.renderInto === "function") {
    renderable.renderInto(parts);
    return;
  }
  if (typeof Node !== "undefined" && value instanceof Node) {
    pushNode(value as unknown as DomNode, parts);
    return;
  }
  const text = escapeText(String(value));
  if (text !== "") {
    parts.push(text);
  }
}
