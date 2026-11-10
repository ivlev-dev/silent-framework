import {
  HTML_NAMESPACE,
  NODE_COMMENT,
  NODE_DOCUMENT_FRAGMENT,
  NODE_ELEMENT,
  NODE_TEXT,
  SVG_NAMESPACE,
} from "./types.js";
import type { DomCharacterData, DomDocument, DomDocumentFragment, DomElement, DomNode } from "./types.js";
import { AttributesImpl } from "./attributes.js";
import { StyleImpl } from "./style.js";
import { serializeChildren } from "./serializer.js";

type InnerHtmlParser = (document: DomDocument, html: string) => DomNode[];

let innerHtmlParser: InnerHtmlParser | null = null;

export function setInnerHtmlParser(parser: InnerHtmlParser): void {
  innerHtmlParser = parser;
}

export class NodeImpl implements DomNode {
  readonly nodeType: number;
  protected readonly childList: NodeImpl[] = [];
  protected parent: NodeImpl | null = null;
  protected next: NodeImpl | null = null;
  protected previous: NodeImpl | null = null;

  constructor(nodeType: number) {
    this.nodeType = nodeType;
  }

  get parentNode(): NodeImpl | null {
    return this.parent;
  }

  get firstChild(): NodeImpl | null {
    return this.childList[0] ?? null;
  }

  get lastChild(): NodeImpl | null {
    return this.childList[this.childList.length - 1] ?? null;
  }

  get nextSibling(): NodeImpl | null {
    return this.next;
  }

  get previousSibling(): NodeImpl | null {
    return this.previous;
  }

  get childNodes(): readonly NodeImpl[] {
    return this.childList;
  }

  get textContent(): string | null {
    let result = "";
    const visit = (node: NodeImpl): void => {
      for (const child of node.childList) {
        if (child.nodeType === NODE_TEXT && child instanceof TextImpl) {
          result += child.data;
          continue;
        }
        visit(child);
      }
    };
    visit(this);
    return result;
  }

  set textContent(value: string | null) {
    for (const child of this.childList.slice()) {
      child.detachFromParent();
    }
    const text = value == null ? "" : String(value);
    this.appendChild(new TextImpl(text));
  }

  appendChild<T extends DomNode>(node: T): T {
    return this.insertBefore(node, null);
  }

  insertBefore<T extends DomNode>(node: T, reference: DomNode | null): T {
    if (!(node instanceof NodeImpl)) {
      throw new Error("HierarchyRequestError");
    }
    let referenceNode: NodeImpl | null = null;
    if (reference !== null) {
      if (!(reference instanceof NodeImpl) || !this.childList.includes(reference)) {
        throw new Error("NotFoundError");
      }
      referenceNode = reference;
    }
    if (node.nodeType === NODE_DOCUMENT_FRAGMENT) {
      for (const child of node.childList.slice()) {
        this.insertSingle(child, referenceNode);
      }
      return node;
    }
    this.insertSingle(node, referenceNode);
    return node;
  }

  removeChild<T extends DomNode>(node: T): T {
    if (!(node instanceof NodeImpl) || !this.childList.includes(node)) {
      throw new Error("NotFoundError");
    }
    node.detachFromParent();
    return node;
  }

  remove(): void {
    this.detachFromParent();
  }

  addEventListener(_type: string, _listener: unknown, _options?: unknown): void {}

  removeEventListener(_type: string, _listener: unknown, _options?: unknown): void {}

  dispatchEvent(_event: unknown): boolean {
    return false;
  }

  cloneNode(deep = false): NodeImpl {
    const clone = this.createShallowClone();
    if (deep) {
      for (const child of this.childList) {
        clone.appendChild(child.cloneNode(true));
      }
    }
    return clone;
  }

  protected createShallowClone(): NodeImpl {
    return new NodeImpl(this.nodeType);
  }

  private insertSingle(child: NodeImpl, reference: NodeImpl | null): void {
    if (reference === child) {
      return;
    }
    if (reference !== null && !this.childList.includes(reference)) {
      throw new Error("NotFoundError");
    }
    let ancestor: NodeImpl | null = this;
    while (ancestor !== null) {
      if (ancestor === child) {
        throw new Error("HierarchyRequestError");
      }
      ancestor = ancestor.parent;
    }
    child.detachFromParent();
    const index = reference === null ? this.childList.length : this.childList.indexOf(reference);
    if (index === -1) {
      throw new Error("NotFoundError");
    }
    const previous = index > 0 ? this.childList[index - 1] ?? null : null;
    const next = this.childList[index] ?? null;
    this.childList.splice(index, 0, child);
    child.parent = this;
    child.previous = previous;
    child.next = next;
    if (previous !== null) {
      previous.next = child;
    }
    if (next !== null) {
      next.previous = child;
    }
  }

  private detachFromParent(): void {
    const parent = this.parent;
    if (parent === null) {
      return;
    }
    const index = parent.childList.indexOf(this);
    if (index !== -1) {
      parent.childList.splice(index, 1);
    }
    if (this.previous !== null) {
      this.previous.next = this.next;
    }
    if (this.next !== null) {
      this.next.previous = this.previous;
    }
    this.parent = null;
    this.previous = null;
    this.next = null;
  }
}

