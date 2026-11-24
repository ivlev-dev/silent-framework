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

export interface SliderProps {
  readonly min?: number | undefined;
  readonly max?: number | undefined;
  readonly step?: number | undefined;
  readonly value?: number | undefined;
  readonly field?: BoundField<number> | undefined;
  readonly label?: Children;
  readonly hint?: Children;
  readonly error?: Children;
  readonly unit?: string | undefined;
  /** Человекочитаемое значение для `aria-valuetext` и `<output>`. */
  readonly formatValue?: ((value: number) => string) | undefined;
  /** Показывать `<output>` со значением (по умолчанию да). */
  readonly output?: boolean | undefined;
  readonly name?: string | undefined;
  readonly id?: string | undefined;
  readonly required?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly describedBy?: string | undefined;
  readonly onInput?: ((event: InputEvent) => void) | undefined;
  readonly onChange?: ((event: Event) => void) | undefined;
  readonly onBlur?: ((event: FocusEvent) => void) | undefined;
  readonly onFocus?: ((event: FocusEvent) => void) | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
}

/** Ползунок: `range` + `<output>`, значение синхронизируется через `bindValue`. */
export function Slider(props: SliderProps): Node {
  const id = resolveControlId(
    props.id ?? props.field?.id,
    props.name ?? props.field?.name,
    "slider",
  );
  const minOf = (): number => props.min ?? 0;
  const maxOf = (): number => props.max ?? 100;
  const valueOf = (): number => {
    if (props.value !== undefined) return props.value;
    const value = props.field?.value;
    return typeof value === "number" && Number.isFinite(value)
      ? value
      : minOf();
  };
  const readValue = (): number => valueOf();
  const textOf = (): string => {
    if (props.formatValue !== undefined) return props.formatValue(valueOf());
    return `${valueOf()}${props.unit ?? ""}`;
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
      class={props.class}
      style={props.style}
      attrs={props.attrs}
    >
      <div
        class="sui-slider"
        data-invalid={invalidOf() ? "" : undefined}
        data-disabled={props.disabled === true ? "" : undefined}
        data-validating={props.field?.isValidating === true ? "" : undefined}
      >
        <input
          id={id}
          class="sui-slider__input"
          type="range"
          name={nameOf()}
          min={minOf()}
          max={maxOf()}
          step={props.step ?? 1}
          disabled={props.disabled === true}
          required={requiredOf()}
          aria-required={requiredOf() ? "true" : undefined}
          aria-invalid={invalidOf() ? "true" : undefined}
          aria-valuetext={textOf()}
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
        <Show when={props.output !== false}>
          <output class="sui-slider__output" for={id}>
            {textOf()}
          </output>
        </Show>
      </div>
    </Field>
  );
}
