import type { Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import { Show } from "@ivlev-dev/silent-core";
import type { Attrs } from "../../internal/props.js";
import { Spinner } from "../spinner/spinner.js";

export type ButtonVariant = "filled" | "accent" | "tonal" | "outlined" | "text" | "elevated";
export type ButtonSize = "sm" | "md" | "lg";
export type ButtonType = "button" | "submit" | "reset";

export interface ButtonProps {
  readonly variant?: ButtonVariant | undefined;
  readonly size?: ButtonSize | undefined;
  readonly leading?: Children;
  readonly trailing?: Children;
  readonly loading?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly fullWidth?: boolean | undefined;
  readonly type?: ButtonType | undefined;
  readonly onClick?: ((event: MouseEvent) => void) | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
  readonly children?: Children;
  /** Ref-колбэк: `ref((node) => …)`, без объекта-ref. */
  readonly ref?: ((node: Element | null) => void) | undefined;
}

/**
 * Кнопка. `loading` блокирует нажатия и подменяет `leading` на спиннер,
 * сохраняя ширину за счёт того же слота.
 */
export function Button(props: ButtonProps): Node {
  const labelTitle = typeof props.children === "string" ? props.children : undefined;
  return (
    <button
      {...props.attrs}
      ref={props.ref}
      class={["sui-button", props.class]}
      style={props.style}
      type={props.type ?? "button"}
      data-variant={props.variant ?? "filled"}
      data-size={props.size ?? "md"}
      data-loading={props.loading === true ? "" : undefined}
      data-full-width={props.fullWidth === true ? "" : undefined}
      disabled={props.disabled === true || props.loading === true}
      aria-busy={props.loading === true ? "true" : undefined}
      onClick={(event) => {
        if (props.disabled === true || props.loading === true) return;
        props.onClick?.(event);
      }}
    >
      <span class="sui-button__icon" data-slot="leading" aria-hidden="true">
        <Show when={props.loading === true} fallback={props.leading}>
          <Spinner size="sm" />
        </Show>
      </span>
      <span class="sui-button__label" title={labelTitle}>
        {props.children}
      </span>
      <span class="sui-button__icon" data-slot="trailing" aria-hidden="true">
        {props.trailing}
      </span>
    </button>
  );
}
