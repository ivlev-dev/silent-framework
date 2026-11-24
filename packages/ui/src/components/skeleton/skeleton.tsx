import type { ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import type { Attrs } from "../../internal/props.js";

export type SkeletonVariant = "text" | "circle" | "rect";
export type SkeletonAnimation = "pulse" | "wave" | "none";
export type SkeletonSize = "sm" | "md" | "lg";

export interface SkeletonProps {
  readonly variant?: SkeletonVariant | undefined;
  /** Число или CSS-длина (`"12rem"`, `"100%"`). */
  readonly width?: string | number | undefined;
  /** Число или CSS-длина. */
  readonly height?: string | number | undefined;
  /** Количество строк для `variant="text"`. */
  readonly lines?: number | undefined;
  readonly animation?: SkeletonAnimation | undefined;
  /** Высота строки текста: 0.75em / 1em / 1.25em. */
  readonly size?: SkeletonSize | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
  readonly ref?: ((node: Element | null) => void) | undefined;
}

function cssLength(value: string | number): string {
  return typeof value === "number" ? `${value}px` : value;
}

/**
 * Плейсхолдер загрузки. Всегда декоративен (`aria-hidden`): смысл должен
 * озвучивать соседний `aria-busy`-контейнер, а не «серый прямоугольник».
 */
export function Skeleton(props: SkeletonProps): Node {
  const variant = props.variant ?? "text";
  const animation = props.animation ?? "pulse";
  const requested = Math.trunc(props.lines ?? 1);
  const lines = variant === "text" && requested > 1 ? requested : 1;

  const size: Record<string, string> = {};
  if (props.width !== undefined) size.width = cssLength(props.width);
  if (props.height !== undefined) size.height = cssLength(props.height);

  return (
    <span
      {...props.attrs}
      ref={props.ref}
      class={["sui-skeleton", props.class]}
      style={[props.style, size]}
      data-variant={variant}
      data-animation={animation}
      data-size={props.size ?? "md"}
      data-lines={lines > 1 ? "multi" : undefined}
      aria-hidden="true"
    >
      {lines > 1
        ? Array.from({ length: lines }, () => <span class="sui-skeleton__line" />)
        : undefined}
    </span>
  );
}
