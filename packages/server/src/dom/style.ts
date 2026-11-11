import type { DomStyle } from "./types.js";

export class StyleImpl implements DomStyle {
  private readonly properties = new Map<string, string>();
  private readonly onChange: (() => void) | null;

  constructor(onChange?: () => void) {
    this.onChange = onChange ?? null;
  }

  private changed(): void {
    if (this.onChange !== null) {
      this.onChange();
    }
  }

  get cssText(): string {
    const parts: string[] = [];
    for (const [name, value] of this.properties) {
      parts.push(`${name}: ${value};`);
    }
    return parts.join(" ");
  }

  set cssText(value: string) {
    this.properties.clear();
    for (const entry of value.split(";")) {
      const separator = entry.indexOf(":");
      const name = (separator === -1 ? entry : entry.slice(0, separator)).trim();
      if (name === "") {
        continue;
      }
      const propertyValue = separator === -1 ? "" : entry.slice(separator + 1).trim();
      this.properties.set(name, propertyValue);
    }
    this.changed();
  }

  getPropertyValue(name: string): string {
    return this.properties.get(name) ?? "";
  }

  setProperty(name: string, value: string): void {
    this.properties.set(name, String(value));
    this.changed();
  }

  removeProperty(name: string): string {
    const previous = this.properties.get(name) ?? "";
    this.properties.delete(name);
    this.changed();
    return previous;
  }

  clone(): StyleImpl {
    const clone = new StyleImpl();
    for (const [name, value] of this.properties) {
      clone.properties.set(name, value);
    }
    return clone;
  }
}
