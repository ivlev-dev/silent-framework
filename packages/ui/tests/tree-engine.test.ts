import { describe, expect, it } from "vitest";
import type { TreeNode } from "../src/form/internal/tree-engine.js";
import {
  emitTreeSelection,
  flattenTreeView,
  indexTree,
  searchTree,
  toggleTreeSelection,
  treeKeysToValues,
  treeSelection,
} from "../src/form/internal/tree-engine.js";

const nodes: readonly TreeNode[] = [
  {
    value: "a",
    label: "Альфа",
    children: [
      { value: "a1", label: "Альфа 1" },
      {
        value: "a2",
        label: "Альфа 2",
        children: [
          { value: "a2x", label: "Альфа 2 X", keywords: ["икс"] },
        ],
      },
    ],
  },
  {
    value: "b",
    label: "Бета",
    children: [{ value: "b1", label: "Бета 1" }],
  },
  { value: "c", label: "Гамма" },
];

const index = indexTree(nodes);

function keysOf(selected: readonly string[]): ReadonlySet<string> {
  return new Set(selected);
}

describe("tree-engine: индексация и плоская проекция", () => {
  it("строит pre-order, предков, листья и глубины", () => {
    expect(index.order).toEqual(["a", "a1", "a2", "a2x", "b", "b1", "c"]);
    expect(index.roots).toEqual(["a", "b", "c"]);
    expect(index.nodes.get("a2x")?.depth).toBe(2);
    expect(index.nodes.get("a2x")?.ancestorKeys).toEqual(["a", "a2"]);
    expect(index.nodes.get("a")?.leafKeys).toEqual(["a1", "a2x"]);
    expect(index.nodes.get("a")?.descendantKeys).toEqual([
      "a1",
      "a2",
      "a2x",
    ]);
  });

  it("свёрнутое дерево содержит только корни", () => {
    const rows = flattenTreeView(index, {
      expanded: new Set(),
      selected: new Set(),
      cascade: "both",
    });
    expect(rows.map((row) => row.key)).toEqual(["a", "b", "c"]);
    expect(rows.map((row) => row.level)).toEqual([1, 1, 1]);
    expect(rows.map((row) => row.setsize)).toEqual([3, 3, 3]);
    expect(rows.map((row) => row.posinset)).toEqual([1, 2, 3]);
    expect(rows[0]?.hasChildren).toBe(true);
    expect(rows[2]?.hasChildren).toBe(false);
  });

  it("раскрывает ветки и считает level/setsize/posinset по видимым соседям", () => {
    const rows = flattenTreeView(index, {
      expanded: new Set(["a", "a2"]),
      selected: new Set(),
      cascade: "both",
    });
    expect(rows.map((row) => row.key)).toEqual([
      "a",
      "a1",
      "a2",
      "a2x",
      "b",
      "c",
    ]);
    expect(rows.map((row) => row.level)).toEqual([1, 2, 2, 3, 1, 1]);
    expect(rows[1]?.setsize).toBe(2);
    expect(rows[1]?.posinset).toBe(1);
    expect(rows[2]?.posinset).toBe(2);
    expect(rows[3]?.setsize).toBe(1);
    expect(rows[4]?.posinset).toBe(2);
    expect(rows[5]?.posinset).toBe(3);
    expect(rows[0]?.expanded).toBe(true);
    expect(rows[2]?.expanded).toBe(true);
    expect(rows[1]?.expanded).toBe(false);
  });

  it("пробрасывает disabled, description и icon в listbox-опцию", () => {
    const disabledIndex = indexTree([
      {
        value: "p",
        label: "Родитель",
        description: "Пояснение",
        children: [{ value: "x", label: "X", disabled: true }],
      },
    ]);
    const rows = flattenTreeView(disabledIndex, {
      expanded: new Set(["p"]),
      selected: new Set(),
      cascade: "both",
    });
    expect(rows[1]?.option.disabled).toBe(true);
    expect(rows[0]?.option.description).toBe("Пояснение");
    expect(rows[0]?.group).toBeNull();
  });
});

