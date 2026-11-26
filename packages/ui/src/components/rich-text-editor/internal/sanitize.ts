/**
 * Санитайзер HTML для WYSIWYG-редактора.
 *
 * Полностью независим от DOM: собственный токенайзер/парсер, allowlist,
 * нормализация блоков и сериализация. Поэтому SSR получает уже очищенный
 * hidden input, а клиент и сервер ведут себя одинаково.
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
const ALIGN_VALUES = new Set<string>(RICH_TEXT_ALIGNS);
const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);
const RAW_TEXT_TAGS = new Set([
  "script",
  "style",
  "textarea",
  "title",
  "xmp",
  "plaintext",
]);
const BLOCK_START_TAGS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "div",
  "section",
  "article",
  "header",
  "footer",
  "hr",
  "table",
  "thead",
  "tbody",
  "tr",
  "td",
  "th",
]);
const BLOCK_CONTAINERS = new Set([
  "div",
  "section",
  "article",
  "header",
  "footer",
]);

/**
 * Опасные элементы удаляются вместе с содержимым.
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
  "form",
  "meta",
  "link",
  "base",
  "param",
  "title",
  "xmp",
  "plaintext",
]);

const SAFE_SCHEMES = new Set(["http", "https", "mailto", "tel"]);
const SAFE_REL = ["noopener", "noreferrer", "nofollow", "ugc", "sponsored"] as const;
const SAFE_REL_SET = new Set<string>(SAFE_REL);
const SCHEME_PATTERN = /^([a-z][a-z0-9+.-]*):/iu;
const WHITESPACE_AND_CONTROL =
  /[\s\u0000-\u001f\u007f-\u009f\u200b-\u200d\u2060\ufeff]/gu;

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: "\"",
  apos: "'",
  nbsp: "\u00A0",
  colon: ":",
  tab: "\t",
  newline: "\n",
  sol: "/",
  bsol: "\\",
  semi: ";",
  lpar: "(",
  rpar: ")",
  equals: "=",
  num: "#",
  percnt: "%",
  quest: "?",
  commat: "@",
  period: ".",
  comma: ",",
};

function compactUrl(value: string): string {
  return value.replace(WHITESPACE_AND_CONTROL, "");
}

/**
 * Безопасный `href`: http/https/mailto/tel, относительные ссылки, якоря и
 * query. `javascript:`, `data:`, `vbscript:`, `file:` и прочие схемы
 * отбрасываются. Возвращает `null`, если значение использовать нельзя.
 */
export function sanitizeHref(raw: string): string | null {
  const value = compactUrl(decodeEntities(raw));
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

function decodeEntities(value: string): string {
  if (value.indexOf("&") === -1) return value;
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);?/giu,
    (match, body: string) => {
      if (body.startsWith("#x") || body.startsWith("#X")) {
        const code = Number.parseInt(body.slice(2), 16);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : match;
      }
      if (body.startsWith("#")) {
        const code = Number.parseInt(body.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : match;
      }
      return NAMED_ENTITIES[body.toLowerCase()] ?? match;
    },
  );
}

interface HtmlTextNode {
  readonly type: "text";
  value: string;
}

interface HtmlElementNode {
  readonly type: "element";
  tag: string;
  attrs: Array<[string, string]>;
  children: HtmlNode[];
}

type HtmlNode = HtmlTextNode | HtmlElementNode;

function textNode(value: string): HtmlTextNode {
  return { type: "text", value };
}

function elementNode(
  tag: string,
  attrs: Array<[string, string]> = [],
  children: HtmlNode[] = [],
): HtmlElementNode {
  return { type: "element", tag, attrs, children };
}

function getAttr(node: HtmlElementNode, name: string): string | undefined {
  return node.attrs.find(([key]) => key === name)?.[1];
}

function cloneAttrs(node: HtmlElementNode): Array<[string, string]> {
  return node.attrs.map(([key, value]) => [key, value]);
}

function appendNode(stack: HtmlElementNode[], node: HtmlNode): void {
  const parent = stack[stack.length - 1];
  if (parent !== undefined) parent.children.push(node);
}

function parseTagName(input: string, start: number): string | null {
  const match = /^[A-Za-z][A-Za-z0-9:-]*/u.exec(input.slice(start));
  return match === null ? null : match[0];
}

