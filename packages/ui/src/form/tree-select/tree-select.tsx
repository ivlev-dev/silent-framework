import type { Child, Children, StyleInput } from "@ivlev-dev/silent-core";
import {
  For,
  Show,
  createMemo,
  createSignal,
  onCleanup,
  untrack,
} from "@ivlev-dev/silent-core";
import { createVirtualizer } from "@ivlev-dev/silent-virtual";
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
  type ControlSize,
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

const FALLBACK_ROOT_FONT_SIZE = 16;

/** Оценка высоты строки по плотности контрола (совпадает с CSS). */
function optionBlockForSize(size: ControlSize | undefined): number {
  if (size === "sm") return 32;
  if (size === "lg") return 48;
  return 40;
}

function readRootFontSize(): number {
  if (typeof getComputedStyle !== "function" || typeof document === "undefined") {
    return FALLBACK_ROOT_FONT_SIZE;
  }
  const parsed = Number.parseFloat(
    getComputedStyle(document.documentElement).fontSize,
  );
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : FALLBACK_ROOT_FONT_SIZE;
}

function parseCssLength(value: string): number | null {
  const match = /^\s*(-?\d*\.?\d+)\s*(px|rem|em)?\s*$/u.exec(value);
  if (match === null) return null;
  const amount = Number.parseFloat(match[1] ?? "");
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = match[2] ?? "px";
  if (unit === "px") return amount;
  return amount * readRootFontSize();
}

/**
 * Высота строки из `--sui-popup-option-block` (её выставляет `.sui-popup` и
 * уточняет `data-size`). Вне styled-окружения (SSR, тесты) остаётся
 * детерминированный фолбэк по `size`.
 */
function readOptionBlock(
  list: Element | null,
  size: ControlSize | undefined,
): number {
  const fallback = optionBlockForSize(size);
  if (list === null || typeof getComputedStyle !== "function") return fallback;
  const parsed = parseCssLength(
    getComputedStyle(list).getPropertyValue("--sui-popup-option-block").trim(),
  );
  return parsed ?? fallback;
}

/** Позиция строки в окне: абсолютный `start` и признак закреплённой строки. */
interface TreeRowPlacement {
  readonly start: number;
  readonly pinned: boolean;
}

interface TreeWindowRow {
  readonly row: FlatTreeNodeRow;
  readonly start: number;
  readonly pinned: boolean;
}

interface SummaryItem {
  readonly key: string;
  readonly label: string;
}

/** Подставляет загруженные дети по ключу родителя, сохраняя порядок. */
function applyLoadedChildren(
  nodes: readonly TreeSelectNode[],
  loaded: ReadonlyMap<string, readonly TreeSelectNode[]>,
): readonly TreeSelectNode[] {
  if (loaded.size === 0) return nodes;
  let changed = false;
  const next = nodes.map((node) => {
    const key = String(node.value);
    const children = loaded.get(key);
    const resolvedChildren =
      children === undefined
        ? node.children === undefined
          ? undefined
          : applyLoadedChildren(node.children, loaded)
        : children;
    if (resolvedChildren === node.children) return node;
    changed = true;
    return resolvedChildren === undefined
      ? { ...node, hasChildren: false }
      : { ...node, children: resolvedChildren, hasChildren: false };
  });
  return changed ? next : nodes;
}

