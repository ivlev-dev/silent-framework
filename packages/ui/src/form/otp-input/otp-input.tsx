import type { Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import {
  For,
  Show,
  component,
  createSignal,
  untrack,
  type ForProps,
} from "@ivlev-dev/silent-core";
import type { Attrs } from "../../internal/props.js";
import { clientEffect } from "../../internal/overlay.js";
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
import { childrenText } from "../internal/listbox-filter.js";
import { createSelectChangeEvent } from "../internal/listbox-engine.js";
import {
  type OtpChangeReason,
  type OtpCharSet,
  createOtpState,
  isOtpComplete,
  otpChars,
  otpGroupBoundaries,
  otpReducer,
  sanitizeOtpText,
} from "./otp.js";

export type OtpInputCharSet = OtpCharSet;
export type OtpInputChangeReason = OtpChangeReason;
export type OtpInputSize = ControlSize;

export interface OtpInputChangeContext {
  readonly reason: OtpChangeReason;
}

export interface OtpInputProps {
  readonly length?: number | undefined;
  readonly value?: string | undefined;
  readonly defaultValue?: string | undefined;
  readonly field?: BoundField<string> | undefined;
  readonly charSet?: OtpInputCharSet | undefined;
  /** Скрывать символы (`type=password`), значение остаётся реальным. */
  readonly mask?: boolean | undefined;
  /** Разбиение на группы; по умолчанию `[3, 3]`. */
  readonly groups?: readonly number[] | undefined;
  readonly separator?: Children;
  /** Фокус на первый пустой разряд после монтирования (только клиент). */
  readonly autoFocus?: boolean | undefined;
  /** Отправить ближайшую форму, когда код заполнен. */
  readonly autoSubmit?: boolean | undefined;
  readonly onComplete?: ((value: string) => void) | undefined;
  readonly size?: OtpInputSize | undefined;
  readonly onValueChange?:
    | ((value: string, context: OtpInputChangeContext) => void)
    | undefined;
  readonly label?: Children;
  readonly hint?: Children;
  readonly error?: Children;
  readonly name?: string | undefined;
  readonly id?: string | undefined;
  readonly required?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly readOnly?: boolean | undefined;
  readonly describedBy?: string | undefined;
  readonly onInput?: ((event: InputEvent) => void) | undefined;
  readonly onChange?: ((event: Event) => void) | undefined;
  readonly onBlur?: ((event: FocusEvent) => void) | undefined;
  readonly onFocus?: ((event: FocusEvent) => void) | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
}

const DEFAULT_GROUPS: readonly number[] = [3, 3];

function indexText(template: string, index: number, count: number): string {
  return template
    .replace(/\{index\}/gu, String(index))
    .replace(/\{count\}/gu, String(count));
}

/**
 * Прямой вызов `For`: JSX-тег компилируется в серверную дыру, а этот
 * список должен попадать в SSR-разметку и гидрироваться без mismatch.
 */
function renderFor<T>(props: ForProps<T>): Node {
  return component(
    For as unknown as Parameters<typeof component>[0],
    props as unknown as Record<string, unknown>,
  );
}

/**
 * Поле одноразового кода: N разрядов, автопереход, вставка и группы.
 * Скрытый input хранит полное значение для нативной формы, видимые
 * разряды не имеют `name`, поэтому форма получает один код.
 */
export function OtpInput(props: OtpInputProps): Node {
  const config = useUiConfig();
  const length = (): number => Math.max(1, Math.trunc(props.length ?? 6));
  const charSet = (): OtpCharSet => props.charSet ?? "numeric";
  const id = resolveControlId(
    props.id ?? props.field?.id,
    props.name ?? props.field?.name,
    "otp-input",
  );
  const [internal, setInternal] = createSignal<string>(props.defaultValue ?? "");
  const [rootElement, setRootElement] = createSignal<HTMLElement | null>(null);
  const inputs: Array<HTMLInputElement | null> = [];
  let lastCompleted: string | null = null;

  const valueOf = (): string => {
    if (props.value !== undefined) return props.value;
    if (props.field !== undefined) return props.field.value ?? "";
    return internal();
  };
  const chars = (): string[] =>
    otpChars(sanitizeOtpText(valueOf(), charSet()), length());
  const charsText = (): string => chars().join("");
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
  const disabledOf = (): boolean => props.disabled === true;
  const readOnlyOf = (): boolean => props.readOnly === true;
  const described = (): string | undefined =>
    describedBy(
      props.describedBy,
      hasContent(hintOf()) ? hintIdFor(id) : undefined,
      hasContent(errorOf()) ? errorIdFor(id) : undefined,
    );
  const groupLabel = (): string | undefined => {
    const text = childrenText(labelOf()).trim();
    return text === "" ? undefined : text;
  };
  const boundaries = (): ReadonlySet<number> =>
    new Set(otpGroupBoundaries(props.groups ?? DEFAULT_GROUPS, length()));
  const indexes = (): number[] =>
    Array.from({ length: length() }, (_, index) => index);

  const focusAt = (index: number): void => {
    const target = inputs[Math.min(length() - 1, Math.max(0, index))];
    target?.focus({ preventScroll: true });
    target?.select?.();
  };

  const submitForm = (): void => {
    if (props.autoSubmit !== true) return;
    const form = inputs[0]?.form;
    if (form !== null && form !== undefined && typeof form.requestSubmit === "function") {
      form.requestSubmit();
    }
  };

  const emit = (next: string, reason: OtpChangeReason): void => {
    if (props.value === undefined && props.field === undefined) {
      setInternal(next);
    }
    props.onValueChange?.(next, { reason });
    const change = createSelectChangeEvent(next === "" ? [] : [next], false);
    props.field?.onChange(change);
    props.onChange?.(change);
  };

  const applyState = (
    state: { readonly chars: readonly string[]; readonly focus: number },
    reason: OtpChangeReason,
  ): void => {
    const next = state.chars.join("");
    if (next !== charsText()) emit(next, reason);
    if (isOtpComplete(state.chars, length())) {
      if (lastCompleted !== next) {
        lastCompleted = next;
        props.onComplete?.(next);
        submitForm();
      }
    } else {
      lastCompleted = null;
    }
    focusAt(state.focus);
  };

  const handleInput = (index: number, event: InputEvent): void => {
    props.onInput?.(event);
    if (disabledOf() || readOnlyOf()) return;
    const target = event.currentTarget;
    if (!(target instanceof HTMLInputElement)) return;
    const state = otpReducer(
      { chars: chars(), focus: index },
      {
        type: "input",
        index,
        text: target.value,
        length: length(),
        charSet: charSet(),
      },
    );
    target.value = state.chars[index] ?? "";
    applyState(state, "input");
  };

  const handlePaste = (index: number, event: ClipboardEvent): void => {
    if (disabledOf() || readOnlyOf()) return;
    const text = event.clipboardData?.getData("text") ?? "";
    if (text === "") return;
    event.preventDefault();
    const state = otpReducer(
      { chars: chars(), focus: index },
      {
        type: "paste",
        index,
        text,
        length: length(),
        charSet: charSet(),
      },
    );
    applyState(state, "paste");
  };

  const handleKeyDown = (index: number, event: KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (
      event.key !== "Backspace"
      && event.key !== "Delete"
      && event.key !== "ArrowLeft"
      && event.key !== "ArrowRight"
      && event.key !== "Home"
      && event.key !== "End"
    ) {
      return;
    }
    if (disabledOf() || readOnlyOf()) return;
    event.preventDefault();
    const state = otpReducer(
      { chars: chars(), focus: index },
      { type: "key", index, key: event.key, length: length() },
    );
    if (state.chars.join("") !== charsText()) {
      applyState(state, "keyboard");
      return;
    }
    focusAt(state.focus);
  };

  const handleBlur = (event: FocusEvent): void => {
    const root = rootElement();
    const next = event.relatedTarget;
    if (next instanceof Node && root !== null && root.contains(next)) return;
    if (next === null) {
      queueMicrotask(() => {
        if (root !== null && root.contains(document.activeElement)) return;
        props.field?.onBlur(event);
        props.onBlur?.(event);
      });
      return;
    }
    props.field?.onBlur(event);
    props.onBlur?.(event);
  };

  clientEffect(() => {
    if (props.autoFocus !== true) return;
    untrack(() => {
      const state = createOtpState(valueOf(), length(), charSet());
      focusAt(state.focus);
    });
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
        class="sui-otp"
        role="group"
        data-size={props.size ?? "md"}
        data-charset={charSet()}
        data-mask={props.mask === true ? "" : undefined}
        data-invalid={invalidOf() ? "" : undefined}
        data-disabled={disabledOf() ? "" : undefined}
        data-readonly={readOnlyOf() ? "" : undefined}
        data-validating={props.field?.isValidating === true ? "" : undefined}
        data-filled={isOtpComplete(chars(), length()) ? "" : undefined}
        aria-label={groupLabel()}
        aria-describedby={described()}
        aria-invalid={invalidOf() ? "true" : undefined}
        aria-required={requiredOf() ? "true" : undefined}
        aria-busy={props.field?.isValidating === true ? "true" : undefined}
      >
        {renderFor({
          each: indexes,
          keyOf: (index: number) => index,
          children: (_index, position) => {
            const current = (): number => position();
            const boundary = (): boolean => boundaries().has(current() + 1);
            const readChar = (): string => chars()[current()] ?? "";
            return (
              <span
                class="sui-otp__slot"
                data-group-end={
                  boundary() && props.separator === undefined ? "" : undefined
                }
              >
                <input
                  ref={(node: Element | null) => {
                    inputs[current()] = node as HTMLInputElement | null;
                  }}
                  id={current() === 0 ? id : `${id}-${current()}`}
                  class="sui-otp__input"
                  type={props.mask === true ? "password" : "text"}
                  inputMode={charSet() === "numeric" ? "numeric" : "text"}
                  autocomplete={current() === 0 ? "one-time-code" : "off"}
                  maxLength={1}
                  disabled={disabledOf()}
                  readOnly={readOnlyOf()}
                  aria-label={indexText(
                    config.strings.otpDigit,
                    current() + 1,
                    length(),
                  )}
                  aria-invalid={invalidOf() ? "true" : undefined}
                  bindValue={[readChar, NO_WRITE]}
                  onInput={(event) => {
                    handleInput(current(), event);
                  }}
                  onPaste={(event: ClipboardEvent) => {
                    handlePaste(current(), event);
                  }}
                  onKeyDown={(event) => {
                    handleKeyDown(current(), event);
                  }}
                  onFocus={(event: FocusEvent) => {
                    if (event.currentTarget instanceof HTMLInputElement) {
                      event.currentTarget.select();
                    }
                    props.field?.onFocus(event);
                    props.onFocus?.(event);
                  }}
                  onBlur={handleBlur}
                />
                <Show when={boundary() && props.separator !== undefined}>
                  <span class="sui-otp__separator" aria-hidden="true">
                    {props.separator}
                  </span>
                </Show>
              </span>
            );
          },
        })}
        <input
          type="hidden"
          name={nameOf()}
          bindValue={[charsText, NO_WRITE]}
        />
      </div>
    </Field>
  );
}
