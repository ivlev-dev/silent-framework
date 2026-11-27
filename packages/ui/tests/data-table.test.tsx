import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createComponent,
  createRoot,
  flushSync,
  type AnyComponent,
} from "@ivlev-dev/silent-core";
import { renderToString } from "@ivlev-dev/silent-server";
import {
  DataTable,
  dataTableStorageKey,
  mergeColumnOrder,
  type DataTableColumn,
  type DataTableSelection,
  type DataTableSortDirection,
} from "../src/components/data-table/index.js";

interface Row {
  readonly id: number;
  readonly name: string;
  readonly role: string;
  readonly score: number;
}

const ROWS: readonly Row[] = [
  { id: 1, name: "Ада", role: "Инженер", score: 98 },
  { id: 2, name: "Грейс", role: "Архитектор", score: 95 },
  { id: 3, name: "Алан", role: "Исследователь", score: 91 },
];

const COLUMNS: readonly DataTableColumn<Row>[] = [
  { key: "name", header: "Имя", width: 120, minWidth: 80, maxWidth: 240, sortable: true },
  { key: "role", header: "Роль", width: 140 },
  { key: "score", header: "Баллы", width: 90, align: "end", sortable: true },
];

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

function mount(props: Record<string, unknown>): Handle {
  let result: ReturnType<typeof createComponent> | null = null;
  const disposeRoot = createRoot((dispose) => {
    result = createComponent(DataTable as unknown as AnyComponent, props);
    return dispose;
  });
  const created = result as unknown as ReturnType<typeof createComponent>;
  document.body.appendChild(created.node);
  flush();
  const handle: Handle = {
    get node() {
      return created.node;
    },
    update: (next) => {
      created.update(next);
      flush();
    },
    dispose: () => {
      created.dispose();
      disposeRoot();
    },
  };
  handles.push(handle);
  return handle;
}

function baseProps(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tableKey: "people",
    columns: COLUMNS,
    rows: ROWS,
    rowKey: (row: Row) => row.id,
    total: ROWS.length,
    page: 1,
    pageSize: 10,
    ...overrides,
  };
}

function headerKeys(root: Element): readonly string[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>("th.sui-data-table__th[data-column-key]"),
  ).map((node) => node.getAttribute("data-column-key") ?? "");
}

function stubRect(
  element: Element,
  rect: { readonly left: number; readonly top: number; readonly width: number; readonly height: number },
): void {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      ...rect,
      x: rect.left,
      y: rect.top,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      toJSON() {
        return rect;
      },
    }),
  });
}

function pointer(target: EventTarget, type: string, x: number, y: number): void {
  target.dispatchEvent(
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      button: 0,
    }),
  );
}

function key(target: EventTarget, value: string): void {
  target.dispatchEvent(
    new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true }),
  );
}

function storedSettings(tableKey: string): {
  readonly order?: readonly string[];
  readonly widths?: Readonly<Record<string, number>>;
} {
  const raw = window.localStorage.getItem(dataTableStorageKey(tableKey));
  return raw === null ? {} : (JSON.parse(raw) as { order: readonly string[]; widths: Record<string, number> });
}

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal("requestAnimationFrame", undefined);
  vi.stubGlobal("cancelAnimationFrame", undefined);
});