interface ParsedTag {
  readonly tag: string;
  readonly attrs: Array<[string, string]>;
  readonly selfClosing: boolean;
  readonly end: number;
}

function parseAttributes(input: string, start: number): {
  attrs: Array<[string, string]>;
  selfClosing: boolean;
  end: number;
} | null {
  const attrs: Array<[string, string]> = [];
  let index = start;
  while (index < input.length) {
    while (index < input.length && /\s/u.test(input[index] ?? "")) index += 1;
    if (index >= input.length) return null;
    if (input[index] === ">") {
      return { attrs, selfClosing: false, end: index + 1 };
    }
    if (input[index] === "/" && input[index + 1] === ">") {
      return { attrs, selfClosing: true, end: index + 2 };
    }

    const nameStart = index;
    while (
      index < input.length &&
      !/[\s=/>]/u.test(input[index] ?? "")
    ) {
      index += 1;
    }
    if (nameStart === index) {
      index += 1;
      continue;
    }
    const name = input.slice(nameStart, index).toLowerCase();

    while (index < input.length && /\s/u.test(input[index] ?? "")) index += 1;
    let value = "";
    if (input[index] === "=") {
      index += 1;
      while (index < input.length && /\s/u.test(input[index] ?? "")) index += 1;
      const quote = input[index];
      if (quote === "\"" || quote === "'") {
        index += 1;
        const valueStart = index;
        while (index < input.length && input[index] !== quote) index += 1;
        value = input.slice(valueStart, index);
        if (input[index] === quote) index += 1;
      } else {
        const valueStart = index;
        while (
          index < input.length &&
          !/[\s>]/u.test(input[index] ?? "")
        ) {
          index += 1;
        }
        value = input.slice(valueStart, index);
      }
    }
    if (!attrs.some(([key]) => key === name)) {
      attrs.push([name, decodeEntities(value)]);
    }
  }
  return null;
}

function autoCloseForStartTag(stack: HtmlElementNode[], tag: string): void {
  let parent = stack[stack.length - 1];
  while (parent !== undefined && parent.tag === "p" && BLOCK_START_TAGS.has(tag)) {
    stack.pop();
    parent = stack[stack.length - 1];
  }
  parent = stack[stack.length - 1];
  while (parent !== undefined && parent.tag === "li" && tag === "li") {
    stack.pop();
    parent = stack[stack.length - 1];
  }
}

