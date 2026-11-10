import { NODE_TEXT } from "./types.js";
import { NodeImpl } from "./node.js";

export interface RawHole {
  readonly parentNode: RawNode;
  readonly index: number;
  set(value: string): void;
}

export class RawNode extends NodeImpl {
  override readonly nodeType: number = NODE_TEXT;
  private readonly parts: readonly string[];
  private readonly indexes: readonly number[];
  private readonly slots: Array<string | undefined>;
  private readonly holeList: RawHole[] = [];

  constructor(parts: readonly string[], indexes: readonly number[]) {
    super(NODE_TEXT);
    this.parts = parts;
    this.indexes = indexes;
    this.slots = new Array<string | undefined>(indexes.length);
    for (let position = 0; position < indexes.length; position += 1) {
      const index = indexes[position] ?? position;
      const self = this;
      this.holeList.push({
        parentNode: self,
        index: position,
        set(value: string): void {
          self.slots[position] = value;
        },
      });
    }
  }

  get holes(): readonly RawHole[] {
    return this.holeList;
  }

  render(): string {
    let result = this.parts[0] ?? "";
    for (let position = 0; position < this.indexes.length; position += 1) {
      result += this.slots[position] ?? "";
      result += `<!--silent-hole-${this.indexes[position] ?? position}-->`;
      result += this.parts[position + 1] ?? "";
    }
    return result;
  }

  override get textContent(): string {
    return this.render();
  }

  override set textContent(_value: string | null) {}

  protected override createShallowClone(): RawNode {
    const clone = new RawNode(this.parts, this.indexes);
    for (let position = 0; position < this.slots.length; position += 1) {
      const value = this.slots[position];
      if (value !== undefined) {
        clone.holeList[position]?.set(value);
      }
    }
    return clone;
  }
}
