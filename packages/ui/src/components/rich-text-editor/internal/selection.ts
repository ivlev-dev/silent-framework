/**
 * Низкоуровневые операции с `Selection`/`Range` без `document.execCommand`.
 * Все функции работают только с DOM внутри контентной области редактора.
 */

export const ZERO_WIDTH_SPACE = "\u200B";

const TEXT_BLOCK_TAGS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "blockquote",
  "pre",
  "div",
  "li",
]);

const INLINE_TAGS = ["strong", "b", "em", "i", "u", "s", "del", "code", "a"] as const;
const INLINE_SELECTOR = INLINE_TAGS.join(",");

export interface SelectionOffsets {
  readonly start: number;
  readonly end: number;
  readonly collapsed: boolean;
}

export function isElementNode(node: Node | null | undefined): node is Element {
  return node !== null && node !== undefined && node.nodeType === 1;
}

export function isTextNode(node: Node | null | undefined): node is Text {
  return node !== null && node !== undefined && node.nodeType === 3;
}

export function isNodeWithin(root: Node, node: Node): boolean {
  return root === node || root.contains(node);
}

/** Текущий range, если он целиком находится внутри редактора. */
export function getEditorRange(root: HTMLElement): Range | null {
  const selection = root.ownerDocument.getSelection();
  if (selection === null || selection.rangeCount === 0) return null;
  for (let index = 0; index < selection.rangeCount; index += 1) {
    const range = selection.getRangeAt(index);
    if (
      isNodeWithin(root, range.startContainer) &&
      isNodeWithin(root, range.endContainer)
    ) {
      return range;
    }
  }
  return null;
}

export function getWindowSelection(root: HTMLElement): Selection | null {
  return root.ownerDocument.getSelection();
}

/** Копия range: сохранённое выделение должно переживать перерисовку. */
export function cloneEditorRange(range: Range | null): Range | null {
  if (range === null) return null;
  try {
    return range.cloneRange();
  } catch {
    return null;
  }
}

/** Восстанавливает сохранённый range, если его узлы ещё в документе. */
export function restoreRange(root: HTMLElement, range: Range | null): boolean {
  if (range === null) return false;
  if (!range.startContainer.isConnected || !range.endContainer.isConnected) {
    return false;
  }
  if (
    !isNodeWithin(root, range.startContainer) ||
    !isNodeWithin(root, range.endContainer)
  ) {
    return false;
  }
  const selection = root.ownerDocument.getSelection();
  if (selection === null) return false;
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

function pointOffset(root: HTMLElement, node: Node, offset: number): number {
  const range = root.ownerDocument.createRange();
  range.selectNodeContents(root);
  try {
    range.setEnd(node, offset);
  } catch {
    return 0;
  }
  return range.toString().length;
}

/** Текстовые смещения выделения: устойчивы к обёрткам/разворачиванию. */
export function captureOffsets(root: HTMLElement): SelectionOffsets | null {
  const range = getEditorRange(root);
  if (range === null) return null;
  const start = pointOffset(root, range.startContainer, range.startOffset);
  const end = pointOffset(root, range.endContainer, range.endOffset);
  return {
    start: Math.min(start, end),
    end: Math.max(start, end),
    collapsed: range.collapsed,
  };
}

export function textLength(root: HTMLElement): number {
  let total = 0;
  const walker = root.ownerDocument.createTreeWalker(root, 4);
  let node = walker.nextNode();
  while (node !== null) {
    total += (node as Text).data.length;
    node = walker.nextNode();
  }
  return total;
}

function clamp(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > max) return max;
  return value;
}

