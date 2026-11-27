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

function savedSettings(tableKey: string): Record<string, unknown> {
  const raw = window.localStorage.getItem(dataTableStorageKey(tableKey));
  return raw === null ? {} : (JSON.parse(raw) as Record<string, unknown>);
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
      { key: "name", header: "Имя", truncate: true },
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
    const contents = Array.from(
      root.querySelectorAll<HTMLElement>("tbody .sui-data-table__cell-content"),
    );
    expect(contents[0]?.getAttribute("title")).toBe(contents[0]?.textContent);
    expect(contents[1]?.hasAttribute("title")).toBe(false);
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
  function stubHeaders(root: Element): HTMLElement[] {
    const ths = Array.from(root.querySelectorAll<HTMLElement>("th[data-column-key]"));
    const positions = [
      { left: 0, top: 0, width: 120, height: 40 },
      { left: 120, top: 0, width: 140, height: 40 },
      { left: 260, top: 0, width: 90, height: 40 },
    ];
    ths.forEach((th, index) => {
      const position = positions[index];
      if (position !== undefined) stubRect(th, position);
    });
    return ths;
  }

  it("drag за заголовок меняет порядок и сохраняет его в localStorage", () => {
    const handle = mount(baseProps());
    const root = handle.node as Element;
    const ths = stubHeaders(root);

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

  it("клик по сортировке не запускает drag", () => {
    const handle = mount(baseProps());
    const root = handle.node as Element;
    stubHeaders(root);
    const sort = root.querySelector<HTMLElement>(
      "th[data-column-key='name'] button.sui-data-table__sort",
    );
    expect(sort).not.toBeNull();
    if (sort === null) return;
    pointer(sort, "pointerdown", 8, 20);
    pointer(document, "pointermove", 160, 20);
    pointer(document, "pointerup", 160, 20);
    flush();
    expect(headerKeys(root)).toEqual(["name", "role", "score"]);
  });
});

describe("DataTable: перестановка колонок с клавиатуры", () => {
  it("Space, стрелка и Space меняют порядок и сохраняют его", () => {
    const handle = mount(baseProps());
    const root = handle.node as Element;
    const th = root.querySelector<HTMLElement>("th[data-column-key='name']");
    if (th === null) throw new Error("не найден заголовок");
    th.focus();
    key(th, " ");
    flush();
    key(th, "ArrowRight");
    flush();
    key(th, " ");
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
      root.querySelector("th[data-column-key='name']")?.getAttribute("aria-label"),
    ).toContain("Перетащить колонку");
  });
});

