/**
 * Команды форматирования. Все операции выполняются над `Range` и DOM:
 * никакого `document.execCommand` и никаких сторонних библиотек.
 */

import { sanitizeHref } from "./sanitize.js";
import {
  captureOffsets,
  closestWithin,
  findBlock,
  getEditorRange,
  inlineElementsInRange,
  insertMarker,
  insertText,
  normalizeInline,
  selectNodeContents,
  setOffsets,
  unwrapElements,
  wrapTextNodes,
} from "./selection.js";

export type InlineFormat = "bold" | "italic" | "underline" | "strike";
export type BlockFormat =
  | "h1"
  | "h2"
  | "h3"
  | "paragraph"
  | "blockquote"
  | "code";
export type AlignFormat = "left" | "center" | "right";
export type ListFormat = "ul" | "ol";

const INLINE_TAGS: Readonly<Record<InlineFormat, readonly string[]>> = {
  bold: ["strong", "b"],
  italic: ["em", "i"],
  underline: ["u"],
  strike: ["s", "del"],
};

const INLINE_TARGET: Readonly<Record<InlineFormat, string>> = {
  bold: "strong",
  italic: "em",
  underline: "u",
  strike: "s",
};

const BLOCK_TARGET: Readonly<Record<BlockFormat, string>> = {
  h1: "h1",
  h2: "h2",
  h3: "h3",
  paragraph: "p",
  blockquote: "blockquote",
  code: "pre",
};

const BLOCK_SELECTOR = "p,h1,h2,h3,blockquote,pre,li,div";
const BLOCK_TAGS = new Set(BLOCK_SELECTOR.split(","));
const REL_TOKENS = ["noopener", "noreferrer", "nofollow", "ugc", "sponsored"] as const;

function topLevelNodeAt(root: HTMLElement, node: Node, offset: number): Node | null {
  if (node === root) {
    const children = root.childNodes;
    const index = Math.min(Math.max(offset, 0), Math.max(children.length - 1, 0));
    return children[index] ?? null;
  }
  let current: Node = node;
  while (current.parentNode !== null && current.parentNode !== root) {
    current = current.parentNode;
  }
  return current.parentNode === root ? current : null;
}

function moveChildren(from: Node, to: Node): void {
  while (from.firstChild !== null) {
    to.appendChild(from.firstChild);
  }
}

function ensureNonEmptyBlock(root: HTMLElement, block: HTMLElement): void {
  if (block.textContent === "" && block.querySelector("br") === null) {
    block.appendChild(root.ownerDocument.createElement("br"));
  }
}

function liftListItem(root: HTMLElement, li: Element): HTMLElement | null {
  const list = li.parentElement;
  if (list === null || (list.localName !== "ul" && list.localName !== "ol")) {
    return null;
  }
  const documentRef = root.ownerDocument;
  const paragraph = documentRef.createElement("p") as HTMLElement;
  const align = li.getAttribute("data-align");
  if (align === "left" || align === "center" || align === "right") {
    paragraph.setAttribute("data-align", align);
  }
  moveChildren(li, paragraph);
  ensureNonEmptyBlock(root, paragraph);

  const previous = li.previousElementSibling;
  const next = li.nextElementSibling;
  if (previous === null && next === null) {
    list.replaceWith(paragraph);
    return paragraph;
  }
  if (previous === null) {
    list.before(paragraph);
    li.remove();
    return paragraph;
  }
  if (next === null) {
    list.after(paragraph);
    li.remove();
    return paragraph;
  }
  const tail = list.cloneNode(false) as Element;
  let cursor = li.nextElementSibling;
  while (cursor !== null) {
    const following = cursor.nextElementSibling;
    tail.appendChild(cursor);
    cursor = following;
  }
  list.after(paragraph);
  paragraph.after(tail);
  li.remove();
  return paragraph;
}

function convertListToBlocks(
  root: HTMLElement,
  list: Element,
  selected: Element,
  targetTag: string,
): void {
  const documentRef = root.ownerDocument;
  for (const li of Array.from(list.children)) {
    if (li.localName !== "li") continue;
    const tag = li === selected ? targetTag : "p";
    const block = documentRef.createElement(tag) as HTMLElement;
    const align = li.getAttribute("data-align");
    if (align === "left" || align === "center" || align === "right") {
      block.setAttribute("data-align", align);
    }
    moveChildren(li, block);
    ensureNonEmptyBlock(root, block);
    list.before(block);
  }
  list.remove();
}

