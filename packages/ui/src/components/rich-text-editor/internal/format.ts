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
const LIST_TAGS = new Set(["ul", "ol"]);
const ALIGN_VALUES = new Set(["left", "center", "right"]);
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

/** Переносит содержимое, разворачивая вложенные `p` (нужно для clear). */
function moveChildrenFlatteningParagraphs(from: Node, to: Node): void {
  for (const child of Array.from(from.childNodes)) {
    if (child.nodeType === 1 && (child as Element).localName === "p") {
      moveChildren(child, to);
      child.remove();
      continue;
    }
    to.appendChild(child);
  }
}

function ensureNonEmptyBlock(root: HTMLElement, block: HTMLElement): void {
  if (block.textContent === "" && block.querySelector("br") === null) {
    block.appendChild(root.ownerDocument.createElement("br"));
  }
}

function copyAlign(from: Element, to: Element): void {
  const align = from.getAttribute("data-align");
  if (align !== null && ALIGN_VALUES.has(align.toLowerCase())) {
    to.setAttribute("data-align", align.toLowerCase());
  }
}

function depthOfBlock(element: Element): number {
  let depth = 0;
  let current: Element | null = element;
  while (current !== null) {
    depth += 1;
    current = current.parentElement;
  }
  return depth;
}

/**
 * Поднимает `li` из списка в самостоятельный блок и сохраняет порядок:
 * при разрыве списка середина делится на две части вокруг блока.
 */
function liftListItem(
  root: HTMLElement,
  li: Element,
  targetTag = "p",
  flattenParagraphs = false,
): HTMLElement | null {
  const list = li.parentElement;
  if (list === null || !LIST_TAGS.has(list.localName)) {
    return null;
  }
  const documentRef = root.ownerDocument;
  const block = documentRef.createElement(targetTag) as HTMLElement;
  copyAlign(li, block);
  if (flattenParagraphs) moveChildrenFlatteningParagraphs(li, block);
  else moveChildren(li, block);
  ensureNonEmptyBlock(root, block);

  const previous = li.previousElementSibling;
  const next = li.nextElementSibling;
  if (previous === null && next === null) {
    list.replaceWith(block);
    return block;
  }
  if (previous === null) {
    list.before(block);
    li.remove();
    return block;
  }
  if (next === null) {
    list.after(block);
    li.remove();
    return block;
  }
  const tail = list.cloneNode(false) as Element;
  let cursor = li.nextElementSibling;
  while (cursor !== null) {
    const following = cursor.nextElementSibling;
    tail.appendChild(cursor);
    cursor = following;
  }
  list.after(block);
  block.after(tail);
  li.remove();
  return block;
}

/** Все блочные элементы, пересекающие диапазон (без фильтра вложенности). */
function blocksInRange(root: HTMLElement, range: Range): HTMLElement[] {
  const result: HTMLElement[] = [];
  for (const element of root.querySelectorAll(BLOCK_SELECTOR)) {
    if (range.intersectsNode(element)) result.push(element as HTMLElement);
  }
  return result;
}

/**
 * Содержательные блоки для блочных команд: самые глубокие из пересекающих
 * диапазон. Так `li > p` даёт `p`, а цитата без абзаца — саму `blockquote`.
 */
function contentBlocks(root: HTMLElement, range: Range): HTMLElement[] {
  if (range.collapsed) {
    const block = findBlock(root, range.startContainer);
    if (block !== root) return [block];
    const top = topLevelNodeAt(root, range.startContainer, range.startOffset);
    if (top !== null && top.nodeType === 1) {
      const element = top as HTMLElement;
      if (BLOCK_TAGS.has(element.localName)) return [element];
      const nested = element.querySelector(BLOCK_SELECTOR);
      if (nested !== null) return [nested as HTMLElement];
    }
    return [];
  }
  const all = blocksInRange(root, range);
  return all.filter(
    (element) => !all.some((other) => other !== element && element.contains(other)),
  );
}

function materializeRootBlock(root: HTMLElement, targetTag: string): HTMLElement {
  const block = root.ownerDocument.createElement(targetTag) as HTMLElement;
  while (root.firstChild !== null) block.appendChild(root.firstChild);
  ensureNonEmptyBlock(root, block);
  root.appendChild(block);
  return block;
}

