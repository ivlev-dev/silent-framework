import { NODE_TEXT } from "./types.js";
import { NodeImpl } from "./node.js";
import { pushValue } from "./serialize-value.js";

export interface RawHole {
  readonly parentNode: RawNode;
  readonly index: number;
  set(value: string): void;
}

const INSERT_START = "<!--silent-insert-->";
const INSERT_END = "<!--silent-insert-end-->";

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

  constructor(
    parentNode: RawNode,
    index: number,
    slots: Array<string | RawSlot | undefined>,
  ) {
    this.parentNode = parentNode;
    this.index = index;
    this.slots = slots;
  }

  set(value: string): void {
    this.slots[this.index] = value;
  }

  __silentServerHoleSetValue(value: unknown): boolean {
    this.slots[this.index] = new RawSlot(value);
    return true;
  }
}

export class RawNode extends NodeImpl {
  private readonly parts: readonly string[];
  private readonly indexes: readonly number[];
  private readonly markers: readonly string[];
  private readonly tails: readonly string[] | undefined;
  private readonly slots: Array<string | RawSlot | undefined>;
  private readonly holeList: RawHole[];

  constructor(
    parts: readonly string[],
    indexes: readonly number[],
    markers: readonly string[],
    tails?: readonly string[],
  ) {
    super(NODE_TEXT);
    this.parts = parts;
    this.indexes = indexes;
    this.markers = markers;
    this.tails = tails;
    const count = indexes.length;
    this.slots = new Array<string | RawSlot | undefined>(count);
    const holes = new Array<RawHole>(count);
    for (let position = 0; position < count; position += 1) {
      holes[position] = new RawHoleImpl(this, position, this.slots);
    }
    this.holeList = holes;
  }

  get holes(): readonly RawHole[] {
    return this.holeList;
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
    parts.push(INSERT_START);
    pushValue(slot.value, parts);
    parts.push(INSERT_END);
  }

  render(): string {
    const result: string[] = [];
    this.renderInto(result);
    return result.join("");
  }

  override get textContent(): string {
    return this.render();
  }

  override set textContent(_value: string | null) {}

  protected override createShallowClone(): RawNode {
    const clone = new RawNode(this.parts, this.indexes, this.markers, this.tails);
    for (let position = 0; position < this.slots.length; position += 1) {
      const value = this.slots[position];
      if (value !== undefined) {
        clone.slots[position] = value;
      }
    }
    return clone;
  }
}
