import type {
  Children,
  ClassNameValue,
  StyleInput,
} from "@ivlev-dev/silent-core";

/** Атрибуты, которые нельзя выразить типизированными пропсами (`data-*`, `aria-*`). */
export type Attrs = Readonly<
  Record<string, string | number | boolean | null | undefined>
>;

/** Общий контракт примитивов: один корень, без `as` и без захвата props. */
export interface PrimitiveProps {
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
  readonly children?: Children;
}

/** Шаг шкалы отступов (`--sui-space-N`). */
export type SpaceStep = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export type RadiusStep = "none" | "xs" | "sm" | "md" | "lg" | "xl" | "full";

export type ElevationStep = 0 | 1 | 2 | 3 | 4 | 5;

export type BackgroundTone =
  | "transparent"
  | "surface"
  | "surface-container"
  | "surface-container-low"
  | "surface-container-high"
  | "surface-container-highest"
  | "primary-container"
  | "secondary-container"
  | "tertiary-container"
  | "inverse-surface";

export type BorderTone = "none" | "outline" | "outline-variant";

export type AlignItems = "stretch" | "start" | "center" | "end" | "baseline";

export type JustifyContent =
  | "start"
  | "center"
  | "end"
  | "between"
  | "around"
  | "evenly";
