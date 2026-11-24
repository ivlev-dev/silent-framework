import type { Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import { Show } from "@ivlev-dev/silent-core";
import type { Attrs } from "../../internal/props.js";
import { Button } from "../../components/button/button.js";
import { useUiConfig } from "../../theme/config.js";
import { hasContent } from "../internal/control.js";

export type FieldGroupLayout = "stack" | "inline";

export interface FieldGroupProps {
  readonly legend?: Children;
  readonly hint?: Children;
  readonly layout?: FieldGroupLayout | undefined;
  /**
   * Сетка внутри группы: `1` — одна колонка, `2`/`3` — 1 колонка на мобильном,
   * 2 на ≥600px и 3 на ≥840px, `auto` — auto-fit по минимальной ширине.
   * Без значения группа остаётся стеком/строкой (`layout`).
   */
  readonly columns?: 1 | 2 | 3 | "auto" | undefined;
  /** Ограничение ширины формы: удобная мера строки на широких экранах. */
  readonly maxWidth?: "none" | "narrow" | "default" | undefined;
  readonly disabled?: boolean | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
  readonly children?: Children;
}

/** Группа полей: `fieldset`/`legend`, общая подсказка и блокировка. */
export function FieldGroup(props: FieldGroupProps): Node {
  return (
    <fieldset
      {...props.attrs}
      class={["sui-field-group", props.class]}
      style={props.style}
      data-layout={props.layout ?? "stack"}
      data-columns={props.columns === undefined ? undefined : String(props.columns)}
      data-max-width={props.maxWidth}
      data-disabled={props.disabled === true ? "" : undefined}
      disabled={props.disabled === true}
    >
      <Show when={hasContent(props.legend)}>
        <legend class="sui-field-group__legend">{props.legend}</legend>
      </Show>
      <Show when={hasContent(props.hint)}>
        <span class="sui-field-group__hint">{props.hint}</span>
      </Show>
      <div class="sui-field-group__body">{props.children}</div>
    </fieldset>
  );
}

export type FormActionsAlign = "start" | "end" | "between";

export interface FormActionsProps {
  /** Свой набор действий: заменяет кнопки submit/reset. */
  readonly actions?: Children;
  readonly submitLabel?: string | undefined;
  readonly resetLabel?: string | undefined;
  readonly submit?: boolean | undefined;
  readonly reset?: boolean | undefined;
  readonly loading?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly align?: FormActionsAlign | undefined;
  /** Прижать подвал к нижней кромке скроллящегося диалога/страницы. */
  readonly sticky?: boolean | undefined;
  readonly onSubmit?: ((event: MouseEvent) => void) | undefined;
  readonly onReset?: ((event: MouseEvent) => void) | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
  /** Дополнительные действия после основных. */
  readonly children?: Children;
}

/**
 * Подвал формы: submit/reset или свой `actions`-слот.
 * `loading` блокирует оба действия (`Button` ставит `aria-busy`).
 */
export function FormActions(props: FormActionsProps): Node {
  const config = useUiConfig();
  const busy = (): boolean => props.disabled === true || props.loading === true;
  const hasActions = (): boolean => hasContent(props.actions);
  return (
    <div
      {...props.attrs}
      class={["sui-form-actions", props.class]}
      style={props.style}
      data-align={props.align ?? "end"}
      data-sticky={props.sticky === true ? "" : undefined}
      role="group"
    >
      <Show when={hasActions()}>
        <div class="sui-form-actions__slot">{props.actions}</div>
      </Show>
      <Show when={!hasActions() && props.reset !== false}>
        <Button
          type="reset"
          variant="text"
          disabled={busy()}
          onClick={(event) => {
            props.onReset?.(event);
          }}
        >
          {props.resetLabel ?? config.strings.reset}
        </Button>
      </Show>
      <Show when={!hasActions() && props.submit !== false}>
        <Button
          type="submit"
          variant="filled"
          loading={props.loading === true}
          disabled={props.disabled === true}
          onClick={(event) => {
            props.onSubmit?.(event);
          }}
        >
          {props.submitLabel ?? config.strings.submit}
        </Button>
      </Show>
      <>{props.children}</>
    </div>
  );
}
