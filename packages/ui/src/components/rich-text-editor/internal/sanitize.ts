/**
 * Санитайзер HTML для WYSIWYG-редактора.
 *
 * Работает только на клиенте (`DOMParser`/`template`). На сервере не
 * вызывается: SSR отдаёт пустую контентную область, а очистка выполняется
 * после монтирования. Разрешён исключительно узкий allowlist тегов и
 * атрибутов, всё остальное разворачивается (контейнеры) или удаляется
 * (опасные/интерактивные элементы).
 */

export const RICH_TEXT_ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "del",
  "code",
  "pre",
  "blockquote",
  "h1",
  "h2",
  "h3",
  "ul",
  "ol",
  "li",
  "a",
  "hr",
] as const;

/** Теги, на которых разрешён `data-align`. */
export const RICH_TEXT_ALIGN_TAGS = [
  "p",
  "h1",
  "h2",
  "h3",
  "blockquote",
  "pre",
  "li",
] as const;

export const RICH_TEXT_ALIGNS = ["left", "center", "right"] as const;
export type RichTextAlign = (typeof RICH_TEXT_ALIGNS)[number];

/** Публичный (внутри компонента) список разрешённых тегов. */
export const ALLOWED_TAGS = RICH_TEXT_ALLOWED_TAGS;

const ALLOWED = new Set<string>(RICH_TEXT_ALLOWED_TAGS);
const ALIGNED = new Set<string>(RICH_TEXT_ALIGN_TAGS);

/**
 * Опасные элементы удаляются вместе с содержимым. `template`/`noscript`
 * тоже: их содержимое не предназначено для показа в редакторе.
 */
const DROPPED = new Set<string>([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "applet",
  "frame",
  "frameset",
  "template",
  "noscript",
  "svg",
  "math",
  "img",
  "picture",
  "source",
  "video",
  "audio",
  "track",
  "canvas",
  "map",
  "area",
  "input",
  "textarea",
  "select",
  "option",
  "optgroup",
  "meta",
  "link",
  "base",
  "param",
]);

const SAFE_SCHEMES = new Set(["http", "https", "mailto", "tel"]);
const SAFE_REL = ["noopener", "noreferrer", "nofollow", "ugc", "sponsored"] as const;
const SAFE_REL_SET = new Set<string>(SAFE_REL);
const SCHEME_PATTERN = /^([a-z][a-z0-9+.-]*):/iu;
const WHITESPACE_AND_CONTROL =
  /[\s\u0000-\u001f\u007f-\u009f\u200b-\u200d\u2060\ufeff]/gu;

/** Убирает пробелы/control-символы, которыми обходят проверку схемы. */
function compactUrl(value: string): string {
  return value.replace(WHITESPACE_AND_CONTROL, "");
}

/**
 * Безопасный `href`: http/https/mailto/tel, относительные ссылки, якоря и
 * query. `javascript:`, `data:`, `vbscript:`, `file:` и прочие схемы
 * отбрасываются. Возвращает `null`, если значение использовать нельзя.
 */
export function sanitizeHref(raw: string): string | null {
  const value = compactUrl(raw);
  if (value === "") return null;
  if (
    value.startsWith("#") ||
    value.startsWith("?") ||
    value.startsWith("/") ||
    value.startsWith("./") ||
    value.startsWith("../")
  ) {
    return value;
  }
  const match = SCHEME_PATTERN.exec(value);
  if (match === null) return value;
  const scheme = (match[1] ?? "").toLowerCase();
  return SAFE_SCHEMES.has(scheme) ? value : null;
}

/** Синоним для внешних проверок: безопасен ли `href`. */
export function isSafeHref(raw: string): boolean {
  return sanitizeHref(raw) !== null;
}

