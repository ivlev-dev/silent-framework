import type { Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import { Show, createSignal, untrack } from "@ivlev-dev/silent-core";
import type { Attrs } from "../../internal/props.js";
import { clientEffect } from "../../internal/overlay.js";
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

/** Текст `option` из `Children`: внутри `<option>` допустим только текст. */
function optionText(label: Children): string {
  if (typeof label === "function") return optionText(label());
  if (label === null || label === undefined || typeof label === "boolean") {
    return "";
  }
  if (
    typeof label === "string"
    || typeof label === "number"
    || typeof label === "bigint"
  ) {
    return String(label);
  }
  if (typeof label === "object" && "nodeType" in label) {
    return (label as Node).textContent ?? "";
  }
  if (
    typeof label === "object"
    && typeof (label as Iterable<unknown>)[Symbol.iterator] === "function"
  ) {
    let text = "";
    for (const child of label as Iterable<Children>) text += optionText(child);
    return text;
  }
  return String(label);
}

function textValue(value: unknown): string {
  if (Array.isArray(value)) return value.length === 0 ? "" : String(value[0]);
  if (value === undefined || value === null) return "";
  return String(value);
}

function valueList(value: unknown): readonly string[] {
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (value === undefined || value === null || value === "") return [];
  return [String(value)];
}

function createOption(select: HTMLSelectElement): HTMLOptionElement {
  // Скобочный доступ: build-проверка запрещает `createElement(` в dist
  // (так ловят недокомпилированный JSX).
  return select.ownerDocument["createElement"]("option") as HTMLOptionElement;
}

function firstChildOption(select: HTMLSelectElement): HTMLOptionElement | null {
  for (const child of Array.from(select.children)) {
    if (child.localName === "option") return child as HTMLOptionElement;
  }
  return null;
}

function childOptions(
  select: HTMLSelectElement,
  placeholder: HTMLOptionElement | null,
): HTMLOptionElement[] {
  const options: HTMLOptionElement[] = [];
  for (const child of Array.from(select.children)) {
    if (child.localName !== "option" || child === placeholder) continue;
    options.push(child as HTMLOptionElement);
  }
  return options;
}

/**
 * Список. На SSR у выбранных `option` стоит `selected`; разметка строится
 * `.map()` без `For`/маркеров. На клиенте `options` реконсилируются вручную:
 * SSR-разметка остаётся прежней, а после mount обновление сигнала `options`
 * переиспользует/добавляет/удаляет `<option>` без пересоздания `<select>`.
 */
export function Select(props: SelectProps): Node {
  const id = resolveControlId(
    props.id ?? props.field?.id,
    props.name ?? props.field?.name,
    "select",
  );
  const currentValue = (): unknown =>
    props.value !== undefined ? props.value : props.field?.value;
  const selectedValues = (): readonly string[] => valueList(currentValue());
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

  // Только начальная разметка (SSR и первый клиентский рендер). Дальнейшие
  // изменения `options` обрабатывает реконсилятор ниже, а не `<insert>` JSX:
  // иначе список пересоздавался бы целиком и терял выбранное значение.
  const initialOptions = untrack(() => props.options);
  const [selectElement, setSelectElement] = createSignal<HTMLSelectElement | null>(
    null,
  );
  let placeholderOption: HTMLOptionElement | null = null;

  // Реконсиляция options на клиенте: `For` внутри `<select>` ломает SSR/гидрацию
  // (маркеры списка недопустимы парсером), поэтому SSR-разметка остаётся `.map()`,
  // а изменения `props.options` применяются к существующим `<option>`.
  clientEffect(() => {
    const select = selectElement();
    if (select === null) return;
    const options = props.options;
    const multiple = props.multiple === true;
    const placeholder = props.placeholder;
    const required = requiredOf();
    const value = currentValue();

    if (multiple || placeholder === undefined) {
      if (placeholderOption !== null) {
        if (placeholderOption.parentNode === select) placeholderOption.remove();
        placeholderOption = null;
      }
    } else {
      let element = placeholderOption;
      if (element === null || element.parentNode !== select) {
        const first = firstChildOption(select);
        element = first !== null && first.value === "" ? first : null;
        if (element === null) {
          element = createOption(select);
          element.value = "";
          select.insertBefore(element, select.firstChild);
        }
        placeholderOption = element;
      }
      const placeholderText = optionText(placeholder);
      if (element.textContent !== placeholderText) {
        element.textContent = placeholderText;
      }
      if (element.disabled !== required) element.disabled = required;
      if (select.firstElementChild !== element) {
        select.insertBefore(element, select.firstChild);
      }
    }

    const existing = childOptions(select, placeholderOption);
    for (let index = 0; index < options.length; index += 1) {
      const spec = options[index]!;
      let element = existing[index];
      if (element === undefined) {
        element = createOption(select);
        select.appendChild(element);
      }
      const nextValue = optionValue(spec);
      if (element.value !== nextValue) element.value = nextValue;
      const nextDisabled = spec.disabled === true;
      if (element.disabled !== nextDisabled) element.disabled = nextDisabled;
      const nextText = optionText(spec.label);
      if (element.textContent !== nextText) element.textContent = nextText;
    }
    for (let index = options.length; index < existing.length; index += 1) {
      existing[index]!.remove();
    }

    // Выбранное значение — из `currentValue()`; форма не перезаписывается
    // (`bindValue` работает с `NO_WRITE`).
    if (multiple) {
      const desired = new Set(valueList(value));
      for (const element of Array.from(select.options)) {
        const selected = desired.has(element.value);
        if (element.selected !== selected) element.selected = selected;
      }
    } else {
      const nextValue = textValue(value);
      if (select.value !== nextValue) select.value = nextValue;
    }

    if (multiple) {
      if (select.hasAttribute("title")) select.removeAttribute("title");
    } else {
      const current = textValue(value);
      const selected =
        current === ""
          ? undefined
          : options.find((option) => optionValue(option) === current);
      const title = typeof selected?.label === "string" ? selected.label : "";
      if (title === "") {
        if (select.hasAttribute("title")) select.removeAttribute("title");
      } else if (select.title !== title) {
        select.title = title;
      }
    }
  });

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
          ref={(node: Element | null) => {
            setSelectElement(node as HTMLSelectElement | null);
          }}
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
          {initialOptions.map((option) => (
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
