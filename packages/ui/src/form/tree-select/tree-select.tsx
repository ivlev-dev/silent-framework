import type { Children } from "@ivlev-dev/silent-core";
import {
  For,
  Show,
  createSignal,
  untrack,
} from "@ivlev-dev/silent-core";
import { CheckIcon } from "../../icons/check.js";
import { ChevronDownIcon } from "../../icons/chevron-down.js";
import { CloseIcon } from "../../icons/close.js";
import { RemoveIcon } from "../../icons/remove.js";
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
import { childrenText } from "../internal/listbox-filter.js";
import {
  createSelectChangeEvent,
  createTypeaheadState,
  edgeEnabledIndex,
  listboxId,
  listboxKey,
  listboxOptionId,
  nextEnabledIndex,
  pageEnabledIndex,
  typeahead,
  valueKeys,
} from "../internal/listbox-engine.js";
import {
  type FlatTreeNodeRow,
  type TreeIndex,
  emitTreeSelection,
  flattenTreeView,
  indexTree,
  toggleTreeSelection,
  treeKeysToValues,
  treeSelection,
  type TreeSelectionMaps,
} from "../internal/tree-engine.js";
import type { TreeSelectNode, TreeSelectProps, TreeSelectValue } from "./types.js";

function keysOf(value: unknown): string[] {
  const keys = valueKeys(value);
  return [...new Set(keys)];
}

function selectedKeysOf(value: unknown, multiple: boolean): string[] {
  const keys = keysOf(value);
  if (multiple) return keys;
  return keys.length === 0 ? [] : [keys[0]!];
}

interface SummaryItem {
  readonly key: string;
  readonly label: string;
}

/**
 * `TreeSelect` на listbox/tree-движке.
 *
 * Фокус остаётся на триггере (`role="combobox"`), активная строка —
 * `aria-activedescendant`; поиск живёт в панели, поэтому стрелки
 * влево/вправо свободны для раскрытия и сворачивания веток. Панель и строки
 * создаются только после mount: SSR отдаёт закрытый триггер и hidden inputs.
 */
