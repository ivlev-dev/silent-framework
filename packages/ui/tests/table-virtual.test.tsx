import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createComponent,
  createRoot,
  flushSync,
  hydrate,
  type AnyComponent,
} from "@ivlev-dev/silent-core";
import { renderToString } from "@ivlev-dev/silent-server";
import {
  Table,
  type TableColumn,
  type TableSortDirection,
} from "../src/components/table/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const tableCss = readFileSync(
  join(here, "..", "src", "components", "table", "table.css"),
  "utf8",
);

interface Row {
  readonly id: number;
  readonly name: string;
  readonly score: number;
}

const columns: readonly TableColumn<Row>[] = [
  { key: "name", header: "Имя", sortable: true },
  { key: "score", header: "Баллы", align: "end", width: 100 },
];

function makeRows(count: number): readonly Row[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    name: `Строка ${index}`,
    score: index * 3,
  }));
}

const ROWS_1000 = makeRows(1000);
const rowKey = (row: Row): number => row.id;

interface Handle {
  readonly node: Node;
  update(props: Record<string, unknown>): void;
  dispose(): void;
}

const handles: Handle[] = [];

function flush(): void {
  flushSync();
  flushSync();
}

function defineSize(element: Element, height: number, width: number): void {
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    value: height,
  });
  Object.defineProperty(element, "clientWidth", {
    configurable: true,
    value: width,
  });
}

function mount(
  props: Record<string, unknown>,
  viewportHeight = 480,
): { root: HTMLElement; handle: Handle } {
  let result: ReturnType<typeof createComponent> | null = null;
  const disposeRoot = createRoot((dispose) => {
    result = createComponent(Table as unknown as AnyComponent, props);
    return dispose;
  });
  const created = result as unknown as ReturnType<typeof createComponent>;
  const root = created.node as HTMLElement;
  defineSize(root, viewportHeight, 900);
  document.body.appendChild(root);
  flush();
  const handle: Handle = {
    get node() {
      return created.node;
    },
    update: (next) => {
      created.update(next);
    },
    dispose: () => {
      created.dispose();
      disposeRoot();
    },
  };
  handles.push(handle);
  return { root, handle };
}

function click(element: Element): void {
  element.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true }),
  );
  flush();
}

function scrollTo(root: HTMLElement, offset: number): void {
  root.scrollTop = offset;
  root.dispatchEvent(new Event("scroll"));
  flush();
}

function rowIndices(root: Element): number[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>("tbody tr[data-index]"),
  ).map((node) => Number(node.getAttribute("data-index")));
}

function spacerHeight(root: Element, edge: "top" | "bottom"): number {
  const row = root.querySelector<HTMLElement>(
    `tr.sui-table__spacer-row[data-edge="${edge}"]`,
  );
  const cell = row?.querySelector<HTMLElement>("td");
  return Number.parseFloat(cell?.style.height ?? "0");
}

function spacerHeights(root: Element): readonly [number, number] {
  return [spacerHeight(root, "top"), spacerHeight(root, "bottom")];
}

function virtualProps(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    columns,
    rows: ROWS_1000,
    rowKey,
    caption: "Люди",
    ...overrides,
  };
}

beforeEach(() => {
  // Синхронное обновление окна: без rAF scroll-обработчик применяется сразу.
  vi.stubGlobal("requestAnimationFrame", undefined);
  vi.stubGlobal("cancelAnimationFrame", undefined);
});

