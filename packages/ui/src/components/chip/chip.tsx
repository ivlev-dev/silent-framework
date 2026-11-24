import type { Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import { Show } from "@ivlev-dev/silent-core";
import type { Attrs } from "../../internal/props.js";
import { CheckIcon } from "../../icons/check.js";
import { CloseIcon } from "../../icons/close.js";
import { useUiConfig } from "../../theme/config.js";

export type ChipVariant = "assist" | "filter" | "input" | "suggestion";

export interface ChipProps {
  readonly variant?: ChipVariant | undefined;
  /** Отмеченное состояние (`filter` получает `aria-pressed`). */
  readonly selected?: boolean | undefined;
  /** Кнопка удаления с RU-подписью (`Удалить`). */
  readonly removable?: boolean | undefined;
  readonly onRemove?: ((event: MouseEvent) => void) | undefined;
  /** Переопределяет строку `removeItem` из `UiConfigProvider`. */
  readonly removeLabel?: string | undefined;
  /** Иконка слева. Для `filter` при `selected` заменяется галочкой. */
  readonly leading?: Children;
  /** Аватар слева: приоритетнее `leading`. */
  readonly avatar?: Children;
  readonly disabled?: boolean | undefined;
  readonly onClick?: ((event: MouseEvent) => void) | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
  readonly children?: Children;
  readonly ref?: ((node: Element | null) => void) | undefined;
}

/**
 * Чип: assist/filter/input/suggestion. Интерактивная часть — отдельная
 * кнопка внутри корня, поэтому кнопка удаления не оказывается вложенной
 * в другую кнопку и остаётся самостоятельной целью фокуса.
 */
export function Chip(props: ChipProps): Node {
  const config = useUiConfig();
  const variant = props.variant ?? "assist";
  const disabled = props.disabled === true;
  const selected = props.selected === true;
  const interactive = props.onClick !== undefined || props.selected !== undefined;
  const pressed =
    variant === "filter" && props.selected !== undefined
      ? selected
        ? "true"
        : "false"
      : undefined;
  const leading: Children = props.leading;
  const showCheck =
    selected && variant === "filter" && leading === undefined && props.avatar === undefined;

  const main = (
    <>
      <Show when={props.avatar !== undefined && props.avatar !== null}>
        <span class="sui-chip__avatar" data-slot="avatar">
          {props.avatar}
        </span>
      </Show>
      <Show when={props.avatar === undefined || props.avatar === null}>
        <Show when={showCheck || (leading !== undefined && leading !== null)}>
          <span class="sui-chip__icon" data-slot="leading" aria-hidden="true">
            {showCheck ? <CheckIcon size="sm" /> : leading}
          </span>
        </Show>
      </Show>
      <span class="sui-chip__label">{props.children}</span>
    </>
  );

  return (
    <span
      {...props.attrs}
      ref={props.ref}
      class={["sui-chip", props.class]}
      style={props.style}
      data-variant={variant}
      data-selected={selected ? "" : undefined}
      data-disabled={disabled ? "" : undefined}
    >
      {interactive ? (
        <button
          class="sui-chip__action"
          type="button"
          aria-pressed={pressed}
          disabled={disabled}
          onClick={(event) => {
            if (disabled) return;
            props.onClick?.(event);
          }}
        >
          {main}
        </button>
      ) : (
        <span class="sui-chip__action">{main}</span>
      )}
      <Show when={props.removable === true}>
        <button
          class="sui-chip__remove"
          type="button"
          aria-label={props.removeLabel ?? config.strings.removeItem}
          disabled={disabled}
          onClick={(event) => {
            if (disabled) return;
            event.stopPropagation();
            props.onRemove?.(event);
          }}
        >
          <CloseIcon size="sm" />
        </button>
      </Show>
    </span>
  );
}
