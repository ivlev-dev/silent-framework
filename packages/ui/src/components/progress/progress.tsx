import type { ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import { Show } from "@ivlev-dev/silent-core";
import type { Attrs } from "../../internal/props.js";
import { useUiConfig } from "../../theme/config.js";

export type ProgressVariant = "linear" | "circular";
export type ProgressSize = "sm" | "md" | "lg";

export interface ProgressProps {
  readonly variant?: ProgressVariant | undefined;
  /** `0..100`. Без значения (или `NaN`) индикатор неопределённый. */
  readonly value?: number | undefined;
  /** Подпись: видимая и доступная (`aria-label`). */
  readonly label?: string | undefined;
  /** Показать процент рядом с подписью (только для определённого значения). */
  readonly showValue?: boolean | undefined;
  readonly size?: ProgressSize | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
  readonly ref?: ((node: Element | null) => void) | undefined;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/**
 * Индикатор выполнения. `value` вне `0..100` зажимается, отсутствие значения
 * включает indeterminate-режим (без `aria-valuenow`, с анимацией).
 */
export function Progress(props: ProgressProps): Node {
  const config = useUiConfig();
  const variant = props.variant ?? "linear";
  const size = props.size ?? "md";
  const determinate = typeof props.value === "number" && Number.isFinite(props.value);
  const percent = determinate ? clampPercent(props.value as number) : 0;
  const rounded = Math.round(percent);
  const visibleValue = props.showValue === true && determinate ? `${rounded}%` : undefined;
  const accessibleLabel = props.label ?? config.strings.loading;

  return (
    <div
      {...props.attrs}
      ref={props.ref}
      class={["sui-progress", props.class]}
      style={props.style}
      role="progressbar"
      data-variant={variant}
      data-size={size}
      data-indeterminate={determinate ? undefined : ""}
      aria-label={accessibleLabel}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={determinate ? rounded : undefined}
      aria-valuetext={visibleValue ?? props.label}
    >
      <Show when={props.label !== undefined || visibleValue !== undefined}>
        <div class="sui-progress__header">
          <Show when={props.label !== undefined}>
            <span class="sui-progress__label">{props.label}</span>
          </Show>
          <Show when={visibleValue !== undefined}>
            <span class="sui-progress__value">{visibleValue}</span>
          </Show>
        </div>
      </Show>
      <Show
        when={variant === "linear"}
        fallback={
          <svg
            class="sui-progress__ring"
            viewBox="0 0 36 36"
            aria-hidden="true"
            focusable="false"
          >
            <circle
              class="sui-progress__circle-track"
              cx="18"
              cy="18"
              r="15.9155"
              fill="none"
              pathLength="100"
            />
            <circle
              class="sui-progress__circle-value"
              cx="18"
              cy="18"
              r="15.9155"
              fill="none"
              pathLength="100"
              stroke-dasharray="100"
              stroke-dashoffset={determinate ? 100 - percent : undefined}
            />
          </svg>
        }
      >
        <span class="sui-progress__track">
          <span
            class="sui-progress__bar"
            style={determinate ? { width: `${percent}%` } : undefined}
          />
        </span>
      </Show>
    </div>
  );
}
