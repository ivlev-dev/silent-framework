import type { Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import { Show } from "@ivlev-dev/silent-core";
import type { Attrs } from "../../internal/props.js";
import { CloseIcon } from "../../icons/close.js";
import { useUiConfig } from "../../theme/config.js";

export type TagVariant =
  | "neutral"
  | "primary"
  | "secondary"
  | "success"
  | "warning"
  | "error"
  | "info";

export type TagSize = "sm" | "md";

export interface TagProps {
  readonly variant?: TagVariant | undefined;
  readonly size?: TagSize | undefined;
  readonly removable?: boolean | undefined;
  readonly onRemove?: ((event: MouseEvent) => void) | undefined;
  /** Переопределяет строку `removeItem` из `UiConfigProvider`. */
  readonly removeLabel?: string | undefined;
  /** Иконка слева; декоративная. */
  readonly leading?: Children;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
  readonly children?: Children;
  readonly ref?: ((node: Element | null) => void) | undefined;
}

/**
 * Тег: статичная метка с необязательной иконкой и кнопкой удаления.
 * Кнопка удаления получает `aria-label` (по умолчанию RU `Удалить`).
 */
export function Tag(props: TagProps): Node {
  const config = useUiConfig();
  return (
    <span
      {...props.attrs}
      ref={props.ref}
      class={["sui-tag", props.class]}
      style={props.style}
      data-variant={props.variant ?? "neutral"}
      data-size={props.size ?? "md"}
    >
      <Show when={props.leading !== undefined && props.leading !== null}>
        <span class="sui-tag__icon" data-slot="leading" aria-hidden="true">
          {props.leading}
        </span>
      </Show>
      <span class="sui-tag__label">{props.children}</span>
      <Show when={props.removable === true}>
        <button
          class="sui-tag__remove"
          type="button"
          aria-label={props.removeLabel ?? config.strings.removeItem}
          onClick={(event) => {
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
