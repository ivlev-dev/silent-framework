export const NODE_ELEMENT = 1;
export const NODE_TEXT = 3;
export const NODE_COMMENT = 8;
export const NODE_DOCUMENT = 9;
export const NODE_DOCUMENT_FRAGMENT = 11;

export const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
export const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

export const SHOW_ELEMENT = 1;
export const SHOW_COMMENT = 128;
export const SHOW_ALL = 0xffffffff;

export interface DomAttr {
  readonly name: string;
  value: string;
}

export interface DomAttributes {
  readonly length: number;
  item(index: number): DomAttr | null;
  [Symbol.iterator](): IterableIterator<DomAttr>;
}

export interface DomStyle {
  cssText: string;
  getPropertyValue(name: string): string;
  setProperty(name: string, value: string): void;
  removeProperty(name: string): string;
}

export interface DomNode {
  readonly nodeType: number;
  readonly parentNode: DomNode | null;
  readonly firstChild: DomNode | null;
  readonly lastChild: DomNode | null;
  readonly nextSibling: DomNode | null;
  readonly previousSibling: DomNode | null;
  readonly childNodes: readonly DomNode[];
  textContent: string | null;
  appendChild<T extends DomNode>(node: T): T;
  insertBefore<T extends DomNode>(node: T, reference: DomNode | null): T;
  removeChild<T extends DomNode>(node: T): T;
  cloneNode(deep?: boolean): DomNode;
}

export interface DomCharacterData extends DomNode {
  data: string;
}

export interface DomElement extends DomNode {
  readonly tagName: string;
  readonly nodeName: string;
  readonly namespaceURI: string;
  readonly attributes: DomAttributes;
  readonly style: DomStyle;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  hasAttribute(name: string): boolean;
  removeAttribute(name: string): void;
}

export interface DomDocumentFragment extends DomNode {}

export interface DomTemplateElement extends DomElement {
  innerHTML: string;
  readonly content: DomDocumentFragment;
}

export interface DomTreeWalker {
  currentNode: DomNode;
  nextNode(): DomNode | null;
  parentNode(): DomNode | null;
}

export interface DomDocument {
  readonly nodeType: number;
  createElement(tag: string): DomElement;
  createElementNS(namespace: string, tag: string): DomElement;
  createComment(data: string): DomCharacterData;
  createTextNode(data: string): DomCharacterData;
  createDocumentFragment(): DomDocumentFragment;
  createTreeWalker(root: DomNode, whatToShow: number): DomTreeWalker;
}