export class TextImpl extends NodeImpl implements DomCharacterData {
  override readonly nodeType: number = NODE_TEXT;
  data: string;

  constructor(data: string) {
    super(NODE_TEXT);
    this.data = data;
  }

  protected override createShallowClone(): TextImpl {
    return new TextImpl(this.data);
  }
}

export class CommentImpl extends TextImpl {
  override readonly nodeType: number = NODE_COMMENT;

  constructor(data: string) {
    super(data);
  }

  protected override createShallowClone(): CommentImpl {
    return new CommentImpl(this.data);
  }
}

export class DocumentFragmentImpl extends NodeImpl implements DomDocumentFragment {
  override readonly nodeType = NODE_DOCUMENT_FRAGMENT;

  constructor() {
    super(NODE_DOCUMENT_FRAGMENT);
  }

  protected override createShallowClone(): DocumentFragmentImpl {
    return new DocumentFragmentImpl();
  }
}

export class ElementImpl extends NodeImpl implements DomElement {
  override readonly nodeType = NODE_ELEMENT;
  readonly tagName: string;
  readonly localName: string;
  readonly nodeName: string;
  readonly namespaceURI: string;
  private attributesValue: AttributesImpl | null = null;
  private styleValue: StyleImpl | null = null;
  private valueState = "";

  get attributes(): AttributesImpl {
    return (this.attributesValue ??= new AttributesImpl());
  }

  get attributeCount(): number {
    return this.attributesValue?.length ?? 0;
  }

  get style(): StyleImpl {
    return (this.styleValue ??= new StyleImpl(() => this.syncStyle()));
  }

  constructor(tagName: string, namespaceURI: string = HTML_NAMESPACE) {
    super(NODE_ELEMENT);
    this.namespaceURI = namespaceURI;
    this.localName = namespaceURI === HTML_NAMESPACE ? tagName.toLowerCase() : tagName;
    this.tagName = namespaceURI === HTML_NAMESPACE ? tagName.toUpperCase() : tagName;
    this.nodeName = this.tagName;
  }

  getAttribute(name: string): string | null {
    return this.attributesValue?.get(this.normalizeName(name)) ?? null;
  }

  setAttribute(name: string, value: string): void {
    const normalized = this.normalizeName(name);
    if (normalized === "style") {
      this.style.cssText = String(value);
      return;
    }
    this.attributes.set(normalized, String(value));
  }

  hasAttribute(name: string): boolean {
    return this.attributesValue?.has(this.normalizeName(name)) ?? false;
  }

  removeAttribute(name: string): void {
    const normalized = this.normalizeName(name);
    if (normalized === "style") {
      if (this.styleValue !== null) {
        this.styleValue.cssText = "";
      }
      return;
    }
    this.attributesValue?.delete(normalized);
  }

  get value(): string {
    if (this.tagName === "TEXTAREA") {
      return this.textContent ?? "";
    }
    return this.valueState;
  }

  set value(next: string | number | boolean | null | undefined) {
    const text = next === null || next === undefined ? "" : String(next);
    this.valueState = text;
    if (this.tagName === "TEXTAREA") {
      this.textContent = text;
      return;
    }
    if (text === "") {
      this.removeAttribute("value");
      return;
    }
    this.setAttribute("value", text);
  }

  get innerHTML(): string {
    return serializeChildren(this);
  }

  set innerHTML(value: string) {
    const parser = innerHtmlParser;
    const document = (globalThis as unknown as { document?: DomDocument }).document;
    if (parser === null || document === undefined) {
      throw new Error("innerHTML недоступен без установленного документа");
    }
    while (this.firstChild !== null) {
      this.removeChild(this.firstChild);
    }
    for (const node of parser(document, value)) {
      this.appendChild(node);
    }
  }

  protected override createShallowClone(): ElementImpl {
    const clone = this.createEmptyClone();
    if (this.attributesValue !== null) {
      for (const attribute of this.attributesValue) {
        clone.attributes.set(attribute.name, attribute.value);
      }
    }
    if (this.styleValue !== null) {
      clone.style.cssText = this.styleValue.cssText;
    }
    return clone;
  }

  protected createEmptyClone(): ElementImpl {
    return new ElementImpl(this.tagName, this.namespaceURI);
  }

  private syncStyle(): void {
    if (this.styleValue === null) {
      return;
    }
    const text = this.styleValue.cssText;
    if (text === "") {
      this.attributesValue?.delete(this.normalizeName("style"));
      return;
    }
    this.attributes.set(this.normalizeName("style"), text);
  }

  private normalizeName(name: string): string {
    return this.namespaceURI === HTML_NAMESPACE ? name.toLowerCase() : name;
  }
}

export class SvgElementImpl extends ElementImpl {
  constructor(tagName: string) {
    super(tagName, SVG_NAMESPACE);
  }

  protected override createEmptyClone(): SvgElementImpl {
    return new SvgElementImpl(this.tagName);
  }
}

export function isElementNode(node: DomNode): node is ElementImpl {
  return node instanceof ElementImpl;
}
