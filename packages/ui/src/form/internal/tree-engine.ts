import type { Children } from "@ivlev-dev/silent-core";
import { childrenText, matchesQuery } from "./listbox-filter.js";
import type {
  FlatListboxOption,
  ListboxOption,
} from "./listbox-engine.js";
import { listboxKey } from "./listbox-engine.js";

/**
 * Чистое ядро дерева выбора.
 *
 * Модель не знает про DOM: компонент `TreeSelect` владеет открытием,
 * фокусом и разметкой, а здесь живут индексация, каскад выбора, эмиссия
 * значений, поиск и «плоская» проекция дерева для рендера и клавиатуры.
 * Проекция совместима с `FlatListboxOption`, поэтому навигацию и typeahead
 * можно переиспользовать из listbox-движка.
 */

export type TreeNodeValue = string | number;

/** Узел дерева: значение, подпись и необязательные дети/метаданные. */
export interface TreeNode {
  readonly value: TreeNodeValue;
  readonly label: Children;
  readonly children?: readonly TreeNode[] | undefined;
  readonly disabled?: boolean | undefined;
  readonly description?: Children | undefined;
  readonly icon?: Children | undefined;
  /** Дополнительные слова для поиска (синонимы, артикулы). */
  readonly keywords?: readonly string[] | undefined;
  /**
   * Узел имеет детей, которых ещё нет в `children`: TreeSelect покажет
   * раскрытие и вызовет `load("", node)`.
   */
  readonly hasChildren?: boolean | undefined;
  /** Алиас `hasChildren` для ленивых деревьев из API. */
  readonly lazy?: boolean | undefined;
}

/** Как выбор узла распространяется по дереву. */
export type TreeCascade = "independent" | "down" | "up" | "both";

/** Какие узлы попадают в значение. */
export type TreeEmit = "leaves" | "checked" | "all";

/** Как поиск формирует видимое дерево. */
export type TreeSearchStrategy = "filter" | "keep-ancestors";

export interface IndexedTreeNode {
  readonly node: TreeNode;
  readonly key: string;
  readonly parentKey: string | null;
  /** Предки от корня к родителю. */
  readonly ancestorKeys: readonly string[];
  readonly childKeys: readonly string[];
  /** Все потомки в pre-order. */
  readonly descendantKeys: readonly string[];
  /** Листья поддерева (для каскада вниз и `emit: leaves`). */
  readonly leafKeys: readonly string[];
  readonly depth: number;
}

export interface TreeIndex {
  readonly roots: readonly string[];
  /** Все ключи в pre-order — детерминированный порядок значений. */
  readonly order: readonly string[];
  readonly nodes: ReadonlyMap<string, IndexedTreeNode>;
}

interface MutableIndexedNode {
  node: TreeNode;
  key: string;
  parentKey: string | null;
  ancestorKeys: string[];
  childKeys: string[];
  descendantKeys: string[];
  leafKeys: string[];
  depth: number;
}

/** Индексирует дерево: ключи, предки, дети, листья и глубины. */
export function indexTree(nodes: readonly TreeNode[]): TreeIndex {
  const map = new Map<string, MutableIndexedNode>();
  const roots: string[] = [];
  const order: string[] = [];

  const visit = (
    node: TreeNode,
    parentKey: string | null,
    ancestorKeys: readonly string[],
    depth: number,
  ): void => {
    const key = listboxKey(node.value);
    if (map.has(key)) return;
    map.set(key, {
      node,
      key,
      parentKey,
      ancestorKeys: [...ancestorKeys],
      childKeys: [],
      descendantKeys: [],
      leafKeys: [],
      depth,
    });
    order.push(key);
    if (parentKey === null) roots.push(key);

    const parent = map.get(key);
    if (parent === undefined) return;
    for (const child of node.children ?? []) {
      const childKey = listboxKey(child.value);
      if (map.has(childKey)) continue;
      parent.childKeys.push(childKey);
      visit(child, key, [...ancestorKeys, key], depth + 1);
    }
  };

  for (const node of nodes) visit(node, null, [], 0);

  // Потомки и листья считаются снизу вверх: у детей всё уже готово.
  for (let index = order.length - 1; index >= 0; index -= 1) {
    const entry = map.get(order[index]!);
    if (entry === undefined) continue;
    const children = entry.childKeys
      .map((childKey) => map.get(childKey))
      .filter((child): child is MutableIndexedNode => child !== undefined);
    entry.descendantKeys = children.flatMap((child) => [
      child.key,
      ...child.descendantKeys,
    ]);
    entry.leafKeys =
      children.length === 0
        ? [entry.key]
        : children.flatMap((child) => child.leafKeys);
  }

  return { roots, order, nodes: map };
}