describe("tree-engine: каскад и indeterminate", () => {
  it("both: родитель отмечает поддерево, частичный ребёнок — indeterminate", () => {
    const partial = treeSelection(index, keysOf(["a1"]), "both");
    expect(partial.checked.get("a1")).toBe(true);
    expect(partial.checked.get("a")).toBe(false);
    expect(partial.indeterminate.get("a")).toBe(true);
    expect(partial.indeterminate.get("a1")).toBe(false);
  });

  it("both: все листья отмечают родителей", () => {
    const all = treeSelection(index, keysOf(["a1", "a2x", "b1"]), "both");
    expect(all.checked.get("a2")).toBe(true);
    expect(all.checked.get("a")).toBe(true);
    expect(all.checked.get("b")).toBe(true);
    expect(all.indeterminate.get("a")).toBe(false);
  });

  it("both: выбор снимает поддерево и предков", () => {
    const next = toggleTreeSelection(
      index,
      ["a", "a1", "a2", "a2x"],
      "a2x",
      "both",
    );
    expect(next).toEqual(["a1"]);
  });

  it("both: выбор родителя добавляет всё поддерево", () => {
    expect(toggleTreeSelection(index, [], "a", "both")).toEqual([
      "a",
      "a1",
      "a2",
      "a2x",
    ]);
  });

  it("down: выбор вниз, снятие ребёнка убирает предков", () => {
    const down = toggleTreeSelection(index, [], "a", "down");
    expect(down).toEqual(["a", "a1", "a2", "a2x"]);
    const after = toggleTreeSelection(index, down, "a2x", "down");
    expect(after).toEqual(["a1"]);
  });

  it("up: выбор листьев поднимается до полного родителя", () => {
    const one = toggleTreeSelection(index, [], "a1", "up");
    expect(one).toEqual(["a1"]);
    const all = toggleTreeSelection(index, one, "a2x", "up");
    expect(all).toEqual(["a", "a1", "a2", "a2x"]);
  });

  it("independent: выбор не распространяется", () => {
    const parentOnly = toggleTreeSelection(index, [], "a", "independent");
    expect(parentOnly).toEqual(["a"]);
    const state = treeSelection(index, keysOf(parentOnly), "independent");
    expect(state.checked.get("a")).toBe(true);
    expect(state.checked.get("a1")).toBe(false);
    expect(toggleTreeSelection(index, parentOnly, "a1", "independent")).toEqual([
      "a",
      "a1",
    ]);
  });
});

describe("tree-engine: emit", () => {
  const all = ["a1", "a2x", "b1"];

  it("leaves отдаёт только листья", () => {
    expect(emitTreeSelection(index, keysOf(all), "both", "leaves")).toEqual([
      "a1",
      "a2x",
      "b1",
    ]);
  });

  it("checked отдаёт родителей и листья, all добавляет частичных", () => {
    expect(emitTreeSelection(index, keysOf(all), "both", "checked")).toEqual([
      "a",
      "a1",
      "a2",
      "a2x",
      "b",
      "b1",
    ]);
    expect(emitTreeSelection(index, keysOf(["a1"]), "both", "all")).toEqual([
      "a",
      "a1",
    ]);
  });

  it("selectable-предикат отсекает невыбираемых родителей", () => {
    const leavesOnly = (key: string): boolean =>
      index.nodes.get(key)?.childKeys.length === 0;
    expect(
      emitTreeSelection(index, keysOf(all), "both", "checked", leavesOnly),
    ).toEqual(["a1", "a2x", "b1"]);
  });

  it("independent: родитель в значении, но листья — нет", () => {
    expect(
      emitTreeSelection(index, keysOf(["a"]), "independent", "leaves"),
    ).toEqual([]);
    expect(
      emitTreeSelection(index, keysOf(["a"]), "independent", "checked"),
    ).toEqual(["a"]);
  });

  it("преобразует ключи в исходные значения", () => {
    expect(treeKeysToValues(index, ["a", "c"])).toEqual(["a", "c"]);
    expect(treeKeysToValues(index, ["missing"])).toEqual([]);
  });
});

describe("tree-engine: поиск", () => {
  it("keep-ancestors оставляет путь и сохраняет уровни", () => {
    const search = searchTree(index, "икс", "keep-ancestors");
    expect([...search.matched]).toEqual(["a2x"]);
    expect([...search.visible]).toEqual(["a", "a2", "a2x"]);

    const rows = flattenTreeView(index, {
      expanded: new Set(),
      selected: new Set(),
      cascade: "both",
      search: "икс",
      searchStrategy: "keep-ancestors",
    });
    expect(rows.map((row) => row.key)).toEqual(["a", "a2", "a2x"]);
    expect(rows.map((row) => row.level)).toEqual([1, 2, 3]);
    expect(rows.every((row) => row.expanded || !row.hasChildren)).toBe(true);
  });

  it("filter поднимает совпадения без видимых предков в корень", () => {
    const rows = flattenTreeView(index, {
      expanded: new Set(),
      selected: new Set(),
      cascade: "both",
      search: "икс",
      searchStrategy: "filter",
    });
    expect(rows.map((row) => row.key)).toEqual(["a2x"]);
    expect(rows[0]?.level).toBe(1);
    expect(rows[0]?.parentKey).toBeNull();
    expect(rows[0]?.setsize).toBe(1);
  });

  it("flattenOnSearch делает результаты одноуровневыми", () => {
    const rows = flattenTreeView(index, {
      expanded: new Set(),
      selected: new Set(),
      cascade: "both",
      search: "альфа",
      searchStrategy: "keep-ancestors",
      flattenOnSearch: true,
    });
    expect(rows.map((row) => row.key)).toEqual(["a", "a1", "a2", "a2x"]);
    expect(rows.every((row) => row.level === 1)).toBe(true);
    expect(rows.every((row) => row.hasChildren === false)).toBe(true);
    expect(rows.map((row) => row.posinset)).toEqual([1, 2, 3, 4]);
  });

  it("совпадение по keywords и описанию", () => {
    const keyword = searchTree(index, "ИКС", "keep-ancestors");
    expect(keyword.matched.has("a2x")).toBe(true);
    const described = indexTree([
      { value: "x", label: "X", description: "Артикул 42" },
    ]);
    expect(searchTree(described, "42").matched.has("x")).toBe(true);
  });
});
