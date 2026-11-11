import type { ServerBackend, ServerTemplate } from "@ivlev-dev/silent-core";
import { RawNode } from "./dom/raw.js";
import { pushValue } from "./dom/serialize-value.js";
import { escapeText } from "./dom/serializer.js";
import { getTemplate, setTemplate, type ParsedTemplate } from "./template-cache.js";

const METADATA = /<(?:title|meta|link)[\s/>]/i;
const HOLE = /<!--silent-hole-(\d+)-->/;

function serializeValue(value: unknown): string {
  const type = typeof value;
  if (type === "string") {
    return escapeText(value as string);
  }
  if (value === null || value === undefined) {
    return "";
  }
  if (type === "number" || type === "bigint") {
    return String(value);
  }
  if (type === "boolean") {
    return "";
  }
  const parts: string[] = [];
  pushValue(value, parts);
  const only = parts[0];
  if (only === undefined) {
    return "";
  }
  return parts.length === 1 ? only : parts.join("");
}

function parseTemplate(html: string): ParsedTemplate | null {
  if (html.includes("data-silent-a-") || METADATA.test(html)) {
    return null;
  }
  const segments = html.split(HOLE);
  const parts: string[] = [];
  const indexes: number[] = [];
  for (let position = 0; position < segments.length; position += 1) {
    const value = segments[position] ?? "";
    if (position % 2 === 0) {
      parts.push(value);
    } else {
      indexes.push(Number(value));
    }
  }
  if (indexes.length === 0) {
    return null;
  }
  const markers = indexes.map((index) => `<!--silent-hole-${index}-->`);
  const tails = new Array<string>(indexes.length);
  for (let position = 0; position < indexes.length; position += 1) {
    tails[position] = (markers[position] ?? "") + (parts[position + 1] ?? "");
  }
  return { parts, indexes, markers, tails };
}

export function createServerBackend(): ServerBackend {
  return {
    createTemplate(html: string): ServerTemplate | null {
      let parsed = getTemplate(html);
      if (parsed === undefined) {
        parsed = parseTemplate(html);
        setTemplate(html, parsed);
      }
      if (parsed === null) {
        return null;
      }
      const node = new RawNode(parsed.parts, parsed.indexes, parsed.markers, parsed.tails);
      return { node, holes: node.holes, attrs: [] };
    },
    serialize: serializeValue,
  };
}
