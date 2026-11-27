import type { Children } from "@ivlev-dev/silent-core";
import {
  Show,
  createSignal,
  onCleanup,
  untrack,
} from "@ivlev-dev/silent-core";
import { ChevronDownIcon } from "../../icons/chevron-down.js";
import { CloseIcon } from "../../icons/close.js";
import {
  bindOpenState,
  clientEffect,
  useDismiss,
  useFloating,
  useMounted,
} from "../../internal/overlay.js";
import { useUiConfig } from "../../theme/config.js";
import { Field } from "../field/field.js";
import {
  NO_WRITE,
  describedBy,
  errorIdFor,
  hasContent,
  hintIdFor,
  resolveControlId,
} from "../internal/control.js";
import {
  childrenText,
  filterListboxItems,
  normalizeSearch,
} from "../internal/listbox-filter.js";
import {
  type FlatListboxOption,
  type ListboxValue,
  createSelectChangeEvent,
  edgeEnabledIndex,
  flattenListbox,
  indexOfValue,
  listboxId,
  listboxKey,
  listboxOptionId,
  nextEnabledIndex,
  pageEnabledIndex,
  singleValueKey,
} from "../internal/listbox-engine.js";
import { ListboxRows } from "../internal/listbox-view.js";
import type {
  SelectItem,
  SelectOption,
  SelectValue,
} from "../select/types.js";
import type { BoundField, ControlSize } from "../internal/control.js";
import type { ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import type { Attrs } from "../../internal/props.js";

export interface ComboboxProps {
  readonly options: readonly SelectItem[];
  readonly value?: SelectValue | undefined;
  readonly defaultValue?: SelectValue | undefined;
  readonly onValueChange?: ((value: SelectValue) => void) | undefined;
  readonly onQueryChange?: ((query: string) => void) | undefined;
  readonly field?: BoundField<string | number> | undefined;
  readonly allowCustomValue?: boolean | undefined;
  readonly creatable?: boolean | undefined;
  readonly createOption?:
    | ((query: string) => SelectOption | null | undefined)
    | undefined;
  readonly loadOptions?:
    | ((
        query: string,
        signal: AbortSignal,
      ) => Promise<readonly SelectItem[]>)
    | undefined;
  readonly loading?: boolean | undefined;
  readonly loadingText?: Children;
  readonly empty?: Children;
  readonly openOnFocus?: boolean | undefined;
  readonly openOnInput?: boolean | undefined;
  readonly minQueryLength?: number | undefined;
  readonly debounce?: number | undefined;
  readonly selectOnTab?: boolean | undefined;
  readonly clearable?: boolean | undefined;
  readonly renderOption?: ((option: SelectOption) => Children) | undefined;
  readonly maxVisible?: number | undefined;
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
  readonly bare?: boolean | undefined;
  readonly describedBy?: string | undefined;
  readonly ariaLabel?: string | undefined;
  readonly onBlur?: ((event: FocusEvent) => void) | undefined;
  readonly onFocus?: ((event: FocusEvent) => void) | undefined;
  readonly onChange?: ((event: Event) => void) | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
}

function optionValueByKey(
  flat: readonly FlatListboxOption[],
  key: string,
): ListboxValue | null {
  for (const entry of flat) {
    if (entry.key === key) return entry.option.value;
  }
  return null;
}

/**
 * Combobox: поле ввода + отфильтрованный listbox. Фокус остаётся в input,
 * активная строка — `aria-activedescendant`. Поддерживает свободное значение,
 * создание опции и асинхронную загрузку с отменой устаревших ответов.
 */
export function Combobox(props: ComboboxProps): Node {
  const config = useUiConfig();
  const id = resolveControlId(
    props.id ?? props.field?.id,
    props.name ?? props.field?.name,
    "combobox",
  );
  const listId = listboxId(id);
  const disabled = (): boolean => props.disabled === true;
  const readOnly = (): boolean => props.readOnly === true;
  const labelOf = (): Children =>
    props.label !== undefined ? props.label : props.field?.label;
  const hintOf = (): Children =>
    props.hint !== undefined ? props.hint : props.field?.hint;
  const errorOf = (): Children =>
    props.error !== undefined ? props.error : props.field?.error;
  const placeholderOf = (): string | undefined =>
    props.placeholder ?? props.field?.placeholder;
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

  const mounted = useMounted();
  const openState = bindOpenState({
    open: () => undefined,
    defaultOpen: () => false,
    onOpenChange: () => undefined,
  });
  const visible = (): boolean => mounted() && openState.isOpen();

  const [uncontrolledValue, setUncontrolledValue] = createSignal<unknown>(
    props.defaultValue,
  );
  const rawValue = (): unknown => {
    if (props.value !== undefined) return props.value;
    if (props.field !== undefined) return props.field.value;
    return uncontrolledValue();
  };
  const selectedKey = (): string => singleValueKey(rawValue());

  const [loadedItems, setLoadedItems] = createSignal<readonly SelectItem[] | null>(
    null,
  );
  const [committedOption, setCommittedOption] = createSignal<SelectOption | null>(
    null,
  );
  const baseItems = (): readonly SelectItem[] => {
    const items = loadedItems() ?? props.options;
    const committed = committedOption();
    if (committed === null) return items;
    const exists = flattenListbox(items).some(
      (entry) => entry.key === listboxKey(committed.value),
    );
    return exists ? items : [committed, ...items];
  };
  const fullFlat = (): readonly FlatListboxOption[] =>
    flattenListbox(baseItems());
  const selectedOptions = (): SelectOption[] =>
    fullFlat()
      .filter((entry) => entry.key === selectedKey())
      .map((entry) => entry.option);
  const selectedText = (): string => {
    const [option] = selectedOptions();
    if (option !== undefined) return childrenText(option.label);
    return selectedKey();
  };

  const [querySignal, setQuerySignal] = createSignal("");
  const [typed, setTyped] = createSignal(false);
  const [cleared, setCleared] = createSignal(false);
  const minQueryLength = (): number => Math.max(0, props.minQueryLength ?? 0);
  const filterText = (): string => {
    if (!typed()) return "";
    const text = querySignal();
    return text.length < minQueryLength() ? "" : text;
  };

  const createOptionForQuery = (): SelectOption | null => {
    if (!typed()) return null;
    if (
      props.createOption === undefined
      && props.creatable !== true
      && props.allowCustomValue !== true
    ) {
      return null;
    }
    const text = querySignal().trim();
    if (text === "") return null;
    const normalized = normalizeSearch(text);
    const exists = fullFlat().some(
      (entry) => normalizeSearch(childrenText(entry.option.label)) === normalized,
    );
    if (exists) return null;
    if (props.createOption !== undefined) {
      return props.createOption(text) ?? null;
    }
    return { value: text, label: text };
  };

  const sourceItems = (): readonly SelectItem[] => {
    const text = filterText();
    const filtered = text === "" ? baseItems() : filterListboxItems(baseItems(), text);
    const created = createOptionForQuery();
    return created === null ? filtered : [created, ...filtered];
  };
  const flat = (): readonly FlatListboxOption[] =>
    flattenListbox(sourceItems());

  const [activeKeySignal, setActiveKeySignal] = createSignal<string | null>(null);
  const activeKey = (): string | null => activeKeySignal();

  // --- загрузка ---------------------------------------------------------
  const [loadingState, setLoadingState] = createSignal(false);
  let controller: AbortController | null = null;
  let requestId = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cancelPending = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    controller?.abort();
    controller = null;
    requestId += 1;
    setLoadingState(false);
  };
  const runLoad = (text: string): void => {
    const load = props.loadOptions;
    if (load === undefined) return;
    controller?.abort();
    const nextController = new AbortController();
    controller = nextController;
    const currentRequest = requestId + 1;
    requestId = currentRequest;
    setLoadingState(true);
    void load(text, nextController.signal)
      .then((items) => {
        if (currentRequest !== requestId || nextController.signal.aborted) return;
        setLoadedItems(items);
        setLoadingState(false);
      })
      .catch((error: unknown) => {
        if (currentRequest !== requestId || nextController.signal.aborted) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLoadingState(false);
      });
  };

  clientEffect(() => {
    const open = visible();
    const text = typed() ? querySignal() : "";
    const min = minQueryLength();
    const delay = Math.max(0, props.debounce ?? 0);
    if (props.loadOptions === undefined) return;
    if (!open) {
      cancelPending();
      return;
    }
    if (text.length < min) {
      cancelPending();
      return;
    }
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (delay === 0) {
      untrack(() => {
        runLoad(text);
      });
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      untrack(() => {
        runLoad(text);
      });
    }, delay);
  });

  onCleanup(() => {
    cancelPending();
  });

  const isLoading = (): boolean => props.loading === true || loadingState();

  // --- refs -------------------------------------------------------------
  const [rootElement, setRootElement] = createSignal<HTMLElement | null>(null);
  const [inputElement, setInputElement] = createSignal<HTMLInputElement | null>(
    null,
  );
  const [panelElement, setPanelElement] = createSignal<HTMLElement | null>(null);
  const side = useFloating({
    anchor: inputElement,
    panel: panelElement,
    isOpen: visible,
    preferred: () => "bottom",
    matchAnchorWidth: true,
  });

  // --- открытие ---------------------------------------------------------
  const open = (resetQuery: boolean): void => {
    if (disabled()) return;
    if (resetQuery) {
      setQuerySignal(selectedText());
      setTyped(false);
    }
    setCleared(false);
    openState.requestOpen(true);
    const input = inputElement();
    if (input !== null) {
      input.focus({ preventScroll: true });
      input.select?.();
    }
  };
  /** Открытие без потери введённого запроса. */
  const openForInteraction = (): void => {
    open(!typed());
  };
  const close = (restoreFocus: boolean): void => {
    if (!visible()) return;
    openState.requestOpen(false);
    setQuerySignal("");
    setTyped(false);
    if (restoreFocus) inputElement()?.focus({ preventScroll: true });
  };
  const toggleOpen = (): void => {
    if (disabled()) return;
    if (visible()) close(true);
    else open(true);
  };

  useDismiss(rootElement, visible, () => close(false), { escape: false });

  // Активная строка после фильтрации/загрузки.
  clientEffect(() => {
    flat();
    visible();
    untrack(() => {
      if (!visible()) return;
      const options = flat();
      if (options.length === 0) {
        setActiveKeySignal(null);
        return;
      }
      const current = activeKey();
      if (current !== null && indexOfValue(options, current) >= 0) return;
      const selected = selectedKey();
      if (selected !== "" && indexOfValue(options, selected) >= 0) {
        setActiveKeySignal(selected);
        return;
      }
      const first = edgeEnabledIndex(options, "first");
      setActiveKeySignal(first >= 0 ? options[first]!.key : null);
    });
  });

  const activeOptionId = (): string | undefined => {
    if (!visible()) return undefined;
    const index = indexOfValue(flat(), activeKey());
    return index < 0 ? undefined : listboxOptionId(id, index);
  };

  // --- выбор ------------------------------------------------------------
  const emitValue = (keys: readonly string[]): void => {
    const options = fullFlat();
    const values = keys
      .map((key) => optionValueByKey(options, key))
      .filter((value): value is ListboxValue => value !== null);
    const next = values[0] ?? "";
    if (props.value === undefined && props.field === undefined) {
      setUncontrolledValue(next);
    }
    props.onValueChange?.(next);
    const change = createSelectChangeEvent(keys, false);
    props.field?.onChange(change);
    props.onChange?.(change);
  };

  const commitCustom = (option: SelectOption): void => {
    setCommittedOption(option);
    emitValue([listboxKey(option.value)]);
    setQuerySignal(childrenText(option.label));
    setTyped(false);
    setCleared(false);
    setActiveKeySignal(listboxKey(option.value));
    close(true);
  };

  const pick = (option: SelectOption): void => {
    if (disabled() || readOnly() || option.disabled === true) return;
    const key = listboxKey(option.value);
    const exists = fullFlat().some((entry) => entry.key === key);
    if (!exists) {
      commitCustom(option);
      return;
    }
    emitValue([key]);
    setQuerySignal("");
    setTyped(false);
    setCleared(false);
    setActiveKeySignal(key);
    close(true);
  };

  const clear = (event: Event): void => {
    event.stopPropagation();
    if (disabled() || readOnly()) return;
    setCommittedOption(null);
    emitValue([]);
    setQuerySignal("");
    setTyped(false);
    setCleared(false);
    inputElement()?.focus({ preventScroll: true });
  };

  const submitTyped = (): boolean => {
    const options = flat();
    const index = indexOfValue(options, activeKey());
    const entry = index >= 0 ? options[index] : options[0];
    if (entry !== undefined) {
      pick(entry.option);
      return true;
    }
    if (props.allowCustomValue === true) {
      const text = querySignal().trim();
      if (text !== "") {
        commitCustom({ value: text, label: text });
        return true;
      }
    }
    return false;
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (disabled()) return;
    const key = event.key;

    if (key === "Escape") {
      event.preventDefault();
      if (visible()) {
        close(true);
        return;
      }
      if (!cleared()) {
        setQuerySignal("");
        setTyped(false);
        setCleared(true);
        props.onQueryChange?.("");
      }
      return;
    }

    if (key === "ArrowDown" || key === "ArrowUp") {
      event.preventDefault();
      if (!visible()) {
        openForInteraction();
        return;
      }
      const options = flat();
      const current = options.findIndex((entry) => entry.key === activeKey());
      const index = nextEnabledIndex(
        options,
        current,
        key === "ArrowDown" ? 1 : -1,
        true,
      );
      if (index >= 0) setActiveKeySignal(options[index]!.key);
      return;
    }

    if (key === "PageDown" || key === "PageUp") {
      if (!visible()) return;
      event.preventDefault();
      const options = flat();
      const current = options.findIndex((entry) => entry.key === activeKey());
      const index = pageEnabledIndex(
        options,
        current,
        key === "PageDown" ? 1 : -1,
        Math.max(1, props.maxVisible ?? 8),
      );
      if (index >= 0) setActiveKeySignal(options[index]!.key);
      return;
    }

    if (key === "Enter") {
      event.preventDefault();
      if (visible()) {
        submitTyped();
      } else {
        openForInteraction();
      }
      return;
    }

    if (key === "Tab") {
      if (props.selectOnTab === true && visible()) {
        const options = flat();
        const current = options.findIndex((entry) => entry.key === activeKey());
        const entry = options[current];
        if (entry !== undefined) pick(entry.option);
      }
      close(false);
      return;
    }

    if (
      key.length === 1
      && !event.ctrlKey
      && !event.metaKey
      && !event.altKey
      && !visible()
      && props.openOnInput !== false
    ) {
      open(false);
      setQuerySignal(key);
      setTyped(true);
      setCleared(false);
      event.preventDefault();
      return;
    }

    if (key === "Home" || key === "End") return;
  };

  const handleInput = (event: Event): void => {
    const target = event.currentTarget as HTMLInputElement | null;
    const next = target?.value ?? "";
    if (!visible() && props.openOnInput !== false) open(false);
    setQuerySignal(next);
    setTyped(true);
    setCleared(false);
    props.onQueryChange?.(next);
  };

  const handleFocus = (event: FocusEvent): void => {
    props.field?.onFocus(event);
    props.onFocus?.(event);
    if (props.openOnFocus === true && !visible()) open(true);
  };

  const handleBlur = (event: FocusEvent): void => {
    const next = event.relatedTarget;
    const root = rootElement();
    if (next instanceof Node && root !== null && root.contains(next)) return;
    props.field?.onBlur(event);
    props.onBlur?.(event);
    if (visible()) close(false);
  };

  const readHiddenValue = (): string => selectedKey();
  const inputValue = (): string => {
    if (visible()) return querySignal();
    if (cleared()) return "";
    return selectedText();
  };
  const comboboxLabel = (): string | undefined => {
    if (props.ariaLabel !== undefined) return props.ariaLabel;
    const labelText = childrenText(labelOf());
    if (labelText !== "") return labelText;
    return placeholderOf();
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
        ref={(node: Element | null) => {
          setRootElement(node as HTMLElement | null);
        }}
        class="sui-combobox"
        data-size={props.size ?? "md"}
        data-invalid={invalidOf() ? "" : undefined}
        data-disabled={disabled() ? "" : undefined}
        data-readonly={readOnly() ? "" : undefined}
        data-validating={props.field?.isValidating === true ? "" : undefined}
        data-bare={props.bare === true ? "" : undefined}
        data-open={visible() ? "" : undefined}
        data-has-value={selectedKey() !== "" ? "" : undefined}
      >
        <input
          ref={(node: Element | null) => {
            setInputElement(node as HTMLInputElement | null);
          }}
          id={id}
          class="sui-combobox__input"
          type="text"
          role="combobox"
          autocomplete="off"
          value={inputValue()}
          placeholder={placeholderOf() ?? ""}
          disabled={disabled()}
          readOnly={readOnly()}
          required={requiredOf()}
          aria-required={requiredOf() ? "true" : undefined}
          aria-invalid={invalidOf() ? "true" : undefined}
          aria-readonly={readOnly() ? "true" : undefined}
          aria-busy={props.field?.isValidating === true ? "true" : undefined}
          aria-describedby={described()}
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-expanded={visible() ? "true" : "false"}
          aria-controls={mounted() ? listId : undefined}
          aria-activedescendant={activeOptionId()}
          aria-label={comboboxLabel()}
          onInput={handleInput}
          onKeyDown={onKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onClick={() => {
            if (!visible()) openForInteraction();
          }}
        />
        <span class="sui-combobox__indicators">
          <Show
            when={
              props.clearable === true
              && selectedKey() !== ""
              && !disabled()
              && !readOnly()
            }
          >
            <button
              type="button"
              class="sui-combobox__clear"
              tabindex="-1"
              aria-label={config.strings.clear}
              onMouseDown={(event: MouseEvent) => {
                event.preventDefault();
              }}
              onClick={clear}
            >
              <CloseIcon size="sm" />
            </button>
          </Show>
          <span class="sui-combobox__arrow" aria-hidden="true">
            <ChevronDownIcon size="sm" />
          </span>
        </span>
        <input
          type="hidden"
          name={nameOf()}
          bindValue={[readHiddenValue, NO_WRITE]}
        />
        <Show when={visible()}>
          <div
            ref={(node: Element | null) => {
              setPanelElement(node as HTMLElement | null);
            }}
            class="sui-popup"
            data-side={side()}
            style={{
              "--sui-popup-max-visible": String(props.maxVisible ?? 8),
            }}
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
                when={flat().length > 0}
                fallback={
                  <Show
                    when={isLoading()}
                    fallback={
                      <div class="sui-popup__empty">
                        {props.empty ?? config.strings.noData}
                      </div>
                    }
                  >
                    <div class="sui-popup__loading" role="status">
                      {props.loadingText ?? config.strings.loading}
                    </div>
                  </Show>
                }
              >
                <ListboxRows
                  options={flat}
                  baseId={id}
                  activeKey={activeKey}
                  selected={(key) => key === selectedKey()}
                  renderOption={props.renderOption}
                  onActivate={(option) => {
                    setActiveKeySignal(listboxKey(option.value));
                  }}
                  onPick={(option) => {
                    pick(option);
                  }}
                />
                <Show when={isLoading()}>
                  <div class="sui-popup__loading" role="status">
                    {props.loadingText ?? config.strings.loading}
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
