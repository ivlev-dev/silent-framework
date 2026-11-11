import { SVG_NAMESPACE } from "./types.js";
import type { DomDocument, DomElement, DomNode, DomTemplateElement } from "./types.js";
import { CommentImpl, DocumentFragmentImpl, ElementImpl, TextImpl, setInnerHtmlParser } from "./node.js";
import { serializeChildren } from "./serializer.js";

const VOID_ELEMENTS: ReadonlySet<string> = new Set([
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

const NAMED_ENTITIES: ReadonlyMap<string, string> = new Map([
  ["amp", "&"],
  ["apos", "'"],
  ["gt", ">"],
  ["lt", "<"],
  ["quot", "\""],
]);

interface OpenElement {
  readonly element: DomElement;
  readonly name: string;
  readonly position: number;
  readonly svgRoot: boolean;
}

export class HtmlParseError extends Error {
  readonly position: number;

  constructor(message: string, position: number) {
    super(message);
    this.name = "HtmlParseError";
    this.position = position;
  }
}

function isWhitespace(char: string): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r" || char === "\f";
}

function isNameChar(char: string): boolean {
  return char !== "" && !isWhitespace(char) && char !== "/" && char !== ">" && char !== "<";
}

function isAttributeNameEnd(char: string): boolean {
  return isWhitespace(char) || char === "=" || char === "/" || char === ">";
}

function isUnquotedValueEnd(char: string): boolean {
  return isWhitespace(char) || char === ">";
}

function isValidCodePoint(code: number): boolean {
  return Number.isInteger(code) && code >= 0 && code <= 0x10ffff;
}

function decodeEntities(value: string): string {
  if (value.indexOf("&") === -1) {
    return value;
  }
  return value.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match: string, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = Number.parseInt(body.slice(2), 16);
      return isValidCodePoint(code) ? String.fromCodePoint(code) : match;
    }
    if (body.startsWith("#")) {
      const code = Number.parseInt(body.slice(1), 10);
      return isValidCodePoint(code) ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES.get(body) ?? match;
  });
}

class FragmentParser {
  private index = 0;
  private readonly stack: OpenElement[] = [];
  private readonly roots = new DocumentFragmentImpl();
  private svgDepth = 0;

  constructor(
    private readonly document: DomDocument,
    private readonly source: string,
  ) {}

  parse(): DomNode[] {
    while (this.index < this.source.length) {
      if (this.source[this.index] === "<") {
        this.parseMarkup();
        continue;
      }
      this.parseText();
    }
    const open = this.stack[this.stack.length - 1];
    if (open !== undefined) {
      throw new HtmlParseError(`Unclosed tag <${open.name}>`, open.position);
    }
    return [...this.roots.childNodes];
  }

  private parseMarkup(): void {
    if (this.source.startsWith("<!--", this.index)) {
      this.parseComment();
      return;
    }
    if (this.source.startsWith("</", this.index)) {
      this.parseClosingTag();
      return;
    }
    this.parseOpeningTag();
  }

  private parseText(): void {
    const next = this.source.indexOf("<", this.index);
    const end = next === -1 ? this.source.length : next;
    const raw = this.source.slice(this.index, end);
    this.index = end;
    if (raw === "") {
      return;
    }
    this.append(new TextImpl(decodeEntities(raw)));
  }

  private parseComment(): void {
    const start = this.index;
    const end = this.source.indexOf("-->", start + 4);
    if (end === -1) {
      throw new HtmlParseError("Unterminated comment", start);
    }
    this.append(new CommentImpl(this.source.slice(start + 4, end)));
    this.index = end + 3;
  }

