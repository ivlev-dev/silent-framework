import type { Children } from "@ivlev-dev/silent-core";
import {
  For,
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
} from "../internal/listbox-filter.js";
import {
  type FlatListboxOption,
  type ListboxItem,
  type ListboxOption,
  type ListboxValue,
  createSelectChangeEvent,
  createTypeaheadState,
  edgeEnabledIndex,
  flattenListbox,
  indexOfValue,
  listboxId,
  listboxKey,
  listboxOptionId,
  nextEnabledIndex,
  pageEnabledIndex,
  toggleSelectedKey,
  typeahead,
  valueKeys,
} from "../internal/listbox-engine.js";
import { ListboxRows } from "../internal/listbox-view.js";
import type { SelectItem, SelectOption, SelectProps } from "./types.js";

function optionValueByKey(
  flat: readonly FlatListboxOption[],
  key: string,
): ListboxValue | null {
  for (const entry of flat) {
    if (entry.key === key) return entry.option.value;
  }
  return null;
}

function selectedKeysOf(value: unknown, multiple: boolean): string[] {
  const keys = valueKeys(value);
  if (multiple) return keys;
  return keys.length === 0 ? [] : [keys[0]!];
}

/**
 * `Select` на listbox-движке. Фокус остаётся на триггере (кнопка или
 * search-input), активная строка — `aria-activedescendant`. Панель и опции
 * создаются только после mount: SSR отдаёт закрытый триггер и hidden inputs.
 */
