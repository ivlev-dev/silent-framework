import type { DomStyle } from "./types.js";
import {
  isSafeStyleProperty,
  isSafeStyleValue,
  splitStyleText,
} from "./attribute-name.js";

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
    for (const declaration of splitStyleText(value)) {
      if (!isSafeStyleProperty(declaration.name)) {
        continue;
      }
      if (declaration.value !== "" && !isSafeStyleValue(declaration.value)) {
        continue;
      }
      this.properties.set(declaration.name, declaration.value);
    }
    this.changed();
  }

  getPropertyValue(name: string): string {
    return this.properties.get(name) ?? "";
  }

  setProperty(name: string, value: string): void {
    if (!isSafeStyleProperty(name)) {
      return;
    }
    const text = String(value);
    if (text !== "" && !isSafeStyleValue(text)) {
      return;
    }
    this.properties.set(name, text);
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
