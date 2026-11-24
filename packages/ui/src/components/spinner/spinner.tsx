import type { ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import { useUiConfig } from "../../theme/config.js";
import type { Attrs } from "../../internal/props.js";

export type SpinnerSize = "sm" | "md" | "lg";

export interface SpinnerProps {
  readonly size?: SpinnerSize | undefined;
  /** Переопределяет строку `loading` из `UiConfigProvider`. */
  readonly label?: string | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
}

/** Индикатор загрузки. Останавливается при `prefers-reduced-motion`. */
export function Spinner(props: SpinnerProps): Node {
  const config = useUiConfig();
  return (
    <span
      {...props.attrs}
      class={["sui-spinner", props.class]}
      style={props.style}
      data-size={props.size ?? "md"}
      role="progressbar"
      aria-label={props.label ?? config.strings.loading}
      aria-valuetext={props.label ?? config.strings.loading}
    >
      <span class="sui-spinner__ring" aria-hidden="true" />
    </span>
  );
}
