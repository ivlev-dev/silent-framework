import type {
  AlignItems,
  JustifyContent,
  PrimitiveProps,
  SpaceStep,
} from "../internal/props.js";

export interface InlineProps extends PrimitiveProps {
  readonly gap?: SpaceStep | undefined;
  readonly align?: AlignItems | undefined;
  readonly justify?: JustifyContent | undefined;
  readonly wrap?: boolean | undefined;
}

/** Горизонтальный поток (flex row). */
export function Inline(props: InlineProps): Node {
  return (
    <div
      {...props.attrs}
      class={["sui-inline", props.class]}
      style={props.style}
      data-gap={props.gap ?? 0}
      data-align={props.align ?? "center"}
      data-justify={props.justify ?? "start"}
      data-wrap={props.wrap === true ? "" : undefined}
    >
      {props.children}
    </div>
  );
}
