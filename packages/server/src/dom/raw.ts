import { normalizeStyle, type StyleInput } from "@ivlev-dev/silent-core";
import { NODE_TEXT } from "./types.js";
import { NodeImpl } from "./node.js";
import { escapeAttribute, escapeText } from "./serializer.js";
import { pushValue } from "./serialize-value.js";

export interface RawHole {
  readonly parentNode: RawNode;
  readonly index: number;
  set(value: string): void;
  setValue(value: unknown): void;
}

const INSERT_START = "<!--silent-insert-->";
const INSERT_END = "<!--silent-insert-end-->";

const SELECT_CHUNK = /<\/?select\b[^>]*>|<option\b[^>]*>/gi;
const OPTION_VALUE = /\svalue\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const SELECTED_ATTR = /\sselected(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/i;

interface SelectState {
  readonly value: string;
  multiple: boolean;
  matched: boolean;
}

function isAttributeBoundary(char: string | undefined): boolean {
  return (
    char === undefined ||
    char === " " ||
    char === "\t" ||
    char === "\n" ||
    char === "\r" ||
    char === "\f" ||
    char === "/" ||
    char === ">"
  );
}

class MarkerAttrStripper {
  private inTag = false;
  private quote: string | null = null;

  strip(value: string): string {
    let out = "";
    let index = 0;
    while (index < value.length) {
      const char = value[index] ?? "";
      if (!this.inTag) {
        out += char;
        index += 1;
        if (char === "<") {
          this.inTag = true;
          this.quote = null;
        }
        continue;
      }
      if (this.quote !== null) {
        out += char;
        index += 1;
        if (char === this.quote) {
          this.quote = null;
        }
        continue;
      }
      if (char === ">") {
        this.inTag = false;
        out += char;
        index += 1;
        continue;
      }
      if (
        (char === " " || char === "\t" || char === "\n" || char === "\r") &&
        value.startsWith("data-silent-", index + 1)
      ) {
        let cursor = index + 1;
        while (cursor < value.length && !isAttributeBoundary(value[cursor])) {
          if (value[cursor] === "=") {
            break;
          }
          cursor += 1;
        }
        if (value[cursor] === "=") {
          cursor += 1;
          const quote = value[cursor];
          if (quote === "\"" || quote === "'") {
            cursor += 1;
            while (cursor < value.length && value[cursor] !== quote) {
              cursor += 1;
            }
            if (cursor < value.length) {
              cursor += 1;
            }
          } else {
            while (cursor < value.length && !isAttributeBoundary(value[cursor])) {
              cursor += 1;
            }
          }
        }
        index = cursor;
        continue;
      }
      out += char;
      index += 1;
    }
    return out;
  }
}

function stripHoleMarker(value: string, marker: string): string {
  if (marker !== "" && value.startsWith(marker)) {
    return value.slice(marker.length);
  }
  return value;
}

function addSelected(tag: string): string {
  if (SELECTED_ATTR.test(tag)) {
    return tag;
  }
  const closing = tag.endsWith("/>") ? "/>" : ">";
  return tag.slice(0, tag.length - closing.length) + " selected" + closing;
}

function removeSelected(tag: string): string {
  return tag.replace(SELECTED_ATTR, "");
}

function applySelectChunk(text: string, state: { active: SelectState | null }): string {
  const active = state.active;
  if (active === null && text.indexOf("<") === -1) {
    return text;
  }
  if (active !== null && /\smultiple(?=[\s/>])/i.test(text)) {
    active.multiple = true;
  }
  return text.replace(SELECT_CHUNK, (tag: string) => {
    if (tag.startsWith("</")) {
      state.active = null;
      return tag;
    }
    const name = tag.slice(1, 2).toLowerCase();
    if (name === "s") {
      return tag;
    }
    const current = state.active;
    if (current === null) {
      return tag;
    }
    const match = OPTION_VALUE.exec(tag);
    const optionValue =
      match === null ? "" : (match[1] ?? match[2] ?? match[3] ?? "");
    if (optionValue === current.value && (current.multiple || !current.matched)) {
      current.matched = true;
      return addSelected(tag);
    }
    return removeSelected(tag);
  });
}

function isTextValue(
  value: unknown,
): value is string | number | bigint | boolean | null | undefined {
  if (value === null || value === undefined) {
    return true;
  }
  const type = typeof value;
  return type === "string" || type === "number" || type === "bigint" || type === "boolean";
}

function serializeText(value: string | number | bigint | boolean | null | undefined): string {
  if (typeof value === "string") {
    return escapeText(value);
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  return "";
}

const BOOLEAN_ATTRIBUTES: ReadonlySet<string> = new Set([
  "checked",
  "selected",
  "disabled",
  "readonly",
  "multiple",
  "required",
  "autofocus",
  "hidden",
  "novalidate",
  "async",
  "defer",
  "open",
  "muted",
  "playsinline",
  "inert",
  "loop",
  "controls",
  "reversed",
]);

function attributeText(value: unknown): string {
  if (value === null || value === undefined || value === false) {
    return "";
  }
  return escapeAttribute(String(value));
}

function serializeAttribute(name: string, value: unknown): string | true | null {
  if (value === null || value === undefined || value === false) {
    return null;
  }
  if (value === true) {
    return BOOLEAN_ATTRIBUTES.has(name) ? true : `${name}="true"`;
  }
  if (name === "class" || name === "className") {
    const text = attributeText(value);
    return text === "" ? null : `class="${text}"`;
  }
  if (name === "style" && typeof value === "object") {
    const declarations = normalizeStyle(value as StyleInput);
    if (declarations === "") {
      return null;
    }
    const text = declarations.endsWith(";")
      ? declarations.slice(0, -1)
      : declarations;
    return `style="${escapeAttribute(text)}"`;
  }
  return `${name}="${attributeText(value)}"`;
}

class RawSlot {
  readonly value: unknown;

  constructor(value: unknown) {
    this.value = value;
  }
}

export type RawContentMode = "text" | "raw" | "html";

function rawText(value: string, pattern: RegExp | null): string {
  const safe = value.indexOf("<!--") === -1 ? value : value.replace(/<!--/g, "<\\!--");
  if (pattern === null) {
    return safe;
  }
  return safe.replace(pattern, (match) => "<\\/" + match.slice(2));
}

function staticAttributeText(name: string, value: unknown): string {
  if (value === null || value === undefined || value === false) {
    return "";
  }
  const serialized = serializeAttribute(name, value);
  if (serialized === null) {
    return "";
  }
  if (serialized === true) {
    return " " + name;
  }
  return " " + serialized;
}

class RawHoleImpl implements RawHole {
  readonly parentNode: RawNode;
  readonly index: number;
  private readonly slots: Array<string | RawSlot | undefined>;
  private readonly bare: boolean;

  constructor(
    parentNode: RawNode,
    index: number,
    slots: Array<string | RawSlot | undefined>,
    bare: boolean,
  ) {
    this.parentNode = parentNode;
    this.index = index;
    this.slots = slots;
    this.bare = bare;
  }

  set(value: string): void {
    this.slots[this.index] = value;
  }

  setValue(value: unknown): void {
    this.__silentServerHoleSetValue(value);
  }

  __silentServerHoleSetValue(value: unknown): boolean {
    if (this.bare && isTextValue(value)) {
      this.slots[this.index] = serializeText(value);
      return true;
    }
    this.slots[this.index] = new RawSlot(value);
    return true;
  }
}

export class RawText extends NodeImpl {
  private readonly text: string;

  constructor(text: string) {
    super(NODE_TEXT);
    this.text = text;
  }

  render(): string {
    return this.text;
  }

  renderInto(parts: import("./serializer.js").PartSink): void {
    parts.push(this.text);
  }

  override get textContent(): string {
    return this.text;
  }

  override set textContent(_value: string | null) {}

  protected override createShallowClone(): RawText {
    return new RawText(this.text);
  }
}

export class RawAttr {
  private readonly hole: RawHole;
  private readonly content: RawHole | undefined;
  private readonly mode: RawContentMode;
  private readonly tag: string | undefined;
  private readonly rawPattern: RegExp | null;
  private readonly statics: Map<string, RawHole> | undefined;
  private readonly values: Map<string, string>;
  private readonly boolean: Set<string>;

  constructor(
    hole: RawHole,
    content?: RawHole,
    mode: RawContentMode = "text",
    tag?: string,
    rawTag?: string,
    statics?: Map<string, RawHole>,
  ) {
    this.hole = hole;
    this.content = content;
    this.mode = mode;
    this.tag = tag;
    this.statics = statics;
    this.rawPattern =
      mode === "raw" && rawTag !== undefined && rawTag !== ""
        ? new RegExp("</" + rawTag, "gi")
        : null;
    this.values = new Map<string, string>();
    this.boolean = new Set<string>();
  }

  setAttribute(name: string, value: unknown): void {
    if (this.content !== undefined) {
      if (this.mode === "html") {
        if (name === "innerHTML") {
          this.setContent(value);
          return;
        }
      } else if (name === "value" || name === "textContent") {
        this.setContent(value);
        return;
      }
    }
    if (name === "value" && this.tag === "select") {
      if (value === null || value === undefined || value === false) {
        this.hole.parentNode.deleteSelectValue(this.hole.index);
        return;
      }
      this.hole.parentNode.setSelectValue(this.hole.index, String(value));
      return;
    }
    const statics = this.statics;
    if (statics !== undefined) {
      const key = name === "className" ? "class" : name;
      const hole = statics.get(key);
      if (hole !== undefined) {
        hole.set(staticAttributeText(key, value));
        this.values.delete(key);
        this.boolean.delete(key);
        return;
      }
    }
    this.setRawAttribute(name, value);
  }

  private setContent(value: unknown): void {
    const content = this.content;
    if (content === undefined) {
      return;
    }
    if (this.mode === "html") {
      content.set(value === null || value === undefined ? "" : String(value));
      return;
    }
    const text =
      value === null || value === undefined
        ? ""
        : typeof value === "string"
          ? value
          : String(value);
    if (this.mode === "raw") {
      content.set(rawText(text, this.rawPattern));
      return;
    }
    content.set(escapeText(text));
  }

  private setRawAttribute(name: string, value: unknown): void {
    const serialized = serializeAttribute(name, value);
    if (serialized === null) {
      this.values.delete(name);
      this.boolean.delete(name);
    } else if (serialized === true) {
      this.values.delete(name);
      this.boolean.add(name);
    } else {
      this.boolean.delete(name);
      this.values.set(name, serialized);
    }
    let out = "";
    for (const part of this.boolean) {
      out += " " + part;
    }
    for (const part of this.values.values()) {
      out += " " + part;
    }
    this.hole.set(out);
  }
}

export class RawNode extends NodeImpl {
  private readonly parts: readonly string[];
  private readonly indexes: readonly number[];
  private readonly markers: readonly string[];
  private readonly tails: readonly string[] | undefined;
  private readonly bare: readonly boolean[] | undefined;
  private readonly wrap: boolean;
  private readonly slots: Array<string | RawSlot | undefined>;
  private readonly holeList: RawHole[];
  private readonly selectValues = new Map<number, string>();

  constructor(
    parts: readonly string[],
    indexes: readonly number[],
    markers: readonly string[],
    tails?: readonly string[],
    bare?: readonly boolean[],
    wrap = true,
    initial?: readonly (string | undefined)[],
  ) {
    super(NODE_TEXT);
    this.parts = parts;
    this.indexes = indexes;
    this.markers = markers;
    this.tails = tails;
    this.bare = bare;
    this.wrap = wrap;
    const count = indexes.length;
    this.slots = new Array<string | RawSlot | undefined>(count);
    if (initial !== undefined) {
      for (let position = 0; position < count; position += 1) {
        const value = initial[position];
        if (value !== undefined) {
          this.slots[position] = value;
        }
      }
    }
    const holes = new Array<RawHole>(count);
    for (let position = 0; position < count; position += 1) {
      holes[position] = new RawHoleImpl(
        this,
        position,
        this.slots,
        bare?.[position] ?? false,
      );
    }
    this.holeList = holes;
  }

  get holes(): readonly RawHole[] {
    return this.holeList;
  }

  holeAt(position: number): RawHole | undefined {
    return this.holeList[position];
  }

  renderInto(parts: import("./serializer.js").PartSink): void {
    const text = this.renderText(parts.markers !== false);
    if (text !== "") {
      parts.push(text);
    }
  }

  setSelectValue(position: number, value: string): void {
    this.selectValues.set(position, value);
  }

  deleteSelectValue(position: number): void {
    this.selectValues.delete(position);
  }

  render(): string {
    return this.renderText(true);
  }

  private renderText(markersEnabled: boolean): string {
    const output: string[] = [];
    const source = this.parts;
    const count = this.indexes.length;
    const selectState: { active: SelectState | null } = { active: null };
    const stripper = markersEnabled ? null : new MarkerAttrStripper();
    const pushStatic = (value: string | undefined): void => {
      if (value === undefined || value === "") {
        return;
      }
      const text = stripper === null ? value : stripper.strip(value);
      const next = applySelectChunk(text, selectState);
      if (next !== "") {
        output.push(next);
      }
    };
    const beginSelect = (position: number): void => {
      const value = this.selectValues.get(position);
      if (value === undefined) {
        return;
      }
      const prefix = source[position] ?? "";
      selectState.active = {
        value,
        multiple: /\smultiple(?=[\s/>])/i.test(prefix),
        matched: false,
      };
    };
    pushStatic(source[0]);
    const tails = this.tails;
    if (tails !== undefined) {
      for (let position = 0; position < count; position += 1) {
        beginSelect(position);
        const slot = this.slotText(position, markersEnabled);
        if (slot !== "") {
          output.push(slot);
        }
        const tail = tails[position];
        if (tail !== undefined && tail !== "") {
          pushStatic(
            markersEnabled
              ? tail
              : stripHoleMarker(tail, this.markers[position] ?? ""),
          );
        }
      }
      return output.join("");
    }
    for (let position = 0; position < count; position += 1) {
      beginSelect(position);
      const slot = this.slotText(position, markersEnabled);
      if (slot !== "") {
        output.push(slot);
      }
      if (markersEnabled) {
        const marker = this.markers[position];
        if (marker !== undefined && marker !== "") {
          output.push(marker);
        }
      }
      pushStatic(source[position + 1]);
    }
    return output.join("");
  }

  private slotText(position: number, markersEnabled: boolean): string {
    const slot = this.slots[position];
    if (slot === undefined) {
      return "";
    }
    if (typeof slot === "string") {
      return slot;
    }
    const out: string[] = [];
    const sink: import("./serializer.js").PartSink = {
      stream: true,
      markers: markersEnabled,
      push(...values: string[]): void {
        for (const value of values) {
          if (value !== "") {
            out.push(value);
          }
        }
      },
    };
    if (this.wrap && markersEnabled) {
      sink.push(INSERT_START);
    }
    pushValue(slot.value, sink);
    if (this.wrap && markersEnabled) {
      sink.push(INSERT_END);
    }
    return out.join("");
  }

  override get textContent(): string {
    return this.render();
  }

  override set textContent(_value: string | null) {}

  protected override createShallowClone(): RawNode {
    const clone = new RawNode(
      this.parts,
      this.indexes,
      this.markers,
      this.tails,
      this.bare,
      this.wrap,
    );
    for (let position = 0; position < this.slots.length; position += 1) {
      const value = this.slots[position];
      if (value !== undefined) {
        clone.slots[position] = value;
      }
    }
    for (const [position, value] of this.selectValues) {
      clone.selectValues.set(position, value);
    }
    return clone;
  }
}
