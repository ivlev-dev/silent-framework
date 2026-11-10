import type { ServerBackend, ServerTemplate } from "@ivlev-dev/silent-core";
import { RawNode } from "./dom/raw.js";
import { serializeNode } from "./dom/serializer.js";
import type { DomNode } from "./dom/types.js";

const METADATA = /<(?:title|meta|link)[\s/>]/i;

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function serializeValue(value: unknown): string {
  if (value === null || value === undefined || typeof value === "boolean") {
    return "";
  }
  if (typeof value === "string") {
    return escapeText(value);
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return escapeText(String(value));
  }
  if (Array.isArray(value)) {
    let result = "";
    for (const item of value) {
      result += serializeValue(item);
    }
    return result;
  }
  if (value instanceof RawNode) {
    return value.render();
  }
  if (value instanceof Node) {
    return serializeNode(value as unknown as DomNode);
  }
  if (typeof value === "function") {
    return serializeValue((value as () => unknown)());
  }
  return escapeText(String(value));
}

export function createServerBackend(): ServerBackend {
  const cache = new Map<string, { parts: string[]; indexes: number[] } | null>();
  return {
    createTemplate(html: string): ServerTemplate | null {
      let parsed = cache.get(html);
      if (parsed === undefined) {
        if (html.includes("data-silent-a-") || METADATA.test(html)) {
          cache.set(html, null);
          parsed = null;
        } else {
          const segments = html.split(/<!--silent-hole-(\d+)-->/);
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
          parsed = indexes.length === 0 ? null : { parts, indexes };
          cache.set(html, parsed);
        }
      }
      if (parsed === null) {
        return null;
      }
      const node = new RawNode(parsed.parts, parsed.indexes);
      return { node, holes: node.holes, attrs: [] };
    },
    serialize(value: unknown): string {
      return serializeValue(value);
    },
  };
}
