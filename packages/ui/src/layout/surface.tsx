import type {
  BackgroundTone,
  BorderTone,
  ElevationStep,
  PrimitiveProps,
  RadiusStep,
  SpaceStep,
} from "../internal/props.js";

export interface SurfaceProps extends PrimitiveProps {
  readonly tone?: BackgroundTone | undefined;
  readonly padding?: SpaceStep | undefined;
  readonly border?: BorderTone | undefined;
  readonly radius?: RadiusStep | undefined;
  readonly elevation?: ElevationStep | undefined;
}

/**
 * Поверхность: фон + скругление + тень + граница. Отдельный примитив, чтобы
 * тон поверхности не смешивался с произвольным `Box`.
 */
export function Surface(props: SurfaceProps): Node {
  return (
    <div
      {...props.attrs}
      class={["sui-surface", props.class]}
      style={props.style}
      data-tone={props.tone ?? "surface-container"}
      data-padding={props.padding ?? 0}
      data-border={props.border ?? "none"}
      data-radius={props.radius ?? "md"}
      data-elevation={props.elevation ?? 0}
    >
      {props.children}
    </div>
  );
}