/** Подсвечивает совпадения запроса в строковой подписи. */
function highlightedLabel(text: string, query: string): Child {
  const needle = query.trim();
  if (needle === "") return text;
  const lowerText = text.toLocaleLowerCase();
  const lowerNeedle = needle.toLocaleLowerCase();
  const parts: Child[] = [];
  let cursor = 0;
  let match = lowerText.indexOf(lowerNeedle, cursor);
  while (match >= 0 && lowerNeedle !== "") {
    if (match > cursor) parts.push(text.slice(cursor, match));
    parts.push(
      <mark class="sui-tree-select__match">
        {text.slice(match, match + needle.length)}
      </mark>,
    );
    cursor = match + needle.length;
    match = lowerText.indexOf(lowerNeedle, cursor);
  }
  if (parts.length === 0) return text;
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message !== "") return error.message;
  if (typeof error === "string" && error !== "") return error;
  return "Не удалось загрузить данные";
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
  const showCheckboxes = (): boolean =>
    props.checkable ?? props.showCheckboxes ?? multiple();
  const searchable = (): boolean => props.searchable !== false;
  const expandOnRow = (): boolean => props.expandOnClick !== "icon";
  const cascade = (): "independent" | "down" | "up" | "both" =>
    props.cascade ?? (multiple() ? "both" : "independent");
  const emitMode = (): "leaves" | "checked" | "all" => props.emit ?? "leaves";
  const maxVisible = (): number => Math.max(1, props.maxVisibleOptions ?? 8);
  const searchDelay = (): number => Math.max(0, props.searchDelay ?? 250);
  const clearable = (): boolean => props.clearable ?? multiple();
  const showSelectAll = (): boolean => props.showSelectAll ?? multiple();
  const selectAllLabel = (): string => props.selectAllLabel ?? "Выбрать все";

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
  // Индекс пересобирается только при смене дерева: внутри одного
  // рендера/flush дерево запрашивается многократно. Ленивые дети и
  // результаты асинхронного поиска лежат отдельно и накладываются поверх.
  const [lazyChildren, setLazyChildren] = createSignal<
    ReadonlyMap<string, readonly TreeSelectNode[]>
  >(new Map());
  const [rootNodes, setRootNodes] = createSignal<
    readonly TreeSelectNode[] | null
  >(null);
  const [searchNodes, setSearchNodes] = createSignal<
    readonly TreeSelectNode[] | null
  >(null);
  const mergedNodes = createMemo<readonly TreeSelectNode[]>(() =>
    applyLoadedChildren(props.nodes, lazyChildren()),
  );
  const rootDisplayNodes = createMemo<readonly TreeSelectNode[]>(() => {
    const roots = rootNodes();
    return roots === null ? [] : applyLoadedChildren(roots, lazyChildren());
  });
  const searchDisplayNodes = createMemo<readonly TreeSelectNode[] | null>(() => {
    const found = searchNodes();
    return found === null
      ? null
      : applyLoadedChildren(found, lazyChildren());
  });
  const baseNodes = (): readonly TreeSelectNode[] =>
    props.nodes.length === 0 && rootNodes() !== null
      ? rootDisplayNodes()
      : mergedNodes();
  const lookupNodes = createMemo<readonly TreeSelectNode[]>(() => {
    const base = baseNodes();
    const found = searchDisplayNodes();
    if (found === null) return base;
    // Результаты поиска участвуют в преобразовании значений и подписях
    // чипов, но не становятся частью видимого дерева при очистке запроса.
    return [...base, ...found];
  });
  let cachedNodes: readonly TreeSelectNode[] | null = null;
  let cachedIndex: TreeIndex | null = null;
  const index = (): TreeIndex => {
    const currentNodes = lookupNodes();
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
    if (entry === undefined || entry.node.disabled === true) return false;
    return entry.childKeys.length === 0 || selectableParents();
  };

  // --- раскрытие --------------------------------------------------------
  const expandedProp = (): readonly TreeSelectValue[] | undefined =>
    props.expandedKeys ?? props.expanded;
  const defaultExpandedProp = (): readonly TreeSelectValue[] | undefined =>
    props.defaultExpandedKeys ?? props.defaultExpanded;
  const initialExpanded = (): Set<string> =>
    new Set((defaultExpandedProp() ?? []).map((value) => String(value)));
  const [uncontrolledExpanded, setUncontrolledExpanded] =
    createSignal<ReadonlySet<string>>(initialExpanded());
  const expandedKeys = (): ReadonlySet<string> => {
    const controlled = expandedProp();
    if (controlled !== undefined) {
      return new Set(controlled.map((value) => String(value)));
    }
    return uncontrolledExpanded();
  };
  const applyExpanded = (next: ReadonlySet<string>): void => {
    if (expandedProp() === undefined) setUncontrolledExpanded(next);
    const current = index();
    props.onExpandedChange?.(
      treeKeysToValues(current, current.order.filter((key) => next.has(key))),
    );
  };
  const toggleExpanded = (key: string): void => {
    if (disabled()) return;
    const next = new Set(expandedKeys());
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
      void loadChildren(key);
    }
    applyExpanded(next);
  };

  // --- поиск ------------------------------------------------------------
  const [querySignal, setQuerySignal] = createSignal("");
  const searchText = (): string => (visible() ? querySignal() : "");
  const searching = (): boolean => searchText().trim() !== "";

  const [loadErrorState, setLoadErrorState] = createSignal<Children | null>(
    null,
  );
  const [rootLoading, setRootLoading] = createSignal(false);
  const [loadingKeys, setLoadingKeys] = createSignal<ReadonlySet<string>>(
    new Set(),
  );
  const loadedKeys = new Set<string>();
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  let searchRequest = 0;
  let rootsRequest = 0;

  const cancelSearchTimer = (): void => {
    if (searchTimer !== null) {
      clearTimeout(searchTimer);
      searchTimer = null;
    }
  };
  onCleanup(() => {
    cancelSearchTimer();
    searchRequest += 1;
    rootsRequest += 1;
  });

  const setKeyLoading = (key: string, loading: boolean): void => {
    const next = new Set(loadingKeys());
    if (loading) next.add(key);
    else next.delete(key);
    setLoadingKeys(next);
  };

  const loadChildren = async (key: string): Promise<void> => {
    const load = props.load;
    if (load === undefined || loadedKeys.has(key)) return;
    const entry = index().nodes.get(key);
    if (
      entry === undefined
      || (entry.node.children !== undefined && entry.node.children.length > 0)
    ) {
      return;
    }
    loadedKeys.add(key);
    setKeyLoading(key, true);
    try {
      const children = await load("", entry.node);
      setLazyChildren((current) => {
        const next = new Map(current);
        next.set(key, children);
        return next;
      });
    } catch (error) {
      loadedKeys.delete(key);
      const message = props.loadError ?? errorMessage(error);
      setLoadErrorState(message);
      props.onLoadError?.(error);
    } finally {
      setKeyLoading(key, false);
    }
  };

  const loadRoots = async (): Promise<void> => {
    const load = props.load;
    if (
      load === undefined
      || props.nodes.length > 0
      || rootNodes() !== null
    ) {
      return;
    }
    const request = rootsRequest + 1;
    rootsRequest = request;
    setRootLoading(true);
    setLoadErrorState(null);
    try {
      const nodes = await load("", undefined);
      if (request !== rootsRequest) return;
      setRootNodes(nodes);
      setSearchNodes(null);
    } catch (error) {
      if (request !== rootsRequest) return;
      setLoadErrorState(props.loadError ?? errorMessage(error));
      props.onLoadError?.(error);
    } finally {
      if (request === rootsRequest) setRootLoading(false);
    }
  };

  const runSearch = (text: string): void => {
    const load = props.load;
    const query = text.trim();
    if (load === undefined || query === "") return;
    const request = searchRequest + 1;
    searchRequest = request;
    setRootLoading(true);
    setLoadErrorState(null);
    void load(query, undefined)
      .then((nodes) => {
        if (request !== searchRequest) return;
        setSearchNodes(nodes);
      })
      .catch((error: unknown) => {
        if (request !== searchRequest) return;
        setLoadErrorState(props.loadError ?? errorMessage(error));
        props.onLoadError?.(error);
      })
      .finally(() => {
        if (request === searchRequest) setRootLoading(false);
      });
  };

  // Поиск с задержкой: локальное дерево фильтруется мгновенно, запрос к API
  // уходит после паузы, а устаревший ответ отбрасывается по номеру запроса.
  const scheduleSearch = (text: string): void => {
    cancelSearchTimer();
    const query = text.trim();
    if (props.load === undefined) return;
    // Новый ввод сразу отменяет старый ответ, даже если запрос ещё ждёт
    // debounce-паузу.
    searchRequest += 1;
    setSearchNodes(null);
    setRootLoading(false);
    setLoadErrorState(null);
    if (query === "") return;
    if (searchDelay() === 0) {
      runSearch(text);
      return;
    }
    searchTimer = setTimeout(() => {
      searchTimer = null;
      runSearch(text);
    }, searchDelay());
  };
  const updateQuery = (text: string): void => {
    setQuerySignal(text);
    scheduleSearch(text);
  };

  const viewNodes = (): readonly TreeSelectNode[] => {
    if (searching() && props.load !== undefined) {
      return searchDisplayNodes() ?? baseNodes();
    }
    return baseNodes();
  };
  let cachedViewNodes: readonly TreeSelectNode[] | null = null;
  let cachedViewIndex: TreeIndex | null = null;
  const viewIndex = (): TreeIndex => {
    const currentNodes = viewNodes();
    if (cachedViewIndex === null || cachedViewNodes !== currentNodes) {
      cachedViewNodes = currentNodes;
      cachedViewIndex = indexTree(currentNodes);
    }
    return cachedViewIndex;
  };

  // Мемо: внутри одного flush дерево запрашивается многократно (сводка,
  // окно рендера, `getItemKey` виртуализатора), а `flattenTreeView` — O(n).
  const rows = createMemo<readonly FlatTreeNodeRow[]>(() =>
    flattenTreeView(viewIndex(), {
      expanded: expandedKeys(),
      selected: selectedSet(),
      cascade: cascade(),
      search: searchText(),
      searchStrategy: props.searchStrategy,
      flattenOnSearch: props.flattenOnSearch,
    }),
  );

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
  // Прокручиваемый контейнер — сам `.sui-popup__list` (`role="tree"`).
  const [listElement, setListElement] = createSignal<HTMLElement | null>(null);
  const [optionBlock, setOptionBlock] = createSignal(
    optionBlockForSize(props.size),
  );
  const side = useFloating({
    anchor: controlElement,
    panel: panelElement,
    isOpen: visible,
    preferred: () => "bottom",
    matchAnchorWidth: true,
  });

  // --- виртуализация ----------------------------------------------------
  // Окно включается всегда, когда есть видимые строки: spacer держит полную
  // высоту, строки позиционируются абсолютно, прокрутка живёт на `role="tree"`.
  const virtualized = (): boolean => rows().length > 0;
  const activeIndex = (): number => activeRow()?.index ?? -1;
  const virtualizer = createVirtualizer({
    count: () => rows().length,
    estimateSize: () => optionBlock(),
    getItemKey: (index) => rows()[index]?.key ?? String(index),
    initialViewportSize: () => optionBlock() * Math.max(1, maxVisible()),
    // Активную строку добавляем в окно, пока она не дальше страницы от
    // видимой области. Дальний прыжок (End/typeahead) не растягивает окно до
    // всего списка: строка рендерится закреплённой, а эффект ниже прокручивает
    // список, после чего окно включает её естественно.
    rangeExtractor: (range) => {
      const index = activeIndex();
      if (index < 0) return [];
      const reach = Math.max(1, maxVisible());
      return index >= range.startIndex - reach && index <= range.endIndex + reach
        ? [index]
        : [];
    },
  });

  clientEffect(() => {
    const node = listElement();
    const active = node !== null && visible() && virtualized();
    virtualizer.setScrollElement(active ? node : null);
    if (!active) return;
    const block = readOptionBlock(node, props.size);
    if (block !== optionBlock()) setOptionBlock(block);
  });

  // Смена активной строки — минимальная прокрутка (`align: "auto"`). Ключ
  // сравнивается, чтобы ручной скролл не возвращал список назад.
  let lastActiveKey: string | null = null;
  let lastActiveList: HTMLElement | null = null;
  clientEffect(() => {
    const node = listElement();
    const key = activeKey();
    if (node === null || key === null || !virtualized()) return;
    if (key === lastActiveKey && node === lastActiveList) return;
    lastActiveKey = key;
    lastActiveList = node;
    const index = activeIndex();
    if (index >= 0) virtualizer.scrollToIndex(index, { align: "auto" });
  });

  // Строки окна: непрерывный диапазон виртуализатора плюс активная строка,
  // если окно её не содержит. Когда вьюпорт ещё не измерен (нет layout —
  // jsdom или скрытая панель), ядро отдаёт пустой диапазон: тогда отдаём всё
  // дерево, иначе строки и `aria-activedescendant` остались бы без целей.
  const windowRows = (): readonly TreeWindowRow[] => {
    const list = rows();
    if (list.length === 0) return [];
    const result: TreeWindowRow[] = [];
    for (const item of virtualizer.virtualItems()) {
      const row = list[item.index];
      if (row !== undefined) {
        result.push({ row, start: item.start, pinned: false });
      }
    }
    if (result.length === 0) {
      for (const row of list) {
        result.push({
          row,
          start: virtualizer.getOffsetForIndex(row.index, "start"),
          pinned: false,
        });
      }
      return result;
    }
    const index = activeIndex();
    if (index >= 0 && !result.some((entry) => entry.row.index === index)) {
      const row = list[index];
      if (row !== undefined) {
        result.push({
          row,
          start: virtualizer.getOffsetForIndex(index, "start"),
          pinned: true,
        });
      }
    }
    return result;
  };

  const spacerStyle = (): StyleInput => ({
    position: "relative",
    top: 0,
    left: 0,
    width: "100%",
    height: virtualizer.totalSize(),
    minHeight: 0,
  });

  const measureRow = (node: Element | null): void => {
    if (node === null) return;
    virtualizer.measureElement(node);
    // `ref` выполняется до вставки детей в документ: повторное измерение
    // микрозадачей видит уже собранную строку.
    queueMicrotask(() => {
      virtualizer.measureElement(node);
    });
  };

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
    cancelSearchTimer();
    searchRequest += 1;
    setQuerySignal("");
    setSearchNodes(null);
    setLoadErrorState(null);
    openState.requestOpen(true);
    syncActive();
    void loadRoots();
  };
  const close = (restoreFocus: boolean): void => {
    if (!visible()) return;
    cancelSearchTimer();
    searchRequest += 1;
    openState.requestOpen(false);
    setQuerySignal("");
    setSearchNodes(null);
    setLoadErrorState(null);
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

  const selectableKeys = (): string[] => {
    const current = index();
    return current.order.filter((key) => {
      const entry = current.nodes.get(key);
      return entry !== undefined
        && entry.node.disabled !== true
        && isSelectableKey(key);
    });
  };
  const allSelected = (): boolean => {
    const current = index();
    const keys = current.order.filter((key) => {
      const entry = current.nodes.get(key);
      return entry !== undefined
        && entry.childKeys.length === 0
        && entry.node.disabled !== true;
    });
    if (keys.length === 0) return false;
    const state = selection();
    return keys.every((key) => state.checked.get(key) === true);
  };
  const toggleSelectAll = (event?: Event): void => {
    event?.stopPropagation();
    if (disabled() || readOnly()) return;
    emitExplicit(allSelected() ? [] : selectableKeys());
    controlElement()?.focus({ preventScroll: true });
  };
  const clearValue = (event?: Event): void => {
    event?.stopPropagation();
    if (disabled() || readOnly()) return;
    emitExplicit([]);
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
      if (querySignal() !== "") updateQuery("");
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
        updateQuery(querySignal() + key);
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
          updateQuery(querySignal() + key);
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
      if (querySignal() !== "") updateQuery("");
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

  const renderRow = (
    row: FlatTreeNodeRow,
    placement?: TreeRowPlacement | undefined,
  ): Node => (
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
      data-index={placement === undefined ? undefined : row.index}
      data-indeterminate={row.indeterminate ? "" : undefined}
      data-disabled={row.option.disabled === true ? "" : undefined}
      data-loading={loadingKeys().has(row.key) ? "" : undefined}
      data-depth={String(row.depth)}
      data-option-index={row.index}
      data-pinned={placement?.pinned === true ? "" : undefined}
      data-value={row.key}
      ref={placement === undefined ? undefined : measureRow}
      style={
        placement === undefined
          ? { "--sui-tree-select-level": String(row.depth) }
          : {
              "--sui-tree-select-level": String(row.depth),
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${placement.start}px)`,
            }
      }
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
          <Show
            when={loadingKeys().has(row.key)}
            fallback={<ChevronDownIcon size="sm" />}
          >
            <span class="sui-tree-select__spinner" aria-hidden="true" />
          </Show>
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
              <span class="sui-tree-select__label">
                {typeof row.node.label === "string"
                  ? highlightedLabel(row.node.label, searchText())
                  : row.node.label}
              </span>
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
            <Show
              when={
                clearable()
                && hasValue()
                && !disabled()
                && !readOnly()
              }
            >
              <button
                type="button"
                class="sui-tree-select__clear"
                tabindex="-1"
                aria-label={props.clearLabel ?? config.strings.clear}
                onMouseDown={(event: MouseEvent) => {
                  event.preventDefault();
                }}
                onClick={clearValue}
              >
                <CloseIcon size="sm" />
              </button>
            </Show>
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
                  updateQuery(target?.value ?? "");
                }}
                onKeyDown={onSearchKeyDown}
                onBlur={handleBlur}
                onFocus={handleFocus}
              />
            </Show>
            <Show when={showSelectAll() || (clearable() && hasValue())}>
              <div class="sui-tree-select__toolbar">
                <Show when={showSelectAll()}>
                  <button
                    type="button"
                    class="sui-tree-select__tool"
                    tabindex="-1"
                    aria-label={allSelected() ? "Снять выбор" : selectAllLabel()}
                    onMouseDown={(event: MouseEvent) => {
                      event.preventDefault();
                    }}
                    onClick={toggleSelectAll}
                  >
                    {allSelected() ? "Снять выбор" : selectAllLabel()}
                  </button>
                </Show>
                <Show when={clearable() && hasValue()}>
                  <button
                    type="button"
                    class="sui-tree-select__tool"
                    tabindex="-1"
                    aria-label={props.clearLabel ?? config.strings.clear}
                    onMouseDown={(event: MouseEvent) => {
                      event.preventDefault();
                    }}
                    onClick={clearValue}
                  >
                    {props.clearLabel ?? config.strings.clear}
                  </button>
                </Show>
              </div>
            </Show>
            <Show when={loadErrorState() !== null && rows().length > 0}>
              <div class="sui-popup__error" role="alert">
                {loadErrorState()}
              </div>
            </Show>
            <div
              id={listId}
              ref={(node: Element | null) => {
                setListElement(node as HTMLElement | null);
              }}
              class="sui-popup__list sui-tree-select__tree"
              role="tree"
              aria-multiselectable={multiple() ? "true" : undefined}
              aria-label={comboboxLabel()}
            >
              <Show
                when={rows().length > 0}
                fallback={
                  <Show
                    when={loadErrorState() !== null}
                    fallback={
                      <Show
                        when={props.loading === true || rootLoading()}
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
                <div class="sui-popup__virtual-spacer" style={spacerStyle()}>
                  <For each={windowRows()} keyOf={(entry) => entry.row.key}>
                    {(entry) =>
                      renderRow(entry.row, {
                        start: entry.start,
                        pinned: entry.pinned,
                      })
                    }
                  </For>
                </div>
              </Show>
            </div>
          </div>
        </Show>
      </div>
    </Field>
  );
}
