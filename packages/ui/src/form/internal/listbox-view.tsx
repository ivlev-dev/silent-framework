import type { Children, StyleInput } from "@ivlev-dev/silent-core";
import { For, Show, createMemo, createSignal } from "@ivlev-dev/silent-core";
import { createVirtualizer } from "@ivlev-dev/silent-virtual";
import { CheckIcon } from "../../icons/check.js";
import { clientEffect } from "../../internal/overlay.js";
import type {
  FlatListboxOption,
  ListboxOption,
} from "./listbox-engine.js";
import { listboxOptionId } from "./listbox-engine.js";

/** С этого количества строк список переключается на оконный рендер. */
export const LISTBOX_VIRTUAL_THRESHOLD = 30;

/** Сколько строк видно в панели по умолчанию (совпадает с CSS). */
export const LISTBOX_DEFAULT_MAX_VISIBLE = 8;

const DEFAULT_OPTION_BLOCK = 40;
const FALLBACK_ROOT_FONT_SIZE = 16;

/**
 * Статичные строки списка. Компонент не владеет состоянием: активная и
 * выбранная опции приходят аксессорами, а `renderOption` получает обычный
 * объект (никаких сигналов внутри строки).
 *
 * При больших наборах строки рендерятся окном через
 * `@ivlev-dev/silent-virtual`; прокручиваемым элементом остаётся родительский
 * `role="listbox"`, поэтому панель и inline-Listbox работают одинаково.
 */
export interface ListboxRowsProps {
  readonly options: () => readonly FlatListboxOption[];
  readonly baseId: string;
  readonly activeKey: () => string | null;
  readonly selected: (key: string) => boolean;
  readonly renderOption?: ((option: ListboxOption) => Children) | undefined;
  readonly onPick: (option: ListboxOption, event: Event) => void;
  readonly onActivate?: ((option: ListboxOption) => void) | undefined;
  /** Число видимых строк для начального окна; по умолчанию из CSS/8. */
  readonly maxVisible?: number | undefined;
}

function groupStart(
  entries: readonly FlatListboxOption[],
  index: number,
): FlatListboxOption | null {
  const entry = entries[index];
  if (entry === undefined || entry.group === null) return null;
  const previous = entries[index - 1];
  if (previous !== undefined && previous.groupIndex === entry.groupIndex) {
    return null;
  }
  return entry;
}

function groupLabelId(baseId: string, entry: FlatListboxOption): string {
  return `${baseId}-group-${entry.groupIndex}`;
}

function parseCssLength(value: string): number | null {
  const match = /^\s*(-?\d*\.?\d+)\s*(px|rem|em)?\s*$/u.exec(value);
  if (match === null) return null;
  const amount = Number.parseFloat(match[1] ?? "");
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = match[2] ?? "px";
  if (unit === "px") return amount;
  return amount * readRootFontSize();
}

