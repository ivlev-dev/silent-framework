import type { PrimitiveProps } from "../internal/props.js";

export type DividerOrientation = "horizontal" | "vertical";
export type DividerInset = "none" | "start" | "both";

export interface DividerProps extends PrimitiveProps {
  readonly orientation?: DividerOrientation | undefined;
  readonly inset?: DividerInset | undefined;
}

/** Разделитель: hairline-линия `outline-variant`. */
export function Divider(props: DividerProps): Node {
  return (
    <hr
      {...props.attrs}
      class={["sui-divider", props.class]}
      style={props.style}
      data-orientation={props.orientation ?? "horizontal"}
      data-inset={props.inset ?? "none"}
      aria-hidden="true"
    />
  );
}
