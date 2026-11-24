import type { Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import type { Attrs } from "../../internal/props.js";

export type LabelVariant = "label-large" | "label-medium" | "label-small";
export type LabelTone = "default" | "muted" | "error" | "primary" | "inherit";

export interface LabelProps {
  /** `for` связывает подпись с контролом. */
  readonly for?: string | undefined;
  readonly variant?: LabelVariant | undefined;
  readonly tone?: LabelTone | undefined;
  readonly disabled?: boolean | undefined;
  /** Маркер обязательности: `*` с `aria-hidden`. */
  readonly required?: boolean | undefined;
  /** Верхний регистр для подписей секций (осознанно, не по умолчанию). */
  readonly uppercase?: boolean | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
  readonly children?: Children;
}

/** Подпись поля формы. Тон `error` включается только явно. */
export function Label(props: LabelProps): Node {
  return (
    <label
      {...props.attrs}
      class={["sui-label", props.class]}
      style={props.style}
      for={props.for}
      data-variant={props.variant ?? "label-large"}
      data-tone={props.tone ?? "default"}
      data-case={props.uppercase === true ? "upper" : undefined}
      data-disabled={props.disabled ? "" : undefined}
    >
      {props.required === true ? (
        <>
          {props.children}
          <span class="sui-label__required" aria-hidden="true">
            *
          </span>
        </>
      ) : props.children}
    </label>
  );
}