afterEach(() => {
  for (const handle of handles.splice(0)) handle.dispose();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("Table: виртуализация", () => {
  it("1000 строк: окно в DOM, spacer-высоты и ARIA-разметка", () => {
    const { root } = mount(virtualProps());
    const table = root.querySelector("table.sui-table");
    expect(table).not.toBeNull();

    // aria-rowcount включает строку заголовка.
    expect(table?.getAttribute("aria-rowcount")).toBe("1001");
    expect(root.querySelector("thead tr")?.getAttribute("aria-rowindex")).toBe(
      "1",
    );

    const indices = rowIndices(root);
    expect(indices.length).toBeGreaterThan(0);
    // Окно, а не все 1000 строк.
    expect(indices.length).toBeLessThan(60);
    expect(indices[0]).toBe(0);

    const rows = Array.from(
      root.querySelectorAll<HTMLElement>("tbody tr[data-index]"),
    );
    for (const row of rows) {
      const index = Number(row.getAttribute("data-index"));
      expect(row.getAttribute("aria-rowindex")).toBe(String(index + 2));
      expect(row.classList.contains("sui-table__row")).toBe(true);
      expect(row.style.position).toBe("");
    }

    const spacers = Array.from(
      root.querySelectorAll<HTMLElement>("tr.sui-table__spacer-row"),
    );
    // Сверху spacer нулевой и не рендерится; снизу — весь остаток таблицы.
    expect(spacers.length).toBeGreaterThan(0);
    expect(root.querySelector('tr.sui-table__spacer-row[data-edge="top"]')).toBeNull();
    for (const spacer of spacers) {
      expect(spacer.getAttribute("aria-hidden")).toBe("true");
      expect(spacer.querySelector("td")?.getAttribute("colspan")).toBe("2");
    }

    const [top, bottom] = spacerHeights(root);
    const lastIndex = indices[indices.length - 1] ?? 0;
    expect(top).toBe(0);
    // Снизу — весь остаток таблицы по оценке 49px на строку.
    expect(bottom).toBeCloseTo(1000 * 49 - (lastIndex + 1) * 49, 5);

    expect(root.hasAttribute("data-virtual")).toBe(true);
    expect(
      root.style.getPropertyValue("--sui-table-virtual-max-height"),
    ).toBe("480px");
  });

  it("прокрутка сдвигает окно и пересчитывает spacer-высоты", () => {
    const { root } = mount(virtualProps());
    expect(rowIndices(root)[0]).toBe(0);

    scrollTo(root, 49 * 500);

    const indices = rowIndices(root);
    expect(indices[0]).toBeGreaterThanOrEqual(490);
    expect(indices[0]).toBeLessThanOrEqual(500);
    expect(indices[indices.length - 1]).toBeGreaterThan(500);

    // В середине списка нужны оба spacer'а.
    expect(root.querySelectorAll("tr.sui-table__spacer-row")).toHaveLength(2);
    const [top, bottom] = spacerHeights(root);
    expect(top).toBeCloseTo((indices[0] ?? 0) * 49, 5);
    expect(bottom).toBeCloseTo(
      1000 * 49 - ((indices[indices.length - 1] ?? 0) + 1) * 49,
      5,
    );
    // Строка ровно в своей координате: aria-rowindex не зависит от окна.
    const firstRow = root.querySelector<HTMLElement>("tbody tr[data-index]");
    expect(firstRow?.getAttribute("aria-rowindex")).toBe(
      String((indices[0] ?? 0) + 2),
    );
  });

  it("virtual={false} рендерит все строки, малая таблица — окно", () => {
    const full = mount(virtualProps({ virtual: false }));
    expect(full.root.querySelectorAll("tbody tr")).toHaveLength(1000);
    expect(full.root.hasAttribute("data-virtual")).toBe(false);
    expect(full.root.querySelectorAll(".sui-table__spacer-row")).toHaveLength(0);
    expect(full.root.querySelector("table")?.hasAttribute("aria-rowcount")).toBe(
      false,
    );
    expect(
      full.root.querySelector("thead tr")?.hasAttribute("aria-rowindex"),
    ).toBe(false);

    // Три строки: окно включено по умолчанию, spacer-строки нулевые и не
    // добавляются, поэтому в DOM ровно три `<tr>`.
    const small = mount(virtualProps({ rows: ROWS_1000.slice(0, 3) }));
    expect(small.root.hasAttribute("data-virtual")).toBe(true);
    expect(small.root.querySelectorAll("tbody tr")).toHaveLength(3);
    expect(rowIndices(small.root)).toEqual([0, 1, 2]);
    expect(small.root.querySelectorAll(".sui-table__spacer-row")).toHaveLength(0);
    expect(spacerHeights(small.root)).toEqual([0, 0]);
    expect(small.root.querySelector("table")?.getAttribute("aria-rowcount")).toBe(
      "4",
    );

    const smallRows = Array.from(
      small.root.querySelectorAll<HTMLElement>("tbody tr[data-index]"),
    );
    expect(smallRows.map((row) => row.getAttribute("aria-rowindex"))).toEqual([
      "2",
      "3",
      "4",
    ]);
  });

  it("пустая таблица показывает empty state без spacer-строк", () => {
    const { root } = mount(virtualProps({ rows: [] }));

    expect(root.hasAttribute("data-virtual")).toBe(false);
    expect(root.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(root.querySelector(".sui-empty-state")?.textContent).toContain(
      "Нет данных",
    );
    expect(
      root.querySelector(".sui-table__empty-cell")?.getAttribute("colspan"),
    ).toBe("2");
    expect(root.querySelectorAll(".sui-table__spacer-row")).toHaveLength(0);
    expect(root.querySelector("table")?.hasAttribute("aria-rowcount")).toBe(
      false,
    );
  });

  it("rowHeight и dense задают оценку высоты", () => {
    const custom = mount(virtualProps({ rowHeight: 40 }));
    const customIndices = rowIndices(custom.root);
    const customLast = customIndices[customIndices.length - 1] ?? 0;
    expect(spacerHeights(custom.root)[1]).toBeCloseTo(
      1000 * 40 - (customLast + 1) * 40,
      5,
    );

    const dense = mount(virtualProps({ dense: true }));
    const denseIndices = rowIndices(dense.root);
    const denseLast = denseIndices[denseIndices.length - 1] ?? 0;
    expect(spacerHeights(dense.root)[1]).toBeCloseTo(
      1000 * 41 - (denseLast + 1) * 41,
      5,
    );
  });

  it("измеряет высоту строк через getBoundingClientRect и уточняет окно", async () => {
    const rect = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockReturnValue({ height: 70, width: 900 } as DOMRect);
    try {
      const { root } = mount(virtualProps());
      await Promise.resolve();
      flush();

      const indices = rowIndices(root);
      // Оценка 49px давала 18 строк окна; реальные 70px — меньше.
      expect(indices.length).toBeGreaterThan(0);
      expect(indices.length).toBeLessThan(18);
      expect(indices[0]).toBe(0);

      const [top, bottom] = spacerHeights(root);
      expect(top).toBe(0);
      expect(bottom).toBeGreaterThan(0);
    } finally {
      rect.mockRestore();
    }
  });

  it("sticky header остаётся внутри скролл-контейнера, горизонтальный скролл сохранён", () => {
    const { root } = mount(
      virtualProps({ stickyHeader: true, maxHeight: 640 }),
    );
    const table = root.querySelector<HTMLElement>("table.sui-table");
    const head = table?.querySelector("thead");

    // Обёртка — единственный скролл-контейнер, таблица и thead внутри неё.
    expect(root.classList.contains("sui-table-scroll")).toBe(true);
    expect(root.firstElementChild).toBe(table);
    expect(head?.parentElement).toBe(table);
    expect(table?.hasAttribute("data-sticky-header")).toBe(true);
    expect(
      root.style.getPropertyValue("--sui-table-virtual-max-height"),
    ).toBe("640px");

    // Контракт CSS: вертикальный скролл виртуализации и прежний
    // горизонтальный скролл на узких экранах.
    expect(tableCss).toMatch(
      /\.sui-table-scroll\[data-virtual\]\s*\{[^}]*max-block-size:\s*var\(--sui-table-virtual-max-height\)/su,
    );
    expect(tableCss).toMatch(
      /\.sui-table-scroll\[data-virtual\]\s*\{[^}]*overflow-y:\s*auto/su,
    );
    expect(tableCss).toMatch(
      /@media \(max-width: 52\.5em\)\s*\{[\s\S]*?overflow-x:\s*auto/su,
    );
    expect(tableCss).toMatch(
      /\.sui-table\[data-sticky-header\][^{]*\{[^}]*position:\s*sticky/su,
    );
    expect(tableCss).toMatch(
      /\.sui-table__spacer-cell\s*\{[^}]*padding:\s*0/su,
    );
  });

  it("клик по заголовку и обновление строк сохраняют сортировку и rowKey", () => {
    const calls: Array<[string, TableSortDirection]> = [];
    const { root, handle } = mount(
      virtualProps({
        sortKey: "name",
        sortDirection: "ascending",
        onSort: (key: string, direction: TableSortDirection) =>
          calls.push([key, direction]),
      }),
    );

    expect(
      root.querySelector("th[aria-sort='ascending']")?.textContent,
    ).toContain("Имя");
    click(root.querySelector(".sui-table__sort") as Element);
    expect(calls).toEqual([["name", "descending"]]);

    const reversed = [...ROWS_1000].reverse();
    handle.update({
      ...virtualProps({
        sortKey: "name",
        sortDirection: "descending",
        onSort: (key: string, direction: TableSortDirection) =>
          calls.push([key, direction]),
      }),
      rows: reversed,
    });
    flush();

    expect(
      root.querySelector("th[aria-sort='descending']")?.textContent,
    ).toContain("Имя");
    const indices = rowIndices(root);
    expect(indices.length).toBeLessThan(100);
    expect(new Set(indices).size).toBe(indices.length);

    // Первая строка окна — последний элемент исходного порядка (id=1000).
    const firstRow = root.querySelector<HTMLElement>('tbody tr[data-index="0"]');
    expect(firstRow?.textContent).toContain("Строка 999");
    expect(firstRow?.getAttribute("aria-rowindex")).toBe("2");
    expect(root.querySelector("table")?.getAttribute("aria-rowcount")).toBe(
      "1001",
    );
  });
});

function VirtualTableDemo(): Node {
  return (
    <Table
      columns={columns}
      rows={ROWS_1000}
      rowKey={rowKey}
      caption="Люди"
      initialViewportSize={480}
    />
  );
}

describe("Table: SSR и гидрация виртуализации", () => {
  it("SSR детерминирован, содержит окно и ARIA-атрибуты", async () => {
    const first = await renderToString(VirtualTableDemo);
    const second = await renderToString(VirtualTableDemo);

    expect(second.html).toBe(first.html);
    expect(first.html).toContain("<table");
    expect(first.html).toContain('aria-rowcount="1001"');
    expect(first.html).toContain('aria-rowindex="1"');
    expect(first.html).toContain('aria-rowindex="2"');
    expect(first.html).toContain("sui-table__spacer-row");
    expect(first.html).toContain('data-index="0"');
    expect(first.html).not.toContain("jsx(");
    // Окно, а не 1000 строк.
    expect(first.html.match(/data-index=/gu)?.length ?? 0).toBeLessThan(100);
  });

  it("гидрация без mismatch сохраняет окно и rowKey", async () => {
    const { html } = await renderToString(VirtualTableDemo);
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);

    const scroll = container.querySelector<HTMLElement>(".sui-table-scroll");
    expect(scroll).not.toBeNull();
    if (scroll !== null) defineSize(scroll, 480, 900);

    const mismatches: string[] = [];
    const hydration = await hydrate(container, VirtualTableDemo, {
      onMismatch: (error) => mismatches.push(error.message),
    });
    flush();
    handles.push({
      get node() {
        return container;
      },
      update: () => undefined,
      dispose: () => hydration.dispose(),
    });

    expect(mismatches).toEqual([]);
    expect(
      container.querySelector("table")?.getAttribute("aria-rowcount"),
    ).toBe("1001");
    const indices = rowIndices(container);
    expect(indices.length).toBeGreaterThan(0);
    expect(indices.length).toBeLessThan(100);
    expect(indices[0]).toBe(0);
    expect(container.textContent).toContain("Строка 0");
  });
});
