import type { PrimitiveProps, SpaceStep } from "../internal/props.js";

/** Фиксированное число колонок или auto-fit по минимальной ширине. */
export type GridColumns = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | "auto";

export interface GridProps extends PrimitiveProps {
  readonly columns?: GridColumns | undefined;
  readonly gap?: SpaceStep | undefined;
  /** Минимальная ширина колонки для `columns="auto"`. */
  readonly min?: "sm" | "md" | "lg" | undefined;
}

/** Сетка. `columns` задаёт число колонок, `auto` — auto-fit. */
export function Grid(props: GridProps): Node {
  return (
    <div
      {...props.attrs}
      class={["sui-grid", props.class]}
      style={props.style}
      data-columns={props.columns ?? "auto"}
      data-gap={props.gap ?? 0}
      data-min={props.min ?? "md"}
    >
      {props.children}
    </div>
  );
}
