import type { ServerBackend, ServerTemplate } from "@ivlev-dev/silent-core";
import {
  RawAttr,
  RawNode,
  RawText,
  type RawContentMode,
  type RawHole,
} from "./dom/raw.js";
import { pushValue } from "./dom/serialize-value.js";
import { escapeText } from "./dom/serializer.js";
import {
  getTemplate,
  setTemplate,
  type ParsedTemplate,
  type StaticHole,
} from "./template-cache.js";

const METADATA = /<(?:title|meta|link)[\s/>]/i;
const MARKER =
  /<!--silent-hole-(\d+)-->|<!--silent-attr-text-(\d+)-->|<!--silent-attr-raw-(\d+)-->|<!--silent-attr-html-(\d+)-->|<!--silent-static-(\d+)-(class|style)-->|<!--silent-attr-(\d+)-->/g;
const ATTR_MARKER = /data-silent-a-(\d+)=""/g;
const STATIC_ATTR = /\s(class|style)\s*=\s*"([^"]*)"/g;
const TEXT_MARKER = "data-silent-text";
const RCDATA_TAGS: ReadonlySet<string> = new Set(["textarea", "title", "style", "script"]);
const RAW_TEXT_TAGS: ReadonlySet<string> = new Set(["style", "script"]);

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
  readonly tags: ReadonlyMap<number, string>;
  readonly groups: ReadonlyMap<number, number>;
  readonly staticText: ReadonlyMap<string, string>;
}

interface StaticAttr {
  readonly name: string;
  readonly text: string;
}

function extractStatics(tag: string): { cleaned: string; statics: readonly StaticAttr[] } {
  STATIC_ATTR.lastIndex = 0;
  const matches: Array<{ start: number; end: number; name: string; text: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = STATIC_ATTR.exec(tag)) !== null) {
    matches.push({
      start: match.index,
      end: match.index + match[0].length,
      name: (match[1] ?? "").toLowerCase(),
      text: match[0],
    });
  }
  if (matches.length === 0) {
    return { cleaned: tag, statics: [] };
  }
  let cleaned = "";
  let cursor = 0;
  for (const entry of matches) {
    cleaned += tag.slice(cursor, entry.start);
    cursor = entry.end;
  }
  cleaned += tag.slice(cursor);
  const statics: StaticAttr[] = [];
  for (const entry of matches) {
    if (statics.some((item) => item.name === entry.name)) {
      continue;
    }
    statics.push({ name: entry.name, text: entry.text });
  }
  return { cleaned, statics };
}

