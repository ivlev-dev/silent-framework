import type { Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import {
  For,
  Show,
  component,
  createSignal,
  onCleanup,
  type ForProps,
} from "@ivlev-dev/silent-core";
import { CloseIcon } from "../../icons/close.js";
import type { Attrs } from "../../internal/props.js";
import { useUiConfig } from "../../theme/config.js";
import {
  clientEffect,
  useDismiss,
  useMounted,
} from "../../internal/overlay.js";
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
  childrenText,
  filterOptions,
} from "../internal/listbox-filter.js";
import {
  createSelectChangeEvent,
  flattenListbox,
  indexOfValue,
  listboxId,
  listboxOptionId,
  nextEnabledIndex,
} from "../internal/listbox-engine.js";
import { ListboxRows } from "../internal/listbox-view.js";
import {
  type TagNormalizer,
  type TagValidator,
  addTagValues,
  removeTagAt,
  splitTagText,
  tagValues,
} from "./tags.js";

export interface TagInputProps {
  readonly value?: readonly string[] | undefined;
  readonly defaultValue?: readonly string[] | undefined;
  readonly field?: BoundField<readonly string[]> | undefined;
  readonly suggestions?: readonly string[] | undefined;
  /** Асинхронные подсказки; устаревший запрос отменяется через `AbortSignal`. */
  readonly loadSuggestions?:
    | ((
        query: string,
        signal: AbortSignal,
      ) => Promise<readonly string[]>)
    | undefined;
  readonly allowCustom?: boolean | undefined;
  readonly max?: number | undefined;
  readonly minLength?: number | undefined;
  readonly maxLength?: number | undefined;
  /** `Enter` — клавиша, остальные строки — символьные разделители. */
  readonly delimiters?: readonly string[] | undefined;
  readonly splitOnPaste?: boolean | undefined;
  readonly unique?: boolean | undefined;
  /** Нормализация перед проверкой и добавлением; по умолчанию trim. */
  readonly normalize?: TagNormalizer | undefined;
  readonly validateTag?: TagValidator | undefined;
  readonly renderTag?: ((value: string, index: number) => Children) | undefined;
  readonly clearable?: boolean | undefined;
  readonly size?: ControlSize | undefined;
  readonly onValueChange?: ((value: readonly string[]) => void) | undefined;
  readonly label?: Children;
  readonly hint?: Children;
  readonly error?: Children;
  readonly placeholder?: string | undefined;
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

const DEFAULT_DELIMITERS: readonly string[] = [",", "Enter"];

function sameTags(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && left.every((tag, index) => tag === right[index]);
}

/** Прямой `For`: JSX-тег на SSR превращается в дыру без строк списка. */
function renderFor<T>(props: ForProps<T>): Node {
  return component(
    For as unknown as Parameters<typeof component>[0],
    props as unknown as Record<string, unknown>,
  );
}

/**
 * Поле тегов: чипы, текстовый ввод и listbox подсказок. Контейнер имеет
 * роль `combobox`, а ввод остаётся обычным `input` с `aria-activedescendant`.
 * Форма получает синтетическое `change` с `selectedOptions`.
 */
export function TagInput(props: TagInputProps): Node {
  const config = useUiConfig();
  const id = resolveControlId(
    props.id ?? props.field?.id,
    props.name ?? props.field?.name,
    "tag-input",
  );
  const listId = listboxId(id);
  const mounted = useMounted();
  const [internal, setInternal] = createSignal<readonly string[]>(
    props.defaultValue ?? [],
  );
  const [querySignal, setQuerySignal] = createSignal("");
  const [openSignal, setOpenSignal] = createSignal(false);
  const [activeKeySignal, setActiveKeySignal] = createSignal<string | null>(null);
  const [loaded, setLoaded] = createSignal<readonly string[] | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [rootElement, setRootElement] = createSignal<HTMLElement | null>(null);
  const [inputElement, setInputElement] = createSignal<HTMLInputElement | null>(
    null,
  );
  let controller: AbortController | null = null;
  let requestId = 0;

  const disabledOf = (): boolean => props.disabled === true;
  const readOnlyOf = (): boolean => props.readOnly === true;
  const tags = (): readonly string[] => {
    if (props.value !== undefined) return tagValues(props.value);
    if (props.field !== undefined) return tagValues(props.field.value);
    return internal();
  };
  const query = (): string => querySignal();
  const visible = (): boolean =>
    mounted()
    && openSignal()
    && !disabledOf()
    && (filteredSuggestions().length > 0 || loading());
  const activeKey = (): string | null => activeKeySignal();
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
  const described = (): string | undefined =>
    describedBy(
      props.describedBy,
      hasContent(hintOf()) ? hintIdFor(id) : undefined,
      hasContent(errorOf()) ? errorIdFor(id) : undefined,
    );
  const delimiters = (): readonly string[] =>
    props.delimiters ?? DEFAULT_DELIMITERS;
  const allowCustom = (): boolean => props.allowCustom !== false;

  const pool = (): readonly string[] => loaded() ?? props.suggestions ?? [];
  const filteredSuggestions = (): readonly string[] => {
    const options = pool().map((value) => ({ value, label: value }));
    const filtered = filterOptions(options, query());
    const selected = tags();
    const unique = props.unique !== false;
    return filtered
      .map((option) => String(option.value))
      .filter((value) => !unique || !selected.includes(value));
  };
  const flat = () =>
    flattenListbox(
      filteredSuggestions().map((value) => ({ value, label: value })),
    );
  const activeOptionId = (): string | undefined => {
    if (!visible()) return undefined;
    const index = indexOfValue(flat(), activeKey());
    return index < 0 ? undefined : listboxOptionId(id, index);
  };
  const comboboxLabel = (): string | undefined => {
    const text = childrenText(labelOf()).trim();
    if (text !== "") return text;
    const placeholder = props.placeholder ?? props.field?.placeholder;
    return placeholder === undefined || placeholder === "" ? undefined : placeholder;
  };

  const close = (): void => {
    setOpenSignal(false);
    setActiveKeySignal(null);
  };
  const open = (): void => {
    if (disabledOf() || readOnlyOf()) return;
    setOpenSignal(true);
  };

  const emit = (next: readonly string[]): void => {
    if (props.value === undefined && props.field === undefined) {
      setInternal(next);
    }
    props.onValueChange?.(next);
    const change = createSelectChangeEvent(next, true);
    props.field?.onChange(change);
    props.onChange?.(change);
  };

  const addCandidates = (candidates: readonly string[]): boolean => {
    if (disabledOf() || readOnlyOf()) return false;
    const current = tags();
    const next = addTagValues(current, candidates, {
      max: props.max,
      minLength: props.minLength,
      maxLength: props.maxLength,
      unique: props.unique,
      normalize: props.normalize,
      validate: props.validateTag,
    });
    if (sameTags(next, current)) return false;
    emit(next);
    setQuerySignal("");
    close();
    return true;
  };

  const addQuery = (): boolean => {
    if (!allowCustom()) return false;
    return addCandidates([query()]);
  };

  const choose = (value: string): void => {
    addCandidates([value]);
  };

  const removeAt = (index: number): void => {
    if (disabledOf() || readOnlyOf()) return;
    const current = tags();
    const next = removeTagAt(current, index);
    if (sameTags(next, current)) return;
    emit(next);
  };

  const clearAll = (): void => {
    if (disabledOf() || readOnlyOf() || tags().length === 0) return;
    emit([]);
    setQuerySignal("");
    close();
    inputElement()?.focus({ preventScroll: true });
  };

  const moveActive = (direction: 1 | -1): void => {
    open();
    const options = flat();
    if (options.length === 0) {
      setActiveKeySignal(null);
      return;
    }
    const current = indexOfValue(options, activeKey());
    const next = nextEnabledIndex(options, current, direction, true);
    setActiveKeySignal(next < 0 ? null : options[next]?.key ?? null);
  };

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey) return;
    if (disabledOf() || readOnlyOf()) return;
    const html = event as KeyboardEvent & { readonly isComposing?: boolean };
    if (html.isComposing === true) return;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Escape") {
      if (visible()) {
        event.preventDefault();
        close();
      }
      return;
    }
    if (event.key === "Backspace" && query() === "") {
      if (tags().length > 0) {
        event.preventDefault();
        removeAt(tags().length - 1);
      }
      return;
    }

    const enterLike = event.key === "Enter" || event.key === "NumpadEnter";
    const inDelimiters = enterLike
      ? delimiters().includes("Enter")
      : delimiters().includes(event.key);
    if (enterLike && activeKey() !== null) {
      event.preventDefault();
      choose(activeKey()!);
      return;
    }
    if (inDelimiters) {
      const added = addQuery();
      if (added || !enterLike) event.preventDefault();
    }
  };

  const handleInput = (event: InputEvent): void => {
    const target = event.currentTarget;
    if (!(target instanceof HTMLInputElement)) return;
    setQuerySignal(target.value);
    setActiveKeySignal(null);
    if (target.value !== "") open();
  };

  const handlePaste = (event: ClipboardEvent): void => {
    if (disabledOf() || readOnlyOf()) return;
    const text = event.clipboardData?.getData("text") ?? "";
    if (text === "") return;
    event.preventDefault();
    if (!allowCustom()) return;
    const prefix = query();
    const source = prefix === "" ? text : `${prefix}${text}`;
    const candidates = props.splitOnPaste === false
      ? [source]
      : splitTagText(source, delimiters());
    addCandidates(candidates);
  };

  const handleFocusOut = (event: FocusEvent): void => {
    const root = rootElement();
    const next = event.relatedTarget;
    if (next instanceof Node && root !== null && root.contains(next)) return;
    close();
    props.field?.onBlur(event);
    props.onBlur?.(event);
  };

  useDismiss(rootElement, visible, close, { escape: false });

  const cancelLoad = (): void => {
    controller?.abort();
    controller = null;
    requestId += 1;
    setLoading(false);
  };

  clientEffect(() => {
    const load = props.loadSuggestions;
    const enabled = mounted() && openSignal() && !disabledOf();
    const text = query();
    if (load === undefined) return;
    if (!enabled) {
      cancelLoad();
      return;
    }
    controller?.abort();
    const nextController = new AbortController();
    controller = nextController;
    const currentRequest = requestId + 1;
    requestId = currentRequest;
    setLoading(true);
    void load(text, nextController.signal)
      .then((items) => {
        if (currentRequest !== requestId || nextController.signal.aborted) return;
        setLoaded(items);
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (currentRequest !== requestId || nextController.signal.aborted) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLoading(false);
      });
  });

  onCleanup(() => {
    cancelLoad();
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
        class="sui-tag-input"
        role="combobox"
        data-size={props.size ?? "md"}
        data-invalid={invalidOf() ? "" : undefined}
        data-disabled={disabledOf() ? "" : undefined}
        data-readonly={readOnlyOf() ? "" : undefined}
        data-validating={props.field?.isValidating === true ? "" : undefined}
        data-limit={
          props.max !== undefined && tags().length >= props.max
            ? "max"
            : undefined
        }
        data-empty={tags().length === 0 ? "" : undefined}
        aria-label={comboboxLabel()}
        aria-expanded={visible() ? "true" : "false"}
        aria-haspopup="listbox"
        aria-controls={visible() ? listId : undefined}
        aria-describedby={described()}
        aria-invalid={invalidOf() ? "true" : undefined}
        aria-required={requiredOf() ? "true" : undefined}
        aria-busy={props.field?.isValidating === true ? "true" : undefined}
        onFocusIn={(event: FocusEvent) => {
          props.field?.onFocus(event);
          props.onFocus?.(event);
        }}
        onFocusOut={handleFocusOut}
      >
        <div class="sui-tag-input__chips">
          {renderFor({
            each: tags,
            keyOf: (tag: string, index: number) => `${index}:${tag}`,
            children: (tag: string, position) => (
              <span
                class="sui-tag-input__chip"
                data-disabled={disabledOf() ? "" : undefined}
              >
                <span class="sui-tag-input__chip-text">
                  {props.renderTag !== undefined
                    ? props.renderTag(tag, position())
                    : tag}
                </span>
                <Show when={!disabledOf() && !readOnlyOf()}>
                  <button
                    type="button"
                    class="sui-tag-input__remove"
                    tabindex="-1"
                    aria-label={`${config.strings.removeTag}: ${tag}`}
                    onMouseDown={(event: MouseEvent) => {
                      event.preventDefault();
                    }}
                    onClick={() => {
                      removeAt(position());
                    }}
                  >
                    <CloseIcon size="sm" />
                  </button>
                </Show>
              </span>
            ),
          })}
          <input
            ref={(node: Element | null) => {
              setInputElement(node as HTMLInputElement | null);
            }}
            id={id}
            class="sui-tag-input__input"
            type="text"
            inputMode="text"
            autocomplete="off"
            placeholder={props.placeholder ?? props.field?.placeholder ?? ""}
            disabled={disabledOf()}
            readOnly={readOnlyOf()}
            aria-required={requiredOf() ? "true" : undefined}
            aria-invalid={invalidOf() ? "true" : undefined}
            aria-readonly={readOnlyOf() ? "true" : undefined}
            aria-describedby={described()}
            aria-autocomplete="list"
            aria-activedescendant={activeOptionId()}
            aria-expanded={visible() ? "true" : "false"}
            aria-controls={visible() ? listId : undefined}
            bindValue={[query, NO_WRITE]}
            onInput={handleInput}
            onPaste={(event: ClipboardEvent) => {
              handlePaste(event);
            }}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              open();
            }}
            onClick={() => {
              open();
            }}
          />
        </div>
        <Show
          when={
            props.clearable === true
            && tags().length > 0
            && !disabledOf()
            && !readOnlyOf()
          }
        >
          <button
            type="button"
            class="sui-tag-input__clear"
            tabindex="-1"
            aria-label={config.strings.clear}
            onMouseDown={(event: MouseEvent) => {
              event.preventDefault();
            }}
            onClick={clearAll}
          >
            <CloseIcon size="sm" />
          </button>
        </Show>
        {renderFor({
          each: tags,
          keyOf: (tag: string, index: number) => `${index}:${tag}`,
          children: (_tag: string, position) => {
            const readTag = (): string => tags()[position()] ?? "";
            return (
              <input
                type="hidden"
                name={nameOf()}
                bindValue={[readTag, NO_WRITE]}
              />
            );
          },
        })}
        <Show when={visible()}>
          <div
            class="sui-popup"
            data-side="bottom"
            onMouseDown={(event: MouseEvent) => {
              event.preventDefault();
            }}
          >
            <div
              id={listId}
              class="sui-popup__list"
              role="listbox"
              aria-label={comboboxLabel()}
            >
              <Show
                when={filteredSuggestions().length > 0}
                fallback={
                  <Show
                    when={loading()}
                    fallback={
                      <div class="sui-popup__empty">{config.strings.noData}</div>
                    }
                  >
                    <div class="sui-popup__loading" role="status">
                      {config.strings.loading}
                    </div>
                  </Show>
                }
              >
                <ListboxRows
                  options={flat}
                  baseId={id}
                  activeKey={activeKey}
                  selected={() => false}
                  onActivate={(option) => {
                    setActiveKeySignal(String(option.value));
                  }}
                  onPick={(option) => {
                    choose(String(option.value));
                  }}
                />
                <Show when={loading()}>
                  <div class="sui-popup__loading" role="status">
                    {config.strings.loading}
                  </div>
                </Show>
              </Show>
            </div>
          </div>
        </Show>
      </div>
    </Field>
  );
}
