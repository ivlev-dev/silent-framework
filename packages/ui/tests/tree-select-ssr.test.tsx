import { afterEach, describe, expect, it } from "vitest";
import { flushSync, hydrate } from "@ivlev-dev/silent-core";
import { renderToString } from "@ivlev-dev/silent-server";
import {
  TreeSelect,
  type TreeSelectNode,
} from "../src/form/tree-select/index.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  document.body.replaceChildren();
});

function flush(): void {
  flushSync();
  flushSync();
}

const nodes: readonly TreeSelectNode[] = [
  {
    value: "fruits",
    label: "Фрукты",
    children: [
      { value: "apple", label: "Яблоко" },
      {
        value: "banana",
        label: "Банан",
        children: [{ value: "plantain", label: "Плантан" }],
      },
    ],
  },
  { value: "veg", label: "Овощи" },
];

function MultipleTree(): Node {
  return (
    <div>
      <TreeSelect
        id="fruit"
        name="fruit"
        label="Фрукты"
        multiple
        nodes={nodes}
        value={["apple", "plantain"]}
      />
    </div>
  );
}

function SingleTree(): Node {
  return (
    <TreeSelect
      id="fruit"
      name="fruit"
      label="Фрукты"
      nodes={nodes}
      value="plantain"
    />
  );
}

describe("SSR TreeSelect", () => {
  it("multiple: только триггер и hidden inputs, без дерева и панели", async () => {
    const { html } = await renderToString(MultipleTree);
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-haspopup="tree"');
    expect(html).not.toContain('role="tree"');
    expect(html).not.toContain("sui-popup");
    expect(html).not.toContain('role="treeitem"');
    // aria-controls появляется только после mount.
    expect(html).not.toContain("aria-controls");
    const hidden = [...html.matchAll(/<input[^>]*name="fruit"[^>]*>/gu)].map(
      (match) => match[0],
    );
    expect(hidden).toHaveLength(2);
    expect(hidden[0]).toContain('value="apple"');
    expect(hidden[1]).toContain('value="plantain"');
    expect(html).toContain("Фрукты");
  });

  it("single: один hidden input со значением", async () => {
    const { html } = await renderToString(SingleTree);
    const hidden = [...html.matchAll(/<input[^>]*name="fruit"[^>]*>/gu)].map(
      (match) => match[0],
    );
    expect(hidden).toHaveLength(1);
    expect(hidden[0]).toContain('value="plantain"');
    expect(html).not.toContain('role="tree"');
    expect(html).not.toContain("sui-popup");
  });

  it("гидрация без mismatch, затем дерево открывается", async () => {
    const { html } = await renderToString(MultipleTree);
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    const mismatches: string[] = [];
    const handle = await hydrate(container, MultipleTree, {
      onMismatch: (error) => mismatches.push(error.message),
    });
    cleanups.push(() => handle.dispose());
    flush();
    expect(mismatches).toEqual([]);

    const control = container.querySelector<HTMLElement>(
      ".sui-tree-select__control",
    );
    expect(control).not.toBeNull();
    expect(control?.getAttribute("aria-controls")).toBe("fruit-listbox");
    expect(container.querySelector(".sui-popup")).toBeNull();
    expect(
      container.querySelectorAll('input[type="hidden"]'),
    ).toHaveLength(2);

    control?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    flush();
    const tree = container.querySelector('[role="tree"]');
    expect(tree).not.toBeNull();
    expect(tree?.getAttribute("aria-multiselectable")).toBe("true");
    expect(
      container.querySelectorAll('[role="treeitem"]').length,
    ).toBeGreaterThan(0);
  });

  it("детерминированная разметка повторяема", async () => {
    const first = await renderToString(MultipleTree);
    const second = await renderToString(MultipleTree);
    expect(second.html).toBe(first.html);
  });
});
