import type { Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import { Show } from "@ivlev-dev/silent-core";
import type { Attrs } from "../../internal/props.js";
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

export interface SwitchProps {
  readonly checked?: boolean | undefined;
  readonly field?: BoundField<boolean> | undefined;
  readonly label?: Children;
  readonly description?: Children;
  readonly hint?: Children;
  readonly error?: Children;
  readonly name?: string | undefined;
  readonly id?: string | undefined;
  readonly required?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly readOnly?: boolean | undefined;
  /** Размер трека: `sm` компактный, `md` базовый, `lg` крупный. */
  readonly size?: ControlSize | undefined;
  readonly describedBy?: string | undefined;
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
  const invalidOf = (): boolean => hasContent(errorOf());
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
      data-checked={checkedOf() ? "" : undefined}
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
            disabled={props.disabled === true}
            required={requiredOf()}
            aria-required={requiredOf() ? "true" : undefined}
            aria-invalid={invalidOf() ? "true" : undefined}
            aria-checked={checkedOf() ? "true" : "false"}
            aria-readonly={props.readOnly === true ? "true" : undefined}
            aria-busy={props.field?.isValidating === true ? "true" : undefined}
            aria-describedby={described()}
            bindChecked={[readChecked, NO_WRITE]}
            onClick={(event) => {
              if (props.readOnly === true) event.preventDefault();
            }}
            onChange={(event) => {
              if (props.readOnly === true) {
                event.preventDefault();
                return;
              }
              props.field?.onChange(event);
              props.onChange?.(event);
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
          <span class="sui-switch__track" aria-hidden="true">
            <span class="sui-switch__thumb" />
          </span>
        </span>
        <Show when={hasContent(labelOf())}>
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
