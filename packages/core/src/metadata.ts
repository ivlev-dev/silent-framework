import { onCleanup } from "@ivlev-dev/silent-reactivity";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

let collector: ((node: Element) => void) | null = null;

const titles: Element[] = [];
let foreignTitles: Element[] | null = null;

export function setMetadataCollector(
  next: ((node: Element) => void) | null,
): void {
  collector = next;
}

export function isMetadataElement(node: Node | null | undefined): node is Element {
  if (!(node instanceof Element)) {
    return false;
  }
  if (node.namespaceURI === SVG_NAMESPACE || node.hasAttribute("itemprop")) {
    return false;
  }
  const tag = node.tagName;
  return tag === "TITLE" || tag === "META" || tag === "LINK";
}

export function extractMetadata(nodes: readonly Node[]): Node[] {
  const kept: Node[] = [];
  for (const node of nodes) {
    if (isMetadataElement(node)) {
      hoist(node);
      continue;
    }
    collectNested(node);
    kept.push(node);
  }
  return kept;
}

function collectNested(node: Node): void {
  if (node.nodeType !== 1) {
    return;
  }
  for (const child of Array.from(node.childNodes)) {
    if (isMetadataElement(child)) {
      hoist(child);
      continue;
    }
    collectNested(child);
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
  node.parentNode?.removeChild(node);
  stripMarkers(node);
  if (collector !== null) {
    collector(node);
    return;
  }
  if (node.tagName === "TITLE") {
    onCleanup(registerTitle(node));
    return;
  }
  onCleanup(registerAsset(node));
}

function registerAsset(node: Element): () => void {
  if (typeof document === "undefined" || document.head === null) {
    return () => {};
  }
  const head = document.head;
  if (node.parentNode !== head) {
    head.appendChild(node);
  }
  return () => {
    node.parentNode?.removeChild(node);
  };
}

function registerTitle(node: Element): () => void {
  titles.push(node);
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
  if (typeof document === "undefined" || document.head === null) {
    return;
  }
  const head = document.head;
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