/** Ставит выделение по текстовым смещениям (0..длина текста). */
export function setOffsets(root: HTMLElement, start: number, end: number): void {
  const total = textLength(root);
  let from = clamp(Math.min(start, end), total);
  let to = clamp(Math.max(start, end), total);
  const documentRef = root.ownerDocument;
  const selection = documentRef.getSelection();
  if (selection === null) return;

  if (total === 0) {
    const range = documentRef.createRange();
    range.selectNodeContents(root);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    return;
  }

  const walker = documentRef.createTreeWalker(root, 4);
  let consumed = 0;
  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;
  let lastNode: Text | null = null;

  let node = walker.nextNode();
  while (node !== null) {
    const text = node as Text;
    const length = text.data.length;
    lastNode = text;
    const next = consumed + length;
    if (startNode === null && from <= next) {
      startNode = text;
      startOffset = Math.max(0, Math.min(length, from - consumed));
    }
    if (endNode === null && to <= next) {
      endNode = text;
      endOffset = Math.max(0, Math.min(length, to - consumed));
    }
    consumed = next;
    if (startNode !== null && endNode !== null) break;
    node = walker.nextNode();
  }

  if (startNode === null) {
    startNode = lastNode;
    startOffset = lastNode === null ? 0 : lastNode.data.length;
  }
  if (endNode === null) {
    endNode = lastNode;
    endOffset = lastNode === null ? 0 : lastNode.data.length;
  }
  if (startNode === null || endNode === null) return;

  // Пустой текстовый узел не может быть границей диапазона.
  if (startNode.data.length === 0) {
    startOffset = 0;
  }
  if (endNode.data.length === 0) {
    endOffset = 0;
  }

  const range = documentRef.createRange();
  try {
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
  } catch {
    range.selectNodeContents(root);
    range.collapse(false);
    from = total;
    to = total;
  }
  selection.removeAllRanges();
  selection.addRange(range);
}

export function placeCaret(root: HTMLElement, node: Node, offset: number): void {
  const selection = root.ownerDocument.getSelection();
  if (selection === null) return;
  const range = root.ownerDocument.createRange();
  try {
    range.setStart(node, offset);
    range.collapse(true);
  } catch {
    range.selectNodeContents(root);
    range.collapse(true);
  }
  selection.removeAllRanges();
  selection.addRange(range);
}

export function selectNodeContents(
  root: HTMLElement,
  node: Node,
  collapseToEnd = false,
): void {
  const range = root.ownerDocument.createRange();
  range.selectNodeContents(node);
  range.collapse(collapseToEnd);
  const selection = root.ownerDocument.getSelection();
  if (selection === null) return;
  selection.removeAllRanges();
  selection.addRange(range);
}

export function focusEditor(root: HTMLElement): void {
  if (typeof root.focus !== "function") return;
  root.focus({ preventScroll: true });
}

/** Ближайший текстовый блок (p/h1–h3/blockquote/pre/li/div) или сам корень. */
export function findBlock(root: HTMLElement, node: Node): HTMLElement {
  let element: Element | null = isElementNode(node) ? node : node.parentElement;
  while (element !== null && element !== root) {
    if (TEXT_BLOCK_TAGS.has(element.localName)) {
      return element as HTMLElement;
    }
    element = element.parentElement;
  }
  return root;
}

/** Ближайший предок из списка тегов в пределах корня. */
export function closestWithin(
  root: HTMLElement,
  node: Node,
  tags: readonly string[],
): Element | null {
  const allowed = new Set(tags);
  let element: Element | null = isElementNode(node) ? node : node.parentElement;
  while (element !== null) {
    if (allowed.has(element.localName)) return element;
    if (element === root) return null;
    element = element.parentElement;
  }
  return null;
}

/** Все текстовые узлы, пересекающиеся с диапазоном. */
export function textNodesInRange(root: HTMLElement, range: Range): Text[] {
  const documentRef = root.ownerDocument;
  const walker = documentRef.createTreeWalker(root, 4);
  const nodes: Text[] = [];
  let node = walker.nextNode();
  while (node !== null) {
    const text = node as Text;
    if (text.data.length > 0 && range.intersectsNode(text)) {
      nodes.push(text);
    }
    node = walker.nextNode();
  }
  return nodes;
}

export function hasAncestorTag(
  root: HTMLElement,
  node: Node,
  tags: readonly string[],
): boolean {
  return closestWithin(root, node, tags) !== null;
}

