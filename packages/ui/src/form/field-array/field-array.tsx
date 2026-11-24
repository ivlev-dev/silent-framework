import type { Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import { For, Show, createSignal } from "@ivlev-dev/silent-core";
import type { Form, FormArray } from "@ivlev-dev/silent-form";
import type { Attrs } from "../../internal/props.js";
import { useUiConfig } from "../../theme/config.js";
import { hasContent } from "../internal/control.js";

export interface FieldArrayProps<T extends Form> {
  readonly array: FormArray<T>;
  readonly children: (item: T, index: number) => Children;
  /** Ключ строки; по умолчанию — сам элемент (стабильная ссылка формы). */
  readonly keyOf?: ((item: T) => unknown) | undefined;
  readonly label?: Children;
  readonly hint?: Children;
  readonly disabled?: boolean | undefined;
  readonly addLabel?: string | undefined;
  readonly removeLabel?: string | undefined;
  readonly moveUpLabel?: string | undefined;
  readonly moveDownLabel?: string | undefined;
  readonly min?: number | undefined;
  readonly max?: number | undefined;
  /** Показывать кнопки перемещения (по умолчанию да). */
  readonly allowMove?: boolean | undefined;
  readonly onAdd?: ((item: T) => void) | undefined;
  readonly onRemove?: ((index: number) => void) | undefined;
  readonly onMove?: ((from: number, to: number) => void) | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
}

function identityKey<T>(item: T): T {
  return item;
}

/**
 * Повторяемая группа полей поверх `FormArray`.
 *
 * Ключ строки — сам элемент формы, поэтому `add`/`remove`/`move` не
 * пересоздают контролы и не теряют фокус внутри перемещаемой строки.
 */
export function FieldArray<T extends Form>(props: FieldArrayProps<T>): Node {
  const config = useUiConfig();
  // `FormArray.items` — не сигнал: структурные операции через UI помечаем
  // локальной ревизией, чтобы `For` пересобрал строки.
  const [revision, setRevision] = createSignal(0);
  let addButton: HTMLButtonElement | null = null;
  const bump = (): void => {
    setRevision((value) => value + 1);
  };
  const items = (): readonly T[] => {
    revision();
    return props.array.items;
  };
  const lengthOf = (): number => {
    revision();
    return props.array.length;
  };
  const addDisabled = (): boolean =>
    props.disabled === true
    || (props.max !== undefined && lengthOf() >= props.max);
  const removeDisabled = (): boolean =>
    props.disabled === true
    || (props.min !== undefined && lengthOf() <= props.min);
  const add = (): void => {
    const item = props.array.add();
    bump();
    props.onAdd?.(item);
  };
  const remove = (index: number): void => {
    props.array.remove(index);
    bump();
    props.onRemove?.(index);
    // Фокус не теряется в удалённой строке: уводим его на стабильную кнопку.
    if (typeof document !== "undefined" && addButton !== null) {
      addButton.focus();
    }
  };
  const move = (from: number, to: number): void => {
    props.array.move(from, to);
    bump();
    props.onMove?.(from, to);
  };
  return (
    <fieldset
      {...props.attrs}
      class={["sui-field-array", props.class]}
      style={props.style}
      data-disabled={props.disabled === true ? "" : undefined}
    >
      <Show when={hasContent(props.label)}>
        <legend class="sui-field-array__legend">{props.label}</legend>
      </Show>
      <Show when={hasContent(props.hint)}>
        <span class="sui-field-array__hint">{props.hint}</span>
      </Show>
      <Show when={props.array.ownErrors.length > 0}>
        <span class="sui-field-array__error" role="alert">
          {props.array.ownErrors[0]}
        </span>
      </Show>
      <div class="sui-field-array__items">
        <For
          each={items}
          keyOf={props.keyOf ?? identityKey}
        >
          {(item, index) => (
            <div class="sui-field-array__item" data-index={index()}>
              <div class="sui-field-array__item-header">
                <span class="sui-field-array__index" aria-hidden="true">
                  {index() + 1}
                </span>
                <div class="sui-field-array__actions">
                  <Show when={props.allowMove !== false}>
                    <button
                      type="button"
                      class="sui-field-array__action"
                      aria-label={`${props.moveUpLabel ?? config.strings.moveUp} ${index() + 1}`}
                      disabled={props.disabled === true || index() === 0}
                      onClick={() => {
                        move(index(), index() - 1);
                      }}
                    >
                      <span aria-hidden="true">↑</span>
                    </button>
                    <button
                      type="button"
                      class="sui-field-array__action"
                      aria-label={`${props.moveDownLabel ?? config.strings.moveDown} ${index() + 1}`}
                      disabled={
                        props.disabled === true || index() === lengthOf() - 1
                      }
                      onClick={() => {
                        move(index(), index() + 1);
                      }}
                    >
                      <span aria-hidden="true">↓</span>
                    </button>
                  </Show>
                  <button
                    type="button"
                    class="sui-field-array__action"
                    data-variant="danger"
                    aria-label={`${props.removeLabel ?? config.strings.removeItem} ${index() + 1}`}
                    disabled={removeDisabled()}
                    onClick={() => {
                      remove(index());
                    }}
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                </div>
              </div>
              <div class="sui-field-array__fields">
                {props.children(item, index())}
              </div>
            </div>
          )}
        </For>
      </div>
      <div class="sui-field-array__footer">
        <button
          ref={(node: Element | null) => {
            addButton = node instanceof HTMLButtonElement ? node : null;
          }}
          type="button"
          class="sui-field-array__add"
          disabled={addDisabled()}
          onClick={add}
        >
          {props.addLabel ?? config.strings.addItem}
        </button>
      </div>
    </fieldset>
  );
}