function parseHtml(input: string): HtmlNode[] {
  const root = elementNode("#root");
  const stack: HtmlElementNode[] = [root];
  let index = 0;

  while (index < input.length) {
    const nextTag = input.indexOf("<", index);
    if (nextTag === -1) {
      const text = input.slice(index);
      if (text !== "") appendNode(stack, textNode(decodeEntities(text)));
      break;
    }
    if (nextTag > index) {
      const text = input.slice(index, nextTag);
      if (text !== "") appendNode(stack, textNode(decodeEntities(text)));
      index = nextTag;
    }

    if (input.startsWith("<!--", index)) {
      const end = input.indexOf("-->", index + 4);
      index = end === -1 ? input.length : end + 3;
      continue;
    }
    if (input[index + 1] === "!" || input[index + 1] === "?") {
      const end = input.indexOf(">", index + 1);
      index = end === -1 ? input.length : end + 1;
      continue;
    }

    if (input[index + 1] === "/") {
      const name = parseTagName(input, index + 2);
      const end = input.indexOf(">", index + 2);
      if (name === null || end === -1) {
        appendNode(stack, textNode("<"));
        index += 1;
        continue;
      }
      const tag = name.toLowerCase();
      let matchIndex = -1;
      for (let position = stack.length - 1; position > 0; position -= 1) {
        if (stack[position]?.tag === tag) {
          matchIndex = position;
          break;
        }
      }
      if (matchIndex > 0) stack.length = matchIndex;
      index = end + 1;
      continue;
    }

    const name = parseTagName(input, index + 1);
    if (name === null) {
      appendNode(stack, textNode("<"));
      index += 1;
      continue;
    }
    const parsed = parseAttributes(input, index + 1 + name.length);
    if (parsed === null) {
      appendNode(stack, textNode("<"));
      index += 1;
      continue;
    }
    const tag = name.toLowerCase();
    index = parsed.end;

    if (RAW_TEXT_TAGS.has(tag)) {
      const closing = new RegExp(`</${tag}\\s*>`, "iu");
      const rest = input.slice(index);
      const match = closing.exec(rest);
      index = match === null ? input.length : index + match.index + match[0].length;
      continue;
    }

    autoCloseForStartTag(stack, tag);
    const element = elementNode(tag, parsed.attrs);
    appendNode(stack, element);
    if (!parsed.selfClosing && !VOID_TAGS.has(tag)) {
      stack.push(element);
    }
  }

  return root.children;
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

function sanitizeAnchorAttrs(node: HtmlElementNode): Array<[string, string]> {
  const attrs: Array<[string, string]> = [];
  const rawHref = getAttr(node, "href");
  const href = rawHref === undefined ? null : sanitizeHref(rawHref);
  if (href !== null) attrs.push(["href", href]);

  const target = getAttr(node, "target")?.trim().toLowerCase();
  const isBlank = href !== null && target === "_blank";
  if (href !== null && (target === "_blank" || target === "_self")) {
    attrs.push(["target", target]);
  }
  const rel = cleanRel(getAttr(node, "rel") ?? null, isBlank);
  if (href !== null && rel !== null) attrs.push(["rel", rel]);
  return attrs;
}

function sanitizeAttributes(node: HtmlElementNode): Array<[string, string]> {
  if (node.tag === "a") return sanitizeAnchorAttrs(node);
  if (ALIGNED.has(node.tag) || BLOCK_CONTAINERS.has(node.tag)) {
    const align = getAttr(node, "data-align")?.trim().toLowerCase();
    if (align !== undefined && ALIGN_VALUES.has(align)) {
      return [["data-align", align]];
    }
  }
  return [];
}

function sanitizeNodes(nodes: readonly HtmlNode[]): HtmlNode[] {
  const result: HtmlNode[] = [];
  for (const node of nodes) {
    if (node.type === "text") {
      if (node.value !== "") result.push(textNode(node.value));
      continue;
    }
    const tag = node.tag;
    if (DROPPED.has(tag)) continue;
    if (BLOCK_CONTAINERS.has(tag)) {
      result.push(
        elementNode("div", sanitizeAttributes(node), sanitizeNodes(node.children)),
      );
      continue;
    }
    if (!ALLOWED.has(tag)) {
      result.push(...sanitizeNodes(node.children));
      continue;
    }
    result.push(
      elementNode(
        tag,
        sanitizeAttributes(node),
        tag === "br" || tag === "hr" ? [] : sanitizeNodes(node.children),
      ),
    );
  }
  return result;
}

/**
 * Очистка без перестройки блоков: сохраняет структуру DOM для точного
 * восстановления каретки в истории, но удаляет опасные элементы/атрибуты.
 */
function sanitizeStructureNodes(nodes: readonly HtmlNode[]): HtmlNode[] {
  const result: HtmlNode[] = [];
  for (const node of nodes) {
    if (node.type === "text") {
      if (node.value !== "") result.push(textNode(node.value));
      continue;
    }
    if (DROPPED.has(node.tag)) continue;
    const attrs =
      ALLOWED.has(node.tag) || BLOCK_CONTAINERS.has(node.tag)
        ? sanitizeAttributes(node)
        : [];
    result.push(
      elementNode(
        node.tag,
        attrs,
        node.tag === "br" || node.tag === "hr"
          ? []
          : sanitizeStructureNodes(node.children),
      ),
    );
  }
  return result;
}

const OUTPUT_BLOCK_TAGS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "ul",
  "ol",
  "blockquote",
  "pre",
  "hr",
]);
const TEXT_BLOCK_TAGS = new Set(["p", "h1", "h2", "h3", "pre"]);
const HEADING_TAGS = new Set(["h1", "h2", "h3"]);

function isBlankText(value: string): boolean {
  return value.replace(/[\s\u200b\u00a0]+/gu, "") === "";
}

function textContentOf(node: HtmlNode): string {
  if (node.type === "text") return node.value;
  return node.children.map(textContentOf).join("");
}

function inlineHasContent(nodes: readonly HtmlNode[]): boolean {
  return nodes.some((node) =>
    node.type === "text" ? !isBlankText(node.value) : node.tag !== "br",
  );
}