function rewriteTagMarkers(html: string): RewrittenTemplate {
  let prepared = "";
  let index = 0;
  const tags = new Map<number, string>();
  const groups = new Map<number, number>();
  const staticText = new Map<string, string>();
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
    const extracted = extractStatics(tag);
    const group = ids[0] ?? 0;
    for (const id of ids) {
      tags.set(id, name);
      groups.set(id, group);
    }
    prepared += extracted.cleaned.slice(0, extracted.cleaned.length - cut);
    for (const entry of extracted.statics) {
      staticText.set(`${group}:${entry.name}`, entry.text);
      prepared += `<!--silent-static-${group}-${entry.name}-->`;
    }
    for (const id of ids) {
      prepared += `<!--silent-attr-${id}-->`;
    }
    prepared += selfClosing ? "/>" : ">";
    if (!selfClosing && (RCDATA_TAGS.has(name) || extracted.cleaned.includes(TEXT_MARKER))) {
      const kind = RAW_TEXT_TAGS.has(name)
        ? "raw"
        : RCDATA_TAGS.has(name)
          ? "text"
          : "html";
      for (const id of ids) {
        prepared += `<!--silent-attr-${kind}-${id}-->`;
      }
    }
  }
  return { prepared, tags, groups, staticText };
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
  const rewritten = html.includes("data-silent-a-") ? rewriteTagMarkers(html) : null;
  const prepared = rewritten === null ? html : rewritten.prepared;
  const parts: string[] = [];
  const kinds: number[] = [];
  const ids: number[] = [];
  const staticNames: string[] = [];
  let last = 0;
  MARKER.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MARKER.exec(prepared)) !== null) {
    parts.push(prepared.slice(last, match.index));
    if (match[1] !== undefined) {
      kinds.push(0);
      ids.push(Number(match[1]));
      staticNames.push("");
    } else if (match[2] !== undefined) {
      kinds.push(2);
      ids.push(Number(match[2]));
      staticNames.push("");
    } else if (match[3] !== undefined) {
      kinds.push(3);
      ids.push(Number(match[3]));
      staticNames.push("");
    } else if (match[4] !== undefined) {
      kinds.push(4);
      ids.push(Number(match[4]));
      staticNames.push("");
    } else if (match[5] !== undefined) {
      kinds.push(5);
      ids.push(Number(match[5]));
      staticNames.push(match[6] ?? "");
    } else {
      kinds.push(1);
      ids.push(Number(match[7]));
      staticNames.push("");
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
  const attrModes: number[] = [];
  const attrTags: (string | undefined)[] = [];
  const attrGroups: number[] = [];
  const statics: StaticHole[] = [];
  const initial: (string | undefined)[] = new Array<string | undefined>(count);
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
      } else if (kind === 5) {
        statics.push({ position, group: id, name: staticNames[position] ?? "" });
        holesOrdered = false;
      } else {
        attrTexts[id] = position;
        attrModes[id] = kind === 2 ? 0 : kind === 3 ? 1 : 2;
        holesOrdered = false;
      }
    }
    if (kind !== 0 || id !== holeIndex) {
      holesOrdered = false;
    }
    holeIndex += 1;
  }
  if (rewritten !== null) {
    for (let id = 0; id < attrs.length; id += 1) {
      if (attrs[id] === undefined) {
        continue;
      }
      const tag = rewritten.tags.get(id);
      if (tag !== undefined) {
        attrTags[id] = tag;
      }
      const group = rewritten.groups.get(id);
      if (group !== undefined) {
        attrGroups[id] = group;
      }
    }
    for (const entry of statics) {
      const text = rewritten.staticText.get(`${entry.group}:${entry.name}`);
      if (text !== undefined) {
        initial[entry.position] = text;
      }
    }
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
    attrModes,
    attrTags,
    attrGroups,
    statics,
    initial,
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
        true,
        parsed.initial,
      );
      const holes = parsed.holesOrdered === true ? node.holes : collectHoles(node, parsed.holes);
      const attrPositions = parsed.attrs;
      if (attrPositions === undefined || attrPositions.length === 0) {
        return { node, holes, attrs: NO_ATTRS };
      }
      const staticHoles = new Map<number, Map<string, RawHole>>();
      const staticEntries: readonly StaticHole[] = parsed.statics ?? [];
      for (const entry of staticEntries) {
        const hole = node.holeAt(entry.position);
        if (hole === undefined) {
          continue;
        }
        let group = staticHoles.get(entry.group);
        if (group === undefined) {
          group = new Map<string, RawHole>();
          staticHoles.set(entry.group, group);
        }
        group.set(entry.name, hole);
      }
      const attrs = attrPositions.map((position, id) => {
        const hole = node.holeAt(position);
        if (hole === undefined) {
          return undefined;
        }
        const textPosition = parsed.attrTexts?.[id];
        const content = textPosition === undefined ? undefined : node.holeAt(textPosition);
        const mode: RawContentMode =
          parsed.attrModes?.[id] === 1 ? "raw" : parsed.attrModes?.[id] === 2 ? "html" : "text";
        const tag = parsed.attrTags?.[id];
        const group = parsed.attrGroups?.[id];
        return new RawAttr(
          hole,
          content,
          mode,
          tag,
          mode === "raw" ? tag : undefined,
          group === undefined ? undefined : staticHoles.get(group),
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