export function CustomSelect(props: SelectProps): Node {
  const config = useUiConfig();
  const id = resolveControlId(
    props.id ?? props.field?.id,
    props.name ?? props.field?.name,
    "select",
  );
  const listId = listboxId(id);
  const multiple = (): boolean => props.multiple === true;
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
    open: () => props.open,
    defaultOpen: () => props.defaultOpen === true,
    onOpenChange: props.onOpenChange,
  });
  const visible = (): boolean => mounted() && openState.isOpen();

  // --- значения ---------------------------------------------------------
  const [uncontrolledValue, setUncontrolledValue] = createSignal<unknown>(
    props.defaultValue,
  );
  const rawValue = (): unknown => {
    if (props.value !== undefined) return props.value;
    if (props.field !== undefined) return props.field.value;
    return uncontrolledValue();
  };
  const selectedKeys = (): string[] => selectedKeysOf(rawValue(), multiple());

  // --- опции и фильтр ---------------------------------------------------
  const [loadedItems, setLoadedItems] = createSignal<readonly SelectItem[] | null>(
    null,
  );
  const sourceItems = (): readonly SelectItem[] =>
    props.loadOptions === undefined
      ? props.options
      : loadedItems() ?? props.options;
  const fullFlat = (): readonly FlatListboxOption[] =>
    flattenListbox(sourceItems());
  const searchEnabled = (): boolean =>
    props.searchable === true
    || (props.searchable === "auto" && fullFlat().length >= 8);
  const [querySignal, setQuerySignal] = createSignal("");
  const query = (): string => (searchEnabled() ? querySignal() : "");
  const setQuery = (next: string): void => {
    setQuerySignal(next);
  };
  const visibleItems = (): readonly ListboxItem[] => {
    const text = query();
    if (text === "" || props.loadOptions !== undefined) return sourceItems();
    return filterListboxItems(sourceItems(), text);
  };
  const flat = (): readonly FlatListboxOption[] => flattenListbox(visibleItems());
  const selectedOptions = (): SelectOption[] =>
    fullFlat()
      .filter((entry) => selectedKeys().includes(entry.key))
      .map((entry) => entry.option);
  const selectedText = (): string =>
    selectedOptions()
      .map((option) => childrenText(option.label))
      .join(", ");

  // --- активная строка --------------------------------------------------
  const [activeKeySignal, setActiveKeySignal] = createSignal<string | null>(null);
  const activeKey = (): string | null => activeKeySignal();

  // --- загрузка опций ---------------------------------------------------
  const [loadingState, setLoadingState] = createSignal(false);
  const [loadErrorState, setLoadErrorState] = createSignal<Children | null>(
    null,
  );
  let controller: AbortController | null = null;
  let requestId = 0;
  let loadTimer: ReturnType<typeof setTimeout> | null = null;
  const cancelLoadTimer = (): void => {
    if (loadTimer !== null) {
      clearTimeout(loadTimer);
      loadTimer = null;
    }
  };
  const loadErrorMessage = (error: unknown): Children => {
    if (props.loadErrorText !== undefined) return props.loadErrorText;
    if (error instanceof Error && error.message !== "") return error.message;
    if (typeof error === "string" && error !== "") return error;
    return "Не удалось загрузить данные";
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
    setLoadErrorState(null);
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
        setLoadErrorState(loadErrorMessage(error));
        props.onLoadError?.(error);
      });
  };
  const scheduleLoad = (text: string): void => {
    cancelLoadTimer();
    controller?.abort();
    controller = null;
    setLoadErrorState(null);
    const delay = Math.max(0, props.searchDelay ?? 0);
    if (delay === 0) {
      runLoad(text);
      return;
    }
    loadTimer = setTimeout(() => {
      loadTimer = null;
      runLoad(text);
    }, delay);
  };
  const isLoading = (): boolean => props.loading === true || loadingState();

  clientEffect(() => {
    if (!visible() || props.loadOptions === undefined) return;
    const text = query();
    untrack(() => {
      scheduleLoad(text);
    });
  });

  onCleanup(() => {
    cancelLoadTimer();
    controller?.abort();
    controller = null;
  });

  // --- refs и позиционирование -----------------------------------------
  const [rootElement, setRootElement] = createSignal<HTMLElement | null>(null);
  const [controlElement, setControlElement] = createSignal<HTMLElement | null>(
    null,
  );
  const [panelElement, setPanelElement] = createSignal<HTMLElement | null>(null);
  const [inputElement, setInputElement] = createSignal<HTMLInputElement | null>(
    null,
  );
  const triggerElement = (): HTMLElement | null =>
    searchEnabled() ? inputElement() : controlElement();
  const side = useFloating({
    anchor: controlElement,
    panel: panelElement,
    isOpen: visible,
    preferred: () => "bottom",
    matchAnchorWidth: true,
  });

  // --- открытие/закрытие ------------------------------------------------
  const open = (): void => {
    if (disabled()) return;
    cancelLoadTimer();
    controller?.abort();
    controller = null;
    setLoadingState(false);
    setQuery("");
    setLoadErrorState(null);
    openState.requestOpen(true);
  };
  const close = (restoreFocus: boolean): void => {
    if (!visible()) return;
    cancelLoadTimer();
    controller?.abort();
    controller = null;
    setLoadingState(false);
    openState.requestOpen(false);
    setQuery("");
    setLoadErrorState(null);
    if (restoreFocus) triggerElement()?.focus({ preventScroll: true });
  };
  const toggle = (): void => {
    if (disabled()) return;
    if (visible()) close(true);
    else open();
  };

  useDismiss(rootElement, visible, () => close(false), { escape: false });

  // Активная строка: при фильтрации/смене options переносим на выбранную
  // или первую доступную, но не трогаем существующую.
  clientEffect(() => {
    flat();
    selectedKeys();
    visible();
    untrack(() => {
      const options = flat();
      if (options.length === 0) return;
      const key = activeKey();
      if (key !== null && indexOfValue(options, key) >= 0) return;
      const selected = selectedKeys().find(
        (item) => indexOfValue(options, item) >= 0,
      );
      if (selected !== undefined) {
        setActiveKeySignal(selected);
        return;
      }
      const first = edgeEnabledIndex(options, "first");
      if (first >= 0) setActiveKeySignal(options[first]!.key);
    });
  });

  clientEffect(() => {
    const key = activeKey();
    if (!visible() || key === null) return;
    const panel = panelElement();
    if (panel === null) return;
    const index = indexOfValue(flat(), key);
    if (index < 0) return;
    const row = panel.querySelector<HTMLElement>(
      `[data-option-index="${index}"]`,
    );
    if (row !== null && typeof row.scrollIntoView === "function") {
      row.scrollIntoView({ block: "nearest" });
    }
  });

  const activeOptionId = (): string | undefined => {
    if (!visible()) return undefined;
    const index = indexOfValue(flat(), activeKey());
    return index < 0 ? undefined : listboxOptionId(id, index);
  };

  // --- выбор значения ---------------------------------------------------
  const emitValue = (keys: readonly string[]): void => {
    const options = fullFlat();
    const values = keys
      .map((key) => optionValueByKey(options, key))
      .filter((value): value is ListboxValue => value !== null);
    const next = multiple() ? values : values[0] ?? "";
    if (props.value === undefined && props.field === undefined) {
      setUncontrolledValue(next);
    }
    props.onValueChange?.(next);
    const change = createSelectChangeEvent(keys, multiple());
    props.field?.onChange(change);
    props.onChange?.(change);
  };

  const pick = (option: ListboxOption): void => {
    if (disabled() || readOnly() || option.disabled === true) return;
    const key = listboxKey(option.value);
    const next = toggleSelectedKey(selectedKeys(), key, multiple());
    emitValue(next);
    setActiveKeySignal(key);
    if (multiple()) {
      setQuery("");
      triggerElement()?.focus({ preventScroll: true });
      return;
    }
    close(true);
  };

  const removeKey = (key: string): void => {
    if (disabled() || readOnly()) return;
    emitValue(selectedKeys().filter((item) => item !== key));
    triggerElement()?.focus({ preventScroll: true });
  };

  const clear = (event: Event): void => {
    event.stopPropagation();
    if (disabled() || readOnly()) return;
    emitValue([]);
    setQuery("");
    triggerElement()?.focus({ preventScroll: true });
  };

  const typeaheadState = createTypeaheadState();
  const onKeyDown = (event: KeyboardEvent): void => {
    if (disabled()) return;
    const key = event.key;
    const inInput = event.target === inputElement();

    if (!visible()) {
      if (key === "Escape") {
        if (query() !== "") {
          event.preventDefault();
          setQuery("");
        }
        return;
      }
      if (
        key === "ArrowDown"
        || key === "ArrowUp"
        || key === "Enter"
        || key === " "
      ) {
        event.preventDefault();
        open();
        return;
      }
      if (
        key.length === 1
        && key !== " "
        && !event.ctrlKey
        && !event.metaKey
        && !event.altKey
      ) {
        event.preventDefault();
        open();
        if (searchEnabled()) {
          setQuery(key);
          return;
        }
        const result = typeahead(
          typeaheadState,
          flat(),
          key,
          Date.now(),
          -1,
          (option) => childrenText(option.label),
        );
        if (result.index >= 0) {
          const entry = flat()[result.index];
          if (entry !== undefined) setActiveKeySignal(entry.key);
        }
      }
      return;
    }

    const options = flat();
    const current = options.findIndex((entry) => entry.key === activeKey());
    if (key === "Escape") {
      event.preventDefault();
      close(true);
      return;
    }
    if (key === "Tab") {
      close(false);
      return;
    }
    if (key === "ArrowDown" || key === "ArrowUp") {
      event.preventDefault();
      const index = nextEnabledIndex(
        options,
        current,
        key === "ArrowDown" ? 1 : -1,
        true,
      );
      if (index >= 0) setActiveKeySignal(options[index]!.key);
      return;
    }
    if (key === "Home" || key === "End") {
      if (inInput) return;
      event.preventDefault();
      const index = edgeEnabledIndex(options, key === "Home" ? "first" : "last");
      if (index >= 0) setActiveKeySignal(options[index]!.key);
      return;
    }
    if (key === "PageDown" || key === "PageUp") {
      event.preventDefault();
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
      const entry = current >= 0
        ? options[current]
        : options[edgeEnabledIndex(options, "first")];
      if (entry !== undefined) pick(entry.option);
      return;
    }
    if (key === " " && !inInput) {
      event.preventDefault();
      const entry = current >= 0
        ? options[current]
        : options[edgeEnabledIndex(options, "first")];
      if (entry !== undefined) pick(entry.option);
      return;
    }
    if (inInput) return;
    if (
      key.length === 1
      && key !== " "
      && !event.ctrlKey
      && !event.metaKey
      && !event.altKey
    ) {
      event.preventDefault();
      const result = typeahead(
        typeaheadState,
        options,
        key,
        Date.now(),
        current,
        (option) => childrenText(option.label),
      );
      if (result.index >= 0) setActiveKeySignal(options[result.index]!.key);
    }
  };

  const handleBlur = (event: FocusEvent): void => {
    const next = event.relatedTarget;
    const root = rootElement();
    if (next instanceof Node && root !== null && root.contains(next)) return;
    props.field?.onBlur(event);
    props.onBlur?.(event);
    if (visible()) close(false);
  };

  const handleFocus = (event: FocusEvent): void => {
    props.field?.onFocus(event);
    props.onFocus?.(event);
  };

  const inputValue = (): string => {
    if (!searchEnabled()) return "";
    if (visible()) return querySignal();
    return multiple() ? "" : selectedText();
  };

  const searchPlaceholder = (): string => {
    const base = props.searchPlaceholder ?? placeholderOf() ?? "";
    if (multiple() && selectedOptions().length > 0) return base;
    return base;
  };

  const comboboxLabel = (): string | undefined => {
    if (props.ariaLabel !== undefined) return props.ariaLabel;
    const labelText = childrenText(labelOf());
    if (labelText !== "") return labelText;
    return placeholderOf();
  };

  const hasSelection = (): boolean => selectedOptions().length > 0;
  const readHiddenValue = (): string => selectedKeys()[0] ?? "";

  const valueContent = (): Children => {
    if (props.renderValue !== undefined) {
      return props.renderValue(selectedOptions());
    }
    if (!hasSelection()) return undefined;
    if (multiple()) {
      return selectedOptions().map(
        (option) => option.label,
      ) as unknown as Children;
    }
    return selectedOptions()[0]?.label;
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
        class="sui-select"
        data-variant="custom"
        data-size={props.size ?? "md"}
        data-invalid={invalidOf() ? "" : undefined}
        data-disabled={disabled() ? "" : undefined}
        data-readonly={readOnly() ? "" : undefined}
        data-validating={props.field?.isValidating === true ? "" : undefined}
        data-multiple={multiple() ? "" : undefined}
        data-bare={props.bare === true ? "" : undefined}
        data-open={visible() ? "" : undefined}
        data-has-value={hasSelection() ? "" : undefined}
      >
        <div
          ref={(node: Element | null) => {
            setControlElement(node as HTMLElement | null);
          }}
          class="sui-select__control"
          id={searchEnabled() ? `${id}-control` : id}
          role={searchEnabled() ? undefined : "combobox"}
          tabindex={searchEnabled() || disabled() ? undefined : 0}
          title={
            !multiple() && hasSelection()
              ? selectedText()
              : undefined
          }
          aria-haspopup={searchEnabled() ? undefined : "listbox"}
          aria-expanded={searchEnabled() ? undefined : visible() ? "true" : "false"}
          aria-controls={
            searchEnabled() || !mounted() ? undefined : listId
          }
          aria-activedescendant={
            searchEnabled() ? undefined : activeOptionId()
          }
          aria-label={searchEnabled() ? undefined : comboboxLabel()}
          aria-required={requiredOf() ? "true" : undefined}
          aria-invalid={invalidOf() ? "true" : undefined}
          aria-readonly={readOnly() ? "true" : undefined}
          aria-disabled={disabled() ? "true" : undefined}
          aria-busy={props.field?.isValidating === true ? "true" : undefined}
          aria-describedby={described()}
          onClick={(event) => {
            if (disabled()) return;
            const target = event.target;
            if (searchEnabled() && inputElement() !== null) {
              if (target instanceof Node && inputElement()!.contains(target)) {
                if (!visible()) open();
                return;
              }
            }
            toggle();
          }}
          onKeyDown={onKeyDown}
          onBlur={handleBlur}
          onFocus={handleFocus}
        >
          <Show when={multiple() && hasSelection()}>
            <span class="sui-select__chips">
              <Show
                when={props.renderValue !== undefined}
                fallback={
                  <For each={selectedOptions()}>
                    {(option) => (
                      <span
                        class="sui-select__chip"
                        data-value={listboxKey(option.value)}
                      >
                        <span class="sui-select__chip-label">
                          {option.label}
                        </span>
                        <button
                          type="button"
                          class="sui-select__chip-remove"
                          tabindex="-1"
                          aria-label={`${config.strings.removeItem}: ${childrenText(option.label)}`}
                          disabled={disabled() || readOnly()}
                          onMouseDown={(event: MouseEvent) => {
                            event.preventDefault();
                          }}
                          onClick={(event: MouseEvent) => {
                            event.stopPropagation();
                            removeKey(listboxKey(option.value));
                          }}
                        >
                          <CloseIcon size="sm" />
                        </button>
                      </span>
                    )}
                  </For>
                }
              >
                {valueContent()}
              </Show>
            </span>
          </Show>
          <Show
            when={searchEnabled()}
            fallback={
              <span class="sui-select__value">
                <Show
                  when={hasSelection() || props.renderValue !== undefined}
                  fallback={
                    <span class="sui-select__placeholder">
                      {placeholderOf()}
                    </span>
                  }
                >
                  {valueContent()}
                </Show>
              </span>
            }
          >
            <input
              ref={(node: Element | null) => {
                setInputElement(node as HTMLInputElement | null);
              }}
              id={id}
              class="sui-select__search"
              type="text"
              role="combobox"
              autocomplete="off"
              value={inputValue()}
              placeholder={multiple() && hasSelection() ? "" : searchPlaceholder()}
              disabled={disabled()}
              readOnly={readOnly()}
              aria-autocomplete="list"
              aria-haspopup="listbox"
              aria-expanded={visible() ? "true" : "false"}
              aria-controls={mounted() ? listId : undefined}
              aria-activedescendant={activeOptionId()}
              aria-label={comboboxLabel()}
              aria-required={requiredOf() ? "true" : undefined}
              aria-invalid={invalidOf() ? "true" : undefined}
              aria-readonly={readOnly() ? "true" : undefined}
              aria-describedby={described()}
              onInput={(event) => {
                const target = event.currentTarget as HTMLInputElement | null;
                const next = target?.value ?? "";
                if (!visible()) open();
                setQuery(next);
              }}
              onKeyDown={onKeyDown}
              onBlur={handleBlur}
              onFocus={handleFocus}
            />
          </Show>
          <span class="sui-select__indicators">
            <Show
              when={
                props.clearable === true
                && hasSelection()
                && !disabled()
                && !readOnly()
              }
            >
              <button
                type="button"
                class="sui-select__clear"
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
            <span class="sui-select__arrow" aria-hidden="true">
              <ChevronDownIcon size="sm" />
            </span>
          </span>
          <Show when={!multiple()}>
            <input
              type="hidden"
              name={nameOf()}
              bindValue={[readHiddenValue, NO_WRITE]}
            />
          </Show>
          <Show when={multiple()}>
            <For each={selectedKeys()}>
              {(key) => <input type="hidden" name={nameOf()} value={key} />}
            </For>
          </Show>
        </div>
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
              // Клик по строке не должен уводить фокус с триггера.
              event.preventDefault();
            }}
          >
            <div
              id={listId}
              class="sui-popup__list"
              role="listbox"
              aria-multiselectable={multiple() ? "true" : undefined}
              aria-label={comboboxLabel()}
            >
              <Show
                when={flat().length > 0}
                fallback={
                  <Show
                    when={loadErrorState() !== null}
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
                    <div class="sui-popup__error" role="alert">
                      {loadErrorState()}
                    </div>
                  </Show>
                }
              >
                <ListboxRows
                  options={flat}
                  baseId={id}
                  activeKey={activeKey}
                  selected={(key) => selectedKeys().includes(key)}
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
                <Show when={loadErrorState() !== null}>
                  <div class="sui-popup__error" role="alert">
                    {loadErrorState()}
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

export type { SelectItem };
