/**
 * Внутренние проверки значений, попадающих в HTML/CSS.
 *
 * Модуль намеренно не зависит от DOM и публикуется через существующий
 * внутренний subpath `@ivlev-dev/silent-core/attribute-name`, чтобы
 * серверный пакет использовал те же правила, что и клиент.
 */

const URL_ATTRIBUTES: ReadonlySet<string> = new Set([
  "action",
  "background",
  "cite",
  "data",
  "formaction",
  "href",
  "icon",
  "manifest",
  "poster",
  "src",
  "xlink:href",
]);

const SAFE_URL_SCHEMES: ReadonlySet<string> = new Set([
  "http",
  "https",
  "mailto",
  "tel",
]);

const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const URL_CONTROL = /[\u0000-\u0020\u007f\u00ad\u200b-\u200f\u2028\u2029\ufeff]/g;
const NUMERIC_ENTITY = /&#(?:x([0-9a-f]+)|([0-9]+));?/gi;
const NAMED_ENTITY = /&([a-z][a-z0-9]*);/gi;

const NAMED_ENTITIES: ReadonlyMap<string, string> = new Map([
  ["amp", "&"],
  ["colon", ":"],
  ["gt", ">"],
  ["lt", "<"],
  ["newline", "\n"],
  ["quot", "\""],
  ["sol", "/"],
  ["tab", "\t"],
]);

export function isUrlAttributeName(name: string): boolean {
  return URL_ATTRIBUTES.has(name.toLowerCase());
}

function decodeUrlEntities(value: string): string {
  if (value.indexOf("&") === -1) {
    return value;
  }
  let current = value;
  // Двойное кодирование (`&amp;#106;`) тоже не должно обходить проверку.
  for (let pass = 0; pass < 2; pass += 1) {
    const next = current
      .replace(NUMERIC_ENTITY, (match: string, hex: string | undefined, dec: string | undefined) => {
        const code = hex !== undefined
          ? Number.parseInt(hex, 16)
          : Number.parseInt(dec ?? "", 10);
        return Number.isInteger(code) && code >= 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : match;
      })
      .replace(NAMED_ENTITY, (match: string, body: string) =>
        NAMED_ENTITIES.get(body.toLowerCase()) ?? match,
      );
    if (next === current) {
      return current;
    }
    current = next;
  }
  return current;
}

function normalizedUrl(value: string): string {
  const decoded = decodeUrlEntities(value);
  return decoded.replace(URL_CONTROL, "").trim();
}

/**
 * `true`, если значение URL-атрибута не исполняет код: относительные пути,
 * `#hash`, `http:`, `https:`, `mailto:` и `tel:`. `javascript:`, `data:`,
 * `vbscript:`, `file:` и неизвестные схемы отклоняются.
 */
export function isSafeUrlAttributeValue(name: string, value: string): boolean {
  if (!isUrlAttributeName(name)) {
    return true;
  }
  const url = normalizedUrl(value);
  if (url === "") {
    return true;
  }
  const scheme = SCHEME.exec(url);
  if (scheme === null) {
    return true;
  }
  return SAFE_URL_SCHEMES.has((scheme[1] ?? "").toLowerCase());
}

const CUSTOM_PROPERTY = /^--[A-Za-z0-9_-]+$/;
const STANDARD_PROPERTY = /^-?[A-Za-z][A-Za-z0-9-]*$/;

/** Имя CSS-свойства: обычное, вендорное (`-webkit-*`) или `--custom`. */
export function isSafeStyleProperty(name: string): boolean {
  const property = name.trim();
  if (property.length === 0 || property.length > 128) {
    return false;
  }
  return CUSTOM_PROPERTY.test(property) || STANDARD_PROPERTY.test(property);
}

/**
 * Значение CSS-свойства не должно вырываться из объявления: `;` на верхнем
 * уровне, `{`/`}` вне строк, `@` (включая `@import`) и `expression(`.
 * `;`, `@` и `expression(` внутри `url(...)`, `calc(...)` и кавычек разрешены:
 * там они не образуют новое объявление или at-rule.
 */
export function isSafeStyleValue(value: string): boolean {
  if (value.length > 100_000 || value.indexOf("\u0000") !== -1) {
    return false;
  }
  let quote: string | null = null;
  let depth = 0;
  // Только символы верхнего уровня: по ним проверяются at-rule и `expression(`.
  let topLevel = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value.charAt(index);
    if (char === "\\") {
      const escaped = value.charAt(index + 1);
      // Экранированная буква остаётся частью идентификатора (`\expression`
      // декодируется в `expression`), поэтому верхний уровень её сохраняет.
      if (quote === null && depth === 0 && /[A-Za-z]/.test(escaped)) {
        topLevel += escaped;
      }
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
      topLevel += " ";
      continue;
    }
    if (char === "(") {
      if (depth === 0) {
        topLevel += char;
      }
      depth += 1;
      continue;
    }
    if (char === ")") {
      if (depth > 0) {
        depth -= 1;
      }
      if (depth === 0) {
        topLevel += char;
      }
      continue;
    }
    if (char === "{" || char === "}") {
      return false;
    }
    if (char === ";" && depth === 0) {
      return false;
    }
    if (depth === 0) {
      topLevel += char;
    }
  }
  return !topLevel.includes("@") && !/\bexpression\s*\(/i.test(topLevel);
}

const TAG_NAME = /^[A-Za-z][A-Za-z0-9-]*$/;

/** Имя тега безопасно для записи в HTML: буква, затем буквы/цифры/`-`. */
export function isValidTagName(name: string): boolean {
  return name.length !== 0 && TAG_NAME.test(name);
}

export interface StyleTextDeclaration {
  readonly name: string;
  readonly value: string;
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

/** Разбирает CSS-текст на объявления с учётом кавычек, скобок и экранирования. */
export function splitStyleText(value: string): StyleTextDeclaration[] {
  const entries: StyleTextDeclaration[] = [];
  let start = 0;
  let quote: string | null = null;
  let depth = 0;
  const pushEntry = (end: number): void => {
    const entry = value.slice(start, end);
    start = end + 1;
    const separator = findStyleSeparator(entry);
    const name = (separator === -1 ? entry : entry.slice(0, separator)).trim();
    if (name === "") {
      return;
    }
    const declarationValue = separator === -1 ? "" : entry.slice(separator + 1).trim();
    entries.push({ name, value: declarationValue });
  };
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
      pushEntry(index);
    }
  }
  pushEntry(value.length);
  return entries;
}

/** Оставляет только безопасные объявления CSS-текста. */
export function sanitizeStyleText(value: string): string {
  const parts: string[] = [];
  for (const declaration of splitStyleText(value)) {
    if (!isSafeStyleProperty(declaration.name)) {
      continue;
    }
    if (declaration.value !== "" && !isSafeStyleValue(declaration.value)) {
      continue;
    }
    parts.push(`${declaration.name}: ${declaration.value};`);
  }
  return parts.join(" ");
}
