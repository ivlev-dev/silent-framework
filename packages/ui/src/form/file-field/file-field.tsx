import type { Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import { Show, createSignal, onCleanup } from "@ivlev-dev/silent-core";
import type { Attrs } from "../../internal/props.js";
import { useUiConfig } from "../../theme/config.js";
import { Field } from "../field/field.js";
import {
  type BoundField,
  describedBy,
  errorIdFor,
  hasContent,
  hintIdFor,
  resolveControlId,
} from "../internal/control.js";

/** Контекст выбора файлов: `signal` отменяется при размонтировании. */
export interface FileSelectionContext {
  readonly signal: AbortSignal;
}

export interface FileFieldProps {
  readonly accept?: string | undefined;
  readonly multiple?: boolean | undefined;
  /** Имя выбранного файла (или файлов) для отображения. */
  readonly value?: string | undefined;
  /** Поле формы: подпись/подсказка/ошибка (значение контролирует `onFiles`). */
  readonly field?: BoundField<unknown> | undefined;
  readonly label?: Children;
  readonly hint?: Children;
  readonly error?: Children;
  readonly name?: string | undefined;
  readonly id?: string | undefined;
  /** Прогресс загрузки 0–100; `undefined` — полоса скрыта. */
  readonly progress?: number | undefined;
  readonly required?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly chooseLabel?: string | undefined;
  readonly describedBy?: string | undefined;
  /**
   * Получил файлы. Интеграция с `uploadField` — на стороне приложения:
   * `onFiles={(files, { signal }) => uploadField(form, "avatar", files[0], uploader, { signal })}`.
   */
  readonly onFiles?:
    | ((files: readonly File[], context: FileSelectionContext) => void)
    | undefined;
  readonly onBlur?: ((event: FocusEvent) => void) | undefined;
  readonly onFocus?: ((event: FocusEvent) => void) | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
}

/**
 * Поле файла: скрытый `input[type=file]` + доступный триггер.
 * При размонтировании активная загрузка отменяется (`AbortSignal`),
 * а `input.value` сбрасывается, чтобы тот же файл можно было выбрать снова.
 */
export function FileField(props: FileFieldProps): Node {
  const config = useUiConfig();
  const controller = new AbortController();
  const [selected, setSelected] = createSignal<string | null>(null);
  let input: HTMLInputElement | null = null;
  onCleanup(() => {
    controller.abort();
    if (input !== null) input.value = "";
  });
  const id = resolveControlId(
    props.id ?? props.field?.id,
    props.name ?? props.field?.name,
    "file-field",
  );
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
  const fileName = (): string => {
    if (props.value !== undefined) return props.value;
    const name = selected();
    return name === null ? "" : name;
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
      class={props.class}
      style={props.style}
      attrs={props.attrs}
    >
      <div
        class="sui-file-field"
        data-invalid={invalidOf() ? "" : undefined}
        data-disabled={props.disabled === true ? "" : undefined}
        data-has-file={fileName() === "" ? undefined : ""}
        data-uploading={props.progress === undefined ? undefined : ""}
      >
        <input
          ref={(node: Element | null) => {
            if (node instanceof HTMLInputElement) input = node;
          }}
          id={id}
          class="sui-file-field__input"
          type="file"
          name={nameOf()}
          accept={props.accept}
          multiple={props.multiple === true}
          disabled={props.disabled === true}
          required={requiredOf()}
          aria-required={requiredOf() ? "true" : undefined}
          aria-invalid={invalidOf() ? "true" : undefined}
          aria-busy={props.field?.isValidating === true ? "true" : undefined}
          aria-describedby={described()}
          onChange={(event) => {
            const target = event.currentTarget;
            if (!(target instanceof HTMLInputElement)) return;
            const list = target.files;
            const files: readonly File[] = list === null ? [] : Array.from(list);
            if (files.length > 0) {
              setSelected(files.map((file) => file.name).join(", "));
              props.onFiles?.(files, { signal: controller.signal });
            }
            target.value = "";
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
        <label class="sui-file-field__trigger" for={id}>
          <span class="sui-file-field__choose">
            {props.chooseLabel ?? config.strings.chooseFile}
          </span>
          <Show when={fileName() !== ""}>
            <span class="sui-file-field__name" title={fileName()}>
              {fileName()}
            </span>
          </Show>
        </label>
        <Show when={props.progress !== undefined}>
          <div class="sui-file-field__progress">
            <progress
              class="sui-file-field__progressbar"
              value={props.progress}
              max={100}
              aria-label={config.strings.loading}
              aria-valuetext={`${Math.round(props.progress ?? 0)}%`}
            />
            <span class="sui-file-field__percent" aria-hidden="true">
              {Math.round(props.progress ?? 0)}%
            </span>
          </div>
        </Show>
      </div>
    </Field>
  );
}
