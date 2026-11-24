import type { Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import { For, useId } from "@ivlev-dev/silent-core";
import type { Attrs } from "../../internal/props.js";

export type SegmentedButtonSize = "sm" | "md" | "lg";

export interface SegmentedButtonOption {
  readonly key: string;
  readonly label?: Children;
  readonly icon?: Children;
  /** Доступное имя, если визуальной подписи нет. */
  readonly ariaLabel?: string | undefined;
  readonly disabled?: boolean | undefined;
}

export interface SegmentedButtonItemProps {
  readonly value: string;
  readonly selected: boolean;
  readonly label?: Children;
  readonly icon?: Children;
  readonly ariaLabel?: string | undefined;
  readonly disabled?: boolean | undefined;
  readonly id?: string | undefined;
  /** Roving tabindex: выбранный элемент — `0`, остальные — `-1`. */
  readonly tabIndex?: number | undefined;
  readonly onSelect?: ((event: MouseEvent) => void) | undefined;
  readonly onKeyDown?: ((event: KeyboardEvent) => void) | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
  readonly children?: Children;
  readonly ref?: ((node: Element | null) => void) | undefined;
}

/** Сегмент управляемой группы: кнопка с `aria-pressed`. */
export function SegmentedButtonItem(props: SegmentedButtonItemProps): Node {
  return (
    <button
      {...props.attrs}
      ref={props.ref}
      class={["sui-segmented-button__item", props.class]}
      style={props.style}
      type="button"
      id={props.id as string}
      role="button"
      data-value={props.value}
      data-selected={props.selected ? "" : undefined}
      aria-pressed={props.selected ? "true" : "false"}
      aria-label={props.ariaLabel}
      tabindex={props.tabIndex ?? (props.selected ? 0 : -1)}
      disabled={props.disabled === true}
      onClick={(event) => {
        if (props.disabled === true) return;
        props.onSelect?.(event);
      }}
      onKeyDown={(event) => {
        props.onKeyDown?.(event);
      }}
    >
      {props.icon === undefined || props.icon === null ? null : (
        <span class="sui-segmented-button__icon" data-slot="icon" aria-hidden="true">
          {props.icon}
        </span>
      )}
      {props.label === undefined || props.label === null ? null : (
        <span class="sui-segmented-button__label">{props.label}</span>
      )}
      {props.children === undefined || props.children === null ? null : (
        <span class="sui-segmented-button__extra">{props.children}</span>
      )}
    </button>
  );
}

export interface SegmentedButtonProps {
  /** Управляемое значение: ключ выбранного сегмента. */
  readonly value: string;
  readonly options: readonly SegmentedButtonOption[];
  readonly onValueChange?: ((value: string) => void) | undefined;
  readonly size?: SegmentedButtonSize | undefined;
  readonly disabled?: boolean | undefined;
  readonly fullWidth?: boolean | undefined;
  /** Доступное имя группы. */
  readonly label?: string | undefined;
  readonly labelledBy?: string | undefined;
  /** Базовый id для элементов; иначе генерируется. */
  readonly id?: string | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
  readonly ref?: ((node: Element | null) => void) | undefined;
}

function firstEnabled(options: readonly SegmentedButtonOption[]): number {
  for (let index = 0; index < options.length; index += 1) {
    if (options[index]?.disabled !== true) return index;
  }
  return -1;
}

function stepIndex(
  options: readonly SegmentedButtonOption[],
  from: number,
  direction: 1 | -1,
): number {
  const total = options.length;
  let next = from;
  for (let attempt = 0; attempt < total; attempt += 1) {
    next = (next + direction + total) % total;
    if (options[next]?.disabled !== true) return next;
  }
  return -1;
}

function edgeIndex(options: readonly SegmentedButtonOption[], last: boolean): number {
  if (last) {
    for (let index = options.length - 1; index >= 0; index -= 1) {
      if (options[index]?.disabled !== true) return index;
    }
    return -1;
  }
  return firstEnabled(options);
}

interface SegmentedItemsProps {
  readonly options: readonly SegmentedButtonOption[];
  readonly value: string;
  readonly activeIndex: number;
  readonly baseId: string;
  readonly disabled: boolean;
  readonly onValueChange: ((value: string) => void) | undefined;
  readonly onKeyDown: (index: number, event: KeyboardEvent) => void;
}

/** Обёртка над `For`: без неё SSR теряет разметку списка. */
function SegmentedItems(props: SegmentedItemsProps): Node {
  return (
    <For each={props.options} keyOf={(option) => option.key}>
      {(option, index) => (
        <SegmentedButtonItem
          id={`${props.baseId}-item-${index()}`}
          value={option.key}
          label={option.label}
          icon={option.icon}
          ariaLabel={option.ariaLabel}
          selected={props.value === option.key}
          disabled={props.disabled || option.disabled === true}
          tabIndex={index() === props.activeIndex ? 0 : -1}
          onSelect={() => {
            if (option.disabled === true) return;
            if (props.value === option.key) return;
            props.onValueChange?.(option.key);
          }}
          onKeyDown={(event) => {
            props.onKeyDown(index(), event);
          }}
        />
      )}
    </For>
  );
}

/**
 * SegmentedButton (single select): roving tabindex, Arrow/Home/End,
 * `aria-pressed` на сегментах. Управляется через `value`/`onValueChange`.
 */
export function SegmentedButton(props: SegmentedButtonProps): Node {
  const generatedId = useId("sui-segmented");
  const baseId = props.id ?? generatedId;
  const disabled = props.disabled === true;

  const activeIndex = (): number => {
    for (let index = 0; index < props.options.length; index += 1) {
      const option = props.options[index];
      if (option !== undefined && option.key === props.value && option.disabled !== true) {
        return index;
      }
    }
    return firstEnabled(props.options);
  };

  const focusItem = (index: number): void => {
    if (typeof document === "undefined") return;
    const element = document.getElementById(`${baseId}-item-${index}`);
    if (element !== null && typeof (element as HTMLElement).focus === "function") {
      (element as HTMLElement).focus();
    }
  };

  const handleKeyDown = (index: number, event: KeyboardEvent): void => {
    if (disabled) return;
    let nextIndex = -1;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = stepIndex(props.options, index, 1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = stepIndex(props.options, index, -1);
    } else if (event.key === "Home") {
      nextIndex = edgeIndex(props.options, false);
    } else if (event.key === "End") {
      nextIndex = edgeIndex(props.options, true);
    } else {
      return;
    }
    event.preventDefault();
    const next = props.options[nextIndex];
    if (next === undefined) return;
    props.onValueChange?.(next.key);
    focusItem(nextIndex);
  };

  return (
    <div
      {...props.attrs}
      ref={props.ref}
      class={["sui-segmented-button", props.class]}
      style={props.style}
      role="group"
      aria-label={props.label}
      aria-labelledby={props.labelledBy}
      data-size={props.size ?? "md"}
      data-full-width={props.fullWidth === true ? "" : undefined}
      data-disabled={disabled ? "" : undefined}
    >
      <SegmentedItems
        options={props.options}
        value={props.value}
        activeIndex={activeIndex()}
        baseId={baseId}
        disabled={disabled}
        onValueChange={props.onValueChange}
        onKeyDown={handleKeyDown}
      />
    </div>
  );
}
