import type { ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import type { Attrs } from "../../internal/props.js";

export type BadgeVariant = "neutral" | "primary" | "accent" | "success" | "warning" | "error" | "info";

/** Позиция относительно ближайшего `position: relative` родителя. */
export type BadgePosition = "top-end" | "top-start" | "bottom-end" | "bottom-start";

export interface BadgeProps {
  /** Число в бейдже. Значения больше `max` сворачиваются в `max+`. */
  readonly count?: number | undefined;
  /** Порог свёртки, по умолчанию `99` → `99+`. */
  readonly max?: number | undefined;
  /** Точка-индикатор без текста. */
  readonly dot?: boolean | undefined;
  readonly variant?: BadgeVariant | undefined;
  /** Угол у родителя с `position: relative`; по умолчанию — inline. */
  readonly position?: BadgePosition | undefined;
  /** Доступное имя. Для точки обязательно, иначе бейдж декоративен. */
  readonly label?: string | undefined;
  /** Принудительно скрыть от скринридера. */
  readonly decorative?: boolean | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
  readonly ref?: ((node: Element | null) => void) | undefined;
}

function formatCount(count: number, max: number): string {
  const safe = Number.isFinite(count) ? Math.trunc(count) : 0;
  return safe > max ? `${max}+` : String(safe);
}

/**
 * Бейдж-счётчик или точка. Без `label` точка (и пустой бейдж) декоративны:
 * `aria-hidden="true"`, чтобы не плодить «немые» элементы в дереве.
 */
export function Badge(props: BadgeProps): Node {
  const max = props.max ?? 99;
  const dot = props.dot === true;
  const hasCount = typeof props.count === "number" && Number.isFinite(props.count);
  const text = dot || !hasCount ? undefined : formatCount(props.count as number, max);
  const hidden =
    props.decorative === true
    || (props.label === undefined && (dot || !hasCount));

  return (
    <span
      {...props.attrs}
      ref={props.ref}
      class={["sui-badge", props.class]}
      style={props.style}
      data-variant={props.variant ?? "neutral"}
      data-dot={dot ? "" : undefined}
      data-position={props.position}
      role={!hidden && props.label !== undefined ? "status" : undefined}
      aria-label={hidden ? undefined : props.label}
      aria-hidden={hidden ? "true" : undefined}
    >
      {text}
    </span>
  );
}