function setBlock(root: HTMLElement, format: BlockFormat): boolean {
  const range = getEditorRange(root);
  if (range === null) return false;
  const offsets = captureOffsets(root);
  const targetTag = BLOCK_TARGET[format];
  let block = findBlock(root, range.startContainer);

  if (block === root) {
    const top = topLevelNodeAt(root, range.startContainer, range.startOffset);
    if (top !== null && top.nodeType === 1) {
      const element = top as Element;
      if (element === root) {
        // fall through: создаём блок из всего содержимого
      } else if (BLOCK_TAGS.has(element.localName)) {
        block = element as HTMLElement;
      } else {
        const wrapper = root.ownerDocument.createElement(targetTag) as HTMLElement;
        root.insertBefore(wrapper, element);
        wrapper.appendChild(element);
        ensureNonEmptyBlock(root, wrapper);
        normalizeInline(root);
        if (offsets !== null) setOffsets(root, offsets.start, offsets.end);
        return true;
      }
    }
    if (block === root) {
      const wrapper = root.ownerDocument.createElement(targetTag) as HTMLElement;
      while (root.firstChild !== null) wrapper.appendChild(root.firstChild);
      ensureNonEmptyBlock(root, wrapper);
      root.appendChild(wrapper);
      normalizeInline(root);
      if (offsets !== null) setOffsets(root, offsets.start, offsets.end);
      return true;
    }
  }

  // Пункт списка: заголовок/цитата не должны оставаться внутри ul/ol.
  const listItem = closestWithin(root, block, ["li"]);
  if (listItem !== null && block !== listItem) {
    block = listItem as HTMLElement;
  }
  const list = block.parentElement;
  if (block.localName === "li" && list !== null && (list.localName === "ul" || list.localName === "ol")) {
    convertListToBlocks(root, list, block, targetTag);
    if (offsets !== null) setOffsets(root, offsets.start, offsets.end);
    return true;
  }

  if (block.localName === targetTag) {
    if (offsets !== null) setOffsets(root, offsets.start, offsets.end);
    return false;
  }

  const replacement = root.ownerDocument.createElement(targetTag) as HTMLElement;
  const align = block.getAttribute("data-align");
  if (align === "left" || align === "center" || align === "right") {
    replacement.setAttribute("data-align", align);
  }
  moveChildren(block, replacement);
  ensureNonEmptyBlock(root, replacement);
  block.replaceWith(replacement);
  normalizeInline(root);
  if (offsets !== null) setOffsets(root, offsets.start, offsets.end);
  return true;
}

function rangeHasInlineFormat(
  root: HTMLElement,
  range: Range,
  tags: readonly string[],
): boolean {
  if (closestWithin(root, range.startContainer, tags) !== null) return true;
  if (range.collapsed) return false;
  if (closestWithin(root, range.endContainer, tags) !== null) return true;
  // Начало и конец могут лежать в родителе, а формат — внутри диапазона.
  return inlineElementsInRange(root, range, tags).length > 0;
}

function toggleInline(root: HTMLElement, format: InlineFormat): boolean {
  const range = getEditorRange(root);
  if (range === null) return false;
  const aliases = INLINE_TAGS[format];
  const target = INLINE_TARGET[format];
  const offsets = captureOffsets(root);

  if (range.collapsed) {
    insertMarker(root, target);
    normalizeInline(root, aliases);
    return true;
  }

  if (rangeHasInlineFormat(root, range, aliases)) {
    unwrapElements(inlineElementsInRange(root, range, aliases));
  } else {
    wrapTextNodes(root, range, target, aliases);
  }
  normalizeInline(root, aliases);
  if (offsets !== null) setOffsets(root, offsets.start, offsets.end);
  return true;
}

function toggleList(root: HTMLElement, type: ListFormat): boolean {
  const range = getEditorRange(root);
  if (range === null) return false;
  const offsets = captureOffsets(root);
  const documentRef = root.ownerDocument;
  const item = closestWithin(root, range.startContainer, ["li"]);

  if (item !== null) {
    const list = item.parentElement;
    if (list !== null && (list.localName === "ul" || list.localName === "ol")) {
      if (list.localName === type) {
        liftListItem(root, item);
      } else {
        const replacement = documentRef.createElement(type);
        moveChildren(list, replacement);
        list.replaceWith(replacement);
      }
      if (offsets !== null) setOffsets(root, offsets.start, offsets.end);
      return true;
    }
  }

  let block = findBlock(root, range.startContainer);
  if (block === root) {
    const top = topLevelNodeAt(root, range.startContainer, range.startOffset);
    if (top !== null && top.nodeType === 1) {
      const element = top as Element;
      if (BLOCK_TAGS.has(element.localName)) {
        block = element as HTMLElement;
      }
    }
  }
  if (block === root) {
    const wrapper = documentRef.createElement(type);
    const li = documentRef.createElement("li");
    while (root.firstChild !== null) li.appendChild(root.firstChild);
    ensureNonEmptyBlock(root, li as HTMLElement);
    wrapper.appendChild(li);
    root.appendChild(wrapper);
    if (offsets !== null) setOffsets(root, offsets.start, offsets.end);
    return true;
  }

  const list = documentRef.createElement(type);
  const li = documentRef.createElement("li");
  const align = block.getAttribute("data-align");
  if (align === "left" || align === "center" || align === "right") {
    li.setAttribute("data-align", align);
  }
  moveChildren(block, li);
  ensureNonEmptyBlock(root, li as HTMLElement);
  list.appendChild(li);
  block.replaceWith(list);
  if (offsets !== null) setOffsets(root, offsets.start, offsets.end);
  return true;
}