describe("DataTable: выбор по клику на строку", () => {
  it("selectOnRowClick переключает строку и сохраняет onRowClick", () => {
    let selected = new Set<string | number>();
    const onRowClick = vi.fn();
    let handle: Handle | null = null;
    const onChange = (next: ReadonlySet<string | number>): void => {
      selected = new Set(next);
      handle?.update(baseProps({
        onRowClick,
        selection: { selected, onChange, selectOnRowClick: true },
      }));
    };
    handle = mount(baseProps({
      onRowClick,
      selection: { selected, onChange, selectOnRowClick: true },
    }));
    const row = (handle.node as Element).querySelector<HTMLElement>("tbody tr.sui-data-table__tr");
    row?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    flush();
    expect([...selected]).toEqual([1]);
    expect(onRowClick).toHaveBeenCalledWith(ROWS[0]);
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

interface TreeRow extends Row {
  readonly parentId: number | null;
}

const TREE_ROWS: readonly TreeRow[] = [
  { id: 2, name: "Ада", role: "Инженер", score: 98, parentId: 1 },
  { id: 3, name: "Грейс", role: "Инженер", score: 95, parentId: 1 },
  { id: 1, name: "Инженеры", role: "Группа", score: 0, parentId: null },
  { id: 4, name: "Алан", role: "Группа", score: 0, parentId: null },
];

const TREE_ROOTS: readonly TreeRow[] = TREE_ROWS.filter((row) => row.parentId === null);
const TREE_CHILDREN = (row: TreeRow): readonly TreeRow[] =>
  TREE_ROWS.filter((entry) => entry.parentId === row.id);

function treeProps(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tableKey: "tree",
    columns: COLUMNS as readonly DataTableColumn<TreeRow>[],
    rows: TREE_ROOTS,
    rowKey: (row: TreeRow) => row.id,
    total: TREE_ROWS.length,
    page: 1,
    pageSize: 10,
    tree: {
      getChildren: TREE_CHILDREN,
      defaultExpandedKeys: [1],
    },
    ...overrides,
  };
}

describe("DataTable: ресайз без скачка", () => {
  it("фиксирует измеренные ширины, показывает px и сохраняет после commit", () => {
    const handle = mount(baseProps());
    const root = handle.node as Element;
    const ths = Array.from(root.querySelectorAll<HTMLElement>("th[data-column-key]"));
    const sizes = [120, 140, 90];
    ths.forEach((th, index) => {
      stubRect(th, { left: index * 120, top: 0, width: sizes[index] ?? 100, height: 40 });
    });
    const resizer = root.querySelector<HTMLElement>(
      "button.sui-data-table__resizer[data-column-key='name']",
    );
    if (resizer === null) throw new Error("нет ресайзера");
    stubRect(resizer, { left: 120, top: 0, width: 12, height: 40 });

    pointer(resizer, "pointerdown", 120, 20);
    flush();
    const cols = (): readonly string[] =>
      Array.from(root.querySelectorAll<HTMLTableColElement>("col[data-column-key]"))
        .map((col) => col.style.width);
    expect(cols()).toEqual(["120px", "140px", "90px"]);
    expect(storedSettings("people").widths?.["name"]).toBeUndefined();

    pointer(window, "pointermove", 150, 20);
    flush();
    expect(root.querySelector<HTMLTableColElement>("col[data-column-key='name']")?.style.width).toBe("150px");
    expect(root.querySelector(".sui-data-table__resize-chip")?.textContent).toContain("150 px");
    expect(storedSettings("people").widths?.["name"]).toBeUndefined();

    pointer(window, "pointerup", 150, 20);
    flush();
    expect(storedSettings("people").widths).toEqual({ name: 150, role: 140, score: 90 });
    expect(root.querySelector(".sui-data-table__resize-chip")).toBeNull();
  });
});

describe("DataTable: настройки и раскладка", () => {
  it("диалог настроек скрывает колонку, меняет плотность и закрепление", () => {
    const handle = mount(baseProps());
    const root = handle.node as Element;
    root
      .querySelector<HTMLElement>("button[aria-label='Настройки таблицы']")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    flush();
    const dialog = root.querySelector<HTMLElement>("dialog.sui-dialog");
    expect(dialog?.hasAttribute("open")).toBe(true);

    const roleToggle = dialog?.querySelector<HTMLInputElement>(
      "input[type='checkbox']:not([disabled])",
    );
    if (roleToggle !== null && roleToggle !== undefined) {
      roleToggle.checked = false;
      roleToggle.dispatchEvent(new Event("change", { bubbles: true }));
      flush();
    }

    expect(headerKeys(root).length).toBeLessThan(3);
    expect(savedSettings("people").visible).toBeTypeOf("object");

    const densitySelect = dialog?.querySelector<HTMLSelectElement>(
      "select.sui-data-table__select",
    );
    if (densitySelect !== null && densitySelect !== undefined) {
      densitySelect.value = "compact";
      densitySelect.dispatchEvent(new Event("change", { bubbles: true }));
      flush();
    }
    expect(root.getAttribute("data-density")).toBe("compact");
  });

  it("переключатель layout в тулбаре превращает таблицу в карточки и сохраняет выбор", () => {
    const handle = mount(baseProps({ renderCard: (row: Row) => <strong>{row.name}</strong> }));
    const root = handle.node as Element;
    expect(
      root.querySelector("[data-layout-target='table']")?.getAttribute("aria-pressed"),
    ).toBe("true");
    root
      .querySelector<HTMLElement>("[data-layout-target='cards']")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    flush();
    expect(root.getAttribute("data-layout")).toBe("cards");
    expect(
      root.querySelector("[data-layout-target='cards']")?.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(root.querySelectorAll(".sui-data-table__card")).toHaveLength(3);
    expect(root.querySelector(".sui-data-table__card strong")?.textContent).toBe("Ада");
    expect(savedSettings("people").layout).toBe("cards");
  });

  it("на узком экране карточки по умолчанию даже при сохранённой таблице", () => {
    window.localStorage.setItem(
      dataTableStorageKey("people"),
      JSON.stringify({ layout: "table" }),
    );
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => true,
    }));
    const handle = mount(baseProps());
    expect((handle.node as Element).getAttribute("data-layout")).toBe("cards");
  });

  it("карточки без card-слотов показывают вторую колонку и метаданные", () => {
    const handle = mount(baseProps({ layout: "cards" }));
    const root = handle.node as Element;
    const card = root.querySelector(".sui-data-table__card");
    expect(card?.querySelector(".sui-data-table__card-primary")?.textContent).toBe("Ада");
    expect(card?.querySelector(".sui-data-table__card-secondary")?.textContent).toBe("Инженер");
    const meta = card?.querySelectorAll(".sui-data-table__card-meta-row") ?? [];
    expect(meta).toHaveLength(1);
    expect(meta[0]?.querySelector("dt")?.textContent).toBe("Баллы");
    expect(meta[0]?.querySelector("dd")?.textContent).toBe("98");
  });

  it("карточки выносят колонку actions в подвал", () => {
    const columns: readonly DataTableColumn<Row>[] = [
      ...COLUMNS,
      {
        key: "actions",
        header: "",
        resizable: false,
        locked: true,
        card: { slot: "actions" },
        render: (row: Row) => <button type="button">{`Удалить ${row.name}`}</button>,
      },
    ];
    const handle = mount(baseProps({ columns, layout: "cards" }));
    const root = handle.node as Element;
    const actions = root.querySelector(".sui-data-table__card-actions");
    expect(actions?.querySelector("button")?.textContent).toBe("Удалить Ада");
  });

  it("locked-колонка не получает ручку перетаскивания", () => {
    const columns: readonly DataTableColumn<Row>[] = COLUMNS.map((column) =>
      column.key === "score" ? { ...column, locked: true } : column,
    );
    const handle = mount(baseProps({ columns }));
    const root = handle.node as Element;
    const locked = root.querySelector<HTMLElement>("th[data-column-key='score']");
    expect(locked?.hasAttribute("data-reorderable")).toBe(false);
    expect(locked?.querySelector(".sui-data-table__drag-grip")).toBeNull();
    expect(
      root.querySelector("th[data-column-key='name'] .sui-data-table__drag-grip"),
    ).not.toBeNull();
  });

  it("sticky footer помечает подвал и контейнер", () => {
    const handle = mount(baseProps({ stickyFooter: true, scrollMode: "contained" }));
    const root = handle.node as Element;
    expect(root.getAttribute("data-sticky-footer")).not.toBeNull();
    expect(root.querySelector(".sui-data-table__footer")?.hasAttribute("data-sticky")).toBe(true);
    expect(root.getAttribute("data-scroll")).toBe("contained");
  });
});

describe("DataTable: дерево, выбор и массовые действия", () => {
  it("дерево раскрывает детей и рисует indent", () => {
    const handle = mount(treeProps());
    const root = handle.node as Element;
    expect(root.querySelectorAll("tbody tr.sui-data-table__tr")).toHaveLength(4);
    const toggle = root.querySelector<HTMLElement>(
      "tbody tr[data-key='1'] button.sui-data-table__tree-toggle",
    );
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    toggle?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    flush();
    expect(root.querySelectorAll("tbody tr.sui-data-table__tr")).toHaveLength(2);
  });

  it("каскадный выбор добавляет потомков", () => {
    const selected = new Set<string | number>();
    let handle: Handle | null = null;
    const onChange = (next: ReadonlySet<string | number>): void => {
      selected.clear();
      for (const key of next) selected.add(key);
      handle?.update(treeProps({ selection: { selected, onChange }, tree: {
        getChildren: TREE_CHILDREN,
        defaultExpandedKeys: [1],
        cascadeSelection: true,
      } }));
    };
    handle = mount(treeProps({ selection: { selected, onChange }, tree: {
      getChildren: TREE_CHILDREN,
      defaultExpandedKeys: [1],
      cascadeSelection: true,
    } }));
    const root = handle.node as Element;
    const first = root.querySelector<HTMLInputElement>("input[aria-label='Выбрать строку 1']");
    if (first !== null) {
      first.checked = true;
      first.dispatchEvent(new Event("change", { bubbles: true }));
      flush();
    }
    expect([...selected].sort()).toEqual([1, 2, 3]);
  });

  it("массовые действия показывают счётчик и очищают выбор", () => {
    let selected = new Set<string | number>([1]);
    let handle: Handle | null = null;
    const onChange = (next: ReadonlySet<string | number>): void => {
      selected = new Set(next);
      handle?.update(baseProps({ selection: { selected, onChange, actions: <button type="button">Удалить</button> } }));
    };
    handle = mount(baseProps({ selection: { selected, onChange, actions: <button type="button">Удалить</button> } }));
    const root = handle.node as Element;
    expect(root.querySelector(".sui-data-table__selection-count")?.textContent).toContain("1");
    expect(root.querySelector(".sui-data-table__selection-actions button")?.textContent).toBe("Удалить");
    root
      .querySelector<HTMLElement>("[data-action='clear-selection']")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    flush();
    expect(selected.size).toBe(0);
  });
});
