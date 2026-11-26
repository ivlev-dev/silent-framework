import type { RichTextCommand, ToolbarItem } from "../rich-text-editor.js";

/**
 * Чистая раскладка тулбара: решает, какие команды помещаются в видимую
 * часть, а какие уходят в overflow-меню. Без DOM и измерений — это позволяет
 * тестировать узкие/широкие ширины и приоритеты отдельно от компонента.
 */

export interface ToolbarLayoutOptions {
  readonly items: readonly ToolbarItem[];
  readonly availableWidth: number;
  readonly widths: Readonly<Partial<Record<RichTextCommand, number>>>;
  /** Чем раньше команда, тем выше её шанс остаться видимой. */
  readonly priority?: readonly RichTextCommand[] | undefined;
  readonly gap?: number | undefined;
  readonly buttonWidth?: number | undefined;
  readonly separatorWidth?: number | undefined;
  readonly moreWidth?: number | undefined;
}

export interface ToolbarLayout {
  readonly visible: readonly ToolbarItem[];
  /** Команды в исходном порядке. */
  readonly overflow: readonly RichTextCommand[];
}

interface Entry {
  readonly command: RichTextCommand;
  readonly group: number;
}

const DEFAULT_BUTTON_WIDTH = 32;
const DEFAULT_SEPARATOR_WIDTH = 1;
const DEFAULT_MORE_WIDTH = 32;
const DEFAULT_GAP = 2;

function entriesOf(items: readonly ToolbarItem[]): Entry[] {
  const entries: Entry[] = [];
  let group = 0;
  for (const item of items) {
    if (item === "|") {
      group += 1;
      continue;
    }
    entries.push({ command: item, group });
  }
  return entries;
}

function buildVisible(
  entries: readonly Entry[],
  selected: ReadonlySet<RichTextCommand>,
): ToolbarItem[] {
  const visible: ToolbarItem[] = [];
  let previousGroup: number | null = null;
  for (const entry of entries) {
    if (!selected.has(entry.command)) continue;
    if (previousGroup !== null && entry.group !== previousGroup) {
      visible.push("|");
    }
    visible.push(entry.command);
    previousGroup = entry.group;
  }
  return visible;
}

function widthOf(
  visible: readonly ToolbarItem[],
  overflowCount: number,
  options: ToolbarLayoutOptions,
): number {
  const buttonWidth = options.buttonWidth ?? DEFAULT_BUTTON_WIDTH;
  const separatorWidth =
    options.separatorWidth ?? DEFAULT_SEPARATOR_WIDTH;
  const moreWidth = options.moreWidth ?? DEFAULT_MORE_WIDTH;
  const gap = options.gap ?? DEFAULT_GAP;

  let total = 0;
  for (const item of visible) {
    total += item === "|" ? separatorWidth : (options.widths[item] ?? buttonWidth);
  }
  if (visible.length > 0) total += gap * (visible.length - 1);
  if (overflowCount > 0) {
    if (visible.length > 0) total += gap;
    total += moreWidth;
  }
  return total;
}

function orderedPriority(
  entries: readonly Entry[],
  priority: readonly RichTextCommand[] | undefined,
): RichTextCommand[] {
  const result: RichTextCommand[] = [];
  const seen = new Set<RichTextCommand>();
  if (priority !== undefined) {
    for (const command of priority) {
      if (!seen.has(command)) {
        seen.add(command);
        result.push(command);
      }
    }
  }
  for (const entry of entries) {
    if (!seen.has(entry.command)) {
      seen.add(entry.command);
      result.push(entry.command);
    }
  }
  return result;
}

export function computeToolbarLayout(
  options: ToolbarLayoutOptions,
): ToolbarLayout;
export function computeToolbarLayout(
  items: readonly ToolbarItem[],
  availableWidth: number,
  widths?: Readonly<Partial<Record<RichTextCommand, number>>>,
  extras?: ToolbarLayoutExtras,
): ToolbarLayout;
export function computeToolbarLayout(
  optionsOrItems: ToolbarLayoutOptions | readonly ToolbarItem[],
  availableWidth?: number,
  widths?: Readonly<Partial<Record<RichTextCommand, number>>>,
  extras?: ToolbarLayoutExtras,
): ToolbarLayout {
  const options = normalizeOptions(
    optionsOrItems,
    availableWidth,
    widths,
    extras,
  );
  const entries = entriesOf(options.items);
  const commands = entries.map((entry) => entry.command);
  const all = new Set(commands);
  const allVisible = buildVisible(entries, all);

  if (widthOf(allVisible, 0, options) <= options.availableWidth) {
    return { visible: allVisible, overflow: [] };
  }

  const selected = new Set<RichTextCommand>();
  for (const command of orderedPriority(entries, options.priority)) {
    const candidate = new Set(selected);
    candidate.add(command);
    const visible = buildVisible(entries, candidate);
    const overflowCount = commands.filter((item) => !candidate.has(item)).length;
    if (widthOf(visible, overflowCount, options) <= options.availableWidth) {
      selected.add(command);
    }
  }

  const visible = buildVisible(entries, selected);
  return {
    visible,
    overflow: commands.filter((command) => !selected.has(command)),
  };
}

type ToolbarLayoutExtras = Omit<
  ToolbarLayoutOptions,
  "items" | "availableWidth" | "widths"
>;

function normalizeOptions(
  optionsOrItems: ToolbarLayoutOptions | readonly ToolbarItem[],
  availableWidth?: number,
  widths?: Readonly<Partial<Record<RichTextCommand, number>>>,
  extras?: ToolbarLayoutExtras,
): ToolbarLayoutOptions {
  if (!Array.isArray(optionsOrItems)) {
    return optionsOrItems as ToolbarLayoutOptions;
  }
  return {
    items: optionsOrItems,
    availableWidth: availableWidth ?? 0,
    widths: widths ?? {},
    ...(extras ?? {}),
  };
}

/** Позиционная форма для удобства тестов/интеграции. */
export function splitToolbarItems(
  options: ToolbarLayoutOptions,
): ToolbarLayout;
export function splitToolbarItems(
  items: readonly ToolbarItem[],
  availableWidth: number,
  widths?: Readonly<Partial<Record<RichTextCommand, number>>>,
  extras?: ToolbarLayoutExtras,
): ToolbarLayout;
export function splitToolbarItems(
  optionsOrItems: ToolbarLayoutOptions | readonly ToolbarItem[],
  availableWidth?: number,
  widths?: Readonly<Partial<Record<RichTextCommand, number>>>,
  extras?: ToolbarLayoutExtras,
): ToolbarLayout {
  return computeToolbarLayout(
    normalizeOptions(optionsOrItems, availableWidth, widths, extras),
  );
}
