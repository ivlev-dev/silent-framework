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
}

let savedGlobals: SavedGlobal[] | null = null;
let writableGlobals = false;
let absentGlobals = false;
const previousValues: unknown[] = new Array<unknown>(GLOBAL_NAMES.length);
const hadGlobals: boolean[] = new Array<boolean>(GLOBAL_NAMES.length);
const GLOBAL_VALUE_LIST: readonly unknown[] = GLOBAL_VALUES.map(([, value]) => value);

function captureGlobals(): SavedGlobal[] {
  const saved = new Array<SavedGlobal>(GLOBAL_NAMES.length);
  for (let index = 0; index < GLOBAL_NAMES.length; index += 1) {
    const name = GLOBAL_NAMES[index] ?? "";
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    previousValues[index] = descriptor === undefined ? undefined : descriptor.value;
    hadGlobals[index] = descriptor !== undefined;
    saved[index] = {
      name,
      descriptor,
      writable: descriptor === undefined || descriptor.writable === true,
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

let restoreArmed = false;
let keepShape = false;

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

function installDefined(document: DocumentImpl): void {
  const saved = savedGlobals;
  if (saved === null) {
    return;
  }
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

function restoreWritable(shape: boolean): void {
  const target = globalThis as unknown as Record<string, unknown>;
  if (absentGlobals) {
    if (shape) {
      target["document"] = undefined;
      target["Node"] = undefined;
      target["Element"] = undefined;
      target["SVGElement"] = undefined;
      target["DocumentFragment"] = undefined;
      target["Text"] = undefined;
      target["Comment"] = undefined;
      target["HTMLTemplateElement"] = undefined;
      target["NodeFilter"] = undefined;
      return;
    }
    delete target["document"];
    delete target["Node"];
    delete target["Element"];
    delete target["SVGElement"];
    delete target["DocumentFragment"];
    delete target["Text"];
    delete target["Comment"];
    delete target["HTMLTemplateElement"];
    delete target["NodeFilter"];
    return;
  }
  if (hadGlobals[0] === true) {
    target["document"] = previousValues[0];
  } else {
    delete target["document"];
  }
  if (hadGlobals[1] === true) {
    target["Node"] = previousValues[1];
  } else {
    delete target["Node"];
  }
  if (hadGlobals[2] === true) {
    target["Element"] = previousValues[2];
  } else {
    delete target["Element"];
  }
  if (hadGlobals[3] === true) {
    target["SVGElement"] = previousValues[3];
  } else {
    delete target["SVGElement"];
  }
  if (hadGlobals[4] === true) {
    target["DocumentFragment"] = previousValues[4];
  } else {
    delete target["DocumentFragment"];
  }
  if (hadGlobals[5] === true) {
    target["Text"] = previousValues[5];
  } else {
    delete target["Text"];
  }
  if (hadGlobals[6] === true) {
    target["Comment"] = previousValues[6];
  } else {
    delete target["Comment"];
  }
  if (hadGlobals[7] === true) {
    target["HTMLTemplateElement"] = previousValues[7];
  } else {
    delete target["HTMLTemplateElement"];
  }
  if (hadGlobals[8] === true) {
    target["NodeFilter"] = previousValues[8];
  } else {
    delete target["NodeFilter"];
  }
}

function restoreDefined(): void {
  const saved = savedGlobals;
  if (saved === null) {
    return;
  }
  const target = globalThis as unknown as Record<string, unknown>;
  for (const entry of saved) {
    if (entry.descriptor === undefined) {
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

function restoreGlobals(): void {
  if (!restoreArmed) {
    return;
  }
  restoreArmed = false;
  const shape = keepShape;
  keepShape = false;
  if (writableGlobals) {
    restoreWritable(shape);
    return;
  }
  restoreDefined();
}

export interface DomGlobalsOptions {
  readonly keepShape?: boolean;
}

export function installDomGlobals(
  document: DocumentImpl = createDocument(),
  options: DomGlobalsOptions = {},
): () => void {
  defineNodeConstants();
  if (savedGlobals === null) {
    const captured = captureGlobals();
    savedGlobals = captured;
    writableGlobals = captured.every((entry) => entry.writable);
    absentGlobals = hadGlobals.every((had) => had === false);
  }
  keepShape = options.keepShape === true;
  if (writableGlobals) {
    installWritable(document);
  } else {
    installDefined(document);
  }
  restoreArmed = true;
  return restoreGlobals;
}
