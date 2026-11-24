import type { Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import { For, Show, createSignal, onCleanup, useId } from "@ivlev-dev/silent-core";
import type { Attrs } from "../../internal/props.js";
import { KeyedList } from "../../internal/keyed-list.js";
import { clientEffect } from "../../internal/overlay.js";
import { resolveSlot } from "../../internal/slot.js";

export type TabsOrientation = "horizontal" | "vertical";
export type TabsActivationMode = "automatic" | "manual";
export type TabsSize = "sm" | "md" | "lg";

/** Одна вкладка: ключ стабилен между SSR и клиентом, содержимое ленивое. */
export interface TabItem {
  readonly key: string;
  readonly label: Children;
  /**
   * Содержимое панели. Для SSR/hydration передавайте JSX лениво:
   * `content: () => <…/>`, иначе узел создаётся вне окна гидрации.
   */
  readonly content?: Children;
  readonly disabled?: boolean | undefined;
}

export interface TabListProps {
  readonly orientation?: TabsOrientation | undefined;
  /** Доступное имя списка вкладок. */
  readonly label?: string | undefined;
  /** Идентификатор видимой подписи вместо `label`. */
  readonly labelledBy?: string | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
  readonly children?: Children;
  readonly ref?: ((node: Element | null) => void) | undefined;
}

/** Контейнер вкладок с `role="tablist"`. */
export function TabList(props: TabListProps): Node {
  return (
    <div
      {...props.attrs}
      ref={props.ref}
      class={["sui-tabs__list", props.class]}
      style={props.style}
      role="tablist"
      aria-orientation={props.orientation === "vertical" ? "vertical" : undefined}
      aria-label={props.label}
      aria-labelledby={props.labelledBy}
      data-orientation={props.orientation ?? "horizontal"}
    >
      {props.children}
    </div>
  );
}

export interface TabProps {
  readonly selected: boolean;
  readonly tabId: string;
  readonly panelId?: string | undefined;
  readonly disabled?: boolean | undefined;
  readonly onSelect?: ((event: MouseEvent) => void) | undefined;
  readonly onKeyDown?: ((event: KeyboardEvent) => void) | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
  readonly children?: Children;
  readonly ref?: ((node: Element | null) => void) | undefined;
}

/**
 * Вкладка. Roving tabindex: выбранная — `0`, остальные — `-1`.
 * Клавиатурную навигацию обычно задаёт `Tabs` через `onKeyDown`.
 */
export function Tab(props: TabProps): Node {
  return (
    <button
      {...props.attrs}
      ref={props.ref}
      class={["sui-tabs__tab", props.class]}
      style={props.style}
      type="button"
      role="tab"
      id={props.tabId}
      aria-selected={props.selected ? "true" : "false"}
      aria-controls={props.panelId}
      tabindex={props.selected ? 0 : -1}
      disabled={props.disabled === true}
      data-selected={props.selected ? "" : undefined}
      onClick={(event) => {
        if (props.disabled === true) return;
        props.onSelect?.(event);
      }}
      onKeyDown={(event) => {
        props.onKeyDown?.(event);
      }}
    >
      {resolveSlot(props.children)}
    </button>
  );
}

export interface TabPanelProps {
  readonly active: boolean;
  readonly panelId: string;
  readonly tabId: string;
  /** Не монтировать содержимое до первого показа (по умолчанию `true`). */
  readonly lazy?: boolean | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
  readonly children?: Children;
  readonly ref?: ((node: Element | null) => void) | undefined;
}

/**
 * Панель вкладки. Обёртка существует всегда (валидный `aria-controls`),
 * содержимое при `lazy` монтируется только для активной вкладки.
 */
export function TabPanel(props: TabPanelProps): Node {
  return (
    <div
      {...props.attrs}
      ref={props.ref}
      class={["sui-tabs__panel", props.class]}
      style={props.style}
      role="tabpanel"
      id={props.panelId}
      aria-labelledby={props.tabId}
      tabindex={0}
      hidden={props.active !== true}
      data-active={props.active ? "" : undefined}
    >
      <Show when={props.lazy === false || props.active === true}>{props.children}</Show>
    </div>
  );
}

export interface TabsProps {
  readonly items: readonly TabItem[];
  /** Управляемое значение. */
  readonly value?: string | undefined;
  /** Начальное значение для неуправляемого режима. */
  readonly defaultValue?: string | undefined;
  readonly onValueChange?: ((value: string) => void) | undefined;
  readonly orientation?: TabsOrientation | undefined;
  /** `automatic` — стрелки сразу активируют вкладку, `manual` — только фокус. */
  readonly activationMode?: TabsActivationMode | undefined;
  /** Высота вкладок: компактная, обычная или крупная. */
  readonly size?: TabsSize | undefined;
  /** Монтировать содержимое панели только при активации. По умолчанию `true`. */
  readonly lazy?: boolean | undefined;
  /** Базовый id для `aria-controls`/`aria-labelledby`; иначе генерируется. */
  readonly id?: string | undefined;
  readonly label?: string | undefined;
  readonly labelledBy?: string | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
  readonly ref?: ((node: Element | null) => void) | undefined;
}

function firstEnabledKey(items: readonly TabItem[]): string | undefined {
  for (const item of items) {
    if (item.disabled !== true) return item.key;
  }
  return items[0]?.key;
}

function stepIndex(
  items: readonly TabItem[],
  from: number,
  direction: 1 | -1,
): number {
  const total = items.length;
  let next = from;
  for (let attempt = 0; attempt < total; attempt += 1) {
    next = (next + direction + total) % total;
    if (items[next]?.disabled !== true) return next;
  }
  return -1;
}

function edgeIndex(items: readonly TabItem[], last: boolean): number {
  if (last) {
    for (let index = items.length - 1; index >= 0; index -= 1) {
      if (items[index]?.disabled !== true) return index;
    }
    return -1;
  }
  for (let index = 0; index < items.length; index += 1) {
    if (items[index]?.disabled !== true) return index;
  }
  return -1;
}

/**
 * Вкладки (WAI-ARIA Tabs): roving tabindex, Arrow/Home/End, `aria-selected`
 * и `aria-controls`/`aria-labelledby`. Управляемый (`value`) и неуправляемый
 * (`defaultValue`) режимы; панели ленивые по умолчанию.
 */
export function Tabs(props: TabsProps): Node {
  const orientation = props.orientation ?? "horizontal";
  const generatedId = useId("sui-tabs");
  const baseId = props.id ?? generatedId;
  const [internalValue, setInternalValue] = createSignal<string | undefined>(
    props.defaultValue,
  );
  const [list, setList] = createSignal<HTMLElement | null>(null);

  const currentKey = (): string | undefined => {
    const controlled = props.value;
    if (controlled !== undefined) return controlled;
    const internal = internalValue();
    if (internal !== undefined) return internal;
    return firstEnabledKey(props.items);
  };

  const tabId = (index: number): string => `${baseId}-tab-${index}`;
  const panelId = (index: number): string => `${baseId}-panel-${index}`;

  const select = (key: string): void => {
    if (key === currentKey()) return;
    if (props.value === undefined) setInternalValue(key);
    props.onValueChange?.(key);
  };

  const focusTab = (index: number): void => {
    if (typeof document === "undefined") return;
    const element = document.getElementById(tabId(index));
    if (element !== null && typeof (element as HTMLElement).focus === "function") {
      (element as HTMLElement).focus();
    }
  };

  const handleKeyDown = (index: number, event: KeyboardEvent): void => {
    const items = props.items;
    const vertical = orientation === "vertical";
    const nextKey = event.key;
    let nextIndex = -1;

    if ((!vertical && nextKey === "ArrowRight") || (vertical && nextKey === "ArrowDown")) {
      nextIndex = stepIndex(items, index, 1);
    } else if ((!vertical && nextKey === "ArrowLeft") || (vertical && nextKey === "ArrowUp")) {
      nextIndex = stepIndex(items, index, -1);
    } else if (nextKey === "Home") {
      nextIndex = edgeIndex(items, false);
    } else if (nextKey === "End") {
      nextIndex = edgeIndex(items, true);
    } else if (
      (props.activationMode ?? "automatic") === "manual"
      && (nextKey === "Enter" || nextKey === " ")
    ) {
      event.preventDefault();
      const manual = items[index];
      if (manual !== undefined && manual.disabled !== true) select(manual.key);
      return;
    } else {
      return;
    }

    event.preventDefault();
    const next = items[nextIndex];
    if (next === undefined || next.disabled === true) return;
    if ((props.activationMode ?? "automatic") !== "manual") select(next.key);
    focusTab(nextIndex);
  };

  // Переполнение списка: data-overflow управляет fade у краёв. В jsdom
  // размеры нулевые — атрибут просто не ставится, разметка остаётся валидной.
  clientEffect(() => {
    const element = list();
    if (element === null) return;
    const update = (): void => {
      const max = element.scrollWidth - element.clientWidth;
      if (max <= 1) {
        element.removeAttribute("data-overflow");
        return;
      }
      const atStart = element.scrollLeft <= 1;
      const atEnd = element.scrollLeft >= max - 1;
      if (atStart && atEnd) element.removeAttribute("data-overflow");
      else if (atStart) element.setAttribute("data-overflow", "end");
      else if (atEnd) element.setAttribute("data-overflow", "start");
      else element.setAttribute("data-overflow", "both");
    };
    update();
    element.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update, { passive: true });
    const observer = typeof ResizeObserver === "function"
      ? new ResizeObserver(update)
      : null;
    observer?.observe(element);
    onCleanup(() => {
      element.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      observer?.disconnect();
    });
  });

  return (
    <div
      {...props.attrs}
      ref={props.ref}
      class={["sui-tabs", props.class]}
      style={props.style}
      data-orientation={orientation}
      data-activation={props.activationMode ?? "automatic"}
      data-size={props.size ?? "md"}
    >
      <TabList
        orientation={orientation}
        label={props.label}
        labelledBy={props.labelledBy}
        ref={(node: Element | null) => {
          setList(node as HTMLElement | null);
        }}
      >
        <For each={props.items} keyOf={(item) => item.key}>
          {(item, index) => (
            <Tab
              tabId={tabId(index())}
              panelId={panelId(index())}
              selected={currentKey() === item.key}
              disabled={item.disabled}
              onSelect={() => {
                select(item.key);
              }}
              onKeyDown={(event) => {
                handleKeyDown(index(), event);
              }}
            >
              {item.label}
            </Tab>
          )}
        </For>
      </TabList>
      <div class="sui-tabs__panels">
        <KeyedList each={props.items} keyOf={(item) => item.key}>
          {(item, index) => (
            <TabPanel
              panelId={panelId(index())}
              tabId={tabId(index())}
              active={currentKey() === item.key}
              lazy={props.lazy}
            >
              {item.content}
            </TabPanel>
          )}
        </KeyedList>
      </div>
    </div>
  );
}
