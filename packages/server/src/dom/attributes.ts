import type { DomAttr, DomAttributes } from "./types.js";

interface MutableAttr {
  readonly name: string;
  value: string;
}

export class AttributesImpl implements DomAttributes {
  private readonly entries: MutableAttr[] = [];

  get length(): number {
    return this.entries.length;
  }

  item(index: number): DomAttr | null {
    return this.entries[index] ?? null;
  }

  [Symbol.iterator](): IterableIterator<DomAttr> {
    return this.entries[Symbol.iterator]();
  }

  get(name: string): string | undefined {
    const entry = this.entries.find((item) => item.name === name);
    return entry?.value;
  }

  set(name: string, value: string): void {
    const entry = this.entries.find((item) => item.name === name);
    if (entry !== undefined) {
      entry.value = value;
      return;
    }
    this.entries.push({ name, value });
  }

  has(name: string): boolean {
    return this.entries.some((item) => item.name === name);
  }

  delete(name: string): void {
    const index = this.entries.findIndex((item) => item.name === name);
    if (index !== -1) {
      this.entries.splice(index, 1);
    }
  }

  clone(): AttributesImpl {
    const clone = new AttributesImpl();
    for (const entry of this.entries) {
      clone.set(entry.name, entry.value);
    }
    return clone;
  }
}
