import type { Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import { For, Show, createSignal, useId } from "@ivlev-dev/silent-core";
import type { Attrs } from "../../internal/props.js";
import { ExpandMoreIcon } from "../../icons/expand-more.js";
import { Heading, type HeadingLevel } from "../heading/heading.js";

export type AccordionSelectionMode = "single" | "multiple";
/** `string` для `single`, массив ключей для `multiple`; пустая строка — закрыто. */
export type AccordionValue = string | readonly string[];

export interface AccordionItemData {
  readonly key: string;
  readonly title: Children;
  /** Содержимое: для SSR передавайте лениво — `content: () => <… />`. */
  readonly content?: Children;
  /** Обрезать длинный заголовок одной строкой (многоточие вместо переноса). */
  readonly truncate?: boolean | undefined;
  readonly disabled?: boolean | undefined;
}

export interface AccordionItemProps {
  readonly title: Children;
  readonly expanded: boolean;
  readonly content?: Children;
  readonly truncate?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly headingLevel?: HeadingLevel | undefined;
  /** id триггера; на него ссылается `aria-labelledby` панели. */
  readonly triggerId?: string | undefined;
  /** id панели; на него ссылается `aria-controls` триггера. */
  readonly panelId?: string | undefined;
  readonly onToggle?: ((event: MouseEvent) => void) | undefined;
  readonly onKeyDown?: ((event: KeyboardEvent) => void) | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
  readonly ref?: ((node: Element | null) => void) | undefined;
}

/**
 * Пункт аккордеона: заголовок-кнопка с `aria-expanded`/`aria-controls` и
 * панель. Содержимое закрытого пункта не монтируется вовсе — это важно
 * и для SSR, и для стоимости гидрации.
 */
function accordionItemNode(props: AccordionItemProps): Node {
  const disabled = props.disabled === true;
  const headingLevel = props.headingLevel ?? 3;

  return (
    <div
      {...props.attrs}
      ref={props.ref}
      class={["sui-accordion__item", props.class]}
      style={props.style}
      data-expanded={props.expanded ? "" : undefined}
      data-disabled={disabled ? "" : undefined}
    >
      <Heading
        class="sui-accordion__heading"
        level={headingLevel}
        variant="title-small"
      >
        <button
          class="sui-accordion__trigger"
          type="button"
          id={props.triggerId as string}
          aria-expanded={props.expanded ? "true" : "false"}
          aria-controls={props.panelId}
          disabled={disabled}
          onClick={(event) => {
            if (disabled) return;
            props.onToggle?.(event);
          }}
          onKeyDown={(event) => {
            props.onKeyDown?.(event);
          }}
        >
          <span
            class="sui-accordion__title"
            data-truncate={props.truncate === true ? "" : undefined}
            title={
              props.truncate === true && typeof props.title === "string"
                ? props.title
                : undefined
            }
          >
            {props.title}
          </span>
          <span class="sui-accordion__icon" aria-hidden="true">
            <ExpandMoreIcon size="sm" />
          </span>
        </button>
      </Heading>
      <div
        class="sui-accordion__panel"
        id={props.panelId as string}
        role={props.triggerId === undefined ? undefined : "region"}
        aria-labelledby={props.triggerId}
        hidden={!props.expanded}
        data-expanded={props.expanded ? "" : undefined}
      >
        <Show when={props.expanded}>{props.content}</Show>
      </div>
    </div>
  );
}

/**
 * Публичный пункт аккордеона. Список внутри `Accordion` вызывает
 * `accordionItemNode` напрямую, чтобы не зависеть от кэша лёгких компонентов
 * при гидрации списка.
 */
export function AccordionItem(props: AccordionItemProps): Node {
  return accordionItemNode(props);
}

export interface AccordionProps {
  readonly items: readonly AccordionItemData[];
  /** `single` — открыт максимум один пункт, `multiple` — сколько угодно. */
  readonly selectionMode?: AccordionSelectionMode | undefined;
  /** Управляемое значение. */
  readonly value?: AccordionValue | undefined;
  readonly defaultValue?: AccordionValue | undefined;
  /** `string` в single-режиме, массив ключей — в multiple. */
  readonly onValueChange?: ((value: AccordionValue) => void) | undefined;
  readonly headingLevel?: HeadingLevel | undefined;
  /** Базовый id для `aria-controls`/`aria-labelledby`; иначе генерируется. */
  readonly id?: string | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
  readonly ref?: ((node: Element | null) => void) | undefined;
}

function toKeys(value: AccordionValue | undefined): readonly string[] {
  if (value === undefined) return [];
  if (typeof value === "string") return value === "" ? [] : [value];
  return value;
}

function firstEnabled(items: readonly AccordionItemData[]): number {
  for (let index = 0; index < items.length; index += 1) {
    if (items[index]?.disabled !== true) return index;
  }
  return -1;
}

function stepIndex(
  items: readonly AccordionItemData[],
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

function edgeIndex(items: readonly AccordionItemData[], last: boolean): number {
  if (last) {
    for (let index = items.length - 1; index >= 0; index -= 1) {
      if (items[index]?.disabled !== true) return index;
    }
    return -1;
  }
  return firstEnabled(items);
}

interface AccordionEntriesProps {
  readonly items: readonly AccordionItemData[];
  readonly isOpen: (key: string) => boolean;
  readonly baseId: string;
  readonly headingLevel: HeadingLevel | undefined;
  readonly onToggle: (item: AccordionItemData) => void;
  readonly onKeyDown: (index: number, event: KeyboardEvent) => void;
}

/**
 * Обёртка над `For`: `For` не должен быть единственным ребёнком корня,
 * иначе SSR теряет разметку пунктов.
 */
function AccordionEntries(props: AccordionEntriesProps): Node {
  return (
    <For each={props.items} keyOf={(item) => item.key}>
      {(item, index) =>
        accordionItemNode({
          title: item.title,
          content: item.content,
          truncate: item.truncate === true,
          expanded: props.isOpen(item.key),
          disabled: item.disabled === true,
          headingLevel: props.headingLevel,
          triggerId: `${props.baseId}-trigger-${index()}`,
          panelId: `${props.baseId}-panel-${index()}`,
          onToggle: () => {
            props.onToggle(item);
          },
          onKeyDown: (event) => {
            props.onKeyDown(index(), event);
          },
        })
      }
    </For>
  );
}

/**
 * Accordion (WAI-ARIA Accordion): single/multiple, управляемый (`value`) и
 * неуправляемый (`defaultValue`) режимы, Arrow/Home/End по заголовкам,
 * закрытые пункты не рендерят контент.
 */
export function Accordion(props: AccordionProps): Node {
  const generatedId = useId("sui-accordion");
  const baseId = props.id ?? generatedId;
  const mode: AccordionSelectionMode = props.selectionMode ?? "single";
  const [internal, setInternal] = createSignal<readonly string[]>(
    toKeys(props.defaultValue),
  );

  const openKeys = (): readonly string[] => {
    const source = props.value !== undefined ? toKeys(props.value) : internal();
    return mode === "single" ? source.slice(0, 1) : source;
  };
  const isOpen = (key: string): boolean => openKeys().includes(key);

  const toggle = (item: AccordionItemData): void => {
    if (item.disabled === true) return;
    const current = openKeys();
    const open = current.includes(item.key);
    let next: string[];
    if (open) {
      next = current.filter((key) => key !== item.key);
    } else if (mode === "single") {
      next = [item.key];
    } else {
      next = [...current, item.key];
    }

    if (props.value === undefined) setInternal(next);
    props.onValueChange?.(mode === "single" ? (next[0] ?? "") : next);
  };

  const focusTrigger = (index: number): void => {
    if (typeof document === "undefined") return;
    const element = document.getElementById(`${baseId}-trigger-${index}`);
    if (element !== null && typeof (element as HTMLElement).focus === "function") {
      (element as HTMLElement).focus();
    }
  };

  const handleKeyDown = (index: number, event: KeyboardEvent): void => {
    let nextIndex = -1;
    if (event.key === "ArrowDown") {
      nextIndex = stepIndex(props.items, index, 1);
    } else if (event.key === "ArrowUp") {
      nextIndex = stepIndex(props.items, index, -1);
    } else if (event.key === "Home") {
      nextIndex = edgeIndex(props.items, false);
    } else if (event.key === "End") {
      nextIndex = edgeIndex(props.items, true);
    } else {
      return;
    }
    event.preventDefault();
    if (nextIndex !== -1) focusTrigger(nextIndex);
  };

  return (
    <div
      {...props.attrs}
      ref={props.ref}
      class={["sui-accordion", props.class]}
      style={props.style}
      data-selection-mode={mode}
    >
      <AccordionEntries
        items={props.items}
        isOpen={isOpen}
        baseId={baseId}
        headingLevel={props.headingLevel}
        onToggle={toggle}
        onKeyDown={handleKeyDown}
      />
    </div>
  );
}
