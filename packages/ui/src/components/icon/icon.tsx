import type { Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import type { Attrs } from "../../internal/props.js";

export type IconSize = "sm" | "md" | "lg" | "xl";

export interface IconProps {
  readonly size?: IconSize | undefined;
  /** Если задан — `role="img"` и `aria-label`; иначе иконка декоративна. */
  readonly label?: string | undefined;
  readonly class?: ClassNameValue | undefined;
  readonly style?: StyleInput | undefined;
  readonly attrs?: Attrs | undefined;
  /** Содержимое SVG: `<path>`, `<circle>` и т. п. */
  readonly children?: Children;
}

/**
 * Обёртка над inline-SVG. Цвет — `currentColor`, размер — токен шкалы иконок.
 * Готовые иконки лежат в `@ivlev-dev/silent-ui/icons/*`.
 */
export function Icon(props: IconProps): Node {
  return (
    <svg
      {...props.attrs}
      class={["sui-icon", props.class]}
      style={props.style}
      data-size={props.size ?? "md"}
      viewBox="0 0 24 24"
      width="24"
      height="24"
      role={props.label === undefined ? undefined : "img"}
      aria-label={props.label}
      aria-hidden={props.label === undefined ? "true" : undefined}
      focusable="false"
    >
      {props.children}
    </svg>
  );
}