afterEach(() => {
  for (const handle of handles.splice(0)) handle.dispose();
  document.body.replaceChildren();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("DataTable: серверные состояния", () => {
  it("loading показывает skeleton-строки и aria-busy", () => {
    const handle = mount(baseProps({ rows: [], loading: true, total: 95 }));
    const root = handle.node as Element;
    expect(root.querySelector("table.sui-data-table__table")?.getAttribute("aria-busy")).toBe(
      "true",
    );
    expect(root.querySelectorAll("tr[data-skeleton]")).toHaveLength(10);
    expect(root.querySelector(".sui-data-table__empty")).toBeNull();
  });

  it("error показывает сообщение и не показывает пустое состояние", () => {
    const handle = mount(baseProps({ rows: [], error: "Не удалось загрузить" }));
    const root = handle.node as Element;
    expect(root.querySelector("[role='alert']")?.textContent).toContain(
      "Не удалось загрузить",
    );
    expect(root.querySelector(".sui-data-table__empty")).toBeNull();
  });

  it("empty показывает встроенное или пользовательское состояние", () => {
    const handle = mount(baseProps({ rows: [], total: 0 }));
    expect((handle.node as Element).textContent).toContain("Нет данных");

    handle.update(baseProps({ rows: [], total: 0, empty: <span>Свой пустой экран</span> }));
    expect((handle.node as Element).textContent).toContain("Свой пустой экран");
  });

  it("рендерит строки через render и ключ строки", () => {
    const columns: readonly DataTableColumn<Row>[] = [
      { key: "name", header: "Имя" },
      {
        key: "score",
        header: "Баллы",
        truncate: true,
        render: (row) => <strong>{row.score * 2}</strong>,
      },
    ];
    const handle = mount(baseProps({ columns }));
    const root = handle.node as Element;
    expect(root.querySelectorAll("tbody tr.sui-data-table__tr")).toHaveLength(3);
    expect(root.querySelector("tbody strong")?.textContent).toBe("196");
  });
});

describe("DataTable: пагинация и сортировка", () => {
  it("вызывает onPageChange и onPageSizeChange", () => {
    const onPageChange = vi.fn();
    const onPageSizeChange = vi.fn();
    const handle = mount(
      baseProps({
        total: 95,
        page: 2,
        pageSize: 10,
        onPageChange,
        onPageSizeChange,
      }),
    );
    const root = handle.node as Element;
    const next = root.querySelector<HTMLElement>("button[data-direction='next']");
    expect(next).not.toBeNull();
    next?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    flush();
    expect(onPageChange).toHaveBeenCalledWith(3);

    const select = root.querySelector<HTMLSelectElement>("select.sui-data-table__select");
    expect(select).not.toBeNull();
    if (select !== null) {
      select.value = "20";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      flush();
    }
    expect(onPageSizeChange).toHaveBeenCalledWith(20);
    expect(root.textContent).toContain("11–20 из 95");
  });

  it("клик по заголовку запрашивает сортировку и отражает aria-sort", () => {
    const onSort = vi.fn();
    const handle = mount(baseProps({ onSort }));
    const root = handle.node as Element;
    const sortButton = root.querySelector<HTMLElement>(
      "th[data-column-key='name'] button.sui-data-table__sort",
    );
    sortButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    flush();
    expect(onSort).toHaveBeenCalledWith("name", "ascending");

    handle.update(
      baseProps({
        onSort,
        sortKey: "name",
        sortDirection: "ascending" satisfies DataTableSortDirection,
      }),
    );
    const th = (handle.node as Element).querySelector("th[data-column-key='name']");
    expect(th?.getAttribute("aria-sort")).toBe("ascending");

    (handle.node as Element)
      .querySelector<HTMLElement>("th[data-column-key='name'] button.sui-data-table__sort")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    flush();
    expect(onSort).toHaveBeenLastCalledWith("name", "descending");
  });
});

describe("DataTable: выбор строк", () => {
  it("переключает строку и все строки, отмечает выбранные", () => {
    let selected = new Set<string | number>();
    let handle: Handle | null = null;
    const onChange = (next: ReadonlySet<string | number>): void => {
      selected = new Set(next);
      handle?.update(baseProps({ selection: { selected, onChange } }));
    };
    handle = mount(baseProps({ selection: { selected, onChange } }));
    const root = handle.node as Element;
    const first = root.querySelector<HTMLInputElement>("input[aria-label='Выбрать строку 1']");
    expect(first).not.toBeNull();
    if (first !== null) {
      first.checked = true;
      first.dispatchEvent(new Event("change", { bubbles: true }));
      flush();
    }
    expect([...selected]).toEqual([1]);
    expect(root.querySelectorAll("tr[data-selected]")).toHaveLength(1);

    const all = root.querySelector<HTMLInputElement>("input[aria-label='Выбрать все строки']");
    if (all !== null) {
      all.checked = true;
      all.dispatchEvent(new Event("change", { bubbles: true }));
      flush();
    }
    expect([...selected].sort()).toEqual([1, 2, 3]);
  });
});

describe("DataTable: ресайз колонок", () => {
  it("pointer-события меняют ширину, сохраняют её и сбрасывают двойным кликом", () => {
    const handle = mount(baseProps());
    const root = handle.node as Element;
    const th = root.querySelector<HTMLElement>("th[data-column-key='name']");
    const resizer = root.querySelector<HTMLElement>(
      "button.sui-data-table__resizer[data-column-key='name']",
    );
    expect(th).not.toBeNull();
    expect(resizer).not.toBeNull();
    if (th !== null) stubRect(th, { left: 0, top: 0, width: 120, height: 40 });

    if (resizer !== null) {
      pointer(resizer, "pointerdown", 100, 20);
      pointer(window, "pointermove", 160, 20);
      flush();
      pointer(window, "pointermove", 190, 20);
      flush();
      expect(storedSettings("people").widths?.["name"]).toBeUndefined();

      pointer(window, "pointerup", 190, 20);
      flush();
    }

    expect(storedSettings("people").widths?.["name"]).toBe(210);
    const col = root.querySelector<HTMLTableColElement>("col[data-column-key='name']");
    expect(col?.style.width).toBe("210px");

    resizer?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    flush();
    expect(storedSettings("people").widths?.["name"]).toBeUndefined();
    expect(
      root.querySelector<HTMLTableColElement>("col[data-column-key='name']")?.style.width,
    ).toBe("120px");
  });

  it("клавиатура меняет ширину стрелками, Home сбрасывает", () => {
    const handle = mount(baseProps());
    const root = handle.node as Element;
    const resizer = root.querySelector<HTMLElement>(
      "button.sui-data-table__resizer[data-column-key='name']",
    );
    resizer?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
    );
    flush();
    expect(storedSettings("people").widths?.["name"]).toBe(128);

    resizer?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true }),
    );
    flush();
    expect(storedSettings("people").widths?.["name"]).toBeUndefined();
  });
});