/** Состояние выбора, выведенное из явно выбранных ключей и каскада. */
export interface TreeSelectionMaps {
  readonly checked: ReadonlyMap<string, boolean>;
  readonly indeterminate: ReadonlyMap<string, boolean>;
}

function cascadeDown(cascade: TreeCascade): boolean {
  return cascade === "down" || cascade === "both";
}

/**
 * Выводит отмеченность и «частичность» каждого узла.
 *
 * Правила отображения:
 * - узел отмечен, если он выбран явно;
 * - при каскаде вниз отмеченность предка распространяется на потомков;
 * - в любом каскаде, кроме `independent`, родитель отмечен, когда отмечены
 *   все его дети (иначе значение из листьев не «сворачивалось» бы обратно);
 * - частичный узел — не отмеченный родитель, под которым есть отмеченные
 *   потомки.
 */
export function treeSelection(
  index: TreeIndex,
  selectedKeys: ReadonlySet<string>,
  cascade: TreeCascade,
): TreeSelectionMaps {
  const down = cascadeDown(cascade);
  const displayUp = cascade !== "independent";
  const checked = new Map<string, boolean>();

  const resolve = (key: string): boolean => {
    const known = checked.get(key);
    if (known !== undefined) return known;
    const entry = index.nodes.get(key);
    if (entry === undefined) return false;
    // Защита от случайного цикла: деревья строятся без него.
    checked.set(key, false);
    let value = selectedKeys.has(key);
    if (!value && down) {
      value = entry.ancestorKeys.some((ancestor) =>
        selectedKeys.has(ancestor),
      );
    }
    if (!value && displayUp && entry.childKeys.length > 0) {
      value = entry.childKeys.every((childKey) => resolve(childKey));
    }
    checked.set(key, value);
    return value;
  };

  for (const key of index.order) resolve(key);

  const indeterminate = new Map<string, boolean>();
  const containsChecked = (key: string): boolean => {
    const entry = index.nodes.get(key);
    if (entry === undefined) return false;
    return entry.childKeys.some(
      (childKey) =>
        checked.get(childKey) === true || containsChecked(childKey),
    );
  };
  for (const key of index.order) {
    const entry = index.nodes.get(key);
    if (entry === undefined) continue;
    indeterminate.set(
      key,
      entry.childKeys.length > 0
        && checked.get(key) !== true
        && containsChecked(key),
    );
  }

  return { checked, indeterminate };
}

function orderedKeys(
  index: TreeIndex,
  selected: ReadonlySet<string>,
): string[] {
  return index.order.filter((key) => selected.has(key));
}

/**
 * Переключает узел с учётом каскада и возвращает новый набор явных ключей.
 *
 * - `down`/`both`: выбор узла добавляет всё поддерево.
 * - `up`/`both`: выбор добавляет предков, у которых отмечены все дети.
 * - Снятие узла в любом каскаде, кроме `independent`, очищает поддерево и
 *   предков: иначе явно выбранный предок снова «подсветил» бы потомков.
 */
export function toggleTreeSelection(
  index: TreeIndex,
  selectedKeys: readonly string[],
  key: string,
  cascade: TreeCascade,
): string[] {
  const entry = index.nodes.get(key);
  const selected = new Set(selectedKeys);
  if (entry === undefined) return orderedKeys(index, selected);

  const state = treeSelection(index, selected, cascade);
  const target = state.checked.get(key) !== true;
  const down = cascadeDown(cascade);
  const up = cascade === "up" || cascade === "both";

  if (target) {
    selected.add(key);
    if (down) {
      for (const childKey of entry.descendantKeys) selected.add(childKey);
    }
    if (up) {
      for (const ancestorKey of [...entry.ancestorKeys].reverse()) {
        const ancestor = index.nodes.get(ancestorKey);
        if (ancestor === undefined) continue;
        const current = treeSelection(index, selected, cascade);
        const complete = ancestor.childKeys.every(
          (childKey) => current.checked.get(childKey) === true,
        );
        if (!complete) break;
        selected.add(ancestorKey);
      }
    }
  } else {
    selected.delete(key);
    if (cascade !== "independent") {
      for (const childKey of entry.descendantKeys) selected.delete(childKey);
      for (const ancestorKey of entry.ancestorKeys) {
        selected.delete(ancestorKey);
      }
    }
  }

  return orderedKeys(index, selected);
}