/** Обёртка выделенных текстовых узлов в новый inline-элемент. */
export function wrapTextNodes(
  root: HTMLElement,
  range: Range,
  tag: string,
  skipTags: readonly string[],
  configure?: (element: Element) => void,
): Element[] {
  const documentRef = root.ownerDocument;
  const nodes = textNodesInRange(root, range);
  const wrappers: Element[] = [];
  for (const node of nodes) {
    if (hasAncestorTag(root, node, skipTags)) continue;
    const start = node === range.startContainer ? range.startOffset : 0;
    const end = node === range.endContainer ? range.endOffset : node.data.length;
    if (start >= end) continue;

    let target = node;
    if (end < target.data.length) target.splitText(end);
    if (start > 0) {
      const tail = target.splitText(start);
      target = tail;
    }
    if (target.data.length === 0) continue;

    const wrapper = documentRef.createElement(tag);
    configure?.(wrapper);
    const parent = target.parentNode;
    if (parent === null) continue;
    parent.insertBefore(wrapper, target);
    wrapper.appendChild(target);
    wrappers.push(wrapper);
  }
  return wrappers;
}

export function depthOf(element: Element): number {
  let depth = 0;
  let current: Element | null = element;
  while (current !== null) {
    depth += 1;
    current = current.parentElement;
  }
  return depth;
}

/** Разворачивает элементы, оставляя их содержимое на месте. */
export function unwrapElements(elements: readonly Element[]): void {
  const ordered = [...elements].sort((left, right) => depthOf(right) - depthOf(left));
  for (const element of ordered) {
    const parent = element.parentNode;
    if (parent === null) continue;
    while (element.firstChild !== null) {
      parent.insertBefore(element.firstChild, element);
    }
    parent.removeChild(element);
  }
}

/** Все inline-элементы (из набора тегов), пересекающиеся с диапазоном. */
export function inlineElementsInRange(
  root: HTMLElement,
  range: Range,
  tags: readonly string[] = INLINE_TAGS,
): Element[] {
  const selector = tags.join(",");
  if (selector === "") return [];
  const found = root.querySelectorAll(selector);
  const result: Element[] = [];
  for (const element of found) {
    if (range.intersectsNode(element)) result.push(element);
  }
  return result;
}

function mergeNested(element: Element): boolean {
  let changed = false;
  for (const child of Array.from(element.children)) {
    if (child.localName !== element.localName) continue;
    while (child.firstChild !== null) {
      element.insertBefore(child.firstChild, child);
    }
    child.remove();
    changed = true;
  }
  return changed;
}

function sameAnchor(left: Element, right: Element): boolean {
  if (left.localName !== "a" || right.localName !== "a") return true;
  return (
    left.getAttribute("href") === right.getAttribute("href") &&
    left.getAttribute("target") === right.getAttribute("target") &&
    left.getAttribute("rel") === right.getAttribute("rel")
  );
}

function mergeAdjacent(parent: Node): boolean {
  let changed = false;
  let child = parent.firstChild;
  while (child !== null) {
    const next = child.nextSibling;
    if (
      isElementNode(child) &&
      isElementNode(next) &&
      child.localName === next.localName &&
      INLINE_TAGS.includes(child.localName as (typeof INLINE_TAGS)[number]) &&
      sameAnchor(child, next)
    ) {
      while (next.firstChild !== null) {
        child.appendChild(next.firstChild);
      }
      next.remove();
      changed = true;
      continue;
    }
    child = next;
  }
  return changed;
}

/**
 * Нормализует вложенность inline-форматирования: убирает вложенные и
 * соседние однотипные обёртки, пустые элементы.
 */
export function normalizeInline(root: HTMLElement, tags?: readonly string[]): void {
  const selector = (tags ?? INLINE_TAGS).join(",");
  if (selector === "") return;
  let changed = true;
  let guard = 0;
  while (changed && guard < 16) {
    guard += 1;
    changed = false;
    const elements = Array.from(root.querySelectorAll(selector));
    for (const element of elements) {
      if (!root.contains(element)) continue;
      if (mergeNested(element)) changed = true;
      if (element.textContent === "" && element.querySelector("br") === null) {
        element.remove();
        changed = true;
      }
    }
    for (const element of elements) {
      if (element.parentNode !== null && mergeAdjacent(element.parentNode)) {
        changed = true;
      }
    }
  }
}

