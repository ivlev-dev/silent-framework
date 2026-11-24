import type {
  AlignItems,
  JustifyContent,
  PrimitiveProps,
  SpaceStep,
} from "../internal/props.js";

export interface StackProps extends PrimitiveProps {
  readonly gap?: SpaceStep | undefined;
  readonly align?: AlignItems | undefined;
  readonly justify?: JustifyContent | undefined;
}

/** Вертикальный поток (flex column). */
export function Stack(props: StackProps): Node {
  return (
    <div
      {...props.attrs}
      class={["sui-stack", props.class]}
      style={props.style}
      data-gap={props.gap ?? 0}
      data-align={props.align ?? "stretch"}
      data-justify={props.justify ?? "start"}
    >
      {props.children}
    </div>
  );
}