/**
 * Собирает ключи для значения по режиму `emit`.
 *
 * `leaves` — отмеченные листья, `checked` — все полностью отмеченные узлы,
 * `all` — отмеченные плюс частичные родители. `selectable` отсекает
 * невыбираемые родители (при `selectableParents: false`).
 */
export function emitTreeSelection(
  index: TreeIndex,
  selectedKeys: ReadonlySet<string>,
  cascade: TreeCascade,
  emit: TreeEmit,
  selectable?: ((key: string) => boolean) | undefined,
): string[] {
  const state = treeSelection(index, selectedKeys, cascade);
  return index.order.filter((key) => {
    if (selectable !== undefined && !selectable(key)) return false;
    const entry = index.nodes.get(key);
    if (entry === undefined) return false;
    const checked = state.checked.get(key) === true;
    if (emit === "leaves") {
      return checked && entry.childKeys.length === 0;
    }
    if (emit === "checked") return checked;
    return checked || state.indeterminate.get(key) === true;
  });
}

/** Совпадение узла с запросом: подпись, описание или `keywords`. */
export function treeNodeMatches(node: TreeNode, query: string): boolean {
  if (matchesQuery(childrenText(node.label), query)) return true;
  if (
    node.description !== undefined
    && matchesQuery(childrenText(node.description), query)
  ) {
    return true;
  }
  for (const keyword of node.keywords ?? []) {
    if (matchesQuery(keyword, query)) return true;
  }
  return false;
}

export interface TreeSearchResult {
  readonly matched: ReadonlySet<string>;
  readonly visible: ReadonlySet<string>;
}

/**
 * Поиск по дереву. `keep-ancestors` оставляет путь до совпадений, `filter`
 * показывает только совпадения — у них может не быть видимого родителя,
 * поэтому проекция «поднимает» их в корень.
 */
export function searchTree(
  index: TreeIndex,
  query: string,
  strategy: TreeSearchStrategy = "keep-ancestors",
): TreeSearchResult {
  const matched = new Set<string>();
  for (const key of index.order) {
    const entry = index.nodes.get(key);
    if (entry !== undefined && treeNodeMatches(entry.node, query)) {
      matched.add(key);
    }
  }
  if (strategy === "filter") {
    return {
      matched,
      visible: new Set(index.order.filter((key) => matched.has(key))),
    };
  }
  const visible = new Set(matched);
  for (const key of matched) {
    const entry = index.nodes.get(key);
    for (const ancestorKey of entry?.ancestorKeys ?? []) visible.add(ancestorKey);
  }
  return {
    matched,
    // Порядок — pre-order дерева, а не порядок добавления совпадений.
    visible: new Set(index.order.filter((key) => visible.has(key))),
  };
}

/** Строка дерева: listbox-совместимая опция плюс tree-метаданные. */
export interface FlatTreeNodeRow extends FlatListboxOption {
  readonly node: TreeNode;
  readonly parentKey: string | null;
  readonly depth: number;
  readonly level: number;
  readonly hasChildren: boolean;
  readonly expanded: boolean;
  readonly checked: boolean;
  readonly indeterminate: boolean;
  readonly setsize: number;
  readonly posinset: number;
}

export interface TreeViewOptions {
  readonly expanded: ReadonlySet<string>;
  readonly selected: ReadonlySet<string>;
  readonly cascade: TreeCascade;
  readonly search?: string | undefined;
  readonly searchStrategy?: TreeSearchStrategy | undefined;
  readonly flattenOnSearch?: boolean | undefined;
}

function listboxOptionOf(node: TreeNode): ListboxOption {
  return {
    value: node.value,
    label: node.label,
    disabled: node.disabled,
    description: node.description,
    leading: node.icon,
  };
}