function readRootFontSize(): number {
  if (typeof getComputedStyle !== "function" || typeof document === "undefined") {
    return FALLBACK_ROOT_FONT_SIZE;
  }
  const parsed = Number.parseFloat(
    getComputedStyle(document.documentElement).fontSize,
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : FALLBACK_ROOT_FONT_SIZE;
}

/** Размер строки из CSS-переменной; вне CSS (тесты/SSR) — по `data-size`. */
function readOptionBlock(list: Element | null): number {
  if (list !== null && typeof getComputedStyle === "function") {
    const raw = getComputedStyle(list)
      .getPropertyValue("--sui-popup-option-block")
      .trim();
    const parsed = parseCssLength(raw);
    if (parsed !== null) return parsed;
  }
  if (list !== null && list.classList.contains("sui-listbox__list")) {
    const size = list.closest(".sui-listbox")?.getAttribute("data-size");
    if (size === "sm") return 32;
    if (size === "lg") return 48;
    if (size === "md") return 40;
  }
  return DEFAULT_OPTION_BLOCK;
}

/** Максимум видимых строк из CSS-переменной панели. */
function readMaxVisible(list: Element | null, fallback: number): number {
  if (list !== null && typeof getComputedStyle === "function") {
    const raw = getComputedStyle(list)
      .getPropertyValue("--sui-popup-max-visible")
      .trim();
    const parsed = Number.parseFloat(raw);
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  }
  return fallback;
}

function optionStyle(start: number): StyleInput {
  return {
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    transform: `translateY(${start}px)`,
  };
}

/** Полный список для небольших наборов: прежнее поведение без окна. */
function SmallListboxRows(props: ListboxRowsProps): Node {
  return (
    <For each={props.options} keyOf={(entry) => entry.key}>
      {(entry, index) => {
        const start = (): FlatListboxOption | null =>
          groupStart(props.options(), index());
        return (
          <>
            <Show when={start()}>
              <div
                class="sui-popup__group-label"
                id={groupLabelId(props.baseId, start()!)}
                role="presentation"
              >
                {start()?.group?.label}
              </div>
            </Show>
            <div
              id={listboxOptionId(props.baseId, entry.index)}
              class="sui-popup__option"
              role="option"
              aria-selected={props.selected(entry.key) ? "true" : "false"}
              aria-disabled={entry.option.disabled === true ? "true" : undefined}
              aria-setsize={props.options().length}
              aria-posinset={entry.index + 1}
              data-active={props.activeKey() === entry.key ? "" : undefined}
              data-value={entry.key}
              data-option-index={entry.index}
              onPointerMove={() => {
                props.onActivate?.(entry.option);
              }}
              onClick={(event) => {
                props.onPick(entry.option, event);
              }}
            >
              <span class="sui-popup__option-leading" aria-hidden="true">
                {entry.option.leading}
              </span>
              <span class="sui-popup__option-text">
                <Show
                  when={props.renderOption !== undefined}
                  fallback={
                    <>
                      <span class="sui-popup__option-label">
                        {entry.option.label}
                      </span>
                      <Show when={entry.option.description}>
                        <span class="sui-popup__option-description">
                          {entry.option.description}
                        </span>
                      </Show>
                    </>
                  }
                >
                  <span class="sui-popup__option-label">
                    {props.renderOption?.(entry.option)}
                  </span>
                </Show>
              </span>
              <span class="sui-popup__option-trailing">
                {entry.option.trailing}
              </span>
              <span class="sui-popup__check" aria-hidden="true">
                <Show when={props.selected(entry.key)}>
                  <CheckIcon size="sm" />
                </Show>
              </span>
            </div>
          </>
        );
      }}
    </For>
  );
}

interface VirtualRow {
  readonly entry: FlatListboxOption;
  readonly start: number;
  readonly pinned?: boolean | undefined;
}

/** Оконный рендер больших наборов поверх `createVirtualizer`. */
function VirtualListboxRows(props: ListboxRowsProps): Node {
  const entries = createMemo(() => props.options());
  const optionCount = createMemo(() => entries().length);
  const [spacer, setSpacer] = createSignal<Element | null>(null);
  const [scrollHost, setScrollHost] = createSignal<Element | null>(null);
  const [optionBlock, setOptionBlock] = createSignal(DEFAULT_OPTION_BLOCK);
  const [maxVisible, setMaxVisible] = createSignal(
    props.maxVisible ?? LISTBOX_DEFAULT_MAX_VISIBLE,
  );

  const visibleCount = (): number => props.maxVisible ?? maxVisible();

  const estimateSizeAt = (): number => optionBlock();

  const activeIndex = (): number => {
    const key = props.activeKey();
    if (key === null) return -1;
    const list = entries();
    for (let index = 0; index < list.length; index += 1) {
      if (list[index]?.key === key) return index;
    }
    return -1;
  };

  const virtualizer = createVirtualizer({
    count: optionCount,
    estimateSize: estimateSizeAt,
    getItemKey: (index) => entries()[index]?.key ?? String(index),
    initialViewportSize: optionBlock() * Math.max(1, visibleCount()),
    // Активную строку держим в окне, пока она рядом с видимой областью.
    // Если фокус ушёл далеко (End/typeahead), эффект ниже прокрутит список,
    // и следующий диапазон уже включит её без раздувания окна до всего списка.
    rangeExtractor: (range) => {
      const index = activeIndex();
      return index >= range.startIndex && index <= range.endIndex
        ? [index]
        : [];
    },
  });

  // Прокрутка к активной строке: `auto` — минимальное смещение, то есть
  // поведение `nearest`. Активная строка дополнительно попадает в окно через
  // `rangeExtractor`, поэтому существует в DOM даже до применения прокрутки.
  let lastActiveKey: string | null = null;
  let lastScrollHost: Element | null = null;
  clientEffect(() => {
    const host = scrollHost();
    const key = props.activeKey();
    if (host === null || key === null) return;
    if (key === lastActiveKey && host === lastScrollHost) return;
    lastActiveKey = key;
    lastScrollHost = host;
    const index = activeIndex();
    if (index >= 0) {
      virtualizer.scrollToIndex(index, { align: "auto" });
    }
  });

  // Родительская панель создаётся раньше строк, но ref срабатывает до
  // вставки в документ. Связываем прокрутку эффектом: к этому моменту
  // `role="listbox"` уже доступен в дереве.
  clientEffect(() => {
    const node = spacer();
    if (node === null) {
      setScrollHost(null);
      virtualizer.setScrollElement(null);
      return;
    }
    const list = node.closest('[role="listbox"]');
    setScrollHost(list);
    virtualizer.setScrollElement(list);
    if (list === null) return;
    const nextBlock = readOptionBlock(list);
    const nextVisible = props.maxVisible ?? readMaxVisible(
      list,
      LISTBOX_DEFAULT_MAX_VISIBLE,
    );
    if (nextBlock !== optionBlock()) setOptionBlock(nextBlock);
    if (nextVisible !== maxVisible()) setMaxVisible(nextVisible);
    virtualizer.setOptions({
      estimateSize: estimateSizeAt,
      initialViewportSize: nextBlock * Math.max(1, nextVisible),
    });
  });

  const rows = createMemo<VirtualRow[]>(() => {
    const list = entries();
    const result: VirtualRow[] = [];
    for (const item of virtualizer.virtualItems()) {
      const entry = list[item.index];
      if (entry !== undefined) {
        result.push({ entry, start: item.start });
      }
    }
    return result;
  });

  const spacerStyle = (): StyleInput => ({
    position: "relative",
    top: 0,
    left: 0,
    width: "100%",
    height: virtualizer.totalSize(),
    minHeight: 0,
  });

  const measureRow = (node: Element | null): void => {
    if (node === null) return;
    virtualizer.measureElement(node);
    // Ref выполняется до вставки детей в документ; повторное измерение
    // микрозадачей видит уже собранную и стилизованную строку.
    queueMicrotask(() => {
      virtualizer.measureElement(node);
    });
  };

  // Активная строка вне окна рендерится отдельно в своей абсолютной
  // координате: `aria-activedescendant` всегда указывает на живой узел, а
  // окно не растягивается до всего списка.
  const pinnedRow = createMemo<VirtualRow | null>(() => {
    const index = activeIndex();
    if (index < 0) return null;
    const list = entries();
    const entry = list[index];
    if (entry === undefined) return null;
    if (rows().some((row) => row.entry.index === index)) return null;
    return {
      entry,
      start: virtualizer.getOffsetForIndex(index, "start"),
      pinned: true,
    };
  });

  const renderRows = createMemo<VirtualRow[]>(() => {
    const windowRows = rows();
    const pinned = pinnedRow();
    return pinned === null ? windowRows : [...windowRows, pinned];
  });

  return (
    <div
      class="sui-popup__virtual-spacer"
      ref={(node: Element | null) => {
        setSpacer(node);
      }}
      style={spacerStyle()}
    >
      <For each={renderRows} keyOf={(row) => row.entry.key}>
        {(row) => (
          <div
            class="sui-popup__virtual-row"
            data-index={row.entry.index}
            data-pinned={row.pinned === true ? "" : undefined}
            ref={measureRow}
            style={optionStyle(row.start)}
          >
            <Show when={groupStart(entries(), row.entry.index)}>
              <div
                class="sui-popup__group-label"
                id={groupLabelId(
                  props.baseId,
                  groupStart(entries(), row.entry.index) ?? row.entry,
                )}
                role="presentation"
              >
                {groupStart(entries(), row.entry.index)?.group?.label}
              </div>
            </Show>
            <div
              id={listboxOptionId(props.baseId, row.entry.index)}
              class="sui-popup__option"
              role="option"
              aria-selected={props.selected(row.entry.key) ? "true" : "false"}
              aria-disabled={
                row.entry.option.disabled === true ? "true" : undefined
              }
              aria-setsize={optionCount()}
              aria-posinset={row.entry.index + 1}
              data-active={
                props.activeKey() === row.entry.key ? "" : undefined
              }
              data-value={row.entry.key}
              data-option-index={row.entry.index}
              onPointerMove={() => {
                props.onActivate?.(row.entry.option);
              }}
              onClick={(event) => {
                props.onPick(row.entry.option, event);
              }}
            >
              <span class="sui-popup__option-leading" aria-hidden="true">
                {row.entry.option.leading}
              </span>
              <span class="sui-popup__option-text">
                <Show
                  when={props.renderOption !== undefined}
                  fallback={
                    <>
                      <span class="sui-popup__option-label">
                        {row.entry.option.label}
                      </span>
                      <Show when={row.entry.option.description}>
                        <span class="sui-popup__option-description">
                          {row.entry.option.description}
                        </span>
                      </Show>
                    </>
                  }
                >
                  <span class="sui-popup__option-label">
                    {props.renderOption?.(row.entry.option)}
                  </span>
                </Show>
              </span>
              <span class="sui-popup__option-trailing">
                {row.entry.option.trailing}
              </span>
              <span class="sui-popup__check" aria-hidden="true">
                <Show when={props.selected(row.entry.key)}>
                  <CheckIcon size="sm" />
                </Show>
              </span>
            </div>
          </div>
        )}
      </For>
    </div>
  );
}

export function ListboxRows(props: ListboxRowsProps): Node {
  return (
    <Show
      when={props.options().length >= LISTBOX_VIRTUAL_THRESHOLD}
      fallback={
        <SmallListboxRows
          options={props.options}
          baseId={props.baseId}
          activeKey={props.activeKey}
          selected={props.selected}
          renderOption={props.renderOption}
          onPick={props.onPick}
          onActivate={props.onActivate}
          maxVisible={props.maxVisible}
        />
      }
    >
      <VirtualListboxRows
        options={props.options}
        baseId={props.baseId}
        activeKey={props.activeKey}
        selected={props.selected}
        renderOption={props.renderOption}
        onPick={props.onPick}
        onActivate={props.onActivate}
        maxVisible={props.maxVisible}
      />
    </Show>
  );
}
