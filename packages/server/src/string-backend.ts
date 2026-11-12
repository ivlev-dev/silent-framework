import type { ServerBackend, ServerTemplate } from "@ivlev-dev/silent-core";
import { RawAttr, RawNode, RawText, type RawHole } from "./dom/raw.js";
import { pushValue } from "./dom/serialize-value.js";
import { escapeText } from "./dom/serializer.js";
import { getTemplate, setTemplate, type ParsedTemplate } from "./template-cache.js";

const METADATA = /<(?:title|meta|link)[\s/>]/i;
const MARKER = /<!--silent-hole-(\d+)-->|<!--silent-attr-text-(\d+)-->|<!--silent-attr-(\d+)-->/g;
const ATTR_MARKER = /data-silent-a-(\d+)=""/g;
const RCDATA_TAGS: ReadonlySet<string> = new Set(["textarea", "title"]);

function isLetter(code: number): boolean {
  return (code >= 97 && code <= 122) || (code >= 65 && code <= 90);
}

function findTagEnd(source: string, start: number): number {
  let quote = 0;
  for (let index = start; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    if (quote !== 0) {
      if (code === quote) {
        quote = 0;
      }
      continue;
    }
    if (code === 34 || code === 39) {
      quote = code;
      continue;
    }
    if (code === 62) {
      return index;
    }
  }
  return -1;
}

function tagNameOf(tag: string): string {
  let start = 1;
  while (start < tag.length) {
    const code = tag.charCodeAt(start);
    if (!isLetter(code) && !(code >= 48 && code <= 57) && code !== 45 && code !== 58) {
      break;
    }
    start += 1;
  }
  return tag.slice(1, start).toLowerCase();
}

interface RewrittenTemplate {
  readonly prepared: string;
}

function rewriteTagMarkers(html: string): RewrittenTemplate {
  let prepared = "";
  let index = 0;
  while (index < html.length) {
    const open = html.indexOf("<", index);
    if (open === -1) {
      prepared += html.slice(index);
      break;
    }
    prepared += html.slice(index, open);
    if (!isLetter(html.charCodeAt(open + 1))) {
      prepared += "<";
      index = open + 1;
      continue;
    }
    const end = findTagEnd(html, open + 1);
    if (end === -1) {
      prepared += html.slice(open);
      break;
    }
    const tag = html.slice(open, end + 1);
    const ids: number[] = [];
    ATTR_MARKER.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = ATTR_MARKER.exec(tag)) !== null) {
      ids.push(Number(match[1]));
    }
    index = end + 1;
    if (ids.length === 0) {
      prepared += tag;
      continue;
    }
    const name = tagNameOf(tag);
    const selfClosing = tag.charCodeAt(tag.length - 2) === 47;
    const cut = selfClosing ? 2 : 1;
    prepared += tag.slice(0, tag.length - cut);
    for (const id of ids) {
      prepared += `<!--silent-attr-${id}-->`;
    }
    prepared += selfClosing ? "/>" : ">";
    if (!selfClosing && RCDATA_TAGS.has(name)) {
      for (const id of ids) {
        prepared += `<!--silent-attr-text-${id}-->`;
      }
    }
  }
  return { prepared };
}

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
  if (METADATA.test(html)) {
    return null;
  }
  const prepared = html.includes("data-silent-a-")
    ? rewriteTagMarkers(html).prepared
    : html;
  const parts: string[] = [];
  const kinds: number[] = [];
  const ids: number[] = [];
  let last = 0;
  MARKER.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MARKER.exec(prepared)) !== null) {
    parts.push(prepared.slice(last, match.index));
    if (match[1] !== undefined) {
      kinds.push(0);
      ids.push(Number(match[1]));
    } else if (match[2] !== undefined) {
      kinds.push(2);
      ids.push(Number(match[2]));
    } else {
      kinds.push(1);
      ids.push(Number(match[3]));
    }
    last = MARKER.lastIndex;
  }
  parts.push(prepared.slice(last));
  const count = kinds.length;
  const indexes = new Array<number>(count);
  const markers = new Array<string>(count);
  const tails = new Array<string>(count);
  const bare = new Array<boolean>(count);
  const holes = new Array<number>(count);
  const attrs: number[] = [];
  const attrTexts: number[] = [];
  let holesOrdered = true;
  let holeIndex = 0;
  for (let position = 0; position < count; position += 1) {
    const id = ids[position] ?? 0;
    const before = parts[position] ?? "";
    const kind = kinds[position] ?? 0;
    indexes[position] = position;
    if (kind === 0) {
      holes[position] = id;
      markers[position] = `<!--silent-hole-${id}-->`;
      tails[position] = markers[position] + (parts[position + 1] ?? "");
      bare[position] = before.length === 0 || before.charCodeAt(before.length - 1) === 62;
    } else {
      holes[position] = -1;
      markers[position] = "";
      tails[position] = parts[position + 1] ?? "";
      bare[position] = false;
      if (kind === 1) {
        attrs[id] = position;
        holesOrdered = false;
      } else {
        attrTexts[id] = position;
        holesOrdered = false;
      }
    }
    if (kind !== 0 || id !== holeIndex) {
      holesOrdered = false;
    }
    holeIndex += 1;
  }
  return {
    parts,
    indexes,
    markers,
    tails,
    bare,
    holes,
    attrs,
    attrTexts,
    holesOrdered,
  };
}

const NO_ATTRS: readonly unknown[] = [];

function collectHoles(node: RawNode, holeIds: readonly number[] | undefined): readonly RawHole[] {
  if (holeIds === undefined) {
    return [];
  }
  const holes: RawHole[] = [];
  for (let position = 0; position < holeIds.length; position += 1) {
    const id = holeIds[position];
    if (id !== undefined && id >= 0) {
      const hole = node.holeAt(position);
      if (hole !== undefined) {
        holes[id] = hole;
      }
    }
  }
  return holes;
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
      const node = new RawNode(
        parsed.parts,
        parsed.indexes,
        parsed.markers,
        parsed.tails,
        parsed.bare,
      );
      const holes = parsed.holesOrdered === true ? node.holes : collectHoles(node, parsed.holes);
      const attrPositions = parsed.attrs;
      if (attrPositions === undefined || attrPositions.length === 0) {
        return { node, holes, attrs: NO_ATTRS };
      }
      const attrs = attrPositions.map((position, id) => {
        const hole = node.holeAt(position);
        if (hole === undefined) {
          return undefined;
        }
        const textPosition = parsed.attrTexts?.[id];
        return new RawAttr(
          hole,
          textPosition === undefined ? undefined : node.holeAt(textPosition),
        );
      });
      return { node, holes, attrs };
    },
    createRaw(html: string) {
      return new RawText(html);
    },
    createFragment(parts: readonly string[], values: readonly unknown[]) {
      const count = values.length;
      if (count === 0) {
        return { node: new RawNode([parts[0] ?? ""], [], [], undefined, undefined, false) };
      }
      const indexes = new Array<number>(count);
      const tails = new Array<string>(count);
      for (let position = 0; position < count; position += 1) {
        indexes[position] = position;
        tails[position] = parts[position + 1] ?? "";
      }
      const node = new RawNode(parts, indexes, [], tails, undefined, false);
      for (let position = 0; position < count; position += 1) {
        node.holes[position]?.setValue(values[position]);
      }
      return { node };
    },
    serialize: serializeValue,
  };
}
