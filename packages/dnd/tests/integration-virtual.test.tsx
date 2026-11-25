// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createComponent,
  createSignal,
  flushSync,
} from "@ivlev-dev/silent-core";
import { renderToString } from "@ivlev-dev/silent-server";
import type { VirtualListProps } from "@ivlev-dev/silent-virtual";
import {
  DndContext,
  KeyboardSensor,
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSensor,
  useSensors,
  useSortable,
  verticalListSortingStrategy,
  type DragEndEvent,
} from "../src/index.js";

/**
 * Виртуализатор берём из исходников соседнего пакета.
 *
 * Готовый `dist` в тестах повторно компилируется плагином `silent()`:
 * workspace-ссылка резолвится в реальный путь вне `node_modules`, поэтому
 * precompiled-модуль проходит через шаблонный трансформер второй раз и теряет
 * клиентские обновления. Статический импорт `../../virtual/src` не проходит
 * `typecheck` из-за `rootDir` пакета, поэтому исходник загружается через
 * `import.meta.glob` (Vite компилирует его как обычный исходный модуль).
 */
type VirtualListComponent = <T>(props: VirtualListProps<T>) => Node;

interface VirtualModule {
  readonly VirtualList: VirtualListComponent;
}

interface GlobMeta {
  glob(
    path: string,
    options: { readonly eager: true },
  ): Record<string, VirtualModule>;
}

const virtualModule = (import.meta as unknown as GlobMeta).glob(
  "../../virtual/src/index.ts",
  { eager: true },
)["../../virtual/src/index.ts"] as VirtualModule;

const { VirtualList } = virtualModule;

const TOTAL = 100;
const ROW_HEIGHT = 24;
const VIEWPORT_HEIGHT = 240;
const LIST_WIDTH = 300;
const OVERSCAN = 2;

/** 240 / 24 = 10 видимых строк + overscan 2 с каждой стороны. */
const EXPECTED_INDICES = Array.from({ length: 12 }, (_, index) => index);

interface Row {
  readonly id: string;
  readonly label: string;
}

function buildRows(total: number): Row[] {
  return Array.from({ length: total }, (_, index) => ({
    id: `row-${index}`,
    label: `Строка ${index}`,
  }));
}

interface Handle {
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

function stubRect(
  element: Element,
  rect: { left: number; top: number; width: number; height: number },
): void {
  const full = {
    ...rect,
    x: rect.left,
    y: rect.top,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    toJSON() {
      return full;
    },
  };
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => full,
  });
}

function key(target: EventTarget, value: string): void {
  target.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: value,
      bubbles: true,
      cancelable: true,
    }),
  );
}

function scroller(): HTMLElement {
  const element = document.querySelector<HTMLElement>(
    '[data-testid="virtual-list"]',
  );
  if (element === null) {
    throw new Error('не найден [data-testid="virtual-list"]');
  }
  return element;
}

function rowElements(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-sort-id]"));
}

function wrappers(): HTMLElement[] {
  return Array.from(
    scroller().querySelectorAll<HTMLElement>("[data-index]"),
  );
}

function indices(): number[] {
  return wrappers().map((node) => Number(node.getAttribute("data-index")));
}

function spacer(): HTMLElement {
  const element = scroller().firstElementChild;
  if (!(element instanceof HTMLElement)) {
    throw new Error("у списка нет spacer-элемента");
  }
  return element;
}

/**
 * jsdom не считает layout: подменяем `getBoundingClientRect` каждой строки
 * координатами из её `data-index`, чтобы сенсоры и стратегия сортировки
 * видели тот же порядок, что и пользователь.
 */
function stubRowRects(): void {
  for (const element of rowElements()) {
    const wrapper = element.closest<HTMLElement>("[data-index]");
    if (wrapper === null) {
      continue;
    }
    const index = Number(wrapper.getAttribute("data-index"));
    stubRect(element, {
      left: 0,
      top: index * ROW_HEIGHT,
      width: LIST_WIDTH,
      height: ROW_HEIGHT,
    });
  }
}

