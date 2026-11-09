import {
  NODE_COMMENT,
  NODE_DOCUMENT,
  NODE_DOCUMENT_FRAGMENT,
  NODE_ELEMENT,
  NODE_TEXT,
  SHOW_ALL,
  SHOW_COMMENT,
  SHOW_ELEMENT,
  SVG_NAMESPACE,
} from "./types.js";
import type { DomDocument, DomNode, DomTreeWalker } from "./types.js";
import {
  CommentImpl,
  DocumentFragmentImpl,
  ElementImpl,
  NodeImpl,
  SvgElementImpl,
  TextImpl,
} from "./node.js";
import { TemplateElementImpl } from "./parser.js";

export class TreeWalkerImpl implements DomTreeWalker {
  currentNode: DomNode;
  private readonly root: DomNode;
  private readonly whatToShow: number;

  constructor(root: DomNode, whatToShow: number) {
    this.root = root;
    this.currentNode = root;
    this.whatToShow = whatToShow;
  }

  nextNode(): DomNode | null {
    let candidate = this.nextInOrder(this.currentNode);
    while (candidate !== null) {
      if (this.accepts(candidate)) {
        this.currentNode = candidate;
        return candidate;
      }
      candidate = this.nextInOrder(candidate);
    }
    return null;
  }

  parentNode(): DomNode | null {
    if (this.currentNode === this.root) {
      return null;
    }
    let candidate: DomNode | null = this.currentNode.parentNode;
    while (candidate !== null) {
      if (this.accepts(candidate)) {
        this.currentNode = candidate;
        return candidate;
      }
      if (candidate === this.root) {
        return null;
      }
      candidate = candidate.parentNode;
    }
    return null;
  }

  private accepts(node: DomNode): boolean {
    if (node.nodeType <= 0 || node.nodeType > 32) {
      return false;
    }
    return (this.whatToShow & (1 << (node.nodeType - 1))) !== 0;
  }

  private nextInOrder(node: DomNode): DomNode | null {
    if (node.firstChild !== null) {
      return node.firstChild;
    }
    let current: DomNode = node;
    while (current !== this.root) {
      const sibling = current.nextSibling;
      if (sibling !== null) {
        return sibling;
      }
      const parent = current.parentNode;
      if (parent === null) {
        return null;
      }
      current = parent;
    }
    return null;
  }
}

export class DocumentImpl implements DomDocument {
  readonly nodeType = NODE_DOCUMENT;

  createElement(tag: string): ElementImpl {
    if (tag.toLowerCase() === "template") {
      return new TemplateElementImpl(this);
    }
    return new ElementImpl(tag);
  }

  createElementNS(namespace: string, tag: string): ElementImpl {
    if (namespace === SVG_NAMESPACE) {
      return new SvgElementImpl(tag);
    }
    return new ElementImpl(tag, namespace);
  }

  createComment(data: string): CommentImpl {
    return new CommentImpl(data);
  }

  createTextNode(data: string): TextImpl {
    return new TextImpl(data);
  }

  createDocumentFragment(): DocumentFragmentImpl {
    return new DocumentFragmentImpl();
  }

  createTreeWalker(root: DomNode, whatToShow: number): TreeWalkerImpl {
    return new TreeWalkerImpl(root, whatToShow);
  }
}

export function createDocument(): DocumentImpl {
  return new DocumentImpl();
}

const NODE_CONSTANTS: ReadonlyArray<readonly [string, number]> = [
  ["ELEMENT_NODE", NODE_ELEMENT],
  ["TEXT_NODE", NODE_TEXT],
  ["COMMENT_NODE", NODE_COMMENT],
  ["DOCUMENT_NODE", NODE_DOCUMENT],
  ["DOCUMENT_FRAGMENT_NODE", NODE_DOCUMENT_FRAGMENT],
];

const GLOBAL_VALUES: ReadonlyArray<readonly [string, unknown]> = [
  ["Element", ElementImpl],
  ["SVGElement", SvgElementImpl],
  ["DocumentFragment", DocumentFragmentImpl],
  ["Text", TextImpl],
  ["Comment", CommentImpl],
  ["HTMLTemplateElement", TemplateElementImpl],
  ["NodeFilter", { SHOW_ALL, SHOW_ELEMENT, SHOW_COMMENT }],
];

function defineNodeConstants(): void {
  for (const [name, value] of NODE_CONSTANTS) {
    if (!(name in NodeImpl)) {
      Object.defineProperty(NodeImpl, name, { configurable: true, writable: false, value });
    }
  }
}

export function installDomGlobals(document: DocumentImpl = createDocument()): () => void {
  defineNodeConstants();
  const values: ReadonlyArray<readonly [string, unknown]> = [
    ["document", document],
    ["Node", NodeImpl],
    ...GLOBAL_VALUES,
  ];
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of values) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      enumerable: true,
      value,
    });
  }
  let restored = false;
  return () => {
    if (restored) {
      return;
    }
    restored = true;
    for (const [name, descriptor] of saved) {
      if (descriptor === undefined) {
        Reflect.deleteProperty(globalThis, name);
        continue;
      }
      Object.defineProperty(globalThis, name, descriptor);
    }
  };
}
