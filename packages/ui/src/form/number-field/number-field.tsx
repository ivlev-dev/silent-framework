import type { Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import { Show, createSignal } from "@ivlev-dev/silent-core";
import { ChevronDownIcon } from "../../icons/chevron-down.js";
import { ChevronUpIcon } from "../../icons/chevron-up.js";
import type { Attrs } from "../../internal/props.js";
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
import {
  type NumberFormat,
  editableNumberText,
  formatNumberValue,
  normalizeNumberValue,
  numberValueText,
  parseNumberText,
  precisionOfStep,
  roundToPrecision,
} from "./number.js";

export interface NumberFieldProps {
  /** Управляемое значение; `null` — пусто. */
  readonly value?: number | null | undefined;
  /** Начальное значение в неуправляемом режиме. */
  readonly defaultValue?: number | null | undefined;
  /** Поле формы: значение, подписи, ошибка и события. */
  readonly field?: BoundField<number | null> | undefined;
  readonly min?: number | undefined;
  readonly max?: number | undefined;
  /** Шаг стрелок; по умолчанию 1. */
  readonly step?: number | undefined;
  /** Знаков после запятой; по умолчанию выводится из `step`. */
  readonly precision?: number | undefined;
  /** Кнопки «больше/меньше»: `auto` — скрыть только для disabled/readOnly. */
  readonly steppers?: boolean | "auto" | undefined;
  /** Колесо мыши меняет значение только в фокусе и при `true`. */
  readonly allowWheel?: boolean | undefined;
  /** Приводить значение к `min`/`max` при потере фокуса (по умолчанию да). */
  readonly clampOnBlur?: boolean | undefined;
  readonly format?: NumberFormat | undefined;
  /** Разбор введённого текста; по умолчанию понимает `1 234,5`. */
  readonly parse?: ((text: string) => number | null) | undefined;
  /** Локаль группировки и десятичного разделителя. */
  readonly locale?: string | undefined;
  /** Единица в `aria-valuetext` и визуальном суффиксе. */
  readonly unit?: string | undefined;
  readonly inputMode?: string | undefined;
  readonly onValueChange?: ((value: number | null) => void) | undefined;
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
  readonly describedBy?: string | undefined;
  readonly onInput?: ((event: InputEvent) => void) | undefined;
  readonly onChange?: ((event: Event) => void) | undefined;
  readonly onBlur?: ((event: FocusEvent) => void) | undefined;
  readonly onFocus?: ((event: FocusEvent) => void) | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
}

interface SyntheticNumberTarget {
  readonly type: "text";
  readonly value: number | string;
  readonly valueAsNumber: number;
}

/**
 * Синтетическое `change` для формы: `value` — число (не строка), чтобы
 * `coerceValue` не терял тип при повторном вводе, `""` — очистка.
 */
function createNumberChangeEvent(value: number | null): Event {
  const target: SyntheticNumberTarget = {
    type: "text",
    value: value === null ? "" : value,
    valueAsNumber: value === null ? Number.NaN : value,
  };
  return {
    type: "change",
    bubbles: true,
    cancelable: true,
    target,
    currentTarget: target,
  } as unknown as Event;
}

function finiteOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

/**
 * Числовое поле с ролью `spinbutton`: текст, а не `type=number`, поэтому
 * группировка, единица и локальный разделитель не зависят от браузера.
 * На фокусе показывается редактируемый текст, на blur — формат `format`.
 */
export function NumberField(props: NumberFieldProps): Node {
  const config = useUiConfig();
  const locale = (): string => props.locale ?? config.locale;
  const id = resolveControlId(
    props.id ?? props.field?.id,
    props.name ?? props.field?.name,
    "number-field",
  );
  const [internal, setInternal] = createSignal<number | null>(
    props.defaultValue ?? null,
  );
  const [editing, setEditing] = createSignal(false);
  const [focused, setFocused] = createSignal(false);
  const [text, setText] = createSignal<string | null>(null);
  const [rootElement, setRootElement] = createSignal<HTMLElement | null>(null);
  const [inputElement, setInputElement] = createSignal<HTMLInputElement | null>(
    null,
  );

  const stepOf = (): number => {
    const step = props.step ?? 1;
    return Number.isFinite(step) && step > 0 ? step : 1;
  };
  const precisionOf = (): number =>
    props.precision !== undefined
      ? Math.min(20, Math.max(0, Math.trunc(props.precision)))
      : precisionOfStep(stepOf());
  const valueOf = (): number | null => {
    if (props.value !== undefined) return finiteOrNull(props.value);
    if (props.field !== undefined) return finiteOrNull(props.field.value);
    return internal();
  };
  const displayText = (): string => {
    const value = valueOf();
    if (editing()) {
      const current = text();
      if (current !== null) return current;
    }
    if (value === null) return "";
    return formatNumberValue(value, {
      format: props.format,
      locale: locale(),
      precision: precisionOf(),
    });
  };
  const readValue = (): string => displayText();
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
  const readOnlyOf = (): boolean => props.readOnly === true;
  const disabledOf = (): boolean => props.disabled === true;
  const described = (): string | undefined =>
    describedBy(
      props.describedBy,
      hasContent(hintOf()) ? hintIdFor(id) : undefined,
      hasContent(errorOf()) ? errorIdFor(id) : undefined,
    );
  const steppersOf = (): boolean =>
    props.steppers !== false && !readOnlyOf() && !disabledOf();
  const atMin = (): boolean => {
    const value = valueOf();
    return value !== null && props.min !== undefined && value <= props.min;
  };
  const atMax = (): boolean => {
    const value = valueOf();
    return value !== null && props.max !== undefined && value >= props.max;
  };
  const valueText = (): string | undefined => {
    const text = numberValueText(valueOf(), {
      format: props.format,
      locale: locale(),
      precision: precisionOf(),
      unit: props.unit,
    });
    return text === "" ? undefined : text;
  };

  const parse = (input: string): number | null =>
    props.parse !== undefined ? props.parse(input) : parseNumberText(input);

  const commit = (next: number | null): void => {
    if (props.value === undefined && props.field === undefined) {
      setInternal(next);
    }
    props.onValueChange?.(next);
    const change = createNumberChangeEvent(next);
    props.field?.onChange(change);
    props.onChange?.(change);
  };

  const commitEditing = (next: number): void => {
    commit(next);
    setText(editableNumberText(next, locale()));
  };

  const adjust = (direction: 1 | -1, factor = 1): void => {
    if (disabledOf() || readOnlyOf()) return;
    const step = stepOf();
    const base = valueOf() ?? props.min ?? 0;
    const next = normalizeNumberValue(base + direction * step * factor, {
      min: props.min,
      max: props.max,
      precision: precisionOf(),
    });
    commitEditing(next);
  };

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.isComposing === true) return;
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const direction = event.key === "ArrowUp" ? 1 : -1;
      const factor = event.shiftKey ? 10 : event.altKey ? 0.1 : 1;
      adjust(direction, factor);
      return;
    }
    if (event.key === "PageUp" || event.key === "PageDown") {
      event.preventDefault();
      adjust(event.key === "PageUp" ? 1 : -1, 10);
      return;
    }
    if (event.key === "Home" && props.min !== undefined) {
      event.preventDefault();
      commitEditing(normalizeNumberValue(props.min, {
        min: props.min,
        max: props.max,
        precision: precisionOf(),
      }));
      return;
    }
    if (event.key === "End" && props.max !== undefined) {
      event.preventDefault();
      commitEditing(normalizeNumberValue(props.max, {
        min: props.min,
        max: props.max,
        precision: precisionOf(),
      }));
    }
  };

  const handleInput = (event: InputEvent): void => {
    props.onInput?.(event);
    if (disabledOf() || readOnlyOf()) return;
    const target = event.currentTarget;
    if (!(target instanceof HTMLInputElement)) return;
    const raw = target.value;
    setText(raw);
    if (raw.trim() === "") {
      commit(null);
      return;
    }
    const parsed = parse(raw);
    if (parsed === null || !Number.isFinite(parsed)) return;
    const next = roundToPrecision(parsed, precisionOf());
    if (next !== valueOf()) commit(next);
  };

  const handleFocus = (event: FocusEvent): void => {
    setEditing(true);
    setFocused(true);
    const value = valueOf();
    setText(value === null ? "" : editableNumberText(value, locale()));
    props.field?.onFocus(event);
    props.onFocus?.(event);
  };

  const finishEditing = (): void => {
    const currentText = text();
    if (currentText !== null) {
      if (currentText.trim() === "") {
        if (valueOf() !== null) commit(null);
      } else {
        const parsed = parse(currentText);
        if (parsed !== null && Number.isFinite(parsed)) {
          const next = props.clampOnBlur === false
            ? roundToPrecision(parsed, precisionOf())
            : normalizeNumberValue(parsed, {
                min: props.min,
                max: props.max,
                precision: precisionOf(),
              });
          if (next !== valueOf()) commit(next);
        }
      }
    }
    setEditing(false);
    setFocused(false);
    setText(null);
  };

  const handleBlur = (event: FocusEvent): void => {
    const root = rootElement();
    const next = event.relatedTarget;
    if (next instanceof Node && root !== null && root.contains(next)) return;
    finishEditing();
    props.field?.onBlur(event);
    props.onBlur?.(event);
  };

  const handleWheel = (event: WheelEvent): void => {
    if (props.allowWheel !== true || !focused()) return;
    if (disabledOf() || readOnlyOf()) return;
    const input = inputElement();
    if (input === null || document.activeElement !== input) return;
    event.preventDefault();
    adjust(event.deltaY < 0 ? 1 : -1);
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
      disabled={disabledOf()}
      validating={props.field?.isValidating === true}
      class={props.class}
      style={props.style}
      attrs={props.attrs}
    >
      <div
        ref={(node: Element | null) => {
          setRootElement(node as HTMLElement | null);
        }}
        class="sui-number-field"
        data-size={props.size ?? "md"}
        data-invalid={invalidOf() ? "" : undefined}
        data-disabled={disabledOf() ? "" : undefined}
        data-readonly={readOnlyOf() ? "" : undefined}
        data-validating={props.field?.isValidating === true ? "" : undefined}
        data-steppers={steppersOf() ? "" : undefined}
        data-empty={valueOf() === null ? "" : undefined}
        data-limit={atMax() ? "max" : atMin() ? "min" : undefined}
        onWheel={handleWheel}
      >
        <input
          ref={(node: Element | null) => {
            setInputElement(node as HTMLInputElement | null);
          }}
          id={id}
          class="sui-number-field__input"
          type="text"
          role="spinbutton"
          name={nameOf()}
          inputMode={props.inputMode ?? "decimal"}
          autocomplete="off"
          placeholder={props.placeholder ?? props.field?.placeholder ?? ""}
          disabled={disabledOf()}
          readOnly={readOnlyOf()}
          required={requiredOf()}
          aria-required={requiredOf() ? "true" : undefined}
          aria-invalid={invalidOf() ? "true" : undefined}
          aria-readonly={readOnlyOf() ? "true" : undefined}
          aria-busy={props.field?.isValidating === true ? "true" : undefined}
          aria-describedby={described()}
          aria-valuenow={valueOf() ?? undefined}
          aria-valuemin={props.min}
          aria-valuemax={props.max}
          aria-valuetext={valueText()}
          bindValue={[readValue, NO_WRITE]}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
        />
        <Show when={props.unit !== undefined && props.unit !== ""}>
          <span class="sui-number-field__unit" aria-hidden="true">
            {props.unit}
          </span>
        </Show>
        <Show when={steppersOf()}>
          <span class="sui-number-field__steppers">
            <button
              type="button"
              class="sui-number-field__stepper"
              tabindex="-1"
              disabled={disabledOf() || atMax()}
              aria-label={config.strings.increment}
              onMouseDown={(event: MouseEvent) => {
                event.preventDefault();
              }}
              onClick={() => {
                adjust(1);
              }}
            >
              <ChevronUpIcon size="sm" />
            </button>
            <button
              type="button"
              class="sui-number-field__stepper"
              tabindex="-1"
              disabled={disabledOf() || atMin()}
              aria-label={config.strings.decrement}
              onMouseDown={(event: MouseEvent) => {
                event.preventDefault();
              }}
              onClick={() => {
                adjust(-1);
              }}
            >
              <ChevronDownIcon size="sm" />
            </button>
          </span>
        </Show>
      </div>
    </Field>
  );
}

