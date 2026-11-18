// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { createRoot, createSignal, flushSync } from "@ivlev-dev/silent-reactivity";
import { insert, setServerMode, templateHoles, type TemplatePlan } from "../src/dom.js";
import { For } from "../src/control-flow.js";
import { Index } from "../src/index-list.js";
import { component } from "../src/component-lite.js";
import { createComponent, whenIdle, type ComponentResult } from "../src/component.js";
import { hydrate } from "../src/hydrate.js";
import type { AnyComponent } from "../src/types.js";

interface Row {
  readonly id: string;
  readonly label: string;
}

const ROW_HTML = '<li class="row"><!--silent-hole-0--></li>';
const ROW_PLAN: TemplatePlan = {
  roots: 1,
  holes: [{ path: [0, 0], counts: [1, 1] }],
  attrs: [],
  strips: [],
};

const roots: HTMLElement[] = [];

function rowNode(row: Row): Node {
  const clone = templateHoles(ROW_HTML, ROW_PLAN)();
  const hole = clone.holes[0];
  if (hole === undefined) {
    throw new Error("нет дыры");
  }
  insert(hole.parentNode ?? clone.node, () => row.label, hole);
  return clone.node;
}

function makeApp(
  items: () => readonly Row[],
  keyOf?: (row: Row) => string,
): AnyComponent {
  return (() =>
    component(For as never, {
      get each() {
        return items();
      },
      ...(keyOf === undefined ? {} : { keyOf }),
      get children() {
        return (row: Row) => rowNode(row);
      },
    } as never)) as unknown as AnyComponent;
}

async function serverMarkup(app: AnyComponent): Promise<string> {
  setServerMode(true);
  try {
    let result: ComponentResult | null = null;
    const disposeRoot = createRoot((dispose) => {
      result = createComponent(app, {});
      return dispose;
    });
    if (result === null) {
      disposeRoot();
      throw new Error("компонент не создан");
    }
    const created: ComponentResult = result;
    await created.ready;
    await whenIdle();
    flushSync();
    const container = document.createElement("div");
    container.appendChild(created.node);
    const html = container.innerHTML;
    created.dispose();
    disposeRoot();
    return html;
  } finally {
    setServerMode(false);
  }
}

async function hydrateFor(
  items: () => readonly Row[],
  keyOf?: (row: Row) => string,
): Promise<HTMLElement> {
  const app = makeApp(items, keyOf);
  const markup = await serverMarkup(app);
  const root = document.createElement("div");
  root.innerHTML = markup;
  document.body.appendChild(root);
  roots.push(root);
  await hydrate(root, app);
  return root;
}

function labels(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll("li.row")).map(
    (row) => row.textContent ?? "",
  );
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    root.remove();
  }
  document.body.replaceChildren();
});

function makeIndexApp(items: () => readonly Row[]): AnyComponent {
  return (() =>
    component(Index as never, {
      get each() {
        return items();
      },
      get children() {
        return (item: () => Row) => rowNode(item());
      },
    } as never)) as unknown as AnyComponent;
}

async function hydrateIndex(items: () => readonly Row[]): Promise<HTMLElement> {
  const app = makeIndexApp(items);
  const markup = await serverMarkup(app);
  const root = document.createElement("div");
  root.innerHTML = markup;
  document.body.appendChild(root);
  roots.push(root);
  await hydrate(root, app);
  return root;
}

describe("границы реконсиляции For", () => {
  it("очистка после замены элементов сохраняет silent-end и новые строки", async () => {
    const [items, setItems] = createSignal<readonly Row[]>([
      { id: "a", label: "A" },
      { id: "b", label: "B" },
      { id: "c", label: "C" },
    ]);
    const root = await hydrateFor(items);
    expect(labels(root)).toEqual(["A", "B", "C"]);

    setItems([
      { id: "a", label: "A" },
      { id: "b2", label: "B2" },
      { id: "c2", label: "C2" },
    ]);
    flushSync();
    expect(labels(root)).toEqual(["A", "B2", "C2"]);

    setItems([]);
    flushSync();
    expect(labels(root)).toEqual([]);
    expect(root.innerHTML).toContain("silent-end");

    setItems([{ id: "d", label: "D" }]);
    flushSync();
    expect(labels(root)).toEqual(["D"]);
  });

  it("вставка после гидрации не расширяет границы предыдущей строки", async () => {
    const [items, setItems] = createSignal<readonly Row[]>([
      { id: "a", label: "A" },
    ]);
    const root = await hydrateFor(items);

    setItems([
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ]);
    flushSync();
    expect(labels(root)).toEqual(["A", "B"]);

    setItems([{ id: "b2", label: "B2" }]);
    flushSync();
    expect(labels(root)).toEqual(["B2"]);
    expect(root.innerHTML).toContain("silent-end");
  });

  it("For сохраняет вставленную строку после пере-рендера предыдущей", async () => {
    const [items, setItems] = createSignal<readonly Row[]>([
      { id: "a", label: "A" },
      { id: "b", label: "B" },
      { id: "c", label: "C" },
    ]);
    const root = await hydrateFor(items, (row) => row.id);
    expect(labels(root)).toEqual(["A", "B", "C"]);

    setItems([
      { id: "a", label: "A" },
      { id: "x", label: "X" },
      { id: "b", label: "B" },
      { id: "c", label: "C" },
    ]);
    flushSync();
    expect(labels(root)).toEqual(["A", "X", "B", "C"]);

    setItems([
      { id: "a", label: "A2" },
      { id: "x", label: "X" },
      { id: "b", label: "B" },
      { id: "c", label: "C" },
    ]);
    flushSync();
    expect(labels(root)).toEqual(["A2", "X", "B", "C"]);
  });

  it("Index обновляет строки после гидрации", async () => {
    const [items, setItems] = createSignal<readonly Row[]>([
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ]);
    const root = await hydrateIndex(items);
    expect(labels(root)).toEqual(["A", "B"]);

    setItems([
      { id: "b", label: "B" },
      { id: "a", label: "A" },
    ]);
    flushSync();
    expect(labels(root)).toEqual(["B", "A"]);
  });

  it("очистка с fallback сохраняет fallback и последующую вставку", async () => {
    const [items, setItems] = createSignal<readonly Row[]>([
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ]);
    const app = (() =>
      component(For as never, {
        get each() {
          return items();
        },
        fallback: (): Node => {
          const node = document.createElement("p");
          node.className = "empty";
          node.textContent = "empty";
          return node;
        },
        get children() {
          return (row: Row) => rowNode(row);
        },
      } as never)) as unknown as AnyComponent;
    const markup = await serverMarkup(app);
    const root = document.createElement("div");
    root.innerHTML = markup;
    document.body.appendChild(root);
    roots.push(root);
    await hydrate(root, app);

    setItems([]);
    flushSync();
    expect(root.querySelector(".empty")).not.toBeNull();
    expect(root.innerHTML).toContain("silent-end");

    setItems([{ id: "c", label: "C" }]);
    flushSync();
    expect(labels(root)).toEqual(["C"]);
    expect(root.querySelector(".empty")).toBeNull();
  });
});
