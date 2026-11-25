import type { Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import { Show } from "@ivlev-dev/silent-core";
import type { Attrs } from "../../internal/props.js";
import { Spinner } from "../../components/spinner/spinner.js";
import {
  NO_WRITE,
  type BoundField,
  type ControlSize,
  describedBy,
  descriptionIdFor,
  errorIdFor,
  hasContent,
  hintIdFor,
  resolveControlId,
} from "../internal/control.js";

export type SwitchVariant = "switch" | "toggler";
export type SwitchLabelPosition = "start" | "end";

export interface SwitchProps {
  readonly checked?: boolean | undefined;
  readonly field?: BoundField<boolean> | undefined;
  readonly label?: Children;
  readonly description?: Children;
  readonly hint?: Children;
  readonly error?: Children;
  /** Ошибка без текста: контрол невалиден, сообщения ещё нет. */
  readonly invalid?: boolean | undefined;
  /** `switch` — трек + подпись рядом; `toggler` — подпись внутри трека. */
  readonly variant?: SwitchVariant | undefined;
  /** Положение подписи относительно трека (вариант `switch`). */
  readonly labelPosition?: SwitchLabelPosition | undefined;
  readonly name?: string | undefined;
  readonly id?: string | undefined;
  readonly required?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly readOnly?: boolean | undefined;
  /** Ожидание: input заблокирован, в бегунке спиннер, `aria-busy`. */
  readonly loading?: boolean | undefined;
  /** Иконка в бегунке независимо от состояния. */
  readonly icon?: Children;
  /** Иконка в бегунке во включённом состоянии (сильнее `icon`). */
  readonly onIcon?: Children;
  /** Иконка в бегунке в выключенном состоянии (сильнее `icon`). */
  readonly offIcon?: Children;
  /** Размер трека: `sm` компактный, `md` базовый, `lg` крупный. */
  readonly size?: ControlSize | undefined;
  readonly describedBy?: string | undefined;
  /** Уведомление о новом значении (после `field.onChange`). */
  readonly onValueChange?: ((checked: boolean) => void) | undefined;
  readonly onChange?: ((event: Event) => void) | undefined;
  readonly onBlur?: ((event: FocusEvent) => void) | undefined;
  readonly onFocus?: ((event: FocusEvent) => void) | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
}

/**
 * Переключатель: нативный `input[type=checkbox]` с `role="switch"`.
 * Space и фокус работают штатно, `aria-checked` выводится из `checked`.
 */
export function Switch(props: SwitchProps): Node {
  const id = resolveControlId(
    props.id ?? props.field?.id,
    props.name ?? props.field?.name,
    "switch",
  );
  const checkedOf = (): boolean =>
    props.checked !== undefined
      ? props.checked
      : props.field?.value === true;
  const readChecked = (): boolean => checkedOf();
  const labelOf = (): Children =>
    props.label !== undefined ? props.label : props.field?.label;
  const descriptionOf = (): Children =>
    props.description !== undefined ? props.description : props.field?.hint;
  const hintOf = (): Children =>
    props.hint !== undefined ? props.hint : undefined;
  const errorOf = (): Children =>
    props.error !== undefined ? props.error : props.field?.error;
  const nameOf = (): string => props.name ?? props.field?.name ?? id;
  const requiredOf = (): boolean =>
    props.required !== undefined
      ? props.required
      : props.field?.isRequired === true;
  const invalidOf = (): boolean =>
    props.invalid === true || hasContent(errorOf());
  const variantOf = (): SwitchVariant => props.variant ?? "switch";
  const loadingOf = (): boolean => props.loading === true;
  const disabledOf = (): boolean =>
    props.disabled === true || loadingOf();
  const busyOf = (): boolean =>
    loadingOf() || props.field?.isValidating === true;
  const iconOf = (): Children => {
    if (checkedOf()) {
      return props.onIcon !== undefined ? props.onIcon : props.icon;
    }
    return props.offIcon !== undefined ? props.offIcon : props.icon;
  };
  const described = (): string | undefined =>
    describedBy(
      props.describedBy,
      hasContent(descriptionOf()) ? descriptionIdFor(id) : undefined,
      hasContent(hintOf()) ? hintIdFor(id) : undefined,
      hasContent(errorOf()) ? errorIdFor(id) : undefined,
    );
  return (
    <div
      {...props.attrs}
      class={["sui-switch", props.class]}
      style={props.style}
      data-size={props.size ?? "md"}
      data-variant={variantOf()}
      data-label-position={props.labelPosition ?? "end"}
      data-checked={checkedOf() ? "" : undefined}
      data-loading={loadingOf() ? "" : undefined}
      data-invalid={invalidOf() ? "" : undefined}
      data-disabled={props.disabled === true ? "" : undefined}
      data-readonly={props.readOnly === true ? "" : undefined}
      data-validating={props.field?.isValidating === true ? "" : undefined}
      data-touched={props.field?.touched === true ? "" : undefined}
    >
      <label class="sui-switch__row" for={id}>
        <span class="sui-switch__control">
          <input
            id={id}
            class="sui-switch__input"
            type="checkbox"
            role="switch"
            name={nameOf()}
            disabled={disabledOf()}
            required={requiredOf()}
            aria-required={requiredOf() ? "true" : undefined}
            aria-invalid={invalidOf() ? "true" : undefined}
            aria-checked={checkedOf() ? "true" : "false"}
            aria-readonly={props.readOnly === true ? "true" : undefined}
            aria-busy={busyOf() ? "true" : undefined}
            aria-describedby={described()}
            bindChecked={[readChecked, NO_WRITE]}
            onClick={(event) => {
              if (props.readOnly === true || loadingOf()) event.preventDefault();
            }}
            onChange={(event) => {
              if (props.readOnly === true || loadingOf()) {
                event.preventDefault();
                return;
              }
              const target = event.target;
              const next =
                target instanceof HTMLInputElement
                  ? target.checked
                  : !checkedOf();
              props.field?.onChange(event);
              props.onChange?.(event);
              props.onValueChange?.(next);
            }}
            onBlur={(event) => {
              props.field?.onBlur(event);
              props.onBlur?.(event);
            }}
            onFocus={(event) => {
              props.field?.onFocus(event);
              props.onFocus?.(event);
            }}
          />
          <span class="sui-switch__track">
            <span class="sui-switch__thumb">
              <Show when={loadingOf()}>
                <Spinner size="sm" class="sui-switch__spinner" />
              </Show>
              <Show when={!loadingOf() && hasContent(iconOf())}>
                <span class="sui-switch__icon" aria-hidden="true">
                  {iconOf()}
                </span>
              </Show>
            </span>
            <Show when={variantOf() === "toggler" && hasContent(labelOf())}>
              <span class="sui-switch__track-label">{labelOf()}</span>
            </Show>
          </span>
        </span>
        <Show when={variantOf() === "switch" && hasContent(labelOf())}>
          <span class="sui-switch__label">{labelOf()}</span>
        </Show>
      </label>
      <Show when={hasContent(descriptionOf())}>
        <span class="sui-switch__description" id={descriptionIdFor(id)}>
          {descriptionOf()}
        </span>
      </Show>
      <Show when={hasContent(hintOf())}>
        <span class="sui-switch__hint" id={hintIdFor(id)}>
          {hintOf()}
        </span>
      </Show>
      <Show when={hasContent(errorOf())}>
        <span class="sui-switch__error" id={errorIdFor(id)}>
          {errorOf()}
        </span>
      </Show>
    </div>
  );
}
