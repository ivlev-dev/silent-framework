import type { Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import { For, Show, createSignal } from "@ivlev-dev/silent-core";
import type { Attrs } from "../../internal/props.js";
import { useUiConfig } from "../../theme/config.js";
import { Checkbox, type CheckboxVariant } from "../checkbox/checkbox.js";
import {
  type BoundField,
  type GroupColumns,
  type GroupOrientation,
  describedBy,
  errorIdFor,
  hasContent,
  hintIdFor,
  optionDomId,
  resolveControlId,
  valueKey,
  withCount,
} from "../internal/control.js";

export interface CheckboxGroupOption {
  readonly value: string;
  readonly label: Children;
  readonly description?: Children;
  readonly icon?: Children;
  readonly disabled?: boolean | undefined;
}

export type CheckboxGroupVariant = CheckboxVariant;
export type CheckboxGroupOrientation = GroupOrientation;

export interface CheckboxGroupProps {
  readonly options: readonly CheckboxGroupOption[];
  readonly field?: BoundField<readonly string[]> | undefined;
  /** Управляемое значение: значения отмеченных опций. */
  readonly value?: readonly string[] | undefined;
  /** Начальное значение в неуправляемом режиме. */
  readonly defaultValue?: readonly string[] | undefined;
  readonly variant?: CheckboxGroupVariant | undefined;
  readonly orientation?: CheckboxGroupOrientation | undefined;
  /** Сетка опций: 1–4 колонки (на узком экране схлопывается в одну). */
  readonly columns?: GroupColumns | undefined;
  /** Минимум отмеченных опций: снять последнюю нельзя. */
  readonly min?: number | undefined;
  /** Максимум отмеченных опций: лишние опции блокируются. */
  readonly max?: number | undefined;
  readonly label?: Children;
  readonly hint?: Children;
  readonly error?: Children;
  readonly name?: string | undefined;
  readonly id?: string | undefined;
  readonly required?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly readOnly?: boolean | undefined;
  readonly describedBy?: string | undefined;
  readonly onValueChange?: ((value: readonly string[]) => void) | undefined;
  readonly onChange?: ((event: Event) => void) | undefined;
  readonly onBlur?: ((event: FocusEvent) => void) | undefined;
  readonly onFocus?: ((event: FocusEvent) => void) | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
}

interface SyntheticChoiceTarget {
  readonly type: "checkbox";
  readonly multiple: true;
  readonly checked: boolean;
  readonly value: readonly string[];
  readonly selectedOptions: readonly { readonly value: string; readonly selected: true }[];
}

interface CheckboxItemsProps {
  readonly options: readonly CheckboxGroupOption[];
  readonly baseId: string;
  readonly name: string;
  readonly variant: CheckboxGroupVariant;
  readonly invalid: boolean;
  readonly describedBy: string | undefined;
  readonly disabled: boolean;
  readonly readOnly: boolean;
  readonly isSelected: (option: CheckboxGroupOption) => boolean;
  readonly isBlocked: (option: CheckboxGroupOption) => boolean;
  readonly onToggle: (option: CheckboxGroupOption, event: Event) => void;
  readonly onBlur: (event: FocusEvent) => void;
  readonly onFocus: (event: FocusEvent) => void;
}

/**
 * Обёртка над `For`: без отдельного компонента SSR теряет разметку списка
 * (тот же приём, что в `SegmentedButton`).
 */
function CheckboxItems(props: CheckboxItemsProps): Node {
  return (
    <For each={props.options} keyOf={(option) => valueKey(option.value)}>
      {(option) => (
        <Checkbox
          id={optionDomId(props.baseId, option.value)}
          name={props.name}
          value={option.value}
          label={option.label}
          description={option.description}
          icon={option.icon}
          checked={props.isSelected(option)}
          variant={props.variant}
          invalid={props.invalid}
          disabled={
            props.disabled || option.disabled === true || props.isBlocked(option)
          }
          readOnly={props.readOnly}
          describedBy={props.describedBy}
          onChange={(event) => props.onToggle(option, event)}
          onBlur={props.onBlur}
          onFocus={props.onFocus}
        />
      )}
    </For>
  );
}

/**
 * Синтетическое `change`-событие группы: форма читает `selectedOptions`
 * при `multiple: true` и получает массив значений, а не boolean одного input.
 */
function groupChangeEvent(next: readonly string[]): Event {
  const target: SyntheticChoiceTarget = {
    type: "checkbox",
    multiple: true,
    checked: next.length > 0,
    value: next,
    selectedOptions: next.map((value) => ({ value, selected: true as const })),
  };
  return {
    type: "change",
    target,
    currentTarget: target,
  } as unknown as Event;
}

/**
 * Группа чекбоксов: `fieldset`/`legend`, `field` с массивом значений,
 * ограничения `min`/`max` и синтетический `change` с `selectedOptions`.
 */
export function CheckboxGroup(props: CheckboxGroupProps): Node {
  const config = useUiConfig();
  const baseId = resolveControlId(
    props.id ?? props.field?.id,
    props.name ?? props.field?.name,
    "checkbox-group",
  );
  const [internal, setInternal] = createSignal<readonly string[]>(
    props.defaultValue ?? [],
  );

  const valueOf = (): readonly string[] => {
    if (props.value !== undefined) return props.value;
    if (props.field !== undefined) return props.field.value ?? [];
    return internal() ?? [];
  };
  const selectedOf = (option: CheckboxGroupOption): boolean =>
    valueOf().includes(option.value);
  const selectedCount = (): number => valueOf().length;
  const atMax = (): boolean =>
    props.max !== undefined && selectedCount() >= props.max;
  /** Снять отмеченную опцию нельзя, если это нарушит минимум. */
  const blocksDeselect = (): boolean =>
    props.min !== undefined && selectedCount() <= props.min;
  const blockedOf = (option: CheckboxGroupOption): boolean =>
    selectedOf(option) ? blocksDeselect() : atMax();

  const labelOf = (): Children =>
    props.label !== undefined ? props.label : props.field?.label;
  const hintOf = (): Children =>
    props.hint !== undefined ? props.hint : props.field?.hint;
  const errorOf = (): Children =>
    props.error !== undefined ? props.error : props.field?.error;
  const nameOf = (): string => props.name ?? props.field?.name ?? baseId;
  const variantOf = (): CheckboxGroupVariant => props.variant ?? "default";
  const orientationOf = (): CheckboxGroupOrientation =>
    props.orientation ?? "vertical";
  const invalidOf = (): boolean => hasContent(errorOf());
  const busyOf = (): boolean => props.field?.isValidating === true;
  const constraintOf = (): string | undefined => {
    const parts: string[] = [];
    if (props.min !== undefined && props.min > 1) {
      parts.push(withCount(config.strings.minSelections, props.min));
    }
    if (props.max !== undefined) {
      parts.push(withCount(config.strings.maxSelections, props.max));
    }
    return parts.length === 0 ? undefined : parts.join(". ");
  };
  const described = (): string | undefined =>
    describedBy(
      props.describedBy,
      hasContent(hintOf()) ? hintIdFor(baseId) : undefined,
      constraintOf() === undefined ? undefined : `${baseId}-constraint`,
      hasContent(errorOf()) ? errorIdFor(baseId) : undefined,
    );

  const toggle = (option: CheckboxGroupOption, event: Event): void => {
    if (props.disabled === true || props.readOnly === true) {
      event.preventDefault();
      return;
    }
    const target = event.target;
    const checked =
      target instanceof HTMLInputElement ? target.checked : !selectedOf(option);
    const current = valueOf();
    const without = current.filter((value) => value !== option.value);
    const next = checked ? [...without, option.value] : without;
    if (props.max !== undefined && next.length > props.max) return;
    if (props.min !== undefined && next.length < props.min) return;
    if (props.value === undefined && props.field === undefined) {
      setInternal(next);
    }
    const synthetic = groupChangeEvent(next);
    props.field?.onChange(synthetic);
    props.onChange?.(synthetic);
    props.onValueChange?.(next);
  };

  return (
    <fieldset
      {...props.attrs}
      class={["sui-checkbox-group", props.class]}
      style={props.style}
      data-variant={variantOf()}
      data-orientation={orientationOf()}
      data-columns={props.columns === undefined ? undefined : String(props.columns)}
      data-min={props.min === undefined ? undefined : String(props.min)}
      data-max={props.max === undefined ? undefined : String(props.max)}
      data-limit={
        atMax()
          ? "max"
          : props.min !== undefined && selectedCount() === props.min
            ? "min"
            : undefined
      }
      data-invalid={invalidOf() ? "" : undefined}
      data-disabled={props.disabled === true ? "" : undefined}
      data-readonly={props.readOnly === true ? "" : undefined}
      data-validating={busyOf() ? "" : undefined}
      data-touched={props.field?.touched === true ? "" : undefined}
      aria-describedby={described()}
      aria-invalid={invalidOf() ? "true" : undefined}
      aria-required={props.required === true || (props.min ?? 0) > 0 ? "true" : undefined}
      aria-busy={busyOf() ? "true" : undefined}
    >
      <Show when={hasContent(labelOf())}>
        <legend class="sui-checkbox-group__legend">{labelOf()}</legend>
      </Show>
      <Show when={hasContent(hintOf())}>
        <span class="sui-checkbox-group__hint" id={hintIdFor(baseId)}>
          {hintOf()}
        </span>
      </Show>
      <Show when={constraintOf() !== undefined}>
        <span class="sui-checkbox-group__constraint" id={`${baseId}-constraint`}>
          {constraintOf()}
        </span>
      </Show>
      <div class="sui-checkbox-group__body">
        <CheckboxItems
          options={props.options}
          baseId={baseId}
          name={nameOf()}
          variant={variantOf()}
          invalid={invalidOf()}
          describedBy={described()}
          disabled={props.disabled === true}
          readOnly={props.readOnly === true}
          isSelected={selectedOf}
          isBlocked={blockedOf}
          onToggle={toggle}
          onBlur={(event) => {
            props.field?.onBlur(event);
            props.onBlur?.(event);
          }}
          onFocus={(event) => {
            props.field?.onFocus(event);
            props.onFocus?.(event);
          }}
        />
      </div>
      <Show when={hasContent(errorOf())}>
        <span class="sui-checkbox-group__error" id={errorIdFor(baseId)}>
          {errorOf()}
        </span>
      </Show>
    </fieldset>
  );
}
