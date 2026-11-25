import type {
  Children,
  ClassNameValue,
  StyleInput,
} from "@ivlev-dev/silent-core";
import {
  Show,
  createSignal,
  untrack,
} from "@ivlev-dev/silent-core";
import type { Attrs } from "../../internal/props.js";
import type { ControlSize } from "../internal/control.js";
import { clientEffect } from "../../internal/overlay.js";
import { useUiConfig } from "../../theme/config.js";
import {
  describedBy,
} from "../internal/control.js";
import {
  childrenText,
  filterListboxItems,
  type ListboxMatch,
} from "../internal/listbox-filter.js";
import {
  type FlatListboxOption,
  type ListboxItem,
  type ListboxOption,
  type ListboxValue,
  createTypeaheadState,
  edgeEnabledIndex,
  flattenListbox,
  indexOfValue,
  listboxId,
  listboxOptionId,
  nextEnabledIndex,
  pageEnabledIndex,
  toggleSelectedKey,
  typeahead,
  valueKeys,
} from "../internal/listbox-engine.js";
import { ListboxRows } from "../internal/listbox-view.js";

export type {
  ListboxGroup,
  ListboxItem,
  ListboxOption,
  ListboxValue,
} from "../internal/listbox-engine.js";
export type { ListboxMatch } from "../internal/listbox-filter.js";

export interface ListboxProps {
  readonly options: readonly ListboxItem[];
  /** Выбранное значение; для `multiple` — массив. */
  readonly value?: ListboxValue | readonly ListboxValue[] | undefined;
  readonly defaultValue?: ListboxValue | readonly ListboxValue[] | undefined;
  readonly onValueChange?:
    | ((value: ListboxValue | readonly ListboxValue[]) => void)
    | undefined;
  readonly multiple?: boolean | undefined;
  /** Активная опция (визуальный фокус). */
  readonly activeValue?: ListboxValue | undefined;
  readonly onActiveValueChange?: ((value: ListboxValue | null) => void) | undefined;
  readonly searchable?: boolean | undefined;
  readonly query?: string | undefined;
  readonly onQueryChange?: ((query: string) => void) | undefined;
  readonly filter?: ListboxMatch | undefined;
  readonly renderOption?: ((option: ListboxOption) => Children) | undefined;
  readonly empty?: Children;
  readonly loading?: boolean | undefined;
  readonly loadingText?: Children;
  readonly size?: ControlSize | undefined;
  readonly disabled?: boolean | undefined;
  readonly readOnly?: boolean | undefined;
  readonly maxVisible?: number | undefined;
  readonly label?: string | undefined;
  readonly describedBy?: string | undefined;
  readonly id?: string | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
}

