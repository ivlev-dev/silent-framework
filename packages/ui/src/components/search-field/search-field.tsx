import type { Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import { Show, createSignal } from "@ivlev-dev/silent-core";
import type { FieldProps as FormFieldProps } from "@ivlev-dev/silent-form";
import type { Attrs } from "../../internal/props.js";
import { CloseIcon } from "../../icons/close.js";
import { SearchIcon } from "../../icons/search.js";
import { useUiConfig } from "../../theme/config.js";
import { Field } from "../../form/field/field.js";
import {
  NO_WRITE,
  type ControlSize,
  describedBy,
  errorIdFor,
  hasContent,
  hintIdFor,
  resolveControlId,
} from "../../form/internal/control.js";

export interface SearchFieldProps {
  /** Управляемое значение. Без него поле работает как неуправляемое. */
  readonly value?: string | undefined;
  readonly onInput?: ((event: InputEvent) => void) | undefined;
  readonly onValueChange?: ((value: string) => void) | undefined;
  /** Enter в поле. Значение читается из DOM на момент нажатия. */
  readonly onSearch?: ((value: string) => void) | undefined;
  readonly onClear?: ((event: MouseEvent) => void) | undefined;
  /**
   * Поле формы. Только тип из `@ivlev-dev/silent-form`: связь значений,
   * подсказок и ошибок остаётся за контролом.
   */
  readonly field?: FormFieldProps<string> | undefined;
  readonly label?: Children;
  readonly hint?: Children;
  readonly error?: Children;
  readonly placeholder?: string | undefined;
  readonly name?: string | undefined;
  readonly id?: string | undefined;
  /** Доступное имя, если видимой подписи нет. */
  readonly ariaLabel?: string | undefined;
  readonly required?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly readOnly?: boolean | undefined;
  readonly size?: ControlSize | undefined;
  /** Компактная обёртка без внешних отступов. */
  readonly bare?: boolean | undefined;
  /** Переопределяет строку `clear` из `UiConfigProvider`. */
  readonly clearLabel?: string | undefined;
  /** Дополнительные id для `aria-describedby`. */
  readonly describedBy?: string | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
}

/**
 * SearchField: `input[type=search]`, иконка поиска, кнопка очистки с
 * RU-подписью (`Очистить`), Enter → `onSearch`. Дебаунса нет: политика
 * задержки — решение потребителя.
 */
export function SearchField(props: SearchFieldProps): Node {
  const config = useUiConfig();
  const [typed, setTyped] = createSignal("");
  const id = resolveControlId(
    props.id ?? props.field?.id,
    props.name ?? props.field?.name,
    "search-field",
  );

  const readValue = (): string => {
    if (props.value !== undefined) return props.value;
    if (props.field !== undefined) return props.field.value;
    return typed();
  };
  const labelOf = (): Children =>
    props.label !== undefined ? props.label : props.field?.label;
  const hintOf = (): Children =>
    props.hint !== undefined ? props.hint : props.field?.hint;
  const errorOf = (): Children =>
    props.error !== undefined ? props.error : props.field?.error;
  const nameOf = (): string => props.name ?? props.field?.name ?? id;
  const requiredOf = (): boolean =>
    props.required !== undefined ? props.required : props.field?.isRequired === true;
  const invalidOf = (): boolean => hasContent(errorOf());
  const disabled = (): boolean => props.disabled === true;
  const readOnly = (): boolean => props.readOnly === true;
  const described = (): string | undefined =>
    describedBy(
      props.describedBy,
      hasContent(hintOf()) ? hintIdFor(id) : undefined,
      hasContent(errorOf()) ? errorIdFor(id) : undefined,
    );
  const inputLabel = (): string | undefined => {
    if (hasContent(labelOf())) return undefined;
    if (props.ariaLabel !== undefined) return props.ariaLabel;
    if (props.placeholder !== undefined && props.placeholder !== "") {
      return props.placeholder;
    }
    return config.strings.search;
  };

  let inputElement: HTMLInputElement | null = null;
  const bindInput = (node: Element | null): void => {
    inputElement =
      node !== null && node.localName === "input"
        ? (node as HTMLInputElement)
        : null;
  };

  const clear = (event: MouseEvent): void => {
    const input = inputElement;
    if (input === null) return;
    input.value = "";
    const dispatched =
      typeof InputEvent === "function"
        ? new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" })
        : new Event("input", { bubbles: true });
    input.dispatchEvent(dispatched);
    input.focus();
    props.onClear?.(event);
  };

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
      disabled={disabled()}
      validating={props.field?.isValidating === true}
      bare={props.bare === true}
      class={props.class}
      style={props.style}
      attrs={props.attrs}
    >
      <div
        class="sui-search-field"
        data-size={props.size ?? "md"}
        data-disabled={disabled() ? "" : undefined}
        data-readonly={readOnly() ? "" : undefined}
        data-invalid={invalidOf() ? "" : undefined}
        data-validating={props.field?.isValidating === true ? "" : undefined}
        data-has-value={readValue() === "" ? undefined : ""}
      >
        <span class="sui-search-field__icon" aria-hidden="true">
          <SearchIcon size="sm" />
        </span>
        <input
          ref={bindInput}
          id={id}
          class="sui-search-field__input"
          type="search"
          name={nameOf()}
          placeholder={props.placeholder ?? ""}
          disabled={disabled()}
          readOnly={readOnly()}
          required={requiredOf()}
          aria-label={inputLabel()}
          aria-required={requiredOf() ? "true" : undefined}
          aria-invalid={invalidOf() ? "true" : undefined}
          aria-busy={props.field?.isValidating === true ? "true" : undefined}
          aria-describedby={described()}
          bindValue={[readValue, NO_WRITE]}
          onInput={(event) => {
            const nextValue =
              (event.currentTarget as HTMLInputElement | null)?.value ?? "";
            setTyped(nextValue);
            props.field?.onInput(event);
            props.onInput?.(event);
            props.onValueChange?.(nextValue);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            const nextValue =
              (event.currentTarget as HTMLInputElement | null)?.value ?? "";
            props.onSearch?.(nextValue);
          }}
        />
        <Show when={readValue() !== "" && !disabled() && !readOnly()}>
          <button
            class="sui-search-field__clear"
            type="button"
            aria-label={props.clearLabel ?? config.strings.clear}
            onClick={clear}
          >
            <CloseIcon size="sm" />
          </button>
        </Show>
      </div>
    </Field>
  );
}
