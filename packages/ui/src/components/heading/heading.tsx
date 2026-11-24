import type { Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import type { Attrs } from "../../internal/props.js";

/** Допустимые уровни заголовка: тег выбирается статически, без `as`. */
export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export type HeadingVariant =
  | "display-large"
  | "display-medium"
  | "display-small"
  | "headline-large"
  | "headline-medium"
  | "headline-small"
  | "title-large"
  | "title-medium"
  | "title-small";

export type HeadingTone = "default" | "muted" | "primary" | "inherit";

export interface HeadingProps {
  readonly level?: HeadingLevel | undefined;
  readonly variant?: HeadingVariant | undefined;
  readonly tone?: HeadingTone | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
  readonly children?: Children;
}

const DEFAULT_VARIANT: Readonly<Record<HeadingLevel, HeadingVariant>> = {
  1: "display-medium",
  2: "headline-large",
  3: "headline-medium",
  4: "title-large",
  5: "title-medium",
  6: "title-small",
};

/**
 * Заголовок. Уровень задаёт и тег, и вариант по умолчанию; вариант можно
 * переопределить, не ломая структуру документа.
 */
export function Heading(props: HeadingProps): Node {
  const level = props.level ?? 2;
  const variant = props.variant ?? DEFAULT_VARIANT[level];
  const tone = props.tone ?? "default";

  if (level === 1) {
    return (
      <h1 {...props.attrs} class={["sui-heading", props.class]} style={props.style} data-level="1" data-variant={variant} data-tone={tone}>
        {props.children}
      </h1>
    );
  }
  if (level === 3) {
    return (
      <h3 {...props.attrs} class={["sui-heading", props.class]} style={props.style} data-level="3" data-variant={variant} data-tone={tone}>
        {props.children}
      </h3>
    );
  }
  if (level === 4) {
    return (
      <h4 {...props.attrs} class={["sui-heading", props.class]} style={props.style} data-level="4" data-variant={variant} data-tone={tone}>
        {props.children}
      </h4>
    );
  }
  if (level === 5) {
    return (
      <h5 {...props.attrs} class={["sui-heading", props.class]} style={props.style} data-level="5" data-variant={variant} data-tone={tone}>
        {props.children}
      </h5>
    );
  }
  if (level === 6) {
    return (
      <h6 {...props.attrs} class={["sui-heading", props.class]} style={props.style} data-level="6" data-variant={variant} data-tone={tone}>
        {props.children}
      </h6>
    );
  }
  return (
    <h2 {...props.attrs} class={["sui-heading", props.class]} style={props.style} data-level="2" data-variant={variant} data-tone={tone}>
      {props.children}
    </h2>
  );
}