  private parseOpeningTag(): void {
    const start = this.index;
    this.index += 1;
    const nameStart = this.index;
    while (this.index < this.source.length && isNameChar(this.current())) {
      this.index += 1;
    }
    const rawName = this.source.slice(nameStart, this.index);
    if (rawName === "") {
      throw new HtmlParseError("Invalid tag name", start);
    }

    const attributes: Array<readonly [string, string]> = [];
    let selfClosing = false;
    for (;;) {
      this.skipWhitespace();
      if (this.index >= this.source.length) {
        throw new HtmlParseError(`Unterminated tag <${rawName}>`, start);
      }
      const char = this.current();
      if (char === ">") {
        this.index += 1;
        break;
      }
      if (char === "/" && this.source[this.index + 1] === ">") {
        this.index += 2;
        selfClosing = true;
        break;
      }
      if (char === "/") {
        this.index += 1;
        continue;
      }
      attributes.push(this.parseAttribute(rawName));
    }

    const lowerName = rawName.toLowerCase();
    const svgRoot = this.svgDepth === 0 && lowerName === "svg";
    const svgContext = this.svgDepth > 0 || svgRoot;
    const element = svgContext
      ? this.document.createElementNS(SVG_NAMESPACE, rawName)
      : this.document.createElement(lowerName);
    for (const [name, value] of attributes) {
      element.setAttribute(svgContext ? name : name.toLowerCase(), value);
    }
    this.append(element);

    if (selfClosing) {
      return;
    }
    if (!svgContext && VOID_ELEMENTS.has(lowerName)) {
      return;
    }
    this.stack.push({ element, name: rawName, position: start, svgRoot });
    if (svgRoot) {
      this.svgDepth += 1;
    }
  }

  private parseAttribute(tagName: string): readonly [string, string] {
    const start = this.index;
    while (this.index < this.source.length && !isAttributeNameEnd(this.current())) {
      this.index += 1;
    }
    const rawName = this.source.slice(start, this.index);
    if (rawName === "") {
      throw new HtmlParseError(`Invalid attribute in <${tagName}>`, start);
    }
    this.skipWhitespace();
    if (this.source[this.index] !== "=") {
      return [rawName, ""];
    }
    this.index += 1;
    this.skipWhitespace();
    const quote = this.source[this.index];
    if (quote === "\"" || quote === "'") {
      this.index += 1;
      const valueStart = this.index;
      const end = this.source.indexOf(quote, valueStart);
      if (end === -1) {
        throw new HtmlParseError(`Unterminated attribute value in <${tagName}>`, start);
      }
      this.index = end + 1;
      return [rawName, decodeEntities(this.source.slice(valueStart, end))];
    }
    const valueStart = this.index;
    while (this.index < this.source.length && !isUnquotedValueEnd(this.current())) {
      this.index += 1;
    }
    return [rawName, decodeEntities(this.source.slice(valueStart, this.index))];
  }

  private parseClosingTag(): void {
    const start = this.index;
    const end = this.source.indexOf(">", start + 2);
    if (end === -1) {
      throw new HtmlParseError("Unterminated closing tag", start);
    }
    const rawName = this.source.slice(start + 2, end).trim();
    this.index = end + 1;
    const lowerName = rawName.toLowerCase();
    if (VOID_ELEMENTS.has(lowerName)) {
      return;
    }
    const open = this.stack[this.stack.length - 1];
    if (open === undefined) {
      throw new HtmlParseError(`Unexpected closing tag </${rawName}>`, start);
    }
    const matches =
      open.element.namespaceURI === SVG_NAMESPACE
        ? open.name === rawName
        : open.name.toLowerCase() === lowerName;
    if (!matches) {
      throw new HtmlParseError(`Unexpected closing tag </${rawName}>`, start);
    }
    this.stack.pop();
    if (open.svgRoot) {
      this.svgDepth -= 1;
    }
  }

  private append(node: DomNode): void {
    const parent = this.stack[this.stack.length - 1];
    if (parent === undefined) {
      this.roots.appendChild(node);
      return;
    }
    parent.element.appendChild(node);
  }

  private skipWhitespace(): void {
    while (this.index < this.source.length && isWhitespace(this.current())) {
      this.index += 1;
    }
  }

  private current(): string {
    return this.source[this.index] ?? "";
  }
}

export function parseHtmlFragment(document: DomDocument, html: string): DomNode[] {
  return new FragmentParser(document, html).parse();
}

setInnerHtmlParser(parseHtmlFragment);

export class TemplateElementImpl extends ElementImpl implements DomTemplateElement {
  readonly content: DocumentFragmentImpl;
  private readonly ownerDocument: DomDocument;

  constructor(document: DomDocument) {
    super("template");
    this.ownerDocument = document;
    this.content = new DocumentFragmentImpl();
  }

  get innerHTML(): string {
    return serializeChildren(this.content);
  }

  set innerHTML(value: string) {
    const nodes = parseHtmlFragment(this.ownerDocument, value);
    for (const child of this.content.childNodes.slice()) {
      this.content.removeChild(child);
    }
    for (const node of nodes) {
      this.content.appendChild(node);
    }
  }
}