function setAlign(root: HTMLElement, align: AlignFormat): boolean {
  const range = getEditorRange(root);
  if (range === null) return false;
  const offsets = captureOffsets(root);
  let block = findBlock(root, range.startContainer);
  if (block === root) {
    const top = topLevelNodeAt(root, range.startContainer, range.startOffset);
    if (top !== null && top.nodeType === 1) {
      const element = top as Element;
      if (BLOCK_TAGS.has(element.localName)) {
        block = element as HTMLElement;
      }
    }
  }
  if (block === root) {
    const paragraph = root.ownerDocument.createElement("p");
    while (root.firstChild !== null) paragraph.appendChild(root.firstChild);
    ensureNonEmptyBlock(root, paragraph as HTMLElement);
    root.appendChild(paragraph);
    block = paragraph as HTMLElement;
  }
  block.setAttribute("data-align", align);
  if (offsets !== null) setOffsets(root, offsets.start, offsets.end);
  return true;
}

function clearFormatting(root: HTMLElement): boolean {
  const range = getEditorRange(root);
  if (range === null) return false;
  const offsets = captureOffsets(root);

  if (range.collapsed) {
    const ancestors: Element[] = [];
    let element: Element | null =
      range.startContainer.nodeType === 1
        ? (range.startContainer as Element)
        : range.startContainer.parentElement;
    while (element !== null && element !== root) {
      if (["strong", "b", "em", "i", "u", "s", "del", "code", "a"].includes(element.localName)) {
        ancestors.push(element);
      }
      element = element.parentElement;
    }
    unwrapElements(ancestors);
  } else {
    unwrapElements(inlineElementsInRange(root, range));
  }

  const blocks = root.querySelectorAll(BLOCK_SELECTOR);
  for (const block of blocks) {
    if (range.intersectsNode(block)) block.removeAttribute("data-align");
  }

  normalizeInline(root);
  if (offsets !== null) setOffsets(root, offsets.start, offsets.end);
  return true;
}

function relFor(target: string | undefined): string | null {
  if (target !== "_blank") return null;
  return REL_TOKENS.slice(0, 2).join(" ");
}

function configureAnchor(
  anchor: Element,
  href: string,
  target: string | undefined,
): void {
  anchor.setAttribute("href", href);
  if (target === "_blank" || target === "_self") {
    anchor.setAttribute("target", target);
    const rel = relFor(target);
    if (rel === null) {
      anchor.removeAttribute("rel");
    } else {
      anchor.setAttribute("rel", rel);
    }
  } else {
    anchor.removeAttribute("target");
    anchor.removeAttribute("rel");
  }
}

function applyLink(root: HTMLElement, href: string, target: string | undefined): boolean {
  const safeHref = sanitizeHref(href);
  if (safeHref === null) return false;
  const range = getEditorRange(root);
  if (range === null) return false;
  const offsets = captureOffsets(root);
  const existing = closestWithin(root, range.startContainer, ["a"]);

  if (range.collapsed && existing !== null) {
    configureAnchor(existing, safeHref, target);
    if (offsets !== null) setOffsets(root, offsets.start, offsets.end);
    return true;
  }

  if (range.collapsed) {
    insertMarker(root, "a", (element) => configureAnchor(element, safeHref, target));
    return true;
  }

  for (const anchor of inlineElementsInRange(root, range, ["a"])) {
    configureAnchor(anchor, safeHref, target);
  }
  wrapTextNodes(root, range, "a", ["a"], (element) => configureAnchor(element, safeHref, target));
  normalizeInline(root, ["a"]);
  if (offsets !== null) setOffsets(root, offsets.start, offsets.end);
  return true;
}

function unlink(root: HTMLElement): boolean {
  const range = getEditorRange(root);
  if (range === null) return false;
  const offsets = captureOffsets(root);
  const anchors =
    range.collapsed
      ? (() => {
          const anchor = closestWithin(root, range.startContainer, ["a"]);
          return anchor === null ? [] : [anchor];
        })()
      : inlineElementsInRange(root, range, ["a"]);
  if (anchors.length === 0) return false;
  unwrapElements(anchors);
  normalizeInline(root, ["a"]);
  if (offsets !== null) setOffsets(root, offsets.start, offsets.end);
  return true;
}

