import type { Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import { Show } from "@ivlev-dev/silent-core";
import type { Attrs } from "../../internal/props.js";
import { Spinner } from "../spinner/spinner.js";

export type IconButtonSize = "sm" | "md" | "lg";
export type IconButtonVariant = "standard" | "filled" | "accent" | "tonal" | "outlined";

export interface IconButtonProps {
  /** Обязателен: без него кнопка недоступна для скринридера. */
  readonly label: string;
  readonly size?: IconButtonSize | undefined;
  readonly variant?: IconButtonVariant | undefined;
  readonly disabled?: boolean | undefined;
  /** Блокирует нажатия и показывает спиннер вместо иконки. */
  readonly loading?: boolean | undefined;
  readonly type?: "button" | "submit" | "reset" | undefined;
  readonly onClick?: ((event: MouseEvent) => void) | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
  readonly children?: Children;
  readonly ref?: ((node: Element | null) => void) | undefined;
}

/** Круглая кнопка-иконка. Подпись обязательна и всегда уходит в `aria-label`. */
export function IconButton(props: IconButtonProps): Node {
  return (
    <button
      {...props.attrs}
      ref={props.ref}
      class={["sui-icon-button", props.class]}
      style={props.style}
      type={props.type ?? "button"}
      data-variant={props.variant ?? "standard"}
      data-size={props.size ?? "md"}
      data-loading={props.loading === true ? "" : undefined}
      disabled={props.disabled === true || props.loading === true}
      aria-label={props.label}
      aria-busy={props.loading === true ? "true" : undefined}
      onClick={(event) => {
        if (props.disabled === true || props.loading === true) return;
        props.onClick?.(event);
      }}
    >
      <Show when={props.loading === true} fallback={props.children}>
        <Spinner size="sm" />
      </Show>
    </button>
  );
}
