/**
 * Консервативный allow-list для имён атрибутов, попадающих в HTML.
 * Разрешены имена с `-`, `_`, `.`, `:` (data-*, aria-*, xlink:href, xml:lang,
 * пространства имён), но не пробелы, кавычки, `>`, `/` и прочие символы,
 * которыми можно вырваться из тега.
 */
const ATTRIBUTE_NAME = /^[A-Za-z_:][-A-Za-z0-9_:.]*$/;

function isAsciiLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

/** Проверяет, что строка является безопасным именем HTML-атрибута. */
export function isValidAttributeName(name: string): boolean {
  return name.length !== 0 && ATTRIBUTE_NAME.test(name);
}

/**
 * `on[a-z]`/`on:` после нормализации регистра: `onerror`, `onClick`,
 * `on:custom`. Такие имена не должны попадать в сериализованный HTML.
 */
export function isEventAttributeName(name: string): boolean {
  if (name.length < 3) {
    return false;
  }
  const first = name.charCodeAt(0);
  const second = name.charCodeAt(1);
  if ((first | 32) !== 111 || (second | 32) !== 110) {
    return false;
  }
  const third = name.charCodeAt(2);
  return third === 58 || isAsciiLetter(third);
}

/** Имя можно безопасно сериализовать как атрибут и оно не является событием. */
export function isSafeAttributeName(name: string): boolean {
  return isValidAttributeName(name) && !isEventAttributeName(name);
}

// Внутренняя поверхность безопасности для серверного пакета: тот же
// subpath используется `@ivlev-dev/silent-server`.
export {
  isSafeStyleProperty,
  isSafeStyleValue,
  isSafeUrlAttributeValue,
  isUrlAttributeName,
  sanitizeStyleText,
  splitStyleText,
  type StyleTextDeclaration,
} from "./safety.js";
