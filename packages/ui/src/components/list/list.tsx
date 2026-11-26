import type { Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import { For, Show } from "@ivlev-dev/silent-core";
import { createVirtualizer, type VirtualItem } from "@ivlev-dev/silent-virtual";
import type { Attrs } from "../../internal/props.js";

export type ListItemRole = "option" | "button" | "link";

/** Оценка высоты строки по умолчанию (обычный/плотный режим). */
const DEFAULT_ITEM_HEIGHT = 41;
const DENSE_ITEM_HEIGHT = 33;
/** Видимый размер окна по умолчанию: совпадает с `maxHeight`. */
const DEFAULT_VIEWPORT = 480;
/** Запас рендера сверх видимого окна. */
const VIRTUAL_OVERSCAN = 8;

export interface ListProps<T = unknown> {
  /** `role="listbox"`: включает выбор элементов (`ListItem.selected`). */
  readonly selectable?: boolean | undefined;
  /**
   * Выбранный элемент в `items`-режиме: флаг для всех строк или предикат
   * `(item, index) => boolean`. В `children`-режиме не применяется.
   */
  readonly selected?: boolean | ((item: T, index: number) => boolean) | undefined;
  /**
   * Выбор элемента в `items`-режиме (клик, Enter/Space). В `children`-режиме
   * не применяется: там используйте `ListItem.onClick`.
   */
  readonly onSelect?:
    | ((item: T, index: number, event: MouseEvent | KeyboardEvent) => void)
    | undefined;
  /**
   * Коллекция: если задана, `List` рендерит строки сам (и может
   * виртуализировать). Без `items` компонент остаётся обёрткой над `children`.
   * Элемент с полем `disabled: true` получает `aria-disabled` и не выбирается.
   */
  readonly items?: readonly T[] | undefined;
  /** Содержимое строки для `items`-режима (обёртка `ListItem` — у списка). */
  readonly renderItem?: ((item: T, index: number) => Children) | undefined;
  /** Стабильный ключ элемента для `items`-режима. По умолчанию — индекс. */
  readonly keyOf?: ((item: T, index: number) => string | number) | undefined;
  /**
   * Виртуализация `items`-режима: включена по умолчанию, `false` — opt-out
   * и полный рендер коллекции.
   */
  readonly virtual?: boolean | undefined;
  /** Оценка высоты строки, px. По умолчанию 41 (33 при `dense`). */
  readonly itemHeight?: number | undefined;
  /** Максимальная высота прокручиваемого `ul` в виртуальном режиме. */
  readonly maxHeight?: number | undefined;
  /** Начальный размер вьюпорта для детерминированного SSR-среза. */
  readonly initialViewportSize?: number | undefined;
  /** Разделители между всеми элементами. */
  readonly divider?: boolean | undefined;
  /** Плотный режим: меньше вертикальные отступы. */
  readonly dense?: boolean | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
  readonly children?: Children;
  readonly ref?: ((node: Element | null) => void) | undefined;
}

export interface ListItemProps {
  readonly selected?: boolean | undefined;
  readonly interactive?: boolean | undefined;
  readonly current?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  /** Слот слева: аватар, иконка, чекбокс. */
  readonly leading?: Children;
  /** Слот справа: бейдж, иконка, метаданные. */
  readonly trailing?: Children;
  /** Разделитель сверху у конкретного элемента. */
  readonly divider?: boolean | undefined;
  /** Обрезка длинного текста по строкам (1–3). */
  readonly lines?: 1 | 2 | 3 | undefined;
  /** Переопределение роли (по умолчанию: `option` при `selected`, иначе `button`). */
  readonly role?: ListItemRole | undefined;
  readonly onClick?: ((event: MouseEvent | KeyboardEvent) => void) | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
  readonly children?: Children;
  readonly ref?: ((node: Element | null) => void) | undefined;
}

interface ListRowsProps<T> {
  readonly each: readonly T[] | (() => readonly T[]);
  readonly keyOf: (item: T, index: number) => string | number;
  readonly row: (item: T, index: number) => Node;
}

/**
 * Обёртка над `For` для строк списка.
 *
 * Отдельный компонент обязателен: `For` прямо внутри `List` компилятор
 * переводит в direct-режим `parent`/`marker`, и SSR-разметка строк теряется.
 */
function ListRows<T>(props: ListRowsProps<T>): Node {
  return (
    <For each={props.each} keyOf={props.keyOf}>
      {(item, index) => props.row(item, index())}
    </For>
  );
}

function normalizeSize(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function defaultItemContent(item: unknown): Children {
  const type = typeof item;
  if (type === "string" || type === "number" || type === "bigint") {
    return item as Children;
  }
  return String(item);
}

function itemDisabled(item: unknown): boolean {
  return (
    typeof item === "object"
    && item !== null
    && (item as { readonly disabled?: unknown }).disabled === true
  );
}

/** Список. `role="listbox"` ставится только по явному `selectable`. */
export function List<T = unknown>(props: ListProps<T>): Node {
  const items = props.items;
  if (items !== undefined) {
    return <ListItems {...props} items={items} />;
  }
  return (
    <ul
      {...props.attrs}
      ref={props.ref}
      class={["sui-list", props.class]}
      style={props.style}
      role={props.selectable === true ? "listbox" : undefined}
      data-divider={props.divider === true ? "" : undefined}
      data-dense={props.dense === true ? "" : undefined}
    >
      {props.children}
    </ul>
  );
}

interface ListItemsProps<T> extends ListProps<T> {
  readonly items: readonly T[];
}

/** `items`-режим: собственная коллекция с окном и `ListItem`-обёрткой. */
function ListItems<T>(props: ListItemsProps<T>): Node {
  const items = props.items;
  const count = items.length;
  const dense = props.dense === true;
  const selectable = props.selectable === true;
  const itemHeight = normalizeSize(
    props.itemHeight ?? (dense ? DENSE_ITEM_HEIGHT : DEFAULT_ITEM_HEIGHT),
    dense ? DENSE_ITEM_HEIGHT : DEFAULT_ITEM_HEIGHT,
  );
  const virtualEnabled = props.virtual !== false && count > 0;
  const maxHeight = normalizeSize(
    props.maxHeight ?? DEFAULT_VIEWPORT,
    DEFAULT_VIEWPORT,
  );
  const initialViewportSize = normalizeSize(
    props.initialViewportSize ?? DEFAULT_VIEWPORT,
    DEFAULT_VIEWPORT,
  );

  const keyAt = (item: T, index: number): string | number =>
    props.keyOf?.(item, index) ?? index;

  const virtualizer = createVirtualizer({
    count,
    estimateSize: () => itemHeight,
    getItemKey: (index) => keyAt(items[index] as T, index),
    overscan: VIRTUAL_OVERSCAN,
    initialViewportSize,
    enabled: virtualEnabled,
  });

  const selectedAt = (item: T, index: number): boolean => {
    const selected = props.selected;
    if (typeof selected === "function") {
      return selected(item, index);
    }
    return selected === true;
  };

  const row = (item: T, index: number): Node => {
    const disabled = itemDisabled(item);
    const selected = selectable ? selectedAt(item, index) : undefined;
    const rowAttrs: Record<string, string | number | boolean | null | undefined> = {
      "data-index": index,
    };
    if (selectable) {
      rowAttrs["aria-setsize"] = count;
      rowAttrs["aria-posinset"] = index + 1;
    }
    return (
      <ListItem
        selected={selected}
        interactive={selectable && !disabled}
        disabled={disabled}
        attrs={rowAttrs}
        onClick={
          selectable && props.onSelect !== undefined
            ? (event) => {
                props.onSelect?.(item, index, event);
              }
            : undefined
        }
      >
        {props.renderItem === undefined
          ? defaultItemContent(item)
          : props.renderItem(item, index)}
      </ListItem>
    );
  };

  const virtualRow = (entry: VirtualItem): Node => {
    const index = entry.index;
    const item = items[index] as T;
    const disabled = itemDisabled(item);
    const selected = selectable ? selectedAt(item, index) : undefined;
    const rowAttrs: Record<string, string | number | boolean | null | undefined> = {
      "data-index": index,
    };
    if (selectable) {
      rowAttrs["aria-setsize"] = count;
      rowAttrs["aria-posinset"] = index + 1;
    }
    return (
      <ListItem
        ref={measureRow}
        selected={selected}
        interactive={selectable && !disabled}
        disabled={disabled}
        attrs={rowAttrs}
        onClick={
          selectable && props.onSelect !== undefined
            ? (event) => {
                props.onSelect?.(item, index, event);
              }
            : undefined
        }
      >
        {props.renderItem === undefined
          ? defaultItemContent(item)
          : props.renderItem(item, index)}
      </ListItem>
    );
  };

  const measureRow = (node: Element | null): void => {
    if (node === null) return;
    virtualizer.measureElement(node);
    // Ref срабатывает до вставки детей и `data-index`; повторное измерение
    // микрозадачей видит уже собранную строку.
    queueMicrotask(() => {
      virtualizer.measureElement(node);
    });
  };

  const firstStart = (): number => {
    const visible = virtualizer.virtualItems();
    return visible[0]?.start ?? 0;
  };

  const lastEnd = (): number => {
    const visible = virtualizer.virtualItems();
    const last = visible[visible.length - 1];
    return last === undefined ? 0 : last.end;
  };

  const bottomSize = (): number =>
    Math.max(0, virtualizer.totalSize() - lastEnd());

  const setScrollElement = (node: Element | null): void => {
    props.ref?.(node);
    virtualizer.setScrollElement(virtualEnabled ? node : null);
  };

  const listStyle = virtualEnabled
    ? [{ maxHeight, overflowY: "auto" as const }, props.style]
    : props.style;

  const rowEntries: readonly unknown[] | (() => readonly unknown[]) = virtualEnabled
    ? virtualizer.virtualItems
    : items;

  const rowKey = (entry: unknown, index: number): string | number =>
    virtualEnabled ? index : keyAt(entry as T, index);

  const rowContent = (entry: unknown, index: number): Node =>
    virtualEnabled ? virtualRow(entry as VirtualItem) : row(entry as T, index);

  return (
    <ul
      {...props.attrs}
      ref={setScrollElement}
      class={["sui-list", props.class]}
      style={listStyle}
      role={selectable ? "listbox" : undefined}
      data-divider={props.divider === true ? "" : undefined}
      data-dense={dense ? "" : undefined}
      data-virtual={virtualEnabled ? "" : undefined}
    >
      <Show when={virtualEnabled}>
        <li
          aria-hidden="true"
          class="sui-list__spacer"
          style={{ height: firstStart() }}
        />
      </Show>
      <ListRows each={rowEntries} keyOf={rowKey} row={rowContent} />
      <Show when={virtualEnabled}>
        <li
          aria-hidden="true"
          class="sui-list__spacer"
          style={{ height: bottomSize() }}
        />
      </Show>
    </ul>
  );
}

/**
 * Строка списка. Интерактивная строка активируется Enter/Space, `selected`
 * даёт `aria-selected`, `current` — `aria-current="page"`. Компонент не
 * владеет списком и спокойно живёт внутри `For` c `keyOf`.
 */
export function ListItem(props: ListItemProps): Node {
  const interactive = props.interactive === true;
  const disabled = props.disabled === true;
  const active = interactive && !disabled;
  const role =
    props.role ?? (props.selected !== undefined ? "option" : interactive ? "button" : undefined);

  return (
    <li
      {...props.attrs}
      ref={props.ref}
      class={["sui-list-item", props.class]}
      style={props.style}
      role={role}
      tabindex={active ? 0 : undefined}
      data-interactive={interactive ? "" : undefined}
      data-selected={props.selected === true ? "" : undefined}
      data-current={props.current === true ? "" : undefined}
      data-lines={props.lines}
      data-divider={props.divider === true ? "" : undefined}
      aria-selected={props.selected === undefined ? undefined : props.selected ? "true" : "false"}
      aria-current={props.current === true ? "page" : undefined}
      aria-disabled={disabled ? "true" : undefined}
      onClick={(event) => {
        if (!active) return;
        props.onClick?.(event);
      }}
      onKeyDown={(event) => {
        if (!active) return;
        if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
          event.preventDefault();
          props.onClick?.(event);
        }
      }}
    >
      <span class="sui-list-item__leading" data-slot="leading">
        {props.leading}
      </span>
      <span class="sui-list-item__content">{props.children}</span>
      <span class="sui-list-item__trailing" data-slot="trailing">
        {props.trailing}
      </span>
    </li>
  );
}
