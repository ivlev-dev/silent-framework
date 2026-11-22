import { onCleanup } from "@ivlev-dev/silent-reactivity";
import { getRuntimeContextStore } from "./runtime-context-provider.js";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

let collector: ((node: Element) => void) | null = null;

const METADATA_FREE = Symbol.for("silent.metadataFree");
const metadataFree = new WeakSet<Node>();

export function markMetadataFree(node: Node): void {
  try {
    (node as unknown as Record<symbol, unknown>)[METADATA_FREE] = true;
  } catch {
    metadataFree.add(node);
  }
}

export function isMetadataFree(node: Node): boolean {
  return (
    (node as unknown as Record<symbol, unknown>)[METADATA_FREE] === true
    || metadataFree.has(node)
  );
}

const titles: Element[] = [];
let foreignTitles: Element[] | null = null;

export function setMetadataCollector(
  next: ((node: Element) => void) | null,
): void {
  const store = getRuntimeContextStore();
  if (store !== null) {
    store.metadata = next;
    return;
  }
  collector = next;
}

export function getMetadataCollector(): ((node: Element) => void) | null {
  const store = getRuntimeContextStore();
  return store !== null ? store.metadata : collector;
}

export function hoistNode(node: Element): () => void {
  node.parentNode?.removeChild(node);
  stripMarkers(node);
  const target = getMetadataCollector();
  if (target !== null) {
    target(node);
    return () => {};
  }
  if (node.tagName === "TITLE") {
    return registerTitle(node);
  }
  return registerAsset(node);
}

export function isMetadataElement(node: Node | null | undefined): node is Element {
  if (!(node instanceof Element)) {
    return false;
  }
  const tag = node.tagName;
  if (tag !== "TITLE" && tag !== "META" && tag !== "LINK") {
    return false;
  }
  return node.namespaceURI !== SVG_NAMESPACE && !node.hasAttribute("itemprop");
}

export function extractMetadata(nodes: readonly Node[]): Node[] {
  const kept: Node[] = [];
  for (const node of nodes) {
    if (!isMetadataFree(node)) {
      if (isMetadataElement(node)) {
        hoist(node);
        continue;
      }
      collectNested(node);
    }
    kept.push(node);
  }
  return kept.length === nodes.length ? (nodes as Node[]) : kept;
}

export function extractMetadataNode(node: Node): Node | null {
  if (isMetadataFree(node)) {
    return node;
  }
  if (isMetadataElement(node)) {
    hoist(node);
    return null;
  }
  if (node.nodeType === 1 && (node as Element).firstElementChild === null) {
    return node;
  }
  collectNested(node);
  return node;
}

function collectNested(node: Node): void {
  if (node.nodeType !== 1) {
    return;
  }
  let child = node.firstChild;
  while (child !== null) {
    const next = child.nextSibling;
    if (isMetadataElement(child)) {
      hoist(child);
    } else {
      collectNested(child);
    }
    child = next;
  }
}

function stripMarkers(node: Element): void {
  for (const attribute of Array.from(node.attributes)) {
    if (
      attribute.name === "data-silent-text" ||
      attribute.name.startsWith("data-silent-a-")
    ) {
      node.removeAttribute(attribute.name);
    }
  }
}

function hoist(node: Element): void {
  const target = getMetadataCollector();
  const dispose = hoistNode(node);
  if (target === null) {
    onCleanup(dispose);
  }
}

function headElement(): HTMLElement | null {
  if (typeof document === "undefined") {
    return null;
  }
  const head = document.head;
  return head === null || head === undefined ? null : head;
}

function registerAsset(node: Element): () => void {
  const head = headElement();
  if (head === null) {
    return () => {};
  }
  if (node.parentNode !== head) {
    head.appendChild(node);
  }
  return () => {
    node.parentNode?.removeChild(node);
  };
}

function registerTitle(node: Element): () => void {
  if (!titles.includes(node)) {
    titles.push(node);
  }
  syncTitles();
  let active = true;
  const dispose = (): void => {
    if (!active) {
      return;
    }
    active = false;
    const index = titles.indexOf(node);
    if (index !== -1) {
      titles.splice(index, 1);
    }
    if (node.parentNode !== null) {
      node.parentNode.removeChild(node);
    }
    syncTitles();
  };
  return dispose;
}

function syncTitles(): void {
  const head = headElement();
  if (head === null) {
    return;
  }
  if (foreignTitles === null) {
    foreignTitles = [];
    for (const child of Array.from(head.children)) {
      if (child.tagName === "TITLE") {
        foreignTitles.push(child);
      }
    }
  }
  for (const foreign of foreignTitles) {
    if (foreign.parentNode === head) {
      head.removeChild(foreign);
    }
  }
  for (const title of titles) {
    if (title.parentNode !== head) {
      head.appendChild(title);
    }
  }
  if (titles.length === 0) {
    for (const foreign of foreignTitles) {
      if (foreign.parentNode === null) {
        head.appendChild(foreign);
      }
    }
  }
}
