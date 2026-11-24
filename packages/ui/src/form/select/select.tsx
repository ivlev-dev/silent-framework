import type { Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import { Show } from "@ivlev-dev/silent-core";
import type { Attrs } from "../../internal/props.js";
import { Field } from "../field/field.js";
import {
  NO_WRITE,
  type BoundField,
  type ControlSize,
  describedBy,
  errorIdFor,
  hasContent,
  hintIdFor,
  resolveControlId,
} from "../internal/control.js";

export interface SelectOption {
  readonly value: string | number;
  readonly label: Children;
  readonly disabled?: boolean | undefined;
}

export interface SelectProps {
  readonly options: readonly SelectOption[];
  readonly value?:
    | string
    | number
    | readonly (string | number)[]
    | undefined;
  readonly field?:
    | BoundField<string | number | readonly string[]>
    | undefined;
  readonly label?: Children;
  readonly hint?: Children;
  readonly error?: Children;
  readonly placeholder?: string | undefined;
  readonly multiple?: boolean | undefined;
  readonly name?: string | undefined;
  readonly id?: string | undefined;
  readonly required?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly size?: ControlSize | undefined;
  readonly bare?: boolean | undefined;
  readonly describedBy?: string | undefined;
  readonly onChange?: ((event: Event) => void) | undefined;
  readonly onBlur?: ((event: FocusEvent) => void) | undefined;
  readonly onFocus?: ((event: FocusEvent) => void) | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
}

function optionValue(option: SelectOption): string {
  return String(option.value);
}

/**
 * Список. На SSR у выбранных `option` стоит `selected`, на клиенте значение
 * синхронизирует `bindValue` (включая `multiple`).
 */
export function Select(props: SelectProps): Node {
  const id = resolveControlId(
    props.id ?? props.field?.id,
    props.name ?? props.field?.name,
    "select",
  );
  const currentValue = (): unknown =>
    props.value !== undefined ? props.value : props.field?.value;
  const selectedValues = (): readonly string[] => {
    const value = currentValue();
    if (Array.isArray(value)) return value.map((item) => String(item));
    if (value === undefined || value === null || value === "") return [];
    return [String(value)];
  };
  const readValue = (): unknown => {
    const value = currentValue();
    if (Array.isArray(value)) return value.map((item) => String(item));
    if (value === undefined || value === null) return "";
    return String(value);
  };
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
  /** Полный текст выбранного варианта — в `title` для обрезанного значения. */
  const selectedLabel = (): string | undefined => {
    if (props.multiple === true) return undefined;
    const value = currentValue();
    if (value === undefined || value === null || value === "") return undefined;
    const selected = props.options.find(
      (option) => optionValue(option) === String(value),
    );
    return typeof selected?.label === "string" ? selected.label : undefined;
  };
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
        class="sui-select"
        data-size={props.size ?? "md"}
        data-invalid={invalidOf() ? "" : undefined}
        data-disabled={props.disabled === true ? "" : undefined}
        data-validating={props.field?.isValidating === true ? "" : undefined}
        data-multiple={props.multiple === true ? "" : undefined}
        data-bare={props.bare === true ? "" : undefined}
      >
        <select
          id={id}
          class="sui-select__input"
          name={nameOf()}
          title={selectedLabel()}
          multiple={props.multiple === true}
          disabled={props.disabled === true}
          required={requiredOf()}
          aria-required={requiredOf() ? "true" : undefined}
          aria-invalid={invalidOf() ? "true" : undefined}
          aria-busy={props.field?.isValidating === true ? "true" : undefined}
          aria-describedby={described()}
          bindValue={[readValue, NO_WRITE]}
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
        >
          <Show when={props.multiple !== true && props.placeholder !== undefined}>
            <option
              value=""
              disabled={requiredOf()}
              selected={selectedValues().length === 0}
            >
              {props.placeholder}
            </option>
          </Show>
          {props.options.map((option) => (
            <option
              value={optionValue(option)}
              disabled={option.disabled === true}
              selected={selectedValues().includes(optionValue(option))}
            >
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </Field>
  );
}