export function TreeSelect(props: TreeSelectProps): Node {
  const config = useUiConfig();
  const id = resolveControlId(
    props.id ?? props.field?.id,
    props.name ?? props.field?.name,
    "tree-select",
  );
  const listId = listboxId(id);
  const multiple = (): boolean => props.multiple === true;
  const disabled = (): boolean => props.disabled === true;
  const readOnly = (): boolean => props.readOnly === true;
  const selectableParents = (): boolean => props.selectableParents !== false;
  const showCheckboxes = (): boolean => props.showCheckboxes ?? multiple();
  const searchable = (): boolean => props.searchable !== false;
  const expandOnRow = (): boolean => props.expandOnClick !== "icon";
  const cascade = (): "independent" | "down" | "up" | "both" =>
    props.cascade ?? (multiple() ? "both" : "independent");
  const emitMode = (): "leaves" | "checked" | "all" => props.emit ?? "leaves";
  const maxVisible = (): number => Math.max(1, props.maxVisibleOptions ?? 8);

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
  const invalidOf = (): boolean =>
    props.invalid === true || hasContent(errorOf());
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

  // --- дерево и значения ------------------------------------------------
  // Индекс пересобирается только при смене массива `nodes`: внутри одного
  // рендера/flush дерево запрашивается многократно.
  let cachedNodes: readonly TreeSelectNode[] | null = null;
  let cachedIndex: TreeIndex | null = null;
  const index = (): TreeIndex => {
    const currentNodes = props.nodes;
    if (cachedIndex === null || cachedNodes !== currentNodes) {
      cachedNodes = currentNodes;
      cachedIndex = indexTree(currentNodes);
    }
    return cachedIndex;
  };
  const [uncontrolledValue, setUncontrolledValue] = createSignal<unknown>(
    props.defaultValue,
  );
  const rawValue = (): unknown => {
    if (props.value !== undefined) return props.value;
    if (props.field !== undefined) return props.field.value;
    return uncontrolledValue();
  };
  const selectedKeys = (): string[] =>
    selectedKeysOf(rawValue(), multiple());
  const selectedSet = (): ReadonlySet<string> => new Set(selectedKeys());
  const selection = (): TreeSelectionMaps =>
    treeSelection(index(), selectedSet(), cascade());

  const labelOfNode = (node: TreeSelectNode): string =>
    props.getOptionLabel !== undefined
      ? props.getOptionLabel(node)
      : childrenText(node.label);
  const isSelectableKey = (key: string): boolean => {
    const entry = index().nodes.get(key);
    if (entry === undefined) return false;
    return entry.childKeys.length === 0 || selectableParents();
  };

  // --- раскрытие --------------------------------------------------------
  const initialExpanded = (): Set<string> =>
    new Set((props.defaultExpanded ?? []).map((value) => String(value)));
  const [uncontrolledExpanded, setUncontrolledExpanded] =
    createSignal<ReadonlySet<string>>(initialExpanded());
  const expandedKeys = (): ReadonlySet<string> => {
    if (props.expanded !== undefined) {
      return new Set(props.expanded.map((value) => String(value)));
    }
    return uncontrolledExpanded();
  };
  const applyExpanded = (next: ReadonlySet<string>): void => {
    if (props.expanded === undefined) setUncontrolledExpanded(next);
    const current = index();
    props.onExpandedChange?.(
      treeKeysToValues(current, current.order.filter((key) => next.has(key))),
    );
  };
  const toggleExpanded = (key: string): void => {
    if (disabled()) return;
    const next = new Set(expandedKeys());
    if (next.has(key)) next.delete(key);
    else next.add(key);
    applyExpanded(next);
  };

  // --- поиск ------------------------------------------------------------
  const [querySignal, setQuerySignal] = createSignal("");
  const searchText = (): string => (visible() ? querySignal() : "");
  const rows = (): readonly FlatTreeNodeRow[] =>
    flattenTreeView(index(), {
      expanded: expandedKeys(),
      selected: selectedSet(),
      cascade: cascade(),
      search: searchText(),
      searchStrategy: props.searchStrategy,
      flattenOnSearch: props.flattenOnSearch,
    });
  const searching = (): boolean => searchText().trim() !== "";

  // --- активная строка --------------------------------------------------
  const [activeKeySignal, setActiveKeySignal] = createSignal<string | null>(null);
  const activeKey = (): string | null => activeKeySignal();
  const activeRow = (): FlatTreeNodeRow | null => {
    const key = activeKey();
    if (key === null) return null;
    return rows().find((row) => row.key === key) ?? null;
  };
  const activeOptionId = (): string | undefined => {
    if (!visible()) return undefined;
    const row = activeRow();
    return row === null ? undefined : listboxOptionId(id, row.index);
  };

  const syncActive = (): void => {
    const list = rows();
    if (list.length === 0) {
      setActiveKeySignal(null);
      return;
    }
    const key = activeKey();
    if (key !== null && list.some((row) => row.key === key)) return;
    const preferred =
      list.find((row) => row.checked)
      ?? list.find((row) => row.option.disabled !== true)
      ?? list[0];
    setActiveKeySignal(preferred?.key ?? null);
  };

  clientEffect(() => {
    rows();
    selectedKeys();
    visible();
    untrack(syncActive);
  });

  // --- refs и позиционирование -----------------------------------------
  const [rootElement, setRootElement] = createSignal<HTMLElement | null>(null);
  const [controlElement, setControlElement] = createSignal<HTMLElement | null>(
    null,
  );
  const [panelElement, setPanelElement] = createSignal<HTMLElement | null>(null);
  const [searchInput, setSearchInput] = createSignal<HTMLInputElement | null>(
    null,
  );
  const [pendingSearchFocus, setPendingSearchFocus] = createSignal(false);
  const side = useFloating({
    anchor: controlElement,
    panel: panelElement,
    isOpen: visible,
    preferred: () => "bottom",
  });

  clientEffect(() => {
    const row = activeRow();
    if (!visible() || row === null) return;
    const panel = panelElement();
    if (panel === null) return;
    const element = panel.querySelector<HTMLElement>(
      `[data-option-index="${row.index}"]`,
    );
    if (element !== null && typeof element.scrollIntoView === "function") {
      element.scrollIntoView({ block: "nearest" });
    }
  });

  clientEffect(() => {
    if (!pendingSearchFocus() || !visible()) return;
    const input = searchInput();
    if (input === null) return;
    input.focus({ preventScroll: true });
    setPendingSearchFocus(false);
  });

  // --- открытие/закрытие ------------------------------------------------
  const open = (): void => {
    if (disabled()) return;
    setQuerySignal("");
    openState.requestOpen(true);
    syncActive();
  };
  const close = (restoreFocus: boolean): void => {
    if (!visible()) return;
    openState.requestOpen(false);
    setQuerySignal("");
    setPendingSearchFocus(false);
    if (restoreFocus) controlElement()?.focus({ preventScroll: true });
  };
  const toggleOpen = (): void => {
    if (disabled()) return;
    if (visible()) close(true);
    else open();
  };

  useDismiss(rootElement, visible, () => close(false), { escape: false });

  // --- эмиссия значения -------------------------------------------------
  const emitKeys = (emitKeys_: readonly string[]): void => {
    const values = treeKeysToValues(index(), emitKeys_);
    const next: TreeSelectValue = multiple() ? values : values[0] ?? "";
    if (props.value === undefined && props.field === undefined) {
      setUncontrolledValue(next);
    }
    props.onValueChange?.(next);
    const eventKeys = multiple()
      ? values.map((value) => String(value))
      : [String(values[0] ?? "")];
    const change = createSelectChangeEvent(eventKeys, multiple());
    props.field?.onChange(change);
    props.onChange?.(change);
  };

  const emitExplicit = (explicitKeys: readonly string[]): void => {
    if (!multiple()) {
      emitKeys(explicitKeys.length === 0 ? [] : [explicitKeys[0]!]);
      return;
    }
    const emitted = emitTreeSelection(
      index(),
      new Set(explicitKeys),
      cascade(),
      emitMode(),
      isSelectableKey,
    );
    emitKeys(emitted);
  };

  const pick = (key: string): void => {
    if (disabled() || readOnly()) return;
    const entry = index().nodes.get(key);
    if (entry === undefined || entry.node.disabled === true) return;
    if (!isSelectableKey(key)) {
      if (entry.childKeys.length > 0) toggleExpanded(key);
      return;
    }
    if (!multiple()) {
      emitExplicit([key]);
      setActiveKeySignal(key);
      close(true);
      return;
    }
    const next = toggleTreeSelection(index(), selectedKeys(), key, cascade());
    emitExplicit(next);
    setActiveKeySignal(key);
  };

  const removeKey = (key: string): void => {
    if (disabled() || readOnly()) return;
    const entry = index().nodes.get(key);
    if (entry === undefined) {
      emitExplicit(selectedKeys().filter((item) => item !== key));
      return;
    }
    const next = toggleTreeSelection(index(), selectedKeys(), key, cascade());
    emitExplicit(next.filter((item) => item !== key));
    controlElement()?.focus({ preventScroll: true });
  };

  const activateRow = (row: FlatTreeNodeRow, viaKeyboard = false): void => {
    if (disabled()) return;
    setActiveKeySignal(row.key);
    // Клик раскрывает строку только в режиме `row`; клавиатура всегда умеет
    // раскрывать невыбираемый родитель через Enter/Space.
    const expandFromRow = expandOnRow() || viaKeyboard;
    if (readOnly()) {
      if (row.hasChildren && expandFromRow) toggleExpanded(row.key);
      return;
    }
    if (!isSelectableKey(row.key)) {
      if (row.hasChildren && expandFromRow) toggleExpanded(row.key);
      return;
    }
    pick(row.key);
    if (multiple() && row.hasChildren && expandOnRow()) toggleExpanded(row.key);
  };

  // --- сводка выбранного ------------------------------------------------
  const summaryItems = (): SummaryItem[] => {
    const current = index();
    const state = selection();
    const result: SummaryItem[] = [];
    if (multiple()) {
      for (const key of current.order) {
        if (state.checked.get(key) !== true) continue;
        if (!isSelectableKey(key)) continue;
        const entry = current.nodes.get(key);
        if (entry === undefined) continue;
        const shadowed = entry.ancestorKeys.some(
          (ancestorKey) =>
            state.checked.get(ancestorKey) === true
            && isSelectableKey(ancestorKey),
        );
        if (shadowed) continue;
        result.push({ key, label: labelOfNode(entry.node) });
      }
    } else {
      for (const key of current.order) {
        if (state.checked.get(key) !== true) continue;
        const entry = current.nodes.get(key);
        if (entry === undefined) continue;
        result.push({ key, label: labelOfNode(entry.node) });
        break;
      }
    }
    for (const key of selectedKeys()) {
      if (current.nodes.has(key)) continue;
      result.push({ key, label: key });
    }
    return result;
  };

  const hasValue = (): boolean =>
    summaryItems().length > 0 || selectedKeys().length > 0;

  // --- клавиатура -------------------------------------------------------
  const typeaheadState = createTypeaheadState();
  const moveActive = (step: 1 | -1): void => {
    const list = rows();
    const current = activeRow();
    const from = current === null ? -1 : current.index;
    const next = nextEnabledIndex(list, from, step, true);
    if (next >= 0) {
      const row = list[next];
      if (row !== undefined) setActiveKeySignal(row.key);
    }
  };
  const edgeActive = (edge: "first" | "last"): void => {
    const list = rows();
    const index_ = edgeEnabledIndex(list, edge);
    if (index_ >= 0) {
      const row = list[index_];
      if (row !== undefined) setActiveKeySignal(row.key);
    }
  };
  const runTypeahead = (char: string): void => {
    const list = rows();
    const current = activeRow();
    const result = typeahead(
      typeaheadState,
      list,
      char,
      Date.now(),
      current === null ? -1 : current.index,
      (option) => childrenText(option.label),
    );
    if (result.index >= 0) {
      const row = list[result.index];
      if (row !== undefined) setActiveKeySignal(row.key);
    }
  };
  const isPrintable = (event: KeyboardEvent, key: string): boolean =>
    key.length === 1
    && key !== " "
    && !event.ctrlKey
    && !event.metaKey
    && !event.altKey;

  const handleOpenKey = (event: KeyboardEvent): void => {
    const key = event.key;
    if (key === "Escape") {
      event.preventDefault();
      if (querySignal() !== "") setQuerySignal("");
      else close(true);
      return;
    }
    if (key === "Tab") {
      close(false);
      return;
    }
    if (key === "ArrowDown" || key === "ArrowUp") {
      event.preventDefault();
      moveActive(key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (key === "Home" || key === "End") {
      event.preventDefault();
      edgeActive(key === "Home" ? "first" : "last");
      return;
    }
    if (key === "PageDown" || key === "PageUp") {
      event.preventDefault();
      const list = rows();
      const current = activeRow();
      const next = pageEnabledIndex(
        list,
        current === null ? -1 : current.index,
        key === "PageDown" ? 1 : -1,
        maxVisible(),
      );
      if (next >= 0) {
        const row = list[next];
        if (row !== undefined) setActiveKeySignal(row.key);
      }
      return;
    }
    if (key === "ArrowRight") {
      event.preventDefault();
      const row = activeRow();
      if (row === null) return;
      if (row.hasChildren && !row.expanded) {
        toggleExpanded(row.key);
        return;
      }
      const next = rows()[row.index + 1];
      if (next !== undefined && next.parentKey === row.key) {
        setActiveKeySignal(next.key);
      }
      return;
    }
    if (key === "ArrowLeft") {
      event.preventDefault();
      const row = activeRow();
      if (row === null) return;
      if (!searching() && row.hasChildren && row.expanded) {
        toggleExpanded(row.key);
        return;
      }
      if (row.parentKey !== null) {
        const parent = rows().find((item) => item.key === row.parentKey);
        if (parent !== undefined) setActiveKeySignal(parent.key);
      }
      return;
    }
    if (key === "Enter" || key === " ") {
      event.preventDefault();
      const row = activeRow();
      if (row !== null) activateRow(row, true);
      return;
    }
    if (isPrintable(event, key)) {
      event.preventDefault();
      if (searchable()) {
        setQuerySignal(querySignal() + key);
        setPendingSearchFocus(true);
        return;
      }
      runTypeahead(key);
    }
  };

  const onControlKeyDown = (event: KeyboardEvent): void => {
    if (disabled()) return;
    if (!visible()) {
      const key = event.key;
      if (key === "Escape") return;
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
      if (isPrintable(event, key)) {
        event.preventDefault();
        open();
        if (searchable()) {
          setQuerySignal(querySignal() + key);
          setPendingSearchFocus(true);
        } else {
          runTypeahead(key);
        }
      }
      return;
    }
    handleOpenKey(event);
  };

  const onSearchKeyDown = (event: KeyboardEvent): void => {
    const key = event.key;
    if (key === "Escape") {
      event.preventDefault();
      if (querySignal() !== "") setQuerySignal("");
      else close(true);
      return;
    }
    if (key === "Tab") {
      close(false);
      return;
    }
    if (key === "ArrowDown" || key === "ArrowUp") {
      event.preventDefault();
      moveActive(key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (key === "Enter") {
      event.preventDefault();
      const row = activeRow();
      if (row !== null) activateRow(row, true);
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

  const comboboxLabel = (): string | undefined => {
    if (props.ariaLabel !== undefined) return props.ariaLabel;
    const labelText = childrenText(labelOf());
    if (labelText !== "") return labelText;
    return placeholderOf();
  };

  const readHiddenValues = (): readonly string[] =>
    selectedKeys().map((key) => String(key));
  const readSingleHiddenValue = (): string => readHiddenValues()[0] ?? "";

  const renderRow = (row: FlatTreeNodeRow): Node => (
    <div
      id={listboxOptionId(id, row.index)}
      class="sui-tree-select__row"
      role="treeitem"
      aria-level={String(row.level)}
      aria-setsize={String(row.setsize)}
      aria-posinset={String(row.posinset)}
      aria-expanded={
        row.hasChildren ? (row.expanded ? "true" : "false") : undefined
      }
      aria-selected={multiple() ? undefined : row.checked ? "true" : "false"}
      aria-checked={
        multiple()
          ? row.checked
            ? "true"
            : row.indeterminate
              ? "mixed"
              : "false"
          : undefined
      }
      aria-disabled={row.option.disabled === true ? "true" : undefined}
      data-active={activeKey() === row.key ? "" : undefined}
      data-checked={row.checked ? "" : undefined}
      data-indeterminate={row.indeterminate ? "" : undefined}
      data-disabled={row.option.disabled === true ? "" : undefined}
      data-depth={String(row.depth)}
      data-option-index={row.index}
      data-value={row.key}
      style={{ "--sui-tree-select-level": String(row.depth) }}
      onPointerMove={() => {
        setActiveKeySignal(row.key);
      }}
      onClick={(event) => {
        const target = event.target;
        if (
          target instanceof Element
          && target.closest(".sui-tree-select__expander") !== null
        ) {
          return;
        }
        activateRow(row);
      }}
    >
      <Show
        when={row.hasChildren}
        fallback={<span class="sui-tree-select__spacer" aria-hidden="true" />}
      >
        <button
          type="button"
          class="sui-tree-select__expander"
          tabindex="-1"
          aria-hidden="true"
          data-expanded={row.expanded ? "" : undefined}
          onMouseDown={(event: MouseEvent) => {
            event.preventDefault();
          }}
          onClick={(event: MouseEvent) => {
            event.stopPropagation();
            toggleExpanded(row.key);
          }}
        >
          <ChevronDownIcon size="sm" />
        </button>
      </Show>
      <Show when={showCheckboxes()}>
        <span
          class="sui-tree-select__checkbox"
          aria-hidden="true"
          data-checked={row.checked ? "" : undefined}
          data-indeterminate={row.indeterminate ? "" : undefined}
        >
          <Show when={row.checked}>
            <CheckIcon size="sm" />
          </Show>
          <Show when={row.indeterminate}>
            <RemoveIcon size="sm" />
          </Show>
        </span>
      </Show>
      <Show when={row.node.icon}>
        <span class="sui-tree-select__icon" aria-hidden="true">
          {row.node.icon}
        </span>
      </Show>
      <span class="sui-tree-select__text">
        <Show
          when={props.renderOption !== undefined}
          fallback={
            <>
              <span class="sui-tree-select__label">{row.node.label}</span>
              <Show when={row.node.description}>
                <span class="sui-tree-select__description">
                  {row.node.description}
                </span>
              </Show>
            </>
          }
        >
          <span class="sui-tree-select__label">
            {props.renderOption?.(row.node)}
          </span>
        </Show>
      </span>
      <Show when={!showCheckboxes() && row.checked}>
        <span class="sui-tree-select__check" aria-hidden="true">
          <CheckIcon size="sm" />
        </span>
      </Show>
    </div>
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
        class="sui-tree-select"
        data-size={props.size ?? "md"}
        data-invalid={invalidOf() ? "" : undefined}
        data-disabled={disabled() ? "" : undefined}
        data-readonly={readOnly() ? "" : undefined}
        data-validating={props.field?.isValidating === true ? "" : undefined}
        data-multiple={multiple() ? "" : undefined}
        data-bare={props.bare === true ? "" : undefined}
        data-open={visible() ? "" : undefined}
        data-has-value={hasValue() ? "" : undefined}
      >
        <div
          ref={(node: Element | null) => {
            setControlElement(node as HTMLElement | null);
          }}
          id={id}
          class="sui-tree-select__control"
          role="combobox"
          tabindex={disabled() ? undefined : 0}
          aria-haspopup="tree"
          aria-expanded={visible() ? "true" : "false"}
          aria-controls={mounted() ? listId : undefined}
          aria-activedescendant={activeOptionId()}
          aria-label={comboboxLabel()}
          aria-required={requiredOf() ? "true" : undefined}
          aria-invalid={invalidOf() ? "true" : undefined}
          aria-readonly={readOnly() ? "true" : undefined}
          aria-disabled={disabled() ? "true" : undefined}
          aria-busy={props.field?.isValidating === true ? "true" : undefined}
          aria-describedby={described()}
          onClick={() => {
            if (disabled()) return;
            toggleOpen();
          }}
          onKeyDown={onControlKeyDown}
          onBlur={handleBlur}
          onFocus={handleFocus}
        >
          <Show
            when={multiple() && summaryItems().length > 0}
            fallback={
              <span class="sui-tree-select__value">
                <Show
                  when={summaryItems().length > 0}
                  fallback={
                    <span class="sui-tree-select__placeholder">
                      {placeholderOf()}
                    </span>
                  }
                >
                  {summaryItems()[0]?.label}
                </Show>
              </span>
            }
          >
            <span class="sui-tree-select__chips">
              <Show when={summaryItems().length > 0}>
                <For each={summaryItems()}>
                  {(item) => (
                    <span class="sui-tree-select__chip" data-value={item.key}>
                      <span class="sui-tree-select__chip-label">
                        {item.label}
                      </span>
                      <button
                        type="button"
                        class="sui-tree-select__chip-remove"
                        tabindex="-1"
                        aria-label={`${config.strings.removeItem}: ${item.label}`}
                        disabled={disabled() || readOnly()}
                        onMouseDown={(event: MouseEvent) => {
                          event.preventDefault();
                        }}
                        onClick={(event: MouseEvent) => {
                          event.stopPropagation();
                          removeKey(item.key);
                        }}
                      >
                        <CloseIcon size="sm" />
                      </button>
                    </span>
                  )}
                </For>
              </Show>
            </span>
          </Show>
          <span class="sui-tree-select__indicators">
            <span class="sui-tree-select__arrow" aria-hidden="true">
              <ChevronDownIcon size="sm" />
            </span>
          </span>
          <Show when={!multiple()}>
            <input
              type="hidden"
              name={nameOf()}
              bindValue={[readSingleHiddenValue, NO_WRITE]}
            />
          </Show>
          <Show when={multiple()}>
            <For each={readHiddenValues()}>
              {(value) => <input type="hidden" name={nameOf()} value={value} />}
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
              "--sui-popup-max-visible": String(maxVisible()),
            }}
            onMouseDown={(event: MouseEvent) => {
              // Клик по строке/поиску не должен уводить фокус с контрола.
              if (
                event.target instanceof Element
                && event.target.closest(".sui-popup__search") !== null
              ) {
                return;
              }
              event.preventDefault();
            }}
          >
            <Show when={searchable()}>
              <input
                ref={(node: Element | null) => {
                  setSearchInput(node as HTMLInputElement | null);
                }}
                class="sui-popup__search"
                type="text"
                role="searchbox"
                autocomplete="off"
                value={querySignal()}
                placeholder={config.strings.search}
                aria-label={config.strings.search}
                aria-controls={listId}
                aria-activedescendant={activeOptionId()}
                onInput={(event) => {
                  const target = event.currentTarget as HTMLInputElement | null;
                  setQuerySignal(target?.value ?? "");
                }}
                onKeyDown={onSearchKeyDown}
                onBlur={handleBlur}
                onFocus={handleFocus}
              />
            </Show>
            <div
              id={listId}
              class="sui-popup__list sui-tree-select__tree"
              role="tree"
              aria-multiselectable={multiple() ? "true" : undefined}
              aria-label={comboboxLabel()}
            >
              <Show
                when={rows().length > 0}
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
                <For each={rows()}>{(row) => renderRow(row)}</For>
              </Show>
            </div>
          </div>
        </Show>
      </div>
    </Field>
  );
}
