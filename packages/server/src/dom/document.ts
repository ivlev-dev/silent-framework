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

const NODE_FILTER = { SHOW_ALL, SHOW_ELEMENT, SHOW_COMMENT };

const GLOBAL_VALUES: ReadonlyArray<readonly [string, unknown]> = [
  ["Element", ElementImpl],
  ["SVGElement", SvgElementImpl],
  ["DocumentFragment", DocumentFragmentImpl],
  ["Text", TextImpl],
  ["Comment", CommentImpl],
  ["HTMLTemplateElement", TemplateElementImpl],
  ["NodeFilter", NODE_FILTER],
];

const GLOBAL_NAMES: readonly string[] = [
  "document",
  "Node",
  ...GLOBAL_VALUES.map(([name]) => name),
];

interface SavedGlobal {
  readonly name: string;
  readonly descriptor: PropertyDescriptor | undefined;
  readonly writable: boolean;
  readonly absent: boolean;
}

const GLOBAL_VALUE_LIST: readonly unknown[] = GLOBAL_VALUES.map(([, value]) => value);

function captureGlobals(): SavedGlobal[] {
  const saved = new Array<SavedGlobal>(GLOBAL_NAMES.length);
  for (let index = 0; index < GLOBAL_NAMES.length; index += 1) {
    const name = GLOBAL_NAMES[index] ?? "";
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    saved[index] = {
      name,
      descriptor,
      writable: descriptor === undefined || descriptor.writable === true,
      absent:
        descriptor === undefined ||
        (descriptor.value === undefined &&
          descriptor.writable === true &&
          descriptor.configurable === true),
    };
  }
  return saved;
}

let nodeConstantsDefined = false;

function defineNodeConstants(): void {
  if (nodeConstantsDefined) {
    return;
  }
  nodeConstantsDefined = true;
  for (const [name, value] of NODE_CONSTANTS) {
    if (!(name in NodeImpl)) {
      Object.defineProperty(NodeImpl, name, { configurable: true, writable: false, value });
    }
  }
}

function installWritable(document: DocumentImpl): void {
  const target = globalThis as unknown as Record<string, unknown>;
  target["document"] = document;
  target["Node"] = NodeImpl;
  target["Element"] = ElementImpl;
  target["SVGElement"] = SvgElementImpl;
  target["DocumentFragment"] = DocumentFragmentImpl;
  target["Text"] = TextImpl;
  target["Comment"] = CommentImpl;
  target["HTMLTemplateElement"] = TemplateElementImpl;
  target["NodeFilter"] = NODE_FILTER;
}

function installDefined(document: DocumentImpl, saved: readonly SavedGlobal[]): void {
  const target = globalThis as unknown as Record<string, unknown>;
  for (let index = 0; index < saved.length; index += 1) {
    const entry = saved[index];
    if (entry === undefined) {
      continue;
    }
    const value =
      index === 0 ? document : index === 1 ? NodeImpl : GLOBAL_VALUE_LIST[index - 2];
    if (entry.writable) {
      target[entry.name] = value;
      continue;
    }
    Object.defineProperty(globalThis, entry.name, {
      configurable: true,
      writable: true,
      enumerable: true,
      value,
    });
  }
}

function restoreWritable(saved: readonly SavedGlobal[], shape: boolean): void {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const entry of saved) {
    if (entry.absent) {
      if (shape) {
        target[entry.name] = undefined;
      } else {
        delete target[entry.name];
      }
      continue;
    }
    target[entry.name] = entry.descriptor?.value;
  }
}

function restoreDefined(saved: readonly SavedGlobal[]): void {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const entry of saved) {
    if (entry.absent || entry.descriptor === undefined) {
      Reflect.deleteProperty(globalThis, entry.name);
      continue;
    }
    if (entry.writable) {
      target[entry.name] = entry.descriptor.value;
      continue;
    }
    Object.defineProperty(globalThis, entry.name, entry.descriptor);
  }
}

export interface DomGlobalsOptions {
  readonly keepShape?: boolean;
}

export function installDomGlobals(
  document: DocumentImpl = createDocument(),
  options: DomGlobalsOptions = {},
): () => void {
  defineNodeConstants();
  const saved = captureGlobals();
  const writable = saved.every((entry) => entry.writable);
  if (writable) {
    installWritable(document);
  } else {
    installDefined(document, saved);
  }
  const shape = options.keepShape === true;
  let armed = true;
  return (): void => {
    if (!armed) {
      return;
    }
    armed = false;
    if (writable) {
      restoreWritable(saved, shape);
      return;
    }
    restoreDefined(saved);
  };
}