function setBlock(root: HTMLElement, format: BlockFormat): boolean {
  const range = getEditorRange(root);
  if (range === null) return false;
  const offsets = captureOffsets(root);
  const targetTag = BLOCK_TARGET[format];
  const blocks = contentBlocks(root, range);

  if (blocks.length === 0) {
    materializeRootBlock(root, targetTag);
    normalizeInline(root);
    if (offsets !== null) setOffsets(root, offsets.start, offsets.end);
    return true;
  }

  let changed = false;
  for (const block of blocks) {
    if (!block.isConnected) continue;
    if (block.localName === targetTag) continue;

    // Пункт списка: заголовок/цитата не должны оставаться внутри ul/ol.
    const list = block.parentElement;
    if (block.localName === "li" && list !== null && LIST_TAGS.has(list.localName)) {
      liftListItem(root, block, targetTag, targetTag === "p");
      changed = true;
      continue;
    }

    const replacement = root.ownerDocument.createElement(targetTag) as HTMLElement;
    copyAlign(block, replacement);
    moveChildren(block, replacement);
    ensureNonEmptyBlock(root, replacement);
    block.replaceWith(replacement);
    changed = true;
  }

  normalizeInline(root);
  if (offsets !== null) setOffsets(root, offsets.start, offsets.end);
  return changed;
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

function collectListItems(root: HTMLElement, range: Range): HTMLElement[] {
  if (range.collapsed) {
    const item = closestWithin(root, range.startContainer, ["li"]);
    return item === null ? [] : [item as HTMLElement];
  }
  const result: HTMLElement[] = [];
  for (const item of root.querySelectorAll("li")) {
    if (range.intersectsNode(item)) result.push(item as HTMLElement);
  }
  return result;
}

/**
 * Превращает набор соседних блоков в список. Непрерывные группы и разные
 * родители обрабатываются отдельно, поэтому порядок и вложенность не ломаются.
 * Существующий соседний список того же типа переиспользуется — `li` не дублируются.
 */
function convertBlocksToList(
  root: HTMLElement,
  blocks: readonly HTMLElement[],
  type: ListFormat,
): boolean {
  const documentRef = root.ownerDocument;
  const groups = new Map<Element, HTMLElement[]>();
  for (const block of blocks) {
    const parent = block.parentElement;
    if (parent === null) continue;
    const group = groups.get(parent);
    if (group === undefined) groups.set(parent, [block]);
    else group.push(block);
  }

  let changed = false;
  for (const [parent, group] of groups) {
    const runs: HTMLElement[][] = [];
    let run: HTMLElement[] = [];
    for (const block of group) {
      const previous = run.at(-1);
      if (previous !== undefined && previous.nextElementSibling !== block) {
        runs.push(run);
        run = [];
      }
      run.push(block);
    }
    if (run.length > 0) runs.push(run);

    for (const current of runs) {
      const first = current[0];
      if (first === undefined) continue;
      let list: Element;
      const previousList = first.previousElementSibling;
      if (previousList !== null && previousList.localName === type) {
        list = previousList;
      } else {
        list = documentRef.createElement(type);
        parent.insertBefore(list, first);
      }
      for (const block of current) {
        const li = documentRef.createElement("li");
        copyAlign(block, li);
        moveChildren(block, li);
        ensureNonEmptyBlock(root, li as HTMLElement);
        list.appendChild(li);
        block.remove();
      }
      changed = true;
    }
  }
  return changed;
}

function replaceListType(list: Element, type: ListFormat): boolean {
  if (list.localName === type) return false;
  const replacement = list.ownerDocument.createElement(type);
  moveChildren(list, replacement);
  list.replaceWith(replacement);
  return true;
}

/** Склеивает соседние списки одного типа, чтобы не оставлять искусственные разрывы. */
function mergeAdjacentLists(parent: Element, type: ListFormat): void {
  let child = parent.firstElementChild;
  while (child !== null) {
    const next = child.nextElementSibling;
    if (child.localName === type && next !== null && next.localName === type) {
      while (next.firstChild !== null) child.appendChild(next.firstChild);
      next.remove();
      continue;
    }
    child = next;
  }
}

function wrapRootIntoList(root: HTMLElement, type: ListFormat): void {
  const documentRef = root.ownerDocument;
  const list = documentRef.createElement(type);
  const li = documentRef.createElement("li");
  while (root.firstChild !== null) li.appendChild(root.firstChild);
  ensureNonEmptyBlock(root, li as HTMLElement);
  list.appendChild(li);
  root.appendChild(list);
}

function toggleList(root: HTMLElement, type: ListFormat): boolean {
  const range = getEditorRange(root);
  if (range === null) return false;
  const offsets = captureOffsets(root);
  const items = collectListItems(root, range);
  const content = contentBlocks(root, range);
  const nonListBlocks = content.filter(
    (block) =>
      block.localName !== "li" && closestWithin(root, block, ["li"]) === null,
  );

  const lists = new Set<Element>();
  for (const item of items) {
    const list = item.parentElement;
    if (list !== null && LIST_TAGS.has(list.localName)) lists.add(list);
  }
  const affectedParents = new Set<Element>();
  for (const list of lists) {
    if (list.parentElement !== null) affectedParents.add(list.parentElement);
  }
  for (const block of nonListBlocks) {
    if (block.parentElement !== null) affectedParents.add(block.parentElement);
  }

  let changed = false;

  if (items.length > 0) {
    if (nonListBlocks.length === 0) {
      const allSameType = [...lists].every((list) => list.localName === type);
      if (allSameType) {
        for (const item of items) {
          if (!item.isConnected) continue;
          liftListItem(root, item, "p", true);
          changed = true;
        }
      } else {
        for (const list of lists) {
          if (list.isConnected && replaceListType(list, type)) changed = true;
        }
      }
    } else {
      for (const list of lists) {
        if (list.isConnected && replaceListType(list, type)) changed = true;
      }
      if (convertBlocksToList(root, nonListBlocks, type)) changed = true;
    }
  } else if (nonListBlocks.length > 0) {
    changed = convertBlocksToList(root, nonListBlocks, type);
  } else {
    wrapRootIntoList(root, type);
    affectedParents.add(root);
    changed = true;
  }

  for (const parent of affectedParents) {
    if (parent.isConnected) mergeAdjacentLists(parent, type);
  }

  if (offsets !== null) setOffsets(root, offsets.start, offsets.end);
  return changed;
}

function setAlign(root: HTMLElement, align: AlignFormat): boolean {
  const range = getEditorRange(root);
  if (range === null) return false;
  const offsets = captureOffsets(root);
  let blocks = range.collapsed ? contentBlocks(root, range) : blocksInRange(root, range);
  if (blocks.length === 0) {
    blocks = [materializeRootBlock(root, "p")];
  }

  let changed = false;
  for (const block of blocks) {
    if (!block.isConnected) continue;
    if (block.getAttribute("data-align") === align) continue;
    block.setAttribute("data-align", align);
    changed = true;
  }
  if (offsets !== null) setOffsets(root, offsets.start, offsets.end);
  return changed;
}

/** `indent`: вложить li в предыдущий sibling; первый li остаётся на месте. */
function indentListItem(root: HTMLElement, li: HTMLElement): boolean {
  const list = li.parentElement;
  if (list === null || !LIST_TAGS.has(list.localName)) return false;
  const previous = li.previousElementSibling;
  if (previous === null || previous.localName !== "li") return false;

  let nested: Element | null = null;
  for (const child of previous.children) {
    if (child.localName === list.localName) nested = child;
  }
  if (nested === null) {
    nested = root.ownerDocument.createElement(list.localName);
    previous.appendChild(nested);
  }
  nested.appendChild(li);
  return true;
}

/**
 * `outdent`: поднять li на уровень выше. Следующие sibling переносятся
 * во вложенный список поднимаемого li, чтобы сохранить порядок текста.
 */
function outdentListItem(root: HTMLElement, li: HTMLElement): boolean {
  const list = li.parentElement;
  if (list === null || !LIST_TAGS.has(list.localName)) return false;
  const parentLi = list.parentElement;
  if (parentLi === null || parentLi.localName !== "li") return false;
  const outerList = parentLi.parentElement;
  if (outerList === null || !LIST_TAGS.has(outerList.localName)) return false;

  const following: Element[] = [];
  let cursor = li.nextElementSibling;
  while (cursor !== null) {
    const next = cursor.nextElementSibling;
    following.push(cursor);
    cursor = next;
  }

  if (following.length > 0) {
    let nested: Element | null = null;
    for (const child of li.children) {
      if (child.localName === list.localName) nested = child;
    }
    if (nested === null) {
      nested = root.ownerDocument.createElement(list.localName);
      li.appendChild(nested);
    }
    for (const sibling of following) nested.appendChild(sibling);
  }

  li.remove();
  if (list.querySelector("li") === null) list.remove();
  outerList.insertBefore(li, parentLi.nextSibling);
  return true;
}

export function applyIndentFormat(
  root: HTMLElement,
  direction: "indent" | "outdent",
): boolean {
  const range = getEditorRange(root);
  if (range === null) return false;
  const offsets = captureOffsets(root);
  const items = collectListItems(root, range);
  if (items.length === 0) return false;

  const ordered = direction === "indent" ? [...items].reverse() : items;
  let changed = false;
  for (const item of ordered) {
    if (!item.isConnected) continue;
    const result =
      direction === "indent"
        ? indentListItem(root, item)
        : outdentListItem(root, item);
    if (result) changed = true;
  }
  if (changed && offsets !== null) {
    // Смещения остаются валидными, но на стыке узлов каретка должна попасть
    // в перемещённый li, а не в конец предыдущего.
    setOffsets(root, offsets.start, offsets.end, true);
  }
  return changed;
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

  // Снимаем список: выбранные пункты становятся обычными абзацами.
  for (const item of collectListItems(root, range)) {
    if (item.isConnected) liftListItem(root, item, "p", true);
  }

  // Остальные блочные обёртки (h1–h3, blockquote, pre, div) — в `<p>`.
  // Снаружи внутрь: вложенный p разворачивается вместе с родителем.
  const blocks = blocksInRange(root, range).sort(
    (left, right) => depthOfBlock(left) - depthOfBlock(right),
  );
  for (const block of blocks) {
    if (!block.isConnected || block.localName === "p") continue;
    const paragraph = root.ownerDocument.createElement("p");
    moveChildrenFlatteningParagraphs(block, paragraph);
    ensureNonEmptyBlock(root, paragraph);
    block.replaceWith(paragraph);
  }

  for (const block of blocksInRange(root, range)) {
    block.removeAttribute("data-align");
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