export function removeEmptyInline(root: HTMLElement): void {
  normalizeInline(root, INLINE_TAGS);
}

/**
 * Удаляет ZWSP после начала ввода и корректирует каретку.
 * Возвращает `true`, если DOM изменился.
 */
export function stripZeroWidthSpaces(root: HTMLElement): boolean {
  const offsets = captureOffsets(root);
  const documentRef = root.ownerDocument;
  const walker = documentRef.createTreeWalker(root, 4);
  const nodes: Text[] = [];
  let node = walker.nextNode();
  while (node !== null) {
    nodes.push(node as Text);
    node = walker.nextNode();
  }

  let removedBeforeStart = 0;
  let removedBeforeEnd = 0;
  let originalCursor = 0;
  let changed = false;
  const start = offsets?.start ?? 0;
  const end = offsets?.end ?? 0;

  for (const text of nodes) {
    const originalLength = text.data.length;
    if (text.data.indexOf(ZERO_WIDTH_SPACE) === -1) {
      originalCursor += originalLength;
      continue;
    }
    let nextData = "";
    for (let index = 0; index < originalLength; index += 1) {
      const char = text.data[index] ?? "";
      if (char === ZERO_WIDTH_SPACE) {
        changed = true;
        if (originalCursor + index < start) removedBeforeStart += 1;
        if (originalCursor + index < end) removedBeforeEnd += 1;
        continue;
      }
      nextData += char;
    }
    text.data = nextData;
    originalCursor += originalLength;
  }

  if (!changed) return false;
  removeEmptyInline(root);
  if (offsets !== null) {
    setOffsets(root, start - removedBeforeStart, end - removedBeforeEnd);
  }
  return true;
}

export function insertText(root: HTMLElement, value: string): boolean {
  const range = getEditorRange(root);
  if (range === null) return false;
  const documentRef = root.ownerDocument;
  range.deleteContents();
  const text = documentRef.createTextNode(value);
  range.insertNode(text);
  placeCaret(root, text, text.data.length);
  return true;
}

export function insertHtml(root: HTMLElement, html: string): boolean {
  const range = getEditorRange(root);
  if (range === null || html === "") return false;
  const documentRef = root.ownerDocument;
  let fragment: DocumentFragment;
  try {
    fragment = range.createContextualFragment(html);
  } catch {
    return false;
  }
  range.deleteContents();
  const last = fragment.lastChild;
  if (last === null) return false;
  range.insertNode(fragment);
  const after = documentRef.createRange();
  if (last.nodeType === 3) {
    after.setStart(last, (last as Text).data.length);
  } else {
    after.setStartAfter(last);
  }
  after.collapse(true);
  const selection = documentRef.getSelection();
  if (selection !== null) {
    selection.removeAllRanges();
    selection.addRange(after);
  }
  return true;
}

/** Вставляет маркер форматирования с ZWSP и ставит каретку внутрь. */
export function insertMarker(
  root: HTMLElement,
  tag: string,
  configure?: (element: Element) => void,
): boolean {
  const range = getEditorRange(root);
  if (range === null) return false;
  const documentRef = root.ownerDocument;
  const marker = documentRef.createElement(tag);
  configure?.(marker);
  const text = documentRef.createTextNode(ZERO_WIDTH_SPACE);
  marker.appendChild(text);
  range.deleteContents();
  range.insertNode(marker);
  placeCaret(root, text, 1);
  return true;
}

export function isEmptyEditor(root: HTMLElement): boolean {
  if (root.textContent !== null && root.textContent !== "") return false;
  if (root.querySelector("br,hr") !== null) return false;
  return true;
}

/** Текст без разметки — для clear/undo-снапшотов и тестов. */
export function editorText(root: HTMLElement): string {
  return root.textContent ?? "";
}

export { INLINE_TAGS, INLINE_SELECTOR };
