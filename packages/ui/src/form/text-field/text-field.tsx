import type { Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import { Show, createSignal } from "@ivlev-dev/silent-core";
import type { Attrs } from "../../internal/props.js";
import { Icon } from "../../components/icon/icon.js";
import { useUiConfig } from "../../theme/config.js";
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

export type TextFieldType =
  | "text"
  | "email"
  | "password"
  | "number"
  | "search"
  | "tel"
  | "url";

export interface TextFieldProps {
  readonly type?: TextFieldType | undefined;
  /** Явное значение; приоритетнее `field.value`. */
  readonly value?: string | number | undefined;
  /** Поле формы: источник значения, подписи, ошибки и событий. */
  readonly field?: BoundField<string | number> | undefined;
  readonly label?: Children;
  readonly hint?: Children;
  readonly error?: Children;
  readonly placeholder?: string | undefined;
  readonly name?: string | undefined;
  readonly id?: string | undefined;
  readonly required?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly readOnly?: boolean | undefined;
  readonly size?: ControlSize | undefined;
  readonly leading?: Children;
  readonly trailing?: Children;
  /** Без рамки контрола: для встраивания в свою оболочку. */
  readonly bare?: boolean | undefined;
  /** Кнопка «Показать/Скрыть пароль»; по умолчанию включена для `type=password`. */
  readonly passwordToggle?: boolean | undefined;
  /** Дополнительные id для `aria-describedby`. */
  readonly describedBy?: string | undefined;
  readonly onInput?: ((event: InputEvent) => void) | undefined;
  readonly onChange?: ((event: Event) => void) | undefined;
  readonly onBlur?: ((event: FocusEvent) => void) | undefined;
  readonly onFocus?: ((event: FocusEvent) => void) | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
}

const EYE_PATH =
  "M12 5c-5 0-9 3.6-10.5 7C3 15.4 7 19 12 19s9-3.6 10.5-7C21 8.6 17 5 12 5Zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm0-6.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z";
const EYE_OFF_PATH =
  "M3.3 2 2 3.3l3 3C3.4 7.6 2.3 9.2 1.5 11c1.5 3.4 5.5 7 10.5 7 1.9 0 3.7-.5 5.2-1.3l3.5 3.5 1.3-1.3L3.3 2Zm8.7 14c-3.8 0-6.9-2.4-8.4-5 .7-1.2 1.5-2.3 2.6-3.1l1.7 1.7a4 4 0 0 0 5.5 5.5l1.3 1.3c-.9.4-1.8.6-2.7.6Zm8.5-5c-.6-1.3-1.4-2.5-2.5-3.4l-1.5 1.5c.8.7 1.5 1.6 2 2.7-1.5 2.6-4.6 5-8.4 5-.4 0-.8 0-1.2-.1l-1.5 1.5c.9.2 1.8.3 2.7.3 5 0 9-3.6 10.5-7Z";
/**
 * Однострочное поле. `field` — источник значений и ошибок, явные пропсы —
 * overrides. Значение пишется в DOM через `bindValue`, поэтому программное
 * изменение формы не требует перерендера контрола.
 */
export function TextField(props: TextFieldProps): Node {
  const config = useUiConfig();
  const [shown, setShown] = createSignal(false);
  const id = resolveControlId(
    props.id ?? props.field?.id,
    props.name ?? props.field?.name,
    "text-field",
  );
  const currentValue = (): string | number => {
    if (props.value !== undefined) return props.value;
    const value = props.field?.value;
    return value === undefined ? "" : value;
  };
  const readValue = (): unknown => currentValue();
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
  const baseType = (): TextFieldType => props.type ?? "text";
  const passwordToggle = (): boolean =>
    baseType() === "password" && props.passwordToggle !== false;
  const inputType = (): string =>
    baseType() === "password" && shown() ? "text" : baseType();
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
        class="sui-text-field"
        data-size={props.size ?? "md"}
        data-disabled={props.disabled === true ? "" : undefined}
        data-invalid={invalidOf() ? "" : undefined}
        data-readonly={props.readOnly === true ? "" : undefined}
        data-validating={props.field?.isValidating === true ? "" : undefined}
        data-bare={props.bare === true ? "" : undefined}
        data-has-leading={hasContent(props.leading) ? "" : undefined}
        data-has-trailing={hasContent(props.trailing) ? "" : undefined}
      >
        <span class="sui-text-field__leading" aria-hidden="true">
          {props.leading}
        </span>
        <input
          id={id}
          class="sui-text-field__input"
          type={inputType()}
          name={nameOf()}
          placeholder={props.placeholder ?? ""}
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
        <span class="sui-text-field__trailing">
          <>{props.trailing}</>
          <Show when={passwordToggle()}>
            <button
              type="button"
              class="sui-text-field__password-toggle"
              aria-label={
                shown()
                  ? config.strings.hidePassword
                  : config.strings.showPassword
              }
              aria-pressed={shown() ? "true" : "false"}
              onClick={() => {
                setShown(!shown());
              }}
            >
              <Icon size="sm">
                <path d={shown() ? EYE_OFF_PATH : EYE_PATH} />
              </Icon>
            </button>
          </Show>
        </span>
      </div>
    </Field>
  );
}