describe("DataTable: сохранение настроек", () => {
  it("сливает порядок и ширины с новыми колонками, игнорирует удалённые", () => {
    window.localStorage.setItem(
      dataTableStorageKey("people"),
      JSON.stringify({
        order: ["removed", "score"],
        widths: { removed: 50, score: 9999, name: 200 },
      }),
    );
    const handle = mount(
      baseProps({
        columns: [
          ...COLUMNS,
          { key: "extra", header: "Дополнительно" },
        ],
      }),
    );
    const root = handle.node as Element;
    expect(headerKeys(root)).toEqual(["score", "name", "role", "extra"]);
    expect(root.querySelector<HTMLTableColElement>("col[data-column-key='name']")?.style.width).toBe(
      "200px",
    );
    expect(root.querySelector<HTMLTableColElement>("col[data-column-key='score']")?.style.width).toBe(
      "960px",
    );
    expect(
      root.querySelector<HTMLTableColElement>("col[data-column-key='removed']"),
    ).toBeNull();
  });

  it("mergeColumnOrder сохраняет порядок и добавляет новые в конец", () => {
    expect(
      mergeColumnOrder(COLUMNS, ["score", "removed", "name", "score"]),
    ).toEqual(["score", "name", "role"]);
  });
});

describe("DataTable: перестановка колонок", () => {
  it("pointer drag меняет порядок и сохраняет его в localStorage", () => {
    const handle = mount(baseProps());
    const root = handle.node as Element;
    const ths = Array.from(
      root.querySelectorAll<HTMLElement>("th[data-column-key]"),
    );
    const positions = [
      { left: 0, top: 0, width: 120, height: 40 },
      { left: 120, top: 0, width: 140, height: 40 },
      { left: 260, top: 0, width: 90, height: 40 },
    ];
    ths.forEach((th, index) => {
      const position = positions[index];
      if (position !== undefined) stubRect(th, position);
    });

    const dragHandle = root.querySelector<HTMLElement>(
      "button.sui-data-table__drag-handle[data-dnd-id='name']",
    );
    expect(dragHandle).not.toBeNull();
    if (dragHandle === null) return;
    stubRect(dragHandle, { left: 0, top: 0, width: 24, height: 24 });

    pointer(ths[0] as HTMLElement, "pointerdown", 8, 20);
    flush();
    pointer(document, "pointermove", 140, 20);
    flush();
    pointer(document, "pointerup", 140, 20);
    flush();

    expect(headerKeys(root)).toEqual(["role", "name", "score"]);
    expect(storedSettings("people").order).toEqual(["role", "name", "score"]);
    expect(
      root.querySelector("tbody tr.sui-data-table__tr td.sui-data-table__td")?.textContent,
    ).toContain("Инженер");
  });
});

