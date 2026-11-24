import type { Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import { For, Show } from "@ivlev-dev/silent-core";
import type { Attrs } from "../../internal/props.js";
import {
  NO_WRITE,
  type BoundField,
  describedBy,
  descriptionIdFor,
  errorIdFor,
  hasContent,
  hintIdFor,
  resolveControlId,
} from "../internal/control.js";

export interface RadioOption {
  readonly value: string | number;
  readonly label: Children;
  readonly description?: Children;
  readonly disabled?: boolean | undefined;
}

export interface RadioGroupProps {
  readonly options: readonly RadioOption[];
  readonly field?: BoundField<string | number> | undefined;
  readonly value?: string | number | undefined;
  readonly label?: Children;
  readonly hint?: Children;
  readonly error?: Children;
  readonly name?: string | undefined;
  readonly id?: string | undefined;
  readonly required?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly readOnly?: boolean | undefined;
  readonly describedBy?: string | undefined;
  readonly onChange?: ((event: Event) => void) | undefined;
  readonly onBlur?: ((event: FocusEvent) => void) | undefined;
  readonly onFocus?: ((event: FocusEvent) => void) | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
}

function valueKey(value: string | number): string {
  return String(value);
}

function optionDomId(base: string, option: RadioOption): string {
  return `${base}-${valueKey(option.value).replace(/[^A-Za-z0-9_-]+/gu, "-")}`;
}

interface RadioItemProps {
  readonly option: RadioOption;
  readonly id: string;
  readonly name: string;
  readonly checked: () => boolean;
  readonly tabIndex: number;
  readonly disabled: boolean;
  readonly readOnly: boolean;
  readonly required: boolean;
  readonly invalid: boolean;
  readonly busy: boolean;
  readonly describedBy: string | undefined;
  readonly onSelect: (event: Event) => void;
  readonly onBlur: (event: FocusEvent) => void;
  readonly onFocus: (event: FocusEvent) => void;
}

/** Один пункт: `bindChecked` требует локальную ссылку-аксессор. */
function RadioItem(props: RadioItemProps): Node {
  const readChecked = (): boolean => props.checked();
  const descriptionId = (): string => descriptionIdFor(props.id);
  return (
    <label
      class="sui-radio"
      for={props.id}
      data-disabled={props.disabled ? "" : undefined}
      data-checked={props.checked() ? "" : undefined}
    >
      <span class="sui-radio__control">
        <input
          id={props.id}
          class="sui-radio__input"
          type="radio"
          name={props.name}
          value={valueKey(props.option.value)}
          tabIndex={props.tabIndex}
          disabled={props.disabled}
          readOnly={props.readOnly}
          required={props.required}
          aria-required={props.required ? "true" : undefined}
          aria-invalid={props.invalid ? "true" : undefined}
          aria-busy={props.busy ? "true" : undefined}
          aria-describedby={describedBy(props.describedBy, hasContent(props.option.description) ? descriptionId() : undefined)}
          bindChecked={[readChecked, NO_WRITE]}
          onClick={(event) => {
            if (props.readOnly) event.preventDefault();
          }}
          onChange={(event) => {
            if (props.readOnly) {
              event.preventDefault();
              return;
            }
            props.onSelect(event);
          }}
          onBlur={props.onBlur}
          onFocus={props.onFocus}
        />
        <span class="sui-radio__dot" aria-hidden="true" />
      </span>
      <span class="sui-radio__text">
        <span class="sui-radio__label">{props.option.label}</span>
        <Show when={hasContent(props.option.description)}>
          <span class="sui-radio__description" id={descriptionId()}>
            {props.option.description}
          </span>
        </Show>
      </span>
    </label>
  );
}

/**
 * Группа радиокнопок: `fieldset`/`legend`, `field` и roving tabindex.
 * Стрелки/Home/End двигают фокус и выбор по включённым пунктам.
 */
export function RadioGroup(props: RadioGroupProps): Node {
  const baseId = resolveControlId(
    props.id ?? props.field?.id,
    props.name ?? props.field?.name,
    "radio-group",
  );
  const labelOf = (): Children =>
    props.label !== undefined ? props.label : props.field?.label;
  const hintOf = (): Children =>
    props.hint !== undefined ? props.hint : props.field?.hint;
  const errorOf = (): Children =>
    props.error !== undefined ? props.error : props.field?.error;
  const nameOf = (): string => props.name ?? props.field?.name ?? baseId;
  const requiredOf = (): boolean =>
    props.required !== undefined
      ? props.required
      : props.field?.isRequired === true;
  const invalidOf = (): boolean => hasContent(errorOf());
  const currentValue = (): unknown =>
    props.value !== undefined ? props.value : props.field?.value;
  const selectedOf = (option: RadioOption): boolean => {
    const value = currentValue();
    return value !== undefined && value !== null && String(value) === valueKey(option.value);
  };
  const firstEnabled = (): number => {
    for (let index = 0; index < props.options.length; index += 1) {
      const option = props.options[index];
      if (option !== undefined && option.disabled !== true) return index;
    }
    return -1;
  };
  const tabIndexOf = (option: RadioOption, index: number): number => {
    if (selectedOf(option) && option.disabled !== true) return 0;
    const hasSelection = props.options.some(
      (item) => selectedOf(item) && item.disabled !== true,
    );
    return !hasSelection && index === firstEnabled() ? 0 : -1;
  };
  const described = (): string | undefined =>
    describedBy(
      props.describedBy,
      hasContent(hintOf()) ? hintIdFor(baseId) : undefined,
      hasContent(errorOf()) ? errorIdFor(baseId) : undefined,
    );
  const disabledOf = (option: RadioOption): boolean =>
    props.disabled === true || option.disabled === true;
  return (
    <fieldset
      {...props.attrs}
      class={["sui-radio-group", props.class]}
      style={props.style}
      data-invalid={invalidOf() ? "" : undefined}
      data-disabled={props.disabled === true ? "" : undefined}
      data-readonly={props.readOnly === true ? "" : undefined}
      data-validating={props.field?.isValidating === true ? "" : undefined}
      data-touched={props.field?.touched === true ? "" : undefined}
      aria-describedby={described()}
      aria-invalid={invalidOf() ? "true" : undefined}
      aria-busy={props.field?.isValidating === true ? "true" : undefined}
      onKeyDown={(event) => {
        const key = event.key;
        if (
          key !== "ArrowDown"
          && key !== "ArrowRight"
          && key !== "ArrowUp"
          && key !== "ArrowLeft"
          && key !== "Home"
          && key !== "End"
        ) {
          return;
        }
        if (props.readOnly === true || props.disabled === true) return;
        const root = event.currentTarget;
        if (!(root instanceof HTMLElement)) return;
        const inputs = Array.from(
          root.querySelectorAll("input[type=radio]"),
        ).filter(
          (node): node is HTMLInputElement =>
            node instanceof HTMLInputElement && !node.disabled,
        );
        if (inputs.length === 0) return;
        const current = event.target instanceof HTMLInputElement
          ? inputs.indexOf(event.target)
          : -1;
        let next = current;
        if (key === "Home") {
          next = 0;
        } else if (key === "End") {
          next = inputs.length - 1;
        } else if (key === "ArrowDown" || key === "ArrowRight") {
          next = current < 0 ? 0 : (current + 1) % inputs.length;
        } else {
          next = current < 0 ? inputs.length - 1 : (current - 1 + inputs.length) % inputs.length;
        }
        const target = inputs[next];
        if (target !== undefined) {
          target.focus();
          target.click();
        }
        event.preventDefault();
      }}
    >
      <Show when={hasContent(labelOf())}>
        <legend class="sui-radio-group__legend">{labelOf()}</legend>
      </Show>
      <Show when={hasContent(hintOf())}>
        <span class="sui-radio-group__hint" id={hintIdFor(baseId)}>
          {hintOf()}
        </span>
      </Show>
      <div class="sui-radio-group__body">
        <For each={props.options} keyOf={(option) => valueKey(option.value)}>
          {(option, index) => (
            <RadioItem
              option={option}
              id={optionDomId(baseId, option)}
              name={nameOf()}
              checked={() => selectedOf(option)}
              tabIndex={tabIndexOf(option, index())}
              disabled={disabledOf(option)}
              readOnly={props.readOnly === true}
              required={requiredOf()}
              invalid={invalidOf()}
              busy={props.field?.isValidating === true}
              describedBy={described()}
              onSelect={(event) => {
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
          )}
        </For>
      </div>
      <Show when={hasContent(errorOf())}>
        <span class="sui-radio-group__error" id={errorIdFor(baseId)}>
          {errorOf()}
        </span>
      </Show>
    </fieldset>
  );
}