function optionValueByKey(
  flat: readonly FlatListboxOption[],
  key: string | null,
): ListboxValue | null {
  if (key === null) return null;
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
 * Список без всплывающей панели: `role="listbox"`, `aria-activedescendant`
 * и фокус на самом контейнере. Опции статичны, состояния — атрибуты
 * `data-active`/`aria-selected`; `renderOption` получает обычный объект.
 */
export function Listbox(props: ListboxProps): Node {
  const config = useUiConfig();
  const baseId = props.id ?? "sui-listbox";
  const listId = listboxId(baseId);
  const multiple = (): boolean => props.multiple === true;
  const disabled = (): boolean => props.disabled === true;
  const readOnly = (): boolean => props.readOnly === true;

  const [uncontrolledValue, setUncontrolledValue] = createSignal<unknown>(
    props.defaultValue,
  );
  const rawValue = (): unknown =>
    props.value !== undefined ? props.value : uncontrolledValue();
  const selectedKeys = (): readonly string[] =>
    selectedKeysOf(rawValue(), multiple());
  const isSelected = (key: string): boolean => selectedKeys().includes(key);

  const [uncontrolledActive, setUncontrolledActive] = createSignal<string | null>(
    null,
  );
  const activeKey = (): string | null => {
    if (props.activeValue !== undefined) return String(props.activeValue);
    return uncontrolledActive();
  };
  const setActive = (key: string | null): void => {
    if (props.activeValue === undefined) setUncontrolledActive(key);
    const flat = untrack(() => flatOptions());
    props.onActiveValueChange?.(optionValueByKey(flat, key));
  };

  const [uncontrolledQuery, setUncontrolledQuery] = createSignal("");
  const query = (): string =>
    props.query !== undefined ? props.query : uncontrolledQuery();
  const setQuery = (next: string): void => {
    if (props.query === undefined) setUncontrolledQuery(next);
    props.onQueryChange?.(next);
  };

  const sourceItems = (): readonly ListboxItem[] => props.options;
  const visibleItems = (): readonly ListboxItem[] => {
    const text = query();
    if (text === "") return sourceItems();
    return filterListboxItems(sourceItems(), text, props.filter);
  };
  const flatOptions = (): readonly FlatListboxOption[] =>
    flattenListbox(visibleItems());

  const [listElement, setListElement] = createSignal<HTMLElement | null>(null);
  const [searchElement, setSearchElement] = createSignal<HTMLInputElement | null>(
    null,
  );
  const typeaheadState = createTypeaheadState();

  const moveTo = (index: number): void => {
    const flat = flatOptions();
    const entry = flat[index];
    if (entry === undefined) return;
    setActive(entry.key);
  };

  const emitValue = (keys: readonly string[]): void => {
    const flat = flattenListbox(sourceItems());
    const values = keys
      .map((key) => optionValueByKey(flat, key))
      .filter((value): value is ListboxValue => value !== null);
    if (multiple()) {
      props.onValueChange?.(values);
      return;
    }
    props.onValueChange?.(values[0] ?? "");
  };

  const pick = (option: ListboxOption): void => {
    if (disabled() || readOnly() || option.disabled === true) return;
    const key = String(option.value);
    const next = toggleSelectedKey(selectedKeys(), key, multiple());
    if (props.value === undefined) {
      setUncontrolledValue(multiple() ? next : (next[0] ?? ""));
    }
    setActive(key);
    emitValue(next);
  };

  const focusTarget = (): HTMLElement | null =>
    searchElement() ?? listElement();

  const onKeyDown = (event: KeyboardEvent): void => {
    if (disabled()) return;
    const flat = flatOptions();
    if (flat.length === 0) return;
    const current = flat.findIndex((entry) => entry.key === activeKey());
    const key = event.key;
    const inSearch = event.target === searchElement();

    if (key === "ArrowDown" || key === "ArrowUp") {
      event.preventDefault();
      const index = nextEnabledIndex(flat, current, key === "ArrowDown" ? 1 : -1, true);
      if (index >= 0) moveTo(index);
      return;
    }
    if (key === "Home" || key === "End") {
      if (inSearch) return;
      event.preventDefault();
      const index = edgeEnabledIndex(flat, key === "Home" ? "first" : "last");
      if (index >= 0) moveTo(index);
      return;
    }
    if (key === "PageDown" || key === "PageUp") {
      event.preventDefault();
      const pageSize = Math.max(1, props.maxVisible ?? 8);
      const index = pageEnabledIndex(
        flat,
        current,
        key === "PageDown" ? 1 : -1,
        pageSize,
      );
      if (index >= 0) moveTo(index);
      return;
    }
    if (key === "Enter") {
      event.preventDefault();
      const entry = current >= 0 ? flat[current] : flat[edgeEnabledIndex(flat, "first")];
      if (entry !== undefined) pick(entry.option);
      return;
    }
    if (key === " " && !inSearch) {
      event.preventDefault();
      const entry = current >= 0 ? flat[current] : flat[edgeEnabledIndex(flat, "first")];
      if (entry !== undefined) pick(entry.option);
      return;
    }
    if (key === "Escape") {
      if (query() !== "") {
        event.preventDefault();
        setQuery("");
        return;
      }
      return;
    }
    if (inSearch) return;
    if (key.length === 1 && key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      const result = typeahead(
        typeaheadState,
        flat,
        key,
        Date.now(),
        current,
        (option) => childrenText(option.label),
      );
      if (result.index >= 0) moveTo(result.index);
    }
  };

  // Активная опция всегда существует: при фильтрации/смене options
  // переносим её на выбранную или первую доступную.
  const syncActive = (): void => {
    const flat = flatOptions();
    if (flat.length === 0) return;
    const key = activeKey();
    if (key !== null && indexOfValue(flat, key) >= 0) return;
    const selected = selectedKeys().find((item) => indexOfValue(flat, item) >= 0);
    if (selected !== undefined) {
      setActive(selected);
      return;
    }
    const first = edgeEnabledIndex(flat, "first");
    if (first >= 0) setActive(flat[first]!.key);
  };

  // Эффект создаётся в рендере: сигналы options/query/value отслеживаются.
  clientEffect(() => {
    flatOptions();
    selectedKeys();
    activeKey();
    untrack(syncActive);
  });

  const activeForDom = (): string | null => activeKey();

  const activeOptionId = (): string | undefined => {
    const index = indexOfValue(flatOptions(), activeForDom());
    return index < 0 ? undefined : listboxOptionId(baseId, index);
  };

  const descriptionId = (): string | undefined => describedBy(props.describedBy);

  const list = (): Node => (
    <div
      ref={(node: Element | null) => {
        setListElement(node as HTMLElement | null);
      }}
      id={listId}
      class="sui-listbox__list"
      role="listbox"
      tabindex={disabled() ? -1 : 0}
      aria-multiselectable={multiple() ? "true" : undefined}
      aria-label={props.label}
      aria-disabled={disabled() ? "true" : undefined}
      aria-readonly={readOnly() ? "true" : undefined}
      aria-describedby={descriptionId()}
      aria-activedescendant={activeOptionId()}
      style={{
        "--sui-popup-max-visible": String(props.maxVisible ?? 8),
      }}
      onKeyDown={onKeyDown}
    >
      <Show
        when={flatOptions().length > 0}
        fallback={
          <Show
            when={props.loading === true}
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
          options={flatOptions}
          baseId={baseId}
          activeKey={() => activeForDom()}
          selected={isSelected}
          renderOption={props.renderOption}
          onActivate={(option) => {
            setActive(String(option.value));
          }}
          onPick={(option) => {
            pick(option);
            focusTarget()?.focus({ preventScroll: true });
          }}
        />
      </Show>
    </div>
  );




  return (
    <div
      {...props.attrs}
      class={["sui-listbox", props.class]}
      style={props.style}
      data-size={props.size ?? "md"}
      data-multiple={multiple() ? "" : undefined}
      data-disabled={disabled() ? "" : undefined}
      data-readonly={readOnly() ? "" : undefined}
      data-loading={props.loading === true ? "" : undefined}
    >
      <Show when={props.searchable === true}>
        <input
          ref={(node: Element | null) => {
            setSearchElement(node as HTMLInputElement | null);
          }}
          class="sui-listbox__search"
          type="text"
          role="searchbox"
          value={query()}
          placeholder={config.strings.search}
          disabled={disabled()}
          readOnly={readOnly()}
          aria-label={config.strings.search}
          aria-controls={listId}
          onInput={(event) => {
            const target = event.currentTarget as HTMLInputElement | null;
            setQuery(target?.value ?? "");
          }}
          onKeyDown={onKeyDown}
        />
      </Show>
      {list()}
    </div>
  );
}
