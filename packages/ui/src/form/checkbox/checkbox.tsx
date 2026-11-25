import type { Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import { Show } from "@ivlev-dev/silent-core";
import type { Attrs } from "../../internal/props.js";
import {
  NO_WRITE,
  type BoundField,
  type ChoiceVariant,
  type ControlSize,
  describedBy,
  descriptionIdFor,
  errorIdFor,
  hasContent,
  hintIdFor,
  resolveControlId,
} from "../internal/control.js";

export type CheckboxVariant = ChoiceVariant;
export type CheckboxSize = ControlSize;

export interface CheckboxProps {
  readonly checked?: boolean | undefined;
  readonly field?: BoundField<boolean> | undefined;
  readonly label?: Children;
  readonly description?: Children;
  readonly hint?: Children;
  readonly error?: Children;
  /** Значение для отправки формы и групп чекбоксов. */
  readonly value?: string | number | undefined;
  readonly indeterminate?: boolean | undefined;
  readonly name?: string | undefined;
  readonly id?: string | undefined;
  readonly required?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly readOnly?: boolean | undefined;
  /** Оформление: обычная строка, кликабельная карточка или плитка. */
  readonly variant?: CheckboxVariant | undefined;
  /** Размер квадрата и текста: `sm` компактный, `md` базовый, `lg` крупный. */
  readonly size?: CheckboxSize | undefined;
  /** Декоративная иконка рядом с подписью или в карточке. */
  readonly icon?: Children;
  /** Ошибка без текста: контрол невалиден, сообщения ещё нет. */
  readonly invalid?: boolean | undefined;
  readonly describedBy?: string | undefined;
  readonly onChange?: ((event: Event) => void) | undefined;
  readonly onBlur?: ((event: FocusEvent) => void) | undefined;
  readonly onFocus?: ((event: FocusEvent) => void) | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
}

interface CheckboxInputProps {
  readonly id: string;
  readonly name: string;
  readonly value?: string | number | undefined;
  readonly checked: boolean;
  readonly indeterminate: boolean;
  readonly disabled: boolean;
  readonly required: boolean;
  readonly readOnly: boolean;
  readonly invalid: boolean;
  readonly busy: boolean;
  readonly describedBy: string | undefined;
  readonly onChange: ((event: Event) => void) | undefined;
  readonly onBlur: ((event: FocusEvent) => void) | undefined;
  readonly onFocus: ((event: FocusEvent) => void) | undefined;
}

/** Нативный input: единая разметка для строки, карточки и группы. */
function CheckboxInput(props: CheckboxInputProps): Node {
  const readChecked = (): boolean | "mixed" =>
    props.indeterminate ? "mixed" : props.checked;
  return (
    <input
      id={props.id}
      class="sui-checkbox__input"
      type="checkbox"
      name={props.name}
      value={props.value === undefined ? undefined : String(props.value)}
      disabled={props.disabled}
      required={props.required}
      aria-required={props.required ? "true" : undefined}
      aria-invalid={props.invalid ? "true" : undefined}
      aria-checked={
        props.indeterminate ? "mixed" : props.checked ? "true" : "false"
      }
      aria-readonly={props.readOnly ? "true" : undefined}
      aria-busy={props.busy ? "true" : undefined}
      aria-describedby={props.describedBy}
      bindChecked={[readChecked, NO_WRITE]}
      onChange={(event) => {
        if (props.readOnly) {
          event.preventDefault();
          return;
        }
        props.onChange?.(event);
      }}
      onBlur={(event) => props.onBlur?.(event)}
      onFocus={(event) => props.onFocus?.(event)}
    />
  );
}

/** Чекбокс с необязательным `indeterminate`, описанием и связкой с `field`. */
export function Checkbox(props: CheckboxProps): Node {
  const id = resolveControlId(
    props.id ?? props.field?.id,
    props.name ?? props.field?.name,
    "checkbox",
  );
  const checkedOf = (): boolean =>
    props.checked !== undefined
      ? props.checked
      : props.field?.value === true;
  const indeterminateOf = (): boolean => props.indeterminate === true;
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
  const variantOf = (): CheckboxVariant => props.variant ?? "default";
  const sizeOf = (): CheckboxSize => props.size ?? "md";
  const isBoxed = (): boolean => variantOf() !== "default";
  const busyOf = (): boolean => props.field?.isValidating === true;
  const described = (): string | undefined =>
    describedBy(
      props.describedBy,
      hasContent(descriptionOf()) ? descriptionIdFor(id) : undefined,
      hasContent(hintOf()) ? hintIdFor(id) : undefined,
      hasContent(errorOf()) ? errorIdFor(id) : undefined,
    );

  function CheckboxInputBound(): Node {
    return (
      <CheckboxInput
        id={id}
        name={nameOf()}
        value={props.value}
        checked={checkedOf()}
        indeterminate={indeterminateOf()}
        disabled={props.disabled === true}
        required={requiredOf()}
        readOnly={props.readOnly === true}
        invalid={invalidOf()}
        busy={busyOf()}
        describedBy={described()}
        onChange={(event) => {
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
    );
  }

  return (
    <div
      {...props.attrs}
      class={["sui-checkbox", props.class]}
      style={props.style}
      data-variant={variantOf()}
      data-size={sizeOf()}
      data-checked={checkedOf() ? "" : undefined}
      data-indeterminate={indeterminateOf() ? "" : undefined}
      data-invalid={invalidOf() ? "" : undefined}
      data-disabled={props.disabled === true ? "" : undefined}
      data-readonly={props.readOnly === true ? "" : undefined}
      data-validating={busyOf() ? "" : undefined}
      data-touched={props.field?.touched === true ? "" : undefined}
    >
      <Show
        when={isBoxed()}
        fallback={
          <label class="sui-checkbox__row" for={id}>
            <span class="sui-checkbox__control">
              <CheckboxInputBound />
              <span class="sui-checkbox__box" aria-hidden="true" />
            </span>
            <Show when={hasContent(props.icon)}>
              <span class="sui-checkbox__icon" aria-hidden="true">
                {props.icon}
              </span>
            </Show>
            <Show when={hasContent(labelOf())}>
              <span class="sui-checkbox__label">{labelOf()}</span>
            </Show>
          </label>
        }
      >
        <label class="sui-checkbox__card" for={id}>
          <CheckboxInputBound />
          <span class="sui-checkbox__box" aria-hidden="true" />
          <Show when={hasContent(props.icon)}>
            <span class="sui-checkbox__icon" aria-hidden="true">
              {props.icon}
            </span>
          </Show>
          <span class="sui-checkbox__text">
            <Show when={hasContent(labelOf())}>
              <span class="sui-checkbox__label">{labelOf()}</span>
            </Show>
            <Show when={hasContent(descriptionOf())}>
              <span class="sui-checkbox__description" id={descriptionIdFor(id)}>
                {descriptionOf()}
              </span>
            </Show>
          </span>
        </label>
      </Show>
      <Show when={!isBoxed() && hasContent(descriptionOf())}>
        <span class="sui-checkbox__description" id={descriptionIdFor(id)}>
          {descriptionOf()}
        </span>
      </Show>
      <Show when={hasContent(hintOf())}>
        <span class="sui-checkbox__hint" id={hintIdFor(id)}>
          {hintOf()}
        </span>
      </Show>
      <Show when={hasContent(errorOf())}>
        <span class="sui-checkbox__error" id={errorIdFor(id)}>
          {errorOf()}
        </span>
      </Show>
    </div>
  );
}
