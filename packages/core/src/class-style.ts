export type ClassDictionary = {
  readonly [name: string]: ClassNameValue;
};

export type ClassNameValue =
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined
  | readonly ClassNameValue[]
  | ClassDictionary
  | (() => ClassNameValue);

export type StylePrimitive = string | number | boolean | null | undefined;

export interface StyleObject {
  readonly [property: string]: StylePrimitive;
}

export type StyleInput =
  | string
  | StyleObject
  | readonly StyleInput[]
  | null
  | undefined
  | false;

const UNITLESS_PROPERTIES: ReadonlySet<string> = new Set([
  "animation-iteration-count",
  "aspect-ratio",
  "border-image-outset",
  "border-image-slice",
  "border-image-width",
  "box-flex",
  "box-flex-group",
  "box-ordinal-group",
  "column-count",
  "columns",
  "fill-opacity",
  "flex",
  "flex-grow",
  "flex-negative",
  "flex-order",
  "flex-positive",
  "flex-shrink",
  "flood-opacity",
  "font-weight",
  "grid-area",
  "grid-column",
  "grid-column-end",
  "grid-column-span",
  "grid-column-start",
  "grid-row",
  "grid-row-end",
  "grid-row-span",
  "grid-row-start",
  "line-clamp",
  "line-height",
  "opacity",
  "order",
  "orphans",
  "scale",
  "stop-opacity",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-opacity",
  "stroke-width",
  "tab-size",
  "widows",
  "z-index",
  "zoom",
]);

function isWhitespace(value: string): boolean {
  return value.length === 0 || /^\s+$/.test(value);
}

function collectClass(value: ClassNameValue, out: Set<string>): void {
  if (value === null || value === undefined) {
    return;
  }
  const type = typeof value;
  if (type === "string") {
    for (const name of (value as string).split(/\s+/)) {
      if (name !== "") {
        out.add(name);
      }
    }
    return;
  }
  if (type === "function") {
    collectClass((value as () => ClassNameValue)(), out);
    return;
  }
  if (type === "number" || type === "bigint") {
    out.add(String(value));
    return;
  }
  if (type === "boolean") {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectClass(item, out);
    }
    return;
  }
  for (const [name, condition] of Object.entries(value as ClassDictionary)) {
    if (isTruthyClass(condition)) {
      out.add(name);
    }
  }
}

function isTruthyClass(value: ClassNameValue): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  const type = typeof value;
  if (type === "string") {
    return !isWhitespace(value as string);
  }
  if (type === "number" || type === "bigint") {
    return value !== 0;
  }
  if (type === "boolean") {
    return value as boolean;
  }
  if (type === "function") {
    return isTruthyClass((value as () => ClassNameValue)());
  }
  if (Array.isArray(value)) {
    return value.some((item) => isTruthyClass(item));
  }
  return Object.entries(value as ClassDictionary).some(([, condition]) =>
    isTruthyClass(condition),
  );
}

export function normalizeClass(value: ClassNameValue): string {
  const names = new Set<string>();
  collectClass(value, names);
  return [...names].join(" ");
}

export function classNames(...values: readonly ClassNameValue[]): string {
  const names = new Set<string>();
  for (const value of values) {
    collectClass(value, names);
  }
  return [...names].join(" ");
}

function hyphenateStyleName(raw: string): string {
  if (raw.startsWith("--")) {
    return raw;
  }
  if (raw.includes("-")) {
    return raw.toLowerCase();
  }
  let result = "";
  for (const char of raw) {
    if (char >= "A" && char <= "Z") {
      result += "-" + char.toLowerCase();
      continue;
    }
    result += char;
  }
  return result;
}

function formatStyleValue(property: string, raw: StylePrimitive): string {
  if (typeof raw !== "number") {
    return String(raw);
  }
  if (property.startsWith("--") || !Number.isFinite(raw) || raw === 0) {
    return String(raw);
  }
  return isUnitlessProperty(property) ? String(raw) : `${raw}px`;
}

function isUnitlessProperty(property: string): boolean {
  if (UNITLESS_PROPERTIES.has(property)) {
    return true;
  }
  const vendor = /^-(?:webkit|moz|ms|o)-/.exec(property);
  return vendor !== null && UNITLESS_PROPERTIES.has(property.slice(vendor[0].length));
}

function splitStyleDeclarations(value: string): string[] {
  const entries: string[] = [];
  let start = 0;
  let quote: string | null = null;
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value.charAt(index);
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (quote !== null) {
      if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === "(") {
      depth += 1;
      continue;
    }
    if (char === ")") {
      if (depth > 0) {
        depth -= 1;
      }
      continue;
    }
    if (char === ";" && depth === 0) {
      entries.push(value.slice(start, index));
      start = index + 1;
    }
  }
  entries.push(value.slice(start));
  return entries;
}

function findStyleSeparator(entry: string): number {
  let quote: string | null = null;
  let depth = 0;
  for (let index = 0; index < entry.length; index += 1) {
    const char = entry.charAt(index);
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (quote !== null) {
      if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === "(") {
      depth += 1;
      continue;
    }
    if (char === ")") {
      if (depth > 0) {
        depth -= 1;
      }
      continue;
    }
    if (char === ":" && depth === 0) {
      return index;
    }
  }
  return -1;
}

function parseStyleString(value: string): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  for (const entry of splitStyleDeclarations(value)) {
    const separator = findStyleSeparator(entry);
    const rawKey = (separator === -1 ? entry : entry.slice(0, separator)).trim();
    if (rawKey === "") {
      continue;
    }
    const target = separator === -1 ? "" : entry.slice(separator + 1).trim();
    entries.push([hyphenateStyleName(rawKey), target]);
  }
  return entries;
}

function mergeStyle(value: StyleInput, out: Map<string, string>): void {
  if (value === null || value === undefined || value === false) {
    return;
  }
  if (typeof value === "string") {
    for (const [key, target] of parseStyleString(value)) {
      if (target === "") {
        out.delete(key);
      } else {
        out.set(key, target);
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      mergeStyle(item, out);
    }
    return;
  }
  for (const [rawName, rawValue] of Object.entries(value as StyleObject)) {
    const property = hyphenateStyleName(rawName);
    if (
      rawValue === null
      || rawValue === undefined
      || rawValue === false
      || rawValue === ""
    ) {
      out.delete(property);
      continue;
    }
    out.set(property, formatStyleValue(property, rawValue));
  }
}

export function styleDeclarations(value: StyleInput): Map<string, string> {
  const declarations = new Map<string, string>();
  mergeStyle(value, declarations);
  return declarations;
}

export function normalizeStyle(...values: readonly StyleInput[]): string {
  const declarations = new Map<string, string>();
  for (const value of values) {
    mergeStyle(value, declarations);
  }
  const parts: string[] = [];
  for (const [property, target] of declarations) {
    parts.push(`${property}: ${target};`);
  }
  return parts.join(" ");
}

export const styleValue = normalizeStyle;
