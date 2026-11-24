import type { Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import { Show } from "@ivlev-dev/silent-core";
import type { Attrs } from "../../internal/props.js";
import { Field } from "../field/field.js";
import {
  NO_WRITE,
  type BoundField,
  describedBy,
  errorIdFor,
  hasContent,
  hintIdFor,
  resolveControlId,
} from "../internal/control.js";

export type TextareaResize = "none" | "vertical" | "horizontal" | "both";

export interface TextareaProps {
  readonly value?: string | number | undefined;
  readonly field?: BoundField<string | number> | undefined;
  readonly label?: Children;
  readonly hint?: Children;
  readonly error?: Children;
  readonly placeholder?: string | undefined;
  readonly name?: string | undefined;
  readonly id?: string | undefined;
  readonly rows?: number | undefined;
  readonly resize?: TextareaResize | undefined;
  /** Показывать счётчик символов (и предел `maxLength`). */
  readonly counter?: boolean | undefined;
  readonly maxLength?: number | undefined;
  readonly required?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly readOnly?: boolean | undefined;
  readonly bare?: boolean | undefined;
  readonly describedBy?: string | undefined;
  readonly onInput?: ((event: InputEvent) => void) | undefined;
  readonly onChange?: ((event: Event) => void) | undefined;
  readonly onBlur?: ((event: FocusEvent) => void) | undefined;
  readonly onFocus?: ((event: FocusEvent) => void) | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
}

/**
 * Многострочное поле. Авто-высоты нет: `rows` фиксирует высоту одинаково
 * на сервере и клиенте, поэтому гидрация не «прыгает».
 */
export function Textarea(props: TextareaProps): Node {
  const id = resolveControlId(
    props.id ?? props.field?.id,
    props.name ?? props.field?.name,
    "textarea",
  );
  const currentValue = (): string | number => {
    if (props.value !== undefined) return props.value;
    const value = props.field?.value;
    return value === undefined ? "" : value;
  };
  const readValue = (): unknown => currentValue();
  const text = (): string => String(currentValue());
  const labelOf = (): Children =>
    props.label !== undefined ? props.label : props.field?.label;
  const hintOf = (): Children =>
    props.hint !== undefined ? props.hint : props.field?.hint;
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
      hasContent(hintOf()) ? hintIdFor(id) : undefined,
      hasContent(errorOf()) ? errorIdFor(id) : undefined,
    );
  return (
    <Field
      id={id}
      htmlFor={id}
      label={labelOf()}
      hint={hintOf()}
      error={errorOf()}
      required={requiredOf()}
      invalid={invalidOf()}
      touched={props.field?.touched === true}
      disabled={props.disabled === true}
      validating={props.field?.isValidating === true}
      bare={props.bare === true}
      class={props.class}
      style={props.style}
      attrs={props.attrs}
    >
      <div
        class="sui-textarea"
        data-invalid={invalidOf() ? "" : undefined}
        data-disabled={props.disabled === true ? "" : undefined}
        data-readonly={props.readOnly === true ? "" : undefined}
        data-validating={props.field?.isValidating === true ? "" : undefined}
        data-bare={props.bare === true ? "" : undefined}
        data-resize={props.resize ?? "vertical"}
      >
        <textarea
          id={id}
          class="sui-textarea__input"
          name={nameOf()}
          rows={props.rows ?? 3}
          placeholder={props.placeholder ?? ""}
          maxLength={props.maxLength}
          disabled={props.disabled === true}
          readOnly={props.readOnly === true}
          required={requiredOf()}
          aria-required={requiredOf() ? "true" : undefined}
          aria-invalid={invalidOf() ? "true" : undefined}
          aria-busy={props.field?.isValidating === true ? "true" : undefined}
          aria-describedby={described()}
          bindValue={[readValue, NO_WRITE]}
          onInput={(event) => {
            props.field?.onInput(event);
            props.onInput?.(event);
          }}
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
        <Show when={props.counter === true}>
          <span class="sui-textarea__counter" aria-hidden="true">
            {props.maxLength === undefined
              ? text().length
              : `${text().length}/${props.maxLength}`}
          </span>
        </Show>
      </div>
    </Field>
  );
}
