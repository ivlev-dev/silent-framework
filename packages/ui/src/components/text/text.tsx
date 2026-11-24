import type { Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import type { Attrs } from "../../internal/props.js";

/** Вариант типографики: совпадает с `typeScale` из токенов. */
export type TextVariant =
  | "body-large"
  | "body-medium"
  | "body-small"
  | "title-medium"
  | "title-small"
  | "label-large"
  | "label-medium"
  | "label-small";

export type TextTone =
  | "default"
  | "muted"
  | "primary"
  | "secondary"
  | "error"
  | "success"
  | "warning"
  | "inherit";

export type TextAlign = "start" | "center" | "end";
export type TextClamp = 1 | 2 | 3 | 4;

export interface TextProps {
  readonly variant?: TextVariant | undefined;
  readonly tone?: TextTone | undefined;
  readonly align?: TextAlign | undefined;
  /** Обрезка по строкам (`-webkit-line-clamp`). */
  readonly clamp?: TextClamp | undefined;
  /** Одна строка с многоточием (`.sui-truncate`). */
  readonly truncate?: boolean | undefined;
  /** Ограничить меру строки для чтения (`.sui-measure`, 68ch). */
  readonly measure?: boolean | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
  readonly children?: Children;
}

/** Текст: семантический `<span>`, размер/тон/выравнивание — через `data-*`. */
export function Text(props: TextProps): Node {
  return (
    <span
      {...props.attrs}
      class={[
        "sui-text",
        {
          "sui-truncate": props.truncate === true,
          "sui-measure": props.measure === true,
        },
        props.class,
      ]}
      style={props.style}
      data-variant={props.variant ?? "body-medium"}
      data-tone={props.tone ?? "default"}
      data-align={props.align ?? "start"}
      data-clamp={props.clamp}
      data-truncate={props.truncate === true ? "" : undefined}
      data-measure={props.measure === true ? "" : undefined}
    >
      {props.children}
    </span>
  );
}
