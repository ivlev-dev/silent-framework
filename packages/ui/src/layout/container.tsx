import type { PrimitiveProps } from "../internal/props.js";

export type ContainerSize = "content" | "wide" | "full";

export interface ContainerProps extends PrimitiveProps {
  /** Ограничение ширины: `content` (75rem, до 2400px на 4K), `wide` (90rem, до 2600px), `full`. */
  readonly size?: ContainerSize | undefined;
  /** Горизонтальные поля `--sui-gutter`. По умолчанию включены. */
  readonly gutter?: boolean | undefined;
}

/** Ограничитель ширины контента: центр + поля, на 4K шире, но не резиновый. */
export function Container(props: ContainerProps): Node {
  return (
    <div
      {...props.attrs}
      class={["sui-container", props.class]}
      style={props.style}
      data-size={props.size ?? "content"}
      data-gutter={props.gutter === false ? "none" : undefined}
    >
      {props.children}
    </div>
  );
}