function cleanRel(raw: string | null, forceBlank: boolean): string | null {
  const tokens = new Set<string>();
  if (raw !== null) {
    for (const token of raw.toLowerCase().split(/\s+/u)) {
      if (SAFE_REL_SET.has(token)) tokens.add(token);
    }
  }
  if (forceBlank) {
    tokens.add("noopener");
    tokens.add("noreferrer");
  }
  if (tokens.size === 0) return null;
  return SAFE_REL.filter((token) => tokens.has(token)).join(" ");
}

function copyAnchorAttributes(source: Element, target: Element): void {
  const rawHref = source.getAttribute("href");
  const href = rawHref === null ? null : sanitizeHref(rawHref);
  if (href !== null) target.setAttribute("href", href);

  const targetName = source.getAttribute("target")?.trim().toLowerCase();
  const isBlank = href !== null && targetName === "_blank";
  if (href !== null && (targetName === "_blank" || targetName === "_self")) {
    target.setAttribute("target", targetName);
  }

  const rel = cleanRel(source.getAttribute("rel"), isBlank);
  if (rel !== null && href !== null) {
    target.setAttribute("rel", rel);
  }
  // Ссылка без href не должна выглядеть кликабельной.
  if (href === null) {
    target.removeAttribute("target");
    target.removeAttribute("rel");
  }
}

function copyAttributes(source: Element, target: Element, tag: string): void {
  if (tag === "a") {
    copyAnchorAttributes(source, target);
    return;
  }
  if (ALIGNED.has(tag)) {
    const align = source.getAttribute("data-align")?.trim().toLowerCase();
    if (align === "left" || align === "center" || align === "right") {
      target.setAttribute("data-align", align);
    }
  }
}

function cleanChildren(
  source: Node,
  target: Node,
  documentRef: Document,
): void {
  for (const child of Array.from(source.childNodes)) {
    if (child.nodeType === 3) {
      const text = (child as Text).data;
      if (text !== "") target.appendChild(documentRef.createTextNode(text));
      continue;
    }
    if (child.nodeType !== 1) continue;
    const element = child as Element;
    const tag = element.localName.toLowerCase();
    if (DROPPED.has(tag)) continue;
    if (!ALLOWED.has(tag)) {
      cleanChildren(element, target, documentRef);
      continue;
    }
    const clean = documentRef.createElement(tag);
    copyAttributes(element, clean, tag);
    target.appendChild(clean);
    if (tag !== "br" && tag !== "hr") {
      cleanChildren(element, clean, documentRef);
    }
  }
}

function parseDocument(): Document | null {
  if (typeof DOMParser === "function") {
    return new DOMParser().parseFromString(
      "<!doctype html><html><body></body></html>",
      "text/html",
    );
  }
  if (typeof document !== "undefined") {
    return document.implementation.createHTMLDocument("");
  }
  return null;
}

/**
 * Очищает HTML по allowlist. На сервере (без DOM) возвращает пустую строку:
 * вызывающий код не должен полагаться на серверную санитизацию.
 */
export function sanitizeHtml(input: string): string {
  if (typeof input !== "string" || input === "") return "";
  const documentRef = parseDocument();
  if (documentRef === null) return "";

  const parsed = documentRef.implementation.createHTMLDocument("");
  const body = parsed.createElement("body");
  // `createHTMLDocument` создаёт инертный документ: скрипты не исполняются.
  body.innerHTML = input;
  const container = documentRef.createElement("div");
  cleanChildren(body, container, documentRef);
  return container.innerHTML;
}

/** Псевдоним для читаемости в местах, где важно именно «очистить». */
export const sanitize = sanitizeHtml;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

/**
 * Текст из буфера обмена → безопасный HTML. Строки разделяются `<br>`,
 * все спецсимволы экранируются.
 */
export function plainTextToHtml(value: string): string {
  const normalized = value.replace(/\r\n?/gu, "\n");
  if (normalized === "") return "";
  return normalized
    .split("\n")
    .map((line) => escapeHtml(line))
    .join("<br>");
}
