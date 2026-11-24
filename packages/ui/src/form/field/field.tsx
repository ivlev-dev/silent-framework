import type { Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import { Show } from "@ivlev-dev/silent-core";
import type { Attrs } from "../../internal/props.js";
import { Label } from "../../components/label/label.js";
import { useUiConfig } from "../../theme/config.js";
import {
  errorIdFor,
  hasContent,
  hintIdFor,
} from "../internal/control.js";

export interface FieldProps {
  /** DOM-id контрола. Он же — база для `id` подсказки и ошибки. */
  readonly id?: string | undefined;
  /** `for` подписи; по умолчанию совпадает с `id`. */
  readonly htmlFor?: string | undefined;
  readonly label?: Children;
  readonly hint?: Children;
  readonly error?: Children;
  readonly required?: boolean | undefined;
  /** Ошибка без текста: контрол невалиден, но сообщения ещё нет. */
  readonly invalid?: boolean | undefined;
  /** Поле посещено. Только `data`-атрибут: серверные ошибки не скрываем. */
  readonly touched?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  /** Асинхронная проверка: подпись/сообщения получают статус `validating`. */
  readonly validating?: boolean | undefined;
  /** Компактная раскладка без внешних отступов — для встраивания. */
  readonly bare?: boolean | undefined;
  readonly class?: ClassNameValue | undefined;
  readonly style?: StyleInput | undefined;
  readonly attrs?: Attrs | undefined;
  /** Контрол. `Field` не знает его тип и не связывает `aria-describedby`. */
  readonly children?: Children | undefined;
}

/**
 * Обёртка поля: подпись, подсказка, ошибка и слот контрола.
 *
 * `Field` не знает о контроле: `htmlFor`/`id` передаёт вызывающий компонент,
 * а связи `aria-describedby`/`aria-invalid` ставит сам контрол. Подсказка и
 * ошибка получают предсказуемые id `<id>-hint`/`<id>-error`.
 */
export function Field(props: FieldProps): Node {
  const config = useUiConfig();
  const hintId = (): string => hintIdFor(props.id);
  const errorId = (): string => errorIdFor(props.id);
  const invalid = (): boolean =>
    props.invalid === true || hasContent(props.error);
  return (
    <div
      {...props.attrs}
      class={["sui-field", props.class]}
      style={props.style}
      data-invalid={invalid() ? "" : undefined}
      data-touched={props.touched === true ? "" : undefined}
      data-disabled={props.disabled === true ? "" : undefined}
      data-bare={props.bare === true ? "" : undefined}
      data-validating={props.validating === true ? "" : undefined}
      data-has-hint={hasContent(props.hint) ? "" : undefined}
      data-has-error={hasContent(props.error) ? "" : undefined}
    >
      <Show when={hasContent(props.label)}>
        <Label
          class="sui-field__label"
          for={props.htmlFor ?? props.id}
          required={props.required === true}
          tone={invalid() ? "error" : "default"}
          disabled={props.disabled === true}
        >
          <>{props.label}</>
          <span class="sui-field__required-text">{config.strings.required}</span>
        </Label>
      </Show>
      <div class="sui-field__control">{props.children}</div>
      {/*
        Сообщения живут в одной области: подсказка уступает место ошибке,
        поэтому контрол и действия ниже не «прыгают» при валидации. Для полей
        с подсказкой высота строки зарезервирована (см. CSS).
      */}
      <div class="sui-field__messages">
        <Show when={hasContent(props.hint)}>
          <span class="sui-field__hint" id={hintId()}>
            {props.hint}
          </span>
        </Show>
        <Show when={hasContent(props.error)}>
          <span class="sui-field__error" id={errorId()}>
            {props.error}
          </span>
        </Show>
      </div>
    </div>
  );
}