function hasBlockContent(nodes: readonly HtmlNode[]): boolean {
  for (const node of nodes) {
    if (node.type === "text") {
      if (!isBlankText(node.value)) return true;
      continue;
    }
    if (node.tag === "br") continue;
    if (node.tag === "hr") return true;
    if (HEADING_TAGS.has(node.tag) || node.tag === "p" || node.tag === "pre") {
      if (inlineHasContent(node.children)) return true;
      continue;
    }
    if (node.tag === "ul" || node.tag === "ol") {
      if (node.children.some((child) => child.type === "element" && child.tag === "li" && hasBlockContent(child.children))) {
        return true;
      }
      continue;
    }
    if (node.tag === "blockquote") {
      if (hasBlockContent(node.children)) return true;
      continue;
    }
    if (!isBlankText(textContentOf(node))) return true;
  }
  return false;
}

function normalizeInlineChildren(nodes: readonly HtmlNode[]): HtmlNode[] {
  const result: HtmlNode[] = [];
  for (const node of nodes) {
    if (node.type === "text") {
      if (node.value !== "") result.push(textNode(node.value));
      continue;
    }
    const tag = node.tag;
    if (tag === "br") {
      result.push(node);
      continue;
    }
    if (tag === "div" || OUTPUT_BLOCK_TAGS.has(tag) || tag === "li") {
      result.push(...normalizeInlineChildren(node.children));
      continue;
    }
    if (ALLOWED.has(tag)) {
      const children = normalizeInlineChildren(node.children);
      if (children.length === 0) continue;
      result.push(elementNode(tag, cloneAttrs(node), children));
      continue;
    }
    result.push(...normalizeInlineChildren(node.children));
  }
  return result;
}

function normalizeTextBlock(node: HtmlElementNode): HtmlElementNode | null {
  const children = normalizeInlineChildren(node.children);
  if (!inlineHasContent(children)) return null;
  return elementNode(node.tag, cloneAttrs(node), children);
}

function applyAlign(blocks: readonly HtmlNode[], align: string | undefined): HtmlNode[] {
  if (align === undefined) return [...blocks];
  return blocks.map((block) => {
    if (
      block.type === "element" &&
      (ALIGNED.has(block.tag) || block.tag === "li") &&
      getAttr(block, "data-align") === undefined
    ) {
      return elementNode(block.tag, [...cloneAttrs(block), ["data-align", align]], block.children);
    }
    return block;
  });
}

// Forward declarations через функции ниже.
function normalizeBlockSequence(nodes: readonly HtmlNode[]): HtmlNode[] {
  const result: HtmlNode[] = [];
  let inline: HtmlNode[] = [];

  const flushInline = (): void => {
    if (inline.length === 0) return;
    const children = normalizeInlineChildren(inline);
    inline = [];
    if (inlineHasContent(children)) {
      result.push(elementNode("p", [], children));
    }
  };

  for (const node of nodes) {
    if (node.type === "text") {
      inline.push(node);
      continue;
    }
    if (node.tag === "div") {
      flushInline();
      const blocks = normalizeBlockSequence(node.children);
      result.push(...applyAlign(blocks, getAttr(node, "data-align")));
      continue;
    }
    if (node.tag === "li") {
      flushInline();
      const children = normalizeInlineChildren(node.children);
      if (inlineHasContent(children)) {
        result.push(
          elementNode("p", cloneAttrs(node), children),
        );
      }
      continue;
    }
    if (!OUTPUT_BLOCK_TAGS.has(node.tag)) {
      inline.push(node);
      continue;
    }
    flushInline();
    const blocks = normalizeBlock(node);
    result.push(...blocks);
  }
  flushInline();
  return result;
}

function normalizePreservingInline(nodes: readonly HtmlNode[]): HtmlNode[] {
  const result: HtmlNode[] = [];
  let inline: HtmlNode[] = [];

  const flushInline = (): void => {
    if (inline.length === 0) return;
    const children = normalizeInlineChildren(inline);
    inline = [];
    if (inlineHasContent(children)) result.push(...children);
  };

  for (const node of nodes) {
    if (node.type === "text") {
      inline.push(node);
      continue;
    }
    if (node.tag === "div") {
      flushInline();
      const blocks = normalizeBlockSequence(node.children);
      result.push(...applyAlign(blocks, getAttr(node, "data-align")));
      continue;
    }
    if (!OUTPUT_BLOCK_TAGS.has(node.tag) && node.tag !== "li") {
      inline.push(node);
      continue;
    }
    flushInline();
    if (node.tag === "li") {
      const children = normalizePreservingInline(node.children);
      if (hasBlockContent(children)) {
        result.push(elementNode("li", cloneAttrs(node), children));
      }
      continue;
    }
    result.push(...normalizeBlock(node));
  }
  flushInline();
  return result;
}

