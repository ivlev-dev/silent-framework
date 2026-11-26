import type { Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import {
  For,
  Show,
  createSignal,
  onCleanup,
  untrack,
  useId,
} from "@ivlev-dev/silent-core";
import type { Attrs } from "../../internal/props.js";
import { clientEffect } from "../../internal/overlay.js";
import { Label } from "../../components/label/label.js";
import { useUiConfig } from "../../theme/config.js";
import {
  NO_WRITE,
  type BoundField,
  describedBy,
  errorIdFor,
  hasContent,
  hintIdFor,
} from "../../form/internal/control.js";
import { RichTextHistory, type HistorySnapshot } from "./internal/history.js";
import {
  plainTextToHtml,
  sanitizeHref,
  sanitizeHtml,
  sanitizeHtmlStructure,
} from "./internal/sanitize.js";
import {
  applyAlignFormat,
  applyBlockFormat,
  applyClearFormatting,
  applyIndentFormat,
  applyInlineFormat,
  applyLinkFormat,
  applyListFormat,
  applyUnlink,
  insertParagraphBreak,
  isCommandActive,
  isToggleCommand,
  linkTargetFor,
  type AlignFormat,
  type BlockFormat,
  type InlineFormat,
  type ListFormat,
} from "./internal/format.js";
import {
  captureSelection,
  cloneEditorRange,
  closestWithin,
  findBlock,
  focusEditor,
  getEditorRange,
  insertHtml,
  insertText,
  placeCaret,
  restoreRange,
  restoreSelection,
  selectNodeContents,
  stripZeroWidthSpaces,
} from "./internal/selection.js";

export type RichTextCommand =
  | "bold"
  | "italic"
  | "underline"
  | "strike"
  | "h1"
  | "h2"
  | "h3"
  | "paragraph"
  | "ul"
  | "ol"
  | "indent"
  | "outdent"
  | "blockquote"
  | "code"
  | "link"
  | "unlink"
  | "align-left"
  | "align-center"
  | "align-right"
  | "undo"
  | "redo"
  | "clear";

export type ToolbarItem = RichTextCommand | "|";

export interface RichTextEditorProps {
  /** HTML-значение (controlled). */
  readonly value?: string | undefined;
  /** Начальное HTML-значение (uncontrolled). */
  readonly defaultValue?: string | undefined;
  readonly field?: BoundField<string> | undefined;
  readonly onChange?: ((event: Event) => void) | undefined;
  readonly onValueChange?: ((html: string) => void) | undefined;
  readonly onBlur?: ((event: FocusEvent) => void) | undefined;
  readonly label?: Children;
  readonly hint?: Children;
  readonly error?: Children;
  readonly placeholder?: string | undefined;
  readonly name?: string | undefined;
  readonly id?: string | undefined;
  readonly required?: boolean | undefined;
  readonly readOnly?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly invalid?: boolean | undefined;
  readonly toolbar?: boolean | readonly ToolbarItem[] | undefined;
  readonly minHeight?: number | undefined;
  readonly maxHeight?: number | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
}

const DEFAULT_TOOLBAR: readonly ToolbarItem[] = [
  "bold",
  "italic",
  "underline",
  "strike",
  "|",
  "h1",
  "h2",
  "h3",
  "paragraph",
  "|",
  "ul",
  "ol",
  "indent",
  "outdent",
  "blockquote",
  "code",
  "|",
  "align-left",
  "align-center",
  "align-right",
  "|",
  "link",
  "unlink",
  "|",
  "undo",
  "redo",
  "|",
  "clear",
];

const COMMAND_LABELS: Readonly<Record<RichTextCommand, string>> = {
  bold: "Полужирный",
  italic: "Курсив",
  underline: "Подчёркнутый",
  strike: "Зачёркнутый",
  h1: "Заголовок 1",
  h2: "Заголовок 2",
  h3: "Заголовок 3",
  paragraph: "Обычный текст",
  ul: "Маркированный список",
  ol: "Нумерованный список",
  indent: "Увеличить отступ",
  outdent: "Уменьшить отступ",
  blockquote: "Цитата",
  code: "Блок кода",
  link: "Добавить ссылку",
  unlink: "Убрать ссылку",
  "align-left": "По левому краю",
  "align-center": "По центру",
  "align-right": "По правому краю",
  undo: "Отменить",
  redo: "Повторить",
  clear: "Очистить форматирование",
};

const COMMAND_GLYPHS: Readonly<Record<RichTextCommand, string>> = {
  bold: "B",
  italic: "I",
  underline: "U",
  strike: "S",
  h1: "H1",
  h2: "H2",
  h3: "H3",
  paragraph: "¶",
  ul: "•",
  ol: "1.",
  indent: "⇥",
  outdent: "⇤",
  blockquote: "❝",
  code: "</>",
  link: "↗",
  unlink: "⛔",
  "align-left": "L",
  "align-center": "C",
  "align-right": "R",
  undo: "↶",
  redo: "↷",
  clear: "⌫",
};

const LINK_ERROR_TEXT =
  "Укажите безопасную ссылку: http(s), mailto, tel или относительный адрес";

const BLOCK_HTML_PATTERN =
  /<\/?(?:p|div|section|article|header|footer|h[1-6]|ul|ol|li|blockquote|pre|hr|table)\b/iu;

const INLINE_COMMANDS = new Set<RichTextCommand>([
  "bold",
  "italic",
  "underline",
  "strike",
]);

const BLOCK_COMMANDS: Readonly<Partial<Record<RichTextCommand, BlockFormat>>> = {
  h1: "h1",
  h2: "h2",
  h3: "h3",
  paragraph: "paragraph",
  blockquote: "blockquote",
  code: "code",
};

const LIST_COMMANDS: Readonly<Partial<Record<RichTextCommand, ListFormat>>> = {
  ul: "ul",
  ol: "ol",
};

const ALIGN_COMMANDS: Readonly<Partial<Record<RichTextCommand, AlignFormat>>> = {
  "align-left": "left",
  "align-center": "center",
  "align-right": "right",
};

function isToolbarItemList(value: RichTextEditorProps["toolbar"]): value is readonly ToolbarItem[] {
  return Array.isArray(value);
}

function createSyntheticChange(value: string, name: string): Event {
  const target = { value, type: "text", name };
  const event = {
    type: "change",
    target,
    currentTarget: target,
    bubbles: true,
    cancelable: false,
    defaultPrevented: false,
  };
  return event as unknown as Event;
}

interface ToolbarListProps {
  readonly items: readonly ToolbarItem[];
  readonly isActive: (command: RichTextCommand) => boolean;
  readonly isDisabled: (command: RichTextCommand) => boolean;
  readonly isLinkOpen: () => boolean;
  readonly linkPanelId: string;
  readonly onCommand: (command: RichTextCommand) => void;
}

/**
 * Отдельный компонент обязателен: `For` прямо в теле RichTextEditor
 * компилируется в direct-режим и теряет SSR-разметку списка.
 */
function ToolbarList(props: ToolbarListProps): Node {
  return (
    <For each={props.items} keyOf={(item, index) => `${index}-${item}`}>
      {(item) =>
        item === "|" ? (
          <span
            class="sui-rte__divider"
            role="separator"
            aria-orientation="vertical"
          />
        ) : (
          <button
            type="button"
            class="sui-rte__button"
            data-command={item}
            title={COMMAND_LABELS[item]}
            aria-label={COMMAND_LABELS[item]}
            aria-pressed={
              isToggleCommand(item) ? (props.isActive(item) ? "true" : "false") : undefined
            }
            aria-expanded={
              item === "link" ? (props.isLinkOpen() ? "true" : "false") : undefined
            }
            aria-controls={
              item === "link" && props.isLinkOpen() ? props.linkPanelId : undefined
            }
            disabled={props.isDisabled(item)}
            onMouseDown={(event: MouseEvent) => {
              event.preventDefault();
            }}
            onClick={() => {
              props.onCommand(item);
            }}
          >
            <span class="sui-rte__glyph" aria-hidden="true">
              {COMMAND_GLYPHS[item]}
            </span>
          </button>
        )
      }
    </For>
  );
}

/**
 * WYSIWYG-редактор без сторонних библиотек и без `document.execCommand`.
 *
 * SSR отдаёт пустую контентную область (гидрация без mismatch), HTML
 * подставляется только после монтирования: санитизация → `innerHTML` →
 * восстановление каретки. Значение для формы живёт в скрытом input.
 */
export function RichTextEditor(props: RichTextEditorProps): Node {
  // useId вызывается всегда и до ветвлений: порядок вызовов не зависит от
  // появления `id`/`name` на лету. Явные id имеют приоритет.
  const autoId = useId("sui-rte");
  const id = props.id ?? props.name ?? autoId;
  const config = useUiConfig();
  const labelId = `${id}-label`;
  const toolbarId = `${id}-toolbar`;
  const linkPanelId = `${id}-link`;
  const linkErrorId = `${id}-link-error`;
  const hintId = hintIdFor(id);
  const errorId = errorIdFor(id);

  const labels = (): Children =>
    props.label !== undefined ? props.label : props.field?.label;
  const hints = (): Children =>
    props.hint !== undefined ? props.hint : props.field?.hint;
  const errors = (): Children =>
    props.error !== undefined ? props.error : props.field?.error;
  const nameOf = (): string => props.name ?? props.field?.name ?? id;
  const requiredOf = (): boolean =>
    props.required !== undefined ? props.required : props.field?.isRequired === true;
  const invalidOf = (): boolean => props.invalid === true || hasContent(errors());
  const disabled = (): boolean => props.disabled === true;
  const readOnly = (): boolean => props.readOnly === true;
  const editable = (): boolean => !disabled() && !readOnly();

  const externalValue = (): string | undefined => {
    if (props.value !== undefined) return props.value;
    const value = props.field?.value;
    return value === undefined ? undefined : String(value);
  };
  const initialValue = (): string => {
    const controlled = externalValue();
    if (controlled !== undefined) return controlled;
    return props.defaultValue ?? "";
  };

  const [html, setHtml] = createSignal(sanitizeHtml(initialValue()));
  const [contentNode, setContentNode] = createSignal<HTMLDivElement | null>(null);
  const [rootNode, setRootNode] = createSignal<HTMLDivElement | null>(null);
  const [selectionTick, setSelectionTick] = createSignal(0);
  const [historyTick, setHistoryTick] = createSignal(0);
  const [mounted, setMounted] = createSignal(false);
  const [linkOpen, setLinkOpen] = createSignal(false);
  const [linkValue, setLinkValue] = createSignal("");
  const [linkError, setLinkError] = createSignal("");
  const [linkInput, setLinkInput] = createSignal<HTMLInputElement | null>(null);

  const history = new RichTextHistory();
  let savedRange: Range | null = null;
  let historyTimer: ReturnType<typeof setTimeout> | null = null;
  let initialized = false;
  let baselineHtml = "";
  /** Внешнее значение, пришедшее во время фокуса: применим после blur. */
  let pendingExternal: string | null = null;
  let composing = false;
  let compositionDirty = false;

  function readSnapshot(): HistorySnapshot {
    const content = contentNode();
    if (content === null) return { html: "", selection: null };
    return {
      html: sanitizeHtmlStructure(content.innerHTML),
      selection: captureSelection(content),
    };
  }

  function resetHistory(): void {
    if (historyTimer !== null) {
      clearTimeout(historyTimer);
      historyTimer = null;
    }
    history.reset(readSnapshot());
    setHistoryTick((value) => value + 1);
  }

  function pushHistoryNow(): void {
    if (historyTimer !== null) {
      clearTimeout(historyTimer);
      historyTimer = null;
    }
    if (history.push(readSnapshot())) {
      setHistoryTick((value) => value + 1);
    }
  }

  function scheduleHistory(): void {
    if (historyTimer !== null) clearTimeout(historyTimer);
    setHistoryTick((value) => value + 1);
    historyTimer = setTimeout(() => {
      historyTimer = null;
      if (history.push(readSnapshot())) {
        setHistoryTick((value) => value + 1);
      }
    }, 300);
  }

  function flushHistory(): void {
    if (historyTimer !== null) pushHistoryNow();
  }

  function emitValue(): void {
    const content = contentNode();
    if (content === null) return;
    const output = sanitizeHtml(content.innerHTML);
    setHtml(output);
    props.onValueChange?.(output);
    const event = createSyntheticChange(output, nameOf());
    props.onChange?.(event);
    props.field?.onChange(event);
  }

  function setEditorHtml(value: string): boolean {
    const content = contentNode();
    if (content === null) return false;
    const safe = sanitizeHtml(value);
    if (content.innerHTML === safe) {
      setHtml(safe);
      return false;
    }
    content.innerHTML = safe;
    setHtml(safe);
    return true;
  }

  function syncSelection(): void {
    const content = contentNode();
    if (content === null) return;
    const range = getEditorRange(content);
    if (range !== null) {
      savedRange = cloneEditorRange(range);
    }
    setSelectionTick((value) => value + 1);
  }

  function ensureSelection(content: HTMLDivElement): void {
    if (getEditorRange(content) !== null) return;
    if (restoreRange(content, savedRange)) return;
    selectNodeContents(content, content, true);
  }

  function focusAndRestore(content: HTMLDivElement): void {
    focusEditor(content);
    if (savedRange !== null) restoreRange(content, savedRange);
    else if (getEditorRange(content) === null) {
      selectNodeContents(content, content, true);
    }
  }

  function finishCommand(changed: boolean): void {
    const content = contentNode();
    if (content === null) return;
    if (changed) {
      emitValue();
      pushHistoryNow();
    }
    syncSelection();
  }

  function applyExternal(value: string): boolean {
    const root = rootNode();
    const content = contentNode();
    if (root === null || content === null) return false;
    const active = root.ownerDocument.activeElement;
    if (active !== null && root.contains(active)) return false;
    const safe = sanitizeHtml(value);
    if (content.innerHTML === safe) return false;
    content.innerHTML = safe;
    setHtml(safe);
    savedRange = null;
    resetHistory();
    setSelectionTick((valueTick) => valueTick + 1);
    return true;
  }

  const canUndo = (): boolean => {
    historyTick();
    return history.canUndo() || historyTimer !== null;
  };
  const canRedo = (): boolean => {
    historyTick();
    return history.canRedo() && historyTimer === null;
  };

  function applySnapshot(snapshot: HistorySnapshot): void {
    const content = contentNode();
    if (content === null) return;
    content.innerHTML = snapshot.html;
    setHtml(snapshot.html);
    focusEditor(content);
    restoreSelection(content, snapshot.selection);
    emitValue();
    setSelectionTick((value) => value + 1);
    setHistoryTick((value) => value + 1);
    savedRange = cloneEditorRange(getEditorRange(content));
  }

  function undo(): void {
    const content = contentNode();
    if (content === null || !editable() || composing) return;
    flushHistory();
    const snapshot = history.undo();
    if (snapshot !== null) applySnapshot(snapshot);
  }

  function redo(): void {
    const content = contentNode();
    if (content === null || !editable() || composing) return;
    flushHistory();
    const snapshot = history.redo();
    if (snapshot !== null) applySnapshot(snapshot);
  }

  function openLinkPanel(): void {
    const content = contentNode();
    if (content === null || !editable()) return;
    ensureSelection(content);
    savedRange = cloneEditorRange(getEditorRange(content)) ?? savedRange;
    let currentHref = "";
    if (savedRange !== null) {
      let element: Element | null =
        savedRange.startContainer.nodeType === 1
          ? (savedRange.startContainer as Element)
          : savedRange.startContainer.parentElement;
      while (element !== null && element !== content) {
        if (element.localName === "a") {
          currentHref = element.getAttribute("href") ?? "";
          break;
        }
        element = element.parentElement;
      }
    }
    setLinkValue(currentHref);
    setLinkError("");
    setLinkOpen(true);
  }

  function closeLinkPanel(restoreSelection: boolean): void {
    if (restoreSelection) {
      const content = contentNode();
      // Сначала возвращаем фокус внутрь рамки, затем убираем панель:
      // иначе удаление сфокусированного input выглядит как выход из редактора.
      if (content !== null) focusAndRestore(content);
    }
    setLinkOpen(false);
    setLinkError("");
  }

  function applyLink(): void {
    const content = contentNode();
    if (content === null || !editable()) return;
    const raw = linkValue().trim();
    if (raw === "") {
      removeLink();
      return;
    }
    const href = sanitizeHref(raw);
    if (href === null) {
      setLinkError(LINK_ERROR_TEXT);
      return;
    }
    ensureSelection(content);
    const changed = applyLinkFormat(content, href, linkTargetFor(href));
    focusEditor(content);
    setLinkOpen(false);
    setLinkError("");
    finishCommand(changed);
  }

  function removeLink(): void {
    const content = contentNode();
    if (content === null || !editable()) return;
    ensureSelection(content);
    const changed = applyUnlink(content);
    focusEditor(content);
    setLinkOpen(false);
    setLinkError("");
    finishCommand(changed);
  }

  function runCommand(command: RichTextCommand): void {
    const content = contentNode();
    if (content === null || !editable() || composing) return;
    if (command === "link") {
      openLinkPanel();
      return;
    }
    if (command === "undo") {
      undo();
      return;
    }
    if (command === "redo") {
      redo();
      return;
    }

    ensureSelection(content);
    let changed = false;
    if (INLINE_COMMANDS.has(command)) {
      changed = applyInlineFormat(content, command as InlineFormat);
    } else {
      const block = BLOCK_COMMANDS[command];
      if (block !== undefined) {
        changed = applyBlockFormat(content, block);
      } else {
        const list = LIST_COMMANDS[command];
        if (list !== undefined) {
          changed = applyListFormat(content, list);
        } else {
          const align = ALIGN_COMMANDS[command];
          if (align !== undefined) {
            changed = applyAlignFormat(content, align);
          } else if (command === "indent" || command === "outdent") {
            changed = applyIndentFormat(content, command);
          } else if (command === "unlink") {
            changed = applyUnlink(content);
          } else if (command === "clear") {
            changed = applyClearFormatting(content);
          }
        }
      }
    }
    finishCommand(changed);
  }

  function active(command: RichTextCommand): boolean {
    selectionTick();
    const content = contentNode();
    if (content === null) return false;
    return isCommandActive(content, command);
  }

  function toolbarDisabled(command: RichTextCommand): boolean {
    if (disabled() || readOnly()) return true;
    if (command === "undo") return !canUndo();
    if (command === "redo") return !canRedo();
    return false;
  }

  function clearEmptyEditor(content: HTMLDivElement): boolean {
    if ((content.textContent ?? "") !== "") return false;
    if (content.querySelector("hr") !== null) return false;
    if (content.innerHTML === "") return false;
    content.innerHTML = "";
    const active = content.ownerDocument.activeElement;
    if (active !== null && content.contains(active)) {
      placeCaret(content, content, 0);
    }
    return true;
  }

  function handleBeforeInput(event: InputEvent): void {
    if (composing || event.isComposing) compositionDirty = true;
  }

  function handleCompositionStart(): void {
    composing = true;
    compositionDirty = false;
    // Завершаем предыдущую порцию ввода отдельным шагом истории.
    if (historyTimer !== null) pushHistoryNow();
  }

  function finalizeComposition(content: HTMLDivElement): void {
    const dirty = compositionDirty;
    compositionDirty = false;
    if (!dirty || !editable()) return;
    // Финальная фиксация: DOM не пересобираем, только вычищаем ZWSP и
    // отправляем санитизированное значение в форму/историю.
    stripZeroWidthSpaces(content);
    clearEmptyEditor(content);
    emitValue();
    pushHistoryNow();
    syncSelection();
  }

  function handleCompositionEnd(content: HTMLDivElement): void {
    composing = false;
    finalizeComposition(content);
  }

  function handleInput(content: HTMLDivElement, event?: InputEvent): void {
    if (!editable()) return;
    if (composing || event?.isComposing === true) {
      compositionDirty = true;
      return;
    }
    compositionDirty = false;
    stripZeroWidthSpaces(content);
    clearEmptyEditor(content);
    emitValue();
    scheduleHistory();
    syncSelection();
  }

  function adaptPastedHtml(
    content: HTMLDivElement,
    html: string,
    preferBlocks: boolean,
  ): string {
    if (preferBlocks) return html;
    const range = getEditorRange(content);
    if (range === null) return html;
    const block = findBlock(content, range.startContainer);
    if (
      block === content ||
      !["p", "h1", "h2", "h3", "pre", "li", "blockquote"].includes(
        block.localName,
      )
    ) {
      return html;
    }
    // Один абзац из inline-буфера вставляем inline в текущий текстовый блок,
    // чтобы не создавать вложенный p. Блочный источник не переупаковываем.
    if (!html.startsWith("<p>") || !html.endsWith("</p>")) return html;
    const inner = html.slice(3, -4);
    return inner.includes("</p>") ? html : inner;
  }

  function insertBlockHtml(content: HTMLDivElement, html: string): boolean {
    const range = getEditorRange(content);
    if (range === null) return false;
    const block = findBlock(content, range.startContainer);
    if (
      block === content ||
      !["p", "h1", "h2", "h3", "pre"].includes(block.localName)
    ) {
      return insertHtml(content, html);
    }

    const documentRef = content.ownerDocument;
    const tailRange = documentRef.createRange();
    tailRange.setStart(range.endContainer, range.endOffset);
    tailRange.setEnd(block, block.childNodes.length);
    const tail = tailRange.extractContents();
    const fragment = range.createContextualFragment(html);
    const last = fragment.lastChild;
    block.after(fragment);

    let afterBlock: HTMLElement | null = null;
    if (tail.textContent !== "" || tail.querySelector("br,hr") !== null) {
      afterBlock = block.cloneNode(false) as HTMLElement;
      afterBlock.appendChild(tail);
      if (last !== null) last.after(afterBlock);
      else block.after(afterBlock);
    }
    if ((block.textContent ?? "") === "" && block.querySelector("hr") === null) {
      block.remove();
    }

    if (afterBlock !== null && afterBlock.isConnected) {
      selectNodeContents(content, afterBlock, true);
    } else if (last !== null && last.isConnected) {
      selectNodeContents(content, last, false);
    }
    return true;
  }

  function insertSanitized(
    content: HTMLDivElement,
    html: string,
    preferBlocks: boolean,
  ): boolean {
    const adapted = adaptPastedHtml(content, html, preferBlocks);
    if (adapted === "") return false;
    if (/^<(?:p|h[1-3]|ul|ol|blockquote|pre|hr)(?:\s|>)/iu.test(adapted)) {
      return insertBlockHtml(content, adapted);
    }
    return insertHtml(content, adapted);
  }

  function handlePaste(event: ClipboardEvent): void {
    const content = contentNode();
    if (content === null) return;
    event.preventDefault();
    if (!editable() || composing) return;
    const data = event.clipboardData as DataTransfer | null | undefined;
    if (data === null || data === undefined) return;
    const htmlData = data.getData("text/html");
    let preferBlocks = BLOCK_HTML_PATTERN.test(htmlData);
    let safe = htmlData === "" ? "" : sanitizeHtml(htmlData);
    if (safe === "") {
      safe = sanitizeHtml(plainTextToHtml(data.getData("text/plain")));
      preferBlocks = false;
    }
    if (safe === "") return;
    ensureSelection(content);
    if (insertSanitized(content, safe, preferBlocks)) {
      stripZeroWidthSpaces(content);
      finishCommand(true);
    }
  }

  function handleDrop(event: DragEvent): void {
    const content = contentNode();
    if (content === null) return;
    event.preventDefault();
    if (!editable() || composing) return;
    const data = event.dataTransfer as DataTransfer | null | undefined;
    if (data === null || data === undefined) return;
    const htmlData = data.getData("text/html");
    let preferBlocks = BLOCK_HTML_PATTERN.test(htmlData);
    let safe = htmlData === "" ? "" : sanitizeHtml(htmlData);
    if (safe === "") {
      safe = sanitizeHtml(plainTextToHtml(data.getData("text/plain")));
      preferBlocks = false;
    }
    if (safe === "") return;
    ensureSelection(content);
    if (insertSanitized(content, safe, preferBlocks)) {
      stripZeroWidthSpaces(content);
      finishCommand(true);
    }
  }

  function handleKeyDown(content: HTMLDivElement, event: KeyboardEvent): void {
    if (composing || event.isComposing) return;
    if (!editable()) return;
    const meta = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();

    if (meta && !event.altKey) {
      if (key === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (key === "y") {
        event.preventDefault();
        redo();
        return;
      }
      if (key === "b" || key === "i" || key === "u") {
        event.preventDefault();
        runCommand(key === "b" ? "bold" : key === "i" ? "italic" : "underline");
        return;
      }
    }

    if (event.key === "Enter") {
      event.preventDefault();
      ensureSelection(content);
      if (event.shiftKey) {
        const changed = insertHtml(content, "<br>");
        finishCommand(changed);
      } else {
        const changed = insertParagraphBreak(content);
        finishCommand(changed);
      }
      return;
    }

    if (event.key === "Tab" && !event.altKey && !meta) {
      ensureSelection(content);
      const range = getEditorRange(content);
      const inList =
        range !== null && closestWithin(content, range.startContainer, ["li"]) !== null;
      if (inList) {
        event.preventDefault();
        runCommand(event.shiftKey ? "outdent" : "indent");
        return;
      }
      if (!event.shiftKey) {
        event.preventDefault();
        const changed = insertText(content, "\t");
        finishCommand(changed);
      }
      // Shift+Tab вне списка оставляем браузеру: выход к toolbar/наружу.
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      if (linkOpen()) {
        closeLinkPanel(true);
        return;
      }
      content.blur();
    }
  }

  function handleFocusOut(root: HTMLDivElement, event: FocusEvent): void {
    const next = event.relatedTarget;
    if (next instanceof Node && root.contains(next)) return;
    const content = contentNode();
    if (composing) {
      composing = false;
      if (content !== null) finalizeComposition(content);
    }
    if (linkOpen()) setLinkOpen(false);
    if (content !== null && editable()) {
      const stripped = stripZeroWidthSpaces(content);
      const emptied = clearEmptyEditor(content);
      if (stripped || emptied) {
        emitValue();
        pushHistoryNow();
      }
    }
    props.field?.onBlur(event);
    props.onBlur?.(event);
    queueMicrotask(() => {
      const value = pendingExternal;
      pendingExternal = null;
      if (value !== null && !disabled()) applyExternal(value);
    });
  }

  // SSR: эффект не создаётся. На клиенте — после появления ref'ов:
  // санитайз → innerHTML, затем подписки.
  clientEffect(() => {
    const root = rootNode();
    const content = contentNode();
    if (root === null || content === null) return;
    if (initialized && content.isConnected) {
      // Повторный запуск после гидрации/пересоздания ref'ов не должен
      // затирать пользовательский ввод.
      return;
    }

    const source = untrack(() => initialValue());
    const safe = untrack(() => sanitizeHtml(source));
    content.innerHTML = safe;
    setHtml(safe);
    baselineHtml = safe;
    content.setAttribute("data-ready", "");
    root.setAttribute("data-mounted", "");
    initialized = true;
    setMounted(true);
    untrack(() => resetHistory());

    const onInput = (event: Event): void => handleInput(content, event as InputEvent);
    const onBeforeInput = (event: Event): void => handleBeforeInput(event as InputEvent);
    const onCompositionStart = (): void => handleCompositionStart();
    const onCompositionEnd = (): void => handleCompositionEnd(content);
    const onKeyDown = (event: KeyboardEvent): void => handleKeyDown(content, event);
    const onPaste = (event: Event): void => handlePaste(event as ClipboardEvent);
    const onDrop = (event: Event): void => handleDrop(event as DragEvent);
    const onFocusOut = (event: Event): void => handleFocusOut(root, event as FocusEvent);
    const onSelectionChange = (): void => syncSelection();
    const onDocumentReset = (event: Event): void => {
      const form = root.closest("form");
      if (form === null || event.target !== form) return;
      queueMicrotask(() => {
        const active = root.ownerDocument.activeElement;
        if (active !== null && root.contains(active)) return;
        setEditorHtml(baselineHtml);
        resetHistory();
      });
    };

    content.addEventListener("input", onInput);
    content.addEventListener("beforeinput", onBeforeInput);
    content.addEventListener("compositionstart", onCompositionStart);
    content.addEventListener("compositionend", onCompositionEnd);
    content.addEventListener("keydown", onKeyDown);
    content.addEventListener("paste", onPaste);
    content.addEventListener("drop", onDrop);
    content.addEventListener("focusin", onSelectionChange);
    content.addEventListener("keyup", onSelectionChange);
    content.addEventListener("mouseup", onSelectionChange);
    root.addEventListener("focusout", onFocusOut);
    const documentRef = root.ownerDocument;
    documentRef.addEventListener("selectionchange", onSelectionChange);
    documentRef.addEventListener("reset", onDocumentReset, true);

    onCleanup(() => {
      content.removeEventListener("input", onInput);
      content.removeEventListener("beforeinput", onBeforeInput);
      content.removeEventListener("compositionstart", onCompositionStart);
      content.removeEventListener("compositionend", onCompositionEnd);
      content.removeEventListener("keydown", onKeyDown);
      content.removeEventListener("paste", onPaste);
      content.removeEventListener("drop", onDrop);
      content.removeEventListener("focusin", onSelectionChange);
      content.removeEventListener("keyup", onSelectionChange);
      content.removeEventListener("mouseup", onSelectionChange);
      root.removeEventListener("focusout", onFocusOut);
      documentRef.removeEventListener("selectionchange", onSelectionChange);
      documentRef.removeEventListener("reset", onDocumentReset, true);
      root.removeAttribute("data-mounted");
      content.removeAttribute("data-ready");
      if (historyTimer !== null) {
        clearTimeout(historyTimer);
        historyTimer = null;
      }
      initialized = false;
      composing = false;
      compositionDirty = false;
      setMounted(false);
    });
  });

  // Внешнее значение обновляет DOM только когда редактор не в фокусе.
  clientEffect(() => {
    const content = contentNode();
    const root = rootNode();
    const value = externalValue();
    mounted();
    if (content === null || value === undefined || !mounted()) return;
    const active = root?.ownerDocument.activeElement ?? null;
    if (root !== null && active !== null && root.contains(active)) {
      const safe = sanitizeHtml(value);
      pendingExternal = content.innerHTML === safe ? null : value;
      return;
    }
    pendingExternal = null;
    applyExternal(value);
  });

  // Панель ссылки: фокус в поле ввода после открытия.
  clientEffect(() => {
    if (!linkOpen()) return;
    const input = linkInput();
    if (input === null) return;
    input.focus({ preventScroll: true });
    input.select();
  });

  const toolbarItems = (): readonly ToolbarItem[] => {
    if (props.toolbar === false) return [];
    if (isToolbarItemList(props.toolbar)) return props.toolbar;
    return DEFAULT_TOOLBAR;
  };

  const described = (): string | undefined =>
    describedBy(
      hasContent(hints()) ? hintId : undefined,
      hasContent(errors()) ? errorId : undefined,
    );

  const contentStyle = (): StyleInput => {
    const style: Record<string, string> = {};
    if (props.minHeight !== undefined) {
      style["--sui-rte-min-block-size"] = `${props.minHeight}px`;
      style["minHeight"] = `${props.minHeight}px`;
    }
    if (props.maxHeight !== undefined) {
      style["--sui-rte-max-block-size"] = `${props.maxHeight}px`;
      style["maxHeight"] = `${props.maxHeight}px`;
    }
    return style;
  };

  return (
    <div
      {...props.attrs}
      class={["sui-field", props.class]}
      style={props.style}
      data-invalid={invalidOf() ? "" : undefined}
      data-touched={props.field?.touched === true ? "" : undefined}
      data-disabled={disabled() ? "" : undefined}
      data-validating={props.field?.isValidating === true ? "" : undefined}
      data-has-hint={hasContent(hints()) ? "" : undefined}
      data-has-error={hasContent(errors()) ? "" : undefined}
    >
      <Show when={hasContent(labels())}>
        <Label
          attrs={{ id: labelId }}
          class="sui-field__label"
          for={id}
          required={requiredOf()}
          tone={invalidOf() ? "error" : "default"}
          disabled={disabled()}
        >
          <>{labels()}</>
          <span class="sui-field__required-text">{config.strings.required}</span>
        </Label>
      </Show>
      <div class="sui-field__control">
        <div
          ref={(node: Element | null) => {
            setRootNode(node instanceof HTMLDivElement ? node : null);
          }}
          class="sui-rte"
          data-size="md"
          data-disabled={disabled() ? "" : undefined}
          data-readonly={readOnly() ? "" : undefined}
          data-invalid={invalidOf() ? "" : undefined}
          data-validating={props.field?.isValidating === true ? "" : undefined}
        >
          <Show when={toolbarItems().length > 0}>
            <div
              id={toolbarId}
              class="sui-rte__toolbar"
              role="toolbar"
              aria-label="Форматирование текста"
              aria-controls={id}
            >
              <ToolbarList
                items={toolbarItems()}
                isActive={active}
                isDisabled={toolbarDisabled}
                isLinkOpen={() => linkOpen()}
                linkPanelId={linkPanelId}
                onCommand={runCommand}
              />
            </div>
          </Show>
          <Show when={linkOpen()}>
            <div
              id={linkPanelId}
              class="sui-rte__link-panel"
              role="group"
              aria-label="Ссылка"
            >
              <input
                ref={(node: Element | null) => {
                  setLinkInput(node instanceof HTMLInputElement ? node : null);
                }}
                class="sui-rte__link-input"
                type="text"
                inputMode="url"
                aria-label="Адрес ссылки"
                aria-invalid={linkError() === "" ? undefined : "true"}
                aria-describedby={linkError() === "" ? undefined : linkErrorId}
                placeholder="https://example.com"
                bindValue={[linkValue, setLinkValue]}
                onInput={() => {
                  if (linkError() !== "") setLinkError("");
                }}
                onKeyDown={(event: KeyboardEvent) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    applyLink();
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    closeLinkPanel(true);
                  }
                }}
              />
              <button
                type="button"
                class="sui-rte__link-action"
                onClick={() => applyLink()}
              >
                Применить
              </button>
              <button
                type="button"
                class="sui-rte__link-action"
                data-variant="text"
                onClick={() => removeLink()}
              >
                Удалить
              </button>
              <Show when={linkError() !== ""}>
                <span id={linkErrorId} class="sui-rte__link-error" role="alert">
                  {linkError()}
                </span>
              </Show>
            </div>
          </Show>
          <div
            ref={(node: Element | null) => {
              setContentNode(node instanceof HTMLDivElement ? node : null);
            }}
            id={id}
            class="sui-rte__content"
            contenteditable={editable() ? "true" : "false"}
            role="textbox"
            aria-multiline="true"
            aria-labelledby={hasContent(labels()) ? labelId : undefined}
            aria-label={
              hasContent(labels())
                ? undefined
                : props.placeholder !== undefined && props.placeholder !== ""
                  ? props.placeholder
                  : "Текст"
            }
            aria-describedby={described()}
            aria-invalid={invalidOf() ? "true" : undefined}
            aria-required={requiredOf() ? "true" : undefined}
            aria-readonly={readOnly() ? "true" : undefined}
            aria-disabled={disabled() ? "true" : undefined}
            aria-busy={props.field?.isValidating === true ? "true" : undefined}
            tabindex={disabled() ? -1 : 0}
            spellcheck="true"
            data-placeholder={props.placeholder ?? ""}
            style={contentStyle()}
          />
          <input
            id={`${id}-value`}
            type="hidden"
            name={nameOf()}
            disabled={disabled()}
            bindValue={[html, NO_WRITE]}
          />
        </div>
      </div>
      <div class="sui-field__messages">
        <Show when={hasContent(hints())}>
          <span class="sui-field__hint" id={hintId}>
            {hints()}
          </span>
        </Show>
        <Show when={hasContent(errors())}>
          <span class="sui-field__error" id={errorId}>
            {errors()}
          </span>
        </Show>
      </div>
    </div>
  );
}