function splitBlock(root: HTMLElement, range: Range, block: HTMLElement): void {
  const documentRef = root.ownerDocument;
  const tailRange = documentRef.createRange();
  tailRange.setStart(range.endContainer, range.endOffset);
  tailRange.setEnd(block, block.childNodes.length);
  const tail = tailRange.extractContents();
  const next = block.cloneNode(false) as HTMLElement;
  next.appendChild(tail);
  block.after(next);
  ensureNonEmptyBlock(root, next);
  ensureNonEmptyBlock(root, block);
  selectNodeContents(root, next, false);
}

function splitListItem(root: HTMLElement, range: Range, li: HTMLElement): void {
  if ((li.textContent ?? "").trim() === "") {
    const paragraph = liftListItem(root, li);
    if (paragraph !== null) selectNodeContents(root, paragraph, false);
    return;
  }
  const documentRef = root.ownerDocument;
  const tailRange = documentRef.createRange();
  tailRange.setStart(range.endContainer, range.endOffset);
  tailRange.setEnd(li, li.childNodes.length);
  const tail = tailRange.extractContents();
  const next = li.cloneNode(false) as HTMLElement;
  next.appendChild(tail);
  li.after(next);
  ensureNonEmptyBlock(root, next);
  ensureNonEmptyBlock(root, li);
  selectNodeContents(root, next, false);
}

/** Enter: разбивает блок, не отдавая структуру браузеру. */
export function insertParagraphBreak(root: HTMLElement): boolean {
  const range = getEditorRange(root);
  if (range === null) return false;
  if (!range.collapsed) {
    range.deleteContents();
    range.collapse(true);
  }
  const block = findBlock(root, range.startContainer);
  if (block === root) {
    const br = root.ownerDocument.createElement("br");
    range.insertNode(br);
    const after = root.ownerDocument.createRange();
    after.setStartAfter(br);
    after.collapse(true);
    const selection = root.ownerDocument.getSelection();
    if (selection !== null) {
      selection.removeAllRanges();
      selection.addRange(after);
    }
    return true;
  }
  if (block.localName === "pre") {
    return insertText(root, "\n");
  }
  if (block.localName === "li") {
    splitListItem(root, range, block);
    return true;
  }
  splitBlock(root, range, block);
  return true;
}

export function applyInlineFormat(root: HTMLElement, format: InlineFormat): boolean {
  return toggleInline(root, format);
}

export function applyBlockFormat(root: HTMLElement, format: BlockFormat): boolean {
  return setBlock(root, format);
}

export function applyListFormat(root: HTMLElement, type: ListFormat): boolean {
  return toggleList(root, type);
}

export function applyAlignFormat(root: HTMLElement, align: AlignFormat): boolean {
  return setAlign(root, align);
}

export function applyClearFormatting(root: HTMLElement): boolean {
  return clearFormatting(root);
}

export function applyLinkFormat(
  root: HTMLElement,
  href: string,
  target?: string,
): boolean {
  return applyLink(root, href, target);
}

export function applyUnlink(root: HTMLElement): boolean {
  return unlink(root);
}

/**
 * Активное состояние команды считается по текущему `Selection`:
 * предки/блок, а не устаревшие queryCommandState.
 */
export function isCommandActive(
  root: HTMLElement,
  command: string,
): boolean {
  const range = getEditorRange(root);
  if (range === null) return false;

  if (command === "bold" || command === "italic" || command === "underline" || command === "strike") {
    return rangeHasInlineFormat(root, range, INLINE_TAGS[command]);
  }

  const block = findBlock(root, range.startContainer);

  switch (command) {
    case "h1":
    case "h2":
    case "h3":
    case "blockquote":
      return block.localName === command;
    case "paragraph":
      return block.localName === "p";
    case "code":
      return block.localName === "pre";
    case "ul":
    case "ol": {
      const item = closestWithin(root, range.startContainer, ["li"]);
      if (item === null) return false;
      return item.parentElement?.localName === command;
    }
    case "align-left":
    case "align-center":
    case "align-right": {
      const align = block.getAttribute("data-align") ?? (block.localName === "li" ? "left" : "");
      if (command === "align-left") return align === "" || align === "left";
      return align === command.slice("align-".length);
    }
    case "link":
      return closestWithin(root, range.startContainer, ["a"]) !== null;
    default:
      return false;
  }
}

export function isToggleCommand(command: string): boolean {
  return (
    command === "bold" ||
    command === "italic" ||
    command === "underline" ||
    command === "strike" ||
    command === "h1" ||
    command === "h2" ||
    command === "h3" ||
    command === "paragraph" ||
    command === "blockquote" ||
    command === "code" ||
    command === "ul" ||
    command === "ol" ||
    command === "align-left" ||
    command === "align-center" ||
    command === "align-right"
  );
}

export function linkTargetFor(href: string): string | undefined {
  return /^https?:/iu.test(href) ? "_blank" : undefined;
}
