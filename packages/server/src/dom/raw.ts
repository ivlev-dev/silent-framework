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
    const parts: string[] = [];
    for (const [key, item] of Object.entries(value)) {
      if (item === null || item === undefined || item === false || item === "") {
        continue;
      }
      parts.push(`${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}:${String(item)}`);
    }
    return parts.length === 0 ? null : `style="${escapeAttribute(parts.join(";"))}"`;
  }
  return `${name}="${attributeText(value)}"`;
}

class RawSlot {
  readonly value: unknown;

  constructor(value: unknown) {
    this.value = value;
  }
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

  renderInto(parts: string[]): void {
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
  private readonly values: Map<string, string>;
  private readonly boolean: Set<string>;

  constructor(hole: RawHole, content?: RawHole) {
    this.hole = hole;
    this.content = content;
    this.values = new Map<string, string>();
    this.boolean = new Set<string>();
  }

  setAttribute(name: string, value: unknown): void {
    if (this.content !== undefined && (name === "value" || name === "textContent")) {
      this.setContent(value);
      return;
    }
    this.setRawAttribute(name, value);
  }

  private setContent(value: unknown): void {
    const text =
      value === null || value === undefined
        ? ""
        : typeof value === "string"
          ? escapeText(value)
          : escapeText(String(value));
    this.content?.set(text);
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

  constructor(
    parts: readonly string[],
    indexes: readonly number[],
    markers: readonly string[],
    tails?: readonly string[],
    bare?: readonly boolean[],
    wrap = true,
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

  renderInto(parts: string[]): void {
    const source = this.parts;
    const count = this.indexes.length;
    const head = source[0];
    if (head !== undefined && head !== "") {
      parts.push(head);
    }
    const tails = this.tails;
    if (tails !== undefined) {
      for (let position = 0; position < count; position += 1) {
        this.pushSlot(position, parts);
        const tail = tails[position];
        if (tail !== undefined && tail !== "") {
          parts.push(tail);
        }
      }
      return;
    }
    const markers = this.markers;
    for (let position = 0; position < count; position += 1) {
      this.pushSlot(position, parts);
      const marker = markers[position];
      if (marker !== undefined && marker !== "") {
        parts.push(marker);
      }
      const tail = source[position + 1];
      if (tail !== undefined && tail !== "") {
        parts.push(tail);
      }
    }
  }

  private pushSlot(position: number, parts: string[]): void {
    const slot = this.slots[position];
    if (slot === undefined) {
      return;
    }
    if (typeof slot === "string") {
      if (slot !== "") {
        parts.push(slot);
      }
      return;
    }
    if (!this.wrap) {
      pushValue(slot.value, parts);
      return;
    }
    parts.push(INSERT_START);
    pushValue(slot.value, parts);
    parts.push(INSERT_END);
  }

  render(): string {
    const source = this.parts;
    const count = this.indexes.length;
    let out = source[0] ?? "";
    const tails = this.tails;
    if (tails !== undefined) {
      for (let position = 0; position < count; position += 1) {
        out += this.slotText(position);
        out += tails[position] ?? "";
      }
      return out;
    }
    const markers = this.markers;
    for (let position = 0; position < count; position += 1) {
      out += this.slotText(position);
      out += markers[position] ?? "";
      out += source[position + 1] ?? "";
    }
    return out;
  }

  private slotText(position: number): string {
    const slot = this.slots[position];
    if (slot === undefined) {
      return "";
    }
    if (typeof slot === "string") {
      return slot;
    }
    const value = slot.value;
    const nested = value as { render?: () => string } | null;
    if (nested !== null && typeof nested === "object" && typeof nested.render === "function") {
      const text = nested.render();
      return this.wrap ? INSERT_START + text + INSERT_END : text;
    }
    const parts: string[] = [];
    if (this.wrap) {
      parts.push(INSERT_START);
    }
    pushValue(value, parts);
    if (this.wrap) {
      parts.push(INSERT_END);
    }
    return parts.length === 0 ? "" : parts.join("");
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
    return clone;
  }
}
