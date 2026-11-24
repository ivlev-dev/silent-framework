import type {
  BackgroundTone,
  BorderTone,
  ElevationStep,
  PrimitiveProps,
  RadiusStep,
  SpaceStep,
} from "../internal/props.js";

export interface BoxProps extends PrimitiveProps {
  readonly padding?: SpaceStep | undefined;
  readonly background?: BackgroundTone | undefined;
  readonly border?: BorderTone | undefined;
  readonly radius?: RadiusStep | undefined;
  readonly elevation?: ElevationStep | undefined;
}

/**
 * Базовый контейнер: только раскладка и оформление через `data-*`.
 *
 * `attrs` раскидывается runtime-хелпером `spread` компилятора, а не
 * `{...props}`: так геттеры остаются ленивыми, а ref/children не протекают.
 */
export function Box(props: BoxProps): Node {
  return (
    <div
      {...props.attrs}
      class={["sui-box", props.class]}
      style={props.style}
      data-padding={props.padding ?? "none"}
      data-background={props.background ?? "transparent"}
      data-border={props.border ?? "none"}
      data-radius={props.radius ?? "none"}
      data-elevation={props.elevation ?? 0}
    >
      {props.children}
    </div>
  );
}