function SortableRow(props: {
  readonly item: Row;
  readonly index: number;
}): Node {
  const sortable = useSortable({ id: props.item.id });
  const rowStyle = () => {
    const transform = sortable.transform();
    return transform === null
      ? {}
      : { transform: `translate(${transform.x}px, ${transform.y}px)` };
  };
  return (
    <div
      ref={sortable.setNodeRef}
      {...sortable.attributes}
      {...sortable.listeners}
      data-sort-id={props.item.id}
      data-row-index={props.index}
      style={rowStyle()}
    >
      {props.item.label}
    </div>
  );
}

interface AppProps {
  readonly rows: () => readonly Row[];
  readonly onDragEnd: (event: DragEndEvent) => void;
}

function App(props: AppProps): Node {
  const sensors = useSensors(
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  return (
    <DndContext id="virtual-dnd" sensors={sensors} onDragEnd={props.onDragEnd}>
      <div class="board">
        <SortableContext
          items={() => props.rows().map((row) => row.id)}
          strategy={verticalListSortingStrategy}
        >
          <VirtualList
            each={props.rows}
            keyOf={(row) => row.id}
            estimateSize={ROW_HEIGHT}
            overscan={OVERSCAN}
            initialOffset={0}
            initialViewportSize={VIEWPORT_HEIGHT}
            attrs={{ "data-testid": "virtual-list" }}
          >
            {(row, index) => <SortableRow item={row} index={index} />}
          </VirtualList>
        </SortableContext>
      </div>
    </DndContext>
  );
}

interface Mounted {
  readonly rows: () => Row[];
  readonly ended: DragEndEvent[];
}

function mountApp(): Mounted {
  const [rows, setRows] = createSignal<Row[]>(buildRows(TOTAL));
  const ended: DragEndEvent[] = [];

  const result = createComponent(App as never, {
    rows,
    onDragEnd: (event: DragEndEvent) => {
      ended.push(event);
      if (event.over === null) {
        return;
      }
      const list = rows();
      const from = list.findIndex((row) => row.id === event.active.id);
      const to = list.findIndex((row) => row.id === event.over?.id);
      if (from !== -1 && to !== -1) {
        setRows(arrayMove(list, from, to));
      }
    },
  } as unknown as Record<string, unknown>);

  document.body.appendChild(result.node);
  handles.push(result);
  flush();

  // Размер вьюпорта задаём после монтирования: контейнер уже в документе,
  // `resize` пересчитывает диапазон до начала взаимодействия.
  defineSize(scroller(), VIEWPORT_HEIGHT, LIST_WIDTH);
  window.dispatchEvent(new Event("resize"));
  flush();

  return { rows, ended };
}

beforeEach(() => {
  // jsdom не даёт детерминированного кадра; без rAF виртуализатор
  // синхронизирует размеры вьюпорта синхронно.
  vi.stubGlobal("requestAnimationFrame", undefined);
  vi.stubGlobal("cancelAnimationFrame", undefined);
});

afterEach(() => {
  for (const handle of handles.splice(0)) {
    handle.dispose();
  }
  flushSync();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("sortable внутри виртуализированного списка", () => {
  it("окно, клавиатурный drag, arrayMove и сохранение totalSize", () => {
    const view = mountApp();

    // 1. Окно: только видимые строки, корректные `data-index`.
    expect(view.rows()).toHaveLength(TOTAL);
    expect(indices()).toEqual(EXPECTED_INDICES);
    expect(indices().length).toBeGreaterThanOrEqual(10);
    expect(indices().length).toBeLessThan(20);
    expect(rowElements()).toHaveLength(EXPECTED_INDICES.length);
    wrappers().forEach((wrapper, position) => {
      expect(Number(wrapper.getAttribute("data-index"))).toBe(position);
      expect(wrapper.querySelectorAll("[data-sort-id]")).toHaveLength(1);
      expect(wrapper.textContent).toBe(`Строка ${position}`);
    });
    expect(spacer().style.height).toBe(`${TOTAL * ROW_HEIGHT}px`);

    // 2. Строка — настоящий sortable с идентичностью по `row.id`.
    const row0 = rowElements()[0] as HTMLElement;
    const row1 = rowElements()[1] as HTMLElement;
    expect(row0.getAttribute("data-sort-id")).toBe("row-0");
    expect(row1.getAttribute("data-sort-id")).toBe("row-1");
    expect(row0.getAttribute("role")).toBe("button");
    expect(row0.getAttribute("aria-roledescription")).toBe("draggable");
    row0.focus();
    expect(document.activeElement).toBe(row0);

    // 3. Клавиатурный drag: Space → ArrowDown → Space.
    stubRowRects();
    key(row0, " ");
    flush();
    expect(row0.getAttribute("aria-pressed")).toBe("true");
    expect(view.ended).toHaveLength(0);

    key(document, "ArrowDown");
    flush();
    key(document, " ");
    flush();

    expect(view.ended).toHaveLength(1);
    const event = view.ended[0] as DragEndEvent;
    expect(event.active.id).toBe("row-0");
    expect(event.over?.id).toBe("row-1");

    // 4. `arrayMove` меняет порядок, а DOM переносит сами узлы строк.
    expect(view.rows()).toHaveLength(TOTAL);
    expect(view.rows()[0]?.id).toBe("row-1");
    expect(view.rows()[1]?.id).toBe("row-0");
    expect(wrappers().slice(0, 3).map((node) => node.textContent)).toEqual([
      "Строка 1",
      "Строка 0",
      "Строка 2",
    ]);

    // Идентичность строк по `id` сохраняется: row-0 переехал на позицию 1,
    // row-1 — на позицию 0, содержимое строк не перепутано.
    const currentRow0 = document.querySelector<HTMLElement>('[data-sort-id="row-0"]');
    expect(currentRow0).not.toBeNull();
    expect(currentRow0?.closest("[data-index]")?.getAttribute("data-index")).toBe("1");
    expect(currentRow0?.textContent).toBe("Строка 0");
    expect(rowElements()[0]?.getAttribute("data-sort-id")).toBe("row-1");
    expect(rowElements()[0]?.textContent).toBe("Строка 1");

    // 5. После перестановки окно и полный размер списка не сломались.
    expect(indices()).toEqual(EXPECTED_INDICES);
    expect(spacer().style.height).toBe(`${TOTAL * ROW_HEIGHT}px`);
    expect(rowElements()).toHaveLength(EXPECTED_INDICES.length);
  });
});

describe("SSR среза VirtualList с SortableContext", () => {
  function ServerApp(props: {
    readonly rows: readonly Row[];
    readonly onDragEnd: () => void;
  }): Node {
    return <App rows={() => props.rows} onDragEnd={props.onDragEnd} />;
  }

  it("renderToString даёт детерминированный срез видимых строк", async () => {
    const rows = buildRows(TOTAL);
    const first = await renderToString(() => (
      <ServerApp rows={rows} onDragEnd={() => {}} />
    ));
    const second = await renderToString(() => (
      <ServerApp rows={rows} onDragEnd={() => {}} />
    ));

    expect(first.html).toBe(second.html);

    const container = document.createElement("div");
    container.innerHTML = first.html;
    expect(
      Array.from(container.querySelectorAll("[data-index]")).map((node) =>
        Number(node.getAttribute("data-index")),
      ),
    ).toEqual(EXPECTED_INDICES);
    expect(first.html).toContain("Строка 0");
    expect(first.html).toContain("Строка 11");
    expect(first.html).not.toContain("Строка 12");
    expect(first.html).toContain('aria-describedby="virtual-dnd-instructions"');
    expect(first.html.toLowerCase()).not.toContain("onkeydown");
    expect(first.html.toLowerCase()).not.toContain("onpointerdown");
  });
});