/**
 * Проецирует дерево в плоский список строк в порядке обхода.
 *
 * `depth`/`level` и `setsize`/`posinset` считаются по видимым соседям.
 * При поиске все видимые родители раскрыты, чтобы совпадения были видны.
 * `flattenOnSearch` превращает результаты в одноуровневый список.
 */
export function flattenTreeView(
  index: TreeIndex,
  options: TreeViewOptions,
): FlatTreeNodeRow[] {
  const state = treeSelection(index, options.selected, options.cascade);
  const query = options.search ?? "";
  const searching = query.trim() !== "";
  const strategy = options.searchStrategy ?? "keep-ancestors";
  const flattenSearch = searching && options.flattenOnSearch === true;
  const search = searching ? searchTree(index, query, strategy) : null;
  const visible = search?.visible ?? null;
  const isVisible = (key: string): boolean =>
    visible === null || visible.has(key);

  const rows: FlatTreeNodeRow[] = [];
  const rowFor = (
    key: string,
    parentKey: string | null,
    depth: number,
    hasChildren: boolean,
    expanded: boolean,
    setsize: number,
    posinset: number,
  ): FlatTreeNodeRow | null => {
    const entry = index.nodes.get(key);
    if (entry === undefined) return null;
    return {
      option: listboxOptionOf(entry.node),
      key: entry.key,
      index: rows.length,
      group: null,
      groupIndex: -1,
      node: entry.node,
      parentKey,
      depth,
      level: depth + 1,
      hasChildren,
      expanded,
      checked: state.checked.get(key) === true,
      indeterminate: state.indeterminate.get(key) === true,
      setsize,
      posinset,
    };
  };

  if (flattenSearch) {
    const keys = index.order.filter(isVisible);
    keys.forEach((key, position) => {
      const row = rowFor(key, null, 0, false, false, keys.length, position + 1);
      if (row !== null) rows.push(row);
    });
    return rows;
  }

  const visibleParentOf = (key: string): string | null => {
    const entry = index.nodes.get(key);
    if (entry === undefined) return null;
    for (let position = entry.ancestorKeys.length - 1; position >= 0; position -= 1) {
      const ancestorKey = entry.ancestorKeys[position];
      if (ancestorKey !== undefined && isVisible(ancestorKey)) return ancestorKey;
    }
    return null;
  };

  const rootKeys = index.order.filter(
    (key) => isVisible(key) && visibleParentOf(key) === null,
  );

  const walk = (
    siblingKeys: readonly string[],
    parentKey: string | null,
    depth: number,
  ): void => {
    siblingKeys.forEach((key, position) => {
      const entry = index.nodes.get(key);
      if (entry === undefined) return;
      const childKeys = entry.childKeys.filter(isVisible);
      const lazyChildren =
        !searching
        && (entry.node.hasChildren === true || entry.node.lazy === true);
      const hasChildren = childKeys.length > 0 || lazyChildren;
      const expanded = hasChildren && (searching || options.expanded.has(key));
      const row = rowFor(
        key,
        parentKey,
        depth,
        hasChildren,
        expanded,
        siblingKeys.length,
        position + 1,
      );
      if (row === null) return;
      rows.push(row);
      if (expanded) walk(childKeys, key, depth + 1);
    });
  };

  walk(rootKeys, null, 0);

  return rows;
}

/** Значение узла по ключу. */
export function treeValueForKey(
  index: TreeIndex,
  key: string,
): TreeNodeValue | null {
  const entry = index.nodes.get(key);
  return entry === undefined ? null : entry.node.value;
}

/** Преобразует ключи в исходные значения узлов, отбрасывая отсутствующие. */
export function treeKeysToValues(
  index: TreeIndex,
  keys: readonly string[],
): TreeNodeValue[] {
  const values: TreeNodeValue[] = [];
  for (const key of keys) {
    const entry = index.nodes.get(key);
    if (entry !== undefined) values.push(entry.node.value);
  }
  return values;
}

/** Видимая подпись узла по ключу (для typeahead и `title`). */
export function treeLabelForKey(index: TreeIndex, key: string): string {
  const entry = index.nodes.get(key);
  return entry === undefined ? "" : childrenText(entry.node.label);
}