function normalizeList(node: HtmlElementNode): HtmlElementNode | null {
  const items: HtmlNode[] = [];
  let inline: HtmlNode[] = [];

  const flushInline = (): void => {
    if (inline.length === 0) return;
    const children = normalizeInlineChildren(inline);
    inline = [];
    if (inlineHasContent(children)) {
      items.push(elementNode("li", [], children));
    }
  };

  for (const child of node.children) {
    if (child.type === "text") {
      inline.push(child);
      continue;
    }
    if (child.tag === "li") {
      flushInline();
      const children = normalizePreservingInline(child.children);
      if (hasBlockContent(children)) {
        items.push(elementNode("li", cloneAttrs(child), children));
      }
      continue;
    }
    if (child.tag === "div") {
      flushInline();
      const blocks = normalizeBlockSequence(child.children);
      for (const block of blocks) {
        if (block.type === "element" && block.tag === "li") {
          items.push(block);
        } else if (block.type === "element" && OUTPUT_BLOCK_TAGS.has(block.tag)) {
          items.push(elementNode("li", [], [block]));
        } else {
          inline.push(block);
        }
      }
      continue;
    }
    if (OUTPUT_BLOCK_TAGS.has(child.tag)) {
      flushInline();
      const blocks = normalizeBlock(child);
      for (const block of blocks) {
        if (block.type === "element") {
          items.push(elementNode("li", [], [block]));
        }
      }
      continue;
    }
    inline.push(child);
  }
  flushInline();
  if (items.length === 0) return null;
  return elementNode(node.tag, cloneAttrs(node), items);
}

function normalizeBlock(node: HtmlElementNode): HtmlNode[] {
  if (node.tag === "hr") return [node];
  if (node.tag === "ul" || node.tag === "ol") {
    const list = normalizeList(node);
    return list === null ? [] : [list];
  }
  if (node.tag === "blockquote") {
    const children = normalizePreservingInline(node.children);
    return hasBlockContent(children)
      ? [elementNode("blockquote", cloneAttrs(node), children)]
      : [];
  }
  if (TEXT_BLOCK_TAGS.has(node.tag)) {
    const block = normalizeTextBlock(node);
    return block === null ? [] : [block];
  }
  return [];
}

function normalizeTree(nodes: readonly HtmlNode[]): HtmlNode[] {
  return normalizeBlockSequence(nodes);
}

function escapeText(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/gu, "&quot;");
}

function serializeNodes(nodes: readonly HtmlNode[]): string {
  let output = "";
  for (const node of nodes) {
    if (node.type === "text") {
      output += escapeText(node.value);
      continue;
    }
    const attrs = node.attrs
      .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
      .join("");
    if (node.tag === "br" || node.tag === "hr") {
      output += `<${node.tag}${attrs}>`;
      continue;
    }
    output += `<${node.tag}${attrs}>${serializeNodes(node.children)}</${node.tag}>`;
  }
  return output;
}

/**
 * Очищает и нормализует HTML по allowlist без DOM. Работает одинаково на
 * сервере и клиенте, поэтому пригоден для SSR hidden input.
 */
export function sanitizeHtml(input: string): string {
  if (typeof input !== "string" || input === "") return "";
  const parsed = parseHtml(input);
  const sanitized = sanitizeNodes(parsed);
  const normalized = normalizeTree(sanitized);
  return serializeNodes(normalized);
}

/**
 * Санитайз с сохранением структуры (для снапшотов истории). Нужен, чтобы
 * путь к каретке после undo указывал на те же узлы, включая пустые блоки/br.
 */
export function sanitizeHtmlStructure(input: string): string {
  if (typeof input !== "string" || input === "") return "";
  return serializeNodes(sanitizeStructureNodes(parseHtml(input)));
}

/** Псевдонимы для читаемости и внешних проверок. */
export const sanitize = sanitizeHtml;
export const normalizeHtml = sanitizeHtml;

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