describe("DataTable: перестановка колонок с клавиатуры", () => {
  it("Space, стрелка и Space меняют порядок и сохраняют его", () => {
    const handle = mount(baseProps());
    const root = handle.node as Element;
    const ths = Array.from(
      root.querySelectorAll<HTMLElement>("th[data-column-key]"),
    );
    const positions = [
      { left: 0, top: 0, width: 120, height: 40 },
      { left: 120, top: 0, width: 140, height: 40 },
      { left: 260, top: 0, width: 90, height: 40 },
    ];
    ths.forEach((th, index) => {
      const position = positions[index];
      if (position !== undefined) stubRect(th, position);
    });
    const dragHandle = root.querySelector<HTMLElement>(
      "button.sui-data-table__drag-handle[data-dnd-id='name']",
    );
    if (dragHandle === null) throw new Error("не найдена ручка перестановки");
    stubRect(dragHandle, { left: 0, top: 0, width: 24, height: 24 });
    dragHandle.focus();
    key(dragHandle, " ");
    flush();
    key(document, "ArrowRight");
    flush();
    key(document, " ");
    flush();

    expect(headerKeys(root)).toEqual(["role", "name", "score"]);
    expect(storedSettings("people").order).toEqual(["role", "name", "score"]);
  });
});

describe("DataTable: сброс вида", () => {
  it("сбрасывает порядок, ширины и localStorage", () => {
    window.localStorage.setItem(
      dataTableStorageKey("people"),
      JSON.stringify({
        order: ["score", "name", "role"],
        widths: { name: 200 },
      }),
    );
    const handle = mount(baseProps());
    const root = handle.node as Element;
    expect(headerKeys(root)).toEqual(["score", "name", "role"]);

    root
      .querySelector<HTMLElement>("[data-testid='data-table-reset']")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    flush();

    expect(headerKeys(root)).toEqual(["name", "role", "score"]);
    expect(window.localStorage.getItem(dataTableStorageKey("people"))).toBeNull();
    expect(root.querySelector<HTMLTableColElement>("col[data-column-key='name']")?.style.width).toBe(
      "120px",
    );
  });
});

describe("DataTable: доступность и выбор", () => {
  it("role=grid, aria-rowcount и label у чекбоксов", () => {
    const selection: DataTableSelection = {
      selected: new Set<string | number>(),
      onChange: () => {},
    };
    const handle = mount(baseProps({ selection }));
    const root = handle.node as Element;
    const table = root.querySelector("table");
    expect(table?.getAttribute("role")).toBe("grid");
    expect(table?.getAttribute("aria-rowcount")).toBe("4");
    expect(
      root.querySelector("button.sui-data-table__resizer")?.getAttribute("aria-label"),
    ).toContain("Изменить ширину");
    expect(
      root.querySelector("button.sui-data-table__drag-handle")?.getAttribute("aria-label"),
    ).toContain("Переместить колонку");
  });
});

describe("DataTable: SSR", () => {
  it("рендерит разметку без доступа к localStorage", async () => {
    const Demo = (): Node => (
      <DataTable
        tableKey="ssr"
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(row) => row.id}
        total={ROWS.length}
        page={1}
        pageSize={10}
      />
    );
    const { html } = await renderToString(Demo);
    expect(html).toContain('role="grid"');
    expect(html).toContain("sui-data-table__table");
    expect(html).toContain("Ада");
    expect(html).not.toContain("jsx(");
  });
});
