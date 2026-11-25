import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createComponent,
  createRoot,
  createSignal,
  flushSync,
  hydrate,
  setServerMode,
} from "@ivlev-dev/silent-core";
import { renderToString } from "@ivlev-dev/silent-server";
import {
  createVirtualizer,
  VirtualGrid,
  VirtualList,
  type VirtualListProps,
  type Virtualizer,
} from "../src/index.js";
import type { VirtualItem } from "../src/index.js";

type Handle = { dispose(): void };

const handles: Handle[] = [];

class MockResizeObserver {
  static instances: MockResizeObserver[] = [];

  readonly callback: ResizeObserverCallback;
  readonly targets: Element[] = [];
  disconnected = 0;

  constructor(callback: unknown) {
    this.callback = callback as ResizeObserverCallback;
    MockResizeObserver.instances.push(this);
  }

  observe(target: Element): void {
    this.targets.push(target);
  }

  unobserve(target: Element): void {
    const index = this.targets.indexOf(target);
    if (index >= 0) {
      this.targets.splice(index, 1);
    }
  }

  disconnect(): void {
    this.disconnected += 1;
    this.targets.length = 0;
  }

  trigger(): void {
    this.callback([], this as unknown as ResizeObserver);
  }
}

function flush(): void {
  flushSync();
  flushSync();
}

function defineSize(
  element: Element,
  height: number,
  width: number,
): void {
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    value: height,
  });
  Object.defineProperty(element, "clientWidth", {
    configurable: true,
    value: width,
  });
}

function mountListHandle<T>(
  props: VirtualListProps<T>,
  height = 100,
  width = 300,
): { root: HTMLElement; handle: Handle } {
  const result = createComponent(
    VirtualList as never,
    props as unknown as Record<string, unknown>,
  );
  const root = result.node as HTMLElement;
  defineSize(root, height, width);
  document.body.appendChild(root);
  handles.push(result);
  flush();
  return { root, handle: result };
}

function mountList<T>(
  props: VirtualListProps<T>,
  height = 100,
  width = 300,
): HTMLElement {
  return mountListHandle(props, height, width).root;
}

function mountGridHandle(
  props: Record<string, unknown>,
  height = 100,
  width = 300,
): { root: HTMLElement; handle: Handle } {
  const result = createComponent(
    VirtualGrid as never,
    props,
  );
  const root = result.node as HTMLElement;
  defineSize(root, height, width);
  document.body.appendChild(root);
  handles.push(result);
  flush();
  return { root, handle: result };
}

function mountGrid(
  props: Record<string, unknown>,
  height = 100,
  width = 300,
): HTMLElement {
  return mountGridHandle(props, height, width).root;
}

function indices(root: Element): number[] {
  return Array.from(root.querySelectorAll("[data-index]")).map((node) =>
    Number(node.getAttribute("data-index")),
  );
}

function scrollTo(root: HTMLElement, offset: number, viewport = 100): void {
  defineSize(root, viewport, 300);
  root.scrollTop = offset;
  root.dispatchEvent(new Event("scroll"));
  flush();
}

beforeEach(() => {
  MockResizeObserver.instances = [];
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  vi.stubGlobal("requestAnimationFrame", undefined);
  vi.stubGlobal("cancelAnimationFrame", undefined);
  setServerMode(false);
});

afterEach(() => {
  for (const handle of handles.splice(0)) {
    handle.dispose();
  }
  document.body.replaceChildren();
  MockResizeObserver.instances = [];
  vi.unstubAllGlobals();
  setServerMode(false);
});

const items = Array.from({ length: 100 }, (_, index) => ({
  id: `item-${index}`,
  label: `Строка ${index}`,
}));

function itemListProps(
  overrides: Partial<VirtualListProps<(typeof items)[number]>> = {},
): VirtualListProps<(typeof items)[number]> {
  return {
    each: items,
    keyOf: (item) => item.id,
    estimateSize: 20,
    overscan: 2,
    initialOffset: 0,
    initialViewportSize: 100,
    children: (item) => <span>{item.label}</span>,
    ...overrides,
  };
}

function gridProps(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const cells = Array.from({ length: 30 }, (_, index) => `Ячейка ${index}`);
  return {
    each: cells,
    keyOf: (item: string, index: number) => `${index}:${item}`,
    columns: 3,
    estimateRowHeight: 50,
    overscan: 1,
    initialOffset: 0,
    initialViewportSize: 100,
    children: (item: string) => <span>{item}</span>,
    ...overrides,
  };
}

function rowIndices(root: Element): string[] {
  return Array.from(root.querySelectorAll("[data-row]")).map(
    (node) => node.getAttribute("data-row") ?? "",
  );
}

describe("VirtualList", () => {
  it("рендерит диапазон с overscan и двигает строки по scrollTop", () => {
    const root = mountList(itemListProps());

    expect(indices(root)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    const first = root.querySelector('[data-index="0"]') as HTMLElement;
    expect(first.style.transform).toBe("translateY(0px)");
    expect(first.style.height).toBe("20px");

    scrollTo(root, 200);

    expect(indices(root)).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16]);
    const row = root.querySelector('[data-index="10"]') as HTMLElement;
    expect(row.style.transform).toBe("translateY(200px)");
  });

  it("сообщает об изменении диапазона через onRangeChange", () => {
    const ranges: Array<{ start: number; end: number; overStart: number; overEnd: number }> = [];
    const root = mountList(
      itemListProps({
        onRangeChange: (range) => {
          ranges.push({
            start: range.startIndex,
            end: range.endIndex,
            overStart: range.overscanStartIndex,
            overEnd: range.overscanEndIndex,
          });
        },
      }),
    );

    expect(ranges.at(-1)).toEqual({ start: 0, end: 4, overStart: 0, overEnd: 6 });

    scrollTo(root, 200);

    expect(ranges.at(-1)).toEqual({ start: 10, end: 14, overStart: 8, overEnd: 16 });
  });

  it("поддерживает горизонтальный режим", () => {
    const root = mountList(
      itemListProps({
        horizontal: true,
        estimateSize: 40,
        overscan: 1,
        initialViewportSize: 100,
      }),
      100,
      100,
    );

    const first = root.querySelector('[data-index="0"]') as HTMLElement;
    expect(first.style.transform).toBe("translateX(0px)");
    expect(first.style.width).toBe("40px");

    root.scrollLeft = 80;
    root.dispatchEvent(new Event("scroll"));
    flush();

    expect(indices(root)[0]).toBe(1);
    const row = root.querySelector('[data-index="1"]') as HTMLElement;
    expect(row.style.transform).toBe("translateX(40px)");
    expect(root.scrollLeft).toBe(80);
  });

  it("показывает empty для пустого массива", () => {
    const root = mountList(
      itemListProps({
        each: [],
        empty: <div class="empty-state">Нет элементов</div>,
      }),
    );

    expect(root.querySelectorAll("[data-index]")).toHaveLength(0);
    expect(root.querySelector(".empty-state")?.textContent).toBe("Нет элементов");
  });

  it("пересчитывает диапазон после ResizeObserver", () => {
    const root = mountList(itemListProps({ overscan: 0 }), 100, 300);
    expect(indices(root)).toEqual([0, 1, 2, 3, 4]);

    defineSize(root, 200, 300);
    MockResizeObserver.instances[0]?.trigger();
    flush();

    expect(indices(root)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("реагирует на аксессор each при изменении количества", () => {
    const [data, setData] = createSignal(items.slice(0, 10));

    function App(): Node {
      return (
        <VirtualList
          each={data}
          keyOf={(item) => item.id}
          estimateSize={20}
          overscan={0}
          initialViewportSize={100}
        >
          {(item) => <span>{item.label}</span>}
        </VirtualList>
      );
    }

    const result = createComponent(App as never, {});
    const root = result.node as HTMLElement;
    defineSize(root, 100, 300);
    document.body.appendChild(root);
    handles.push(result);
    flush();

    expect(indices(root)).toEqual([0, 1, 2, 3, 4]);

    setData(items.slice(0, 3));
    flush();

    expect(indices(root)).toEqual([0, 1, 2]);
  });
});

describe("createVirtualizer", () => {
  it("измеряет строку через measureElement и перестраивает раскладку", () => {
    const virtualizer = createVirtualizer({
      count: 5,
      estimateSize: () => 50,
      initialViewportSize: 100,
      overscan: 0,
    });

    expect(virtualizer.virtualItems().map((item) => item.size)).toEqual([50, 50]);

    const row = document.createElement("div");
    row.setAttribute("data-index", "0");
    Object.defineProperty(row, "offsetHeight", {
      configurable: true,
      value: 80,
    });
    virtualizer.measureElement(row);
    flush();

    const measured = virtualizer.virtualItems();
    expect(measured[0]?.size).toBe(80);
    expect(measured[1]?.start).toBe(80);
    expect(virtualizer.totalSize()).toBe(280);

    virtualizer.dispose();
  });

  it("вычисляет смещения и прокручивает к индексу и в конец", () => {
    const root = document.createElement("div");
    defineSize(root, 100, 300);
    document.body.appendChild(root);
    const virtualizer = createVirtualizer({
      count: 100,
      estimateSize: () => 20,
      initialViewportSize: 100,
      overscan: 0,
    });
    virtualizer.setScrollElement(root);
    flush();

    expect(virtualizer.getOffsetForIndex(10, "start")).toBe(200);
    expect(virtualizer.getOffsetForIndex(10, "end")).toBe(120);
    expect(virtualizer.getOffsetForIndex(10, "center")).toBe(160);

    virtualizer.scrollToIndex(10, { align: "start" });
    flush();
    expect(root.scrollTop).toBe(200);
    expect(virtualizer.range().startIndex).toBe(10);

    virtualizer.scrollToEnd();
    flush();
    expect(root.scrollTop).toBe(1900);
    expect(virtualizer.range().endIndex).toBe(99);

    virtualizer.scrollToOffset(100);
    flush();
    expect(root.scrollTop).toBe(100);
    expect(virtualizer.range().startIndex).toBe(5);

    virtualizer.dispose();
    root.remove();
  });

  it("троттлит scroll через requestAnimationFrame", () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => undefined);

    const root = document.createElement("div");
    defineSize(root, 100, 300);
    document.body.appendChild(root);
    const virtualizer = createVirtualizer({
      count: 100,
      estimateSize: () => 20,
      initialViewportSize: 100,
      overscan: 0,
    });
    virtualizer.setScrollElement(root);
    flush();
    expect(virtualizer.range().startIndex).toBe(0);

    root.scrollTop = 100;
    root.dispatchEvent(new Event("scroll"));
    root.scrollTop = 120;
    root.dispatchEvent(new Event("scroll"));
    expect(callbacks).toHaveLength(1);
    expect(virtualizer.range().startIndex).toBe(0);

    callbacks.shift()?.(0);
    flush();
    expect(virtualizer.range().startIndex).toBe(6);

    virtualizer.dispose();
    root.remove();
  });

  it("включает isScrolling на scroll и сбрасывает по таймауту", async () => {
    const root = document.createElement("div");
    defineSize(root, 100, 300);
    document.body.appendChild(root);
    const virtualizer = createVirtualizer({
      count: 100,
      estimateSize: () => 20,
      initialViewportSize: 100,
      isScrollingResetDelay: 10,
    });
    virtualizer.setScrollElement(root);
    flush();

    root.dispatchEvent(new Event("scroll"));
    expect(virtualizer.isScrolling()).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 30));
    flush();
    expect(virtualizer.isScrolling()).toBe(false);

    virtualizer.dispose();
    root.remove();
  });

  it("применяет setOptions и переносит измерения через snapshot/restore", () => {
    const host = document.createElement("div");
    defineSize(host, 100, 300);
    document.body.appendChild(host);
    const first = createVirtualizer({
      count: 5,
      estimateSize: () => 50,
      initialViewportSize: 100,
      overscan: 0,
    });
    first.setScrollElement(host);
    flush();
    const row = document.createElement("div");
    row.setAttribute("data-index", "0");
    Object.defineProperty(row, "offsetHeight", {
      configurable: true,
      value: 80,
    });
    first.measureElement(row);
    flush();
    first.virtualItems();

    const snapshot = first.snapshot();
    const restored = createVirtualizer({
      count: 5,
      estimateSize: () => 50,
      initialViewportSize: 100,
      overscan: 0,
    });
    restored.restore(snapshot);
    flush();
    expect(restored.virtualItems()[0]?.size).toBe(80);

    restored.setOptions({ count: 2 });
    flush();
    expect(restored.totalSize()).toBe(130);
    expect(restored.virtualItems().at(-1)?.index).toBe(1);

    first.dispose();
    restored.dispose();
    host.remove();
  });

  it("на сервере возвращает детерминированный срез без слушателей", () => {
    setServerMode(true);
    try {
      const server = createVirtualizer({
        count: 100,
        estimateSize: () => 20,
        initialOffset: 200,
        initialViewportSize: 100,
        overscan: 1,
      });
      const slice: VirtualItem[] = server.virtualItems();
      expect(slice.map((item) => item.index)).toEqual([
        9, 10, 11, 12, 13, 14, 15,
      ]);
      expect(server.range().startIndex).toBe(10);
      expect(server.totalSize()).toBe(2000);
      server.dispose();
    } finally {
      setServerMode(false);
    }
  });
});

describe("VirtualGrid", () => {
  it("виртуализирует строки и рендерит ячейки", () => {
    const rows = Array.from({ length: 10 }, (_, index) => `Ячейка ${index}`);
    const result = createComponent(
      VirtualGrid as never,
      {
        each: rows,
        keyOf: (item: string, index: number) => `${index}:${item}`,
        columns: 3,
        estimateRowHeight: 50,
        overscan: 1,
        initialViewportSize: 100,
        children: (item: string) => <span>{item}</span>,
      } as unknown as Record<string, unknown>,
    );
    const root = result.node as HTMLElement;
    defineSize(root, 100, 300);
    document.body.appendChild(root);
    handles.push(result);
    flush();

    const gridRows = Array.from(root.querySelectorAll("[data-row]"));
    expect(gridRows.map((row) => row.getAttribute("data-row"))).toEqual([
      "0",
      "1",
      "2",
    ]);
    expect(gridRows[0]?.querySelectorAll("[data-index]")).toHaveLength(3);
    expect(gridRows[2]?.querySelectorAll("[data-index]")).toHaveLength(3);
    expect(root.textContent).toContain("Ячейка 8");
    expect(root.textContent).not.toContain("Ячейка 9");

    scrollTo(root, 100);

    expect(
      Array.from(root.querySelectorAll("[data-row]")).map((row) =>
        row.getAttribute("data-row"),
      ),
    ).toEqual(["1", "2", "3"]);
    expect(root.textContent).toContain("Ячейка 9");
  });
});

describe("SSR и гидрация", () => {
  it("гидрирует сетку без mismatch", async () => {
    const data = Array.from({ length: 12 }, (_, index) => ({
      id: `cell-${index}`,
      label: `Ячейка ${index}`,
    }));

    function GridApp(): Node {
      return (
        <VirtualGrid
          each={data}
          keyOf={(item) => item.id}
          columns={3}
          estimateRowHeight={50}
          overscan={1}
          initialOffset={0}
          initialViewportSize={100}
        >
          {(item) => <div>{item.label}</div>}
        </VirtualGrid>
      );
    }

    const { html } = await renderToString(GridApp);
    expect(html).toContain('data-row="0"');
    expect(html).toContain('data-row="2"');
    expect(html).not.toContain('data-row="3"');

    const root = document.createElement("div");
    root.innerHTML = html;
    document.body.appendChild(root);
    const serverNode = root.firstElementChild as HTMLElement;
    defineSize(serverNode, 100, 300);

    const mismatches: string[] = [];
    const handle = await hydrate(root, GridApp, {
      onMismatch: (error) => mismatches.push(error.message),
    });
    flush();

    expect(mismatches).toEqual([]);
    expect(
      Array.from(root.querySelectorAll("[data-row]")).map((node) =>
        node.getAttribute("data-row"),
      ),
    ).toEqual(["0", "1", "2"]);
    expect(root.textContent).toContain("Ячейка 0");

    handle.dispose();
  });

  it("гидрирует список без mismatch", async () => {
    const data = Array.from({ length: 50 }, (_, index) => ({
      id: `ssr-${index}`,
      label: `Элемент ${index}`,
    }));

    function App(): Node {
      return (
        <VirtualList
          each={data}
          keyOf={(item) => item.id}
          estimateSize={20}
          overscan={1}
          initialOffset={0}
          initialViewportSize={100}
        >
          {(item) => <div>{item.label}</div>}
        </VirtualList>
      );
    }

    const { html } = await renderToString(App);
    expect(html).toContain('data-index="0"');
    expect(html).toContain('data-index="5"');
    expect(html).not.toContain('data-index="6"');

    const root = document.createElement("div");
    root.innerHTML = html;
    document.body.appendChild(root);
    const serverNode = root.firstElementChild as HTMLElement;
    defineSize(serverNode, 100, 300);

    const mismatches: string[] = [];
    const handle = await hydrate(root, App, {
      onMismatch: (error) => mismatches.push(error.message),
    });
    flush();

    expect(mismatches).toEqual([]);
    expect(
      Array.from(root.querySelectorAll("[data-index]")).map((node) =>
        node.getAttribute("data-index"),
      ),
    ).toEqual(["0", "1", "2", "3", "4", "5"]);
    expect(root.textContent).toContain("Элемент 0");

    handle.dispose();
  });
});

describe("жизненный цикл контроллера", () => {
  it("после dispose и повторного mount второй список рендерит строки своим контроллером", () => {
    const first = mountListHandle(itemListProps());
    expect(indices(first.root)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    const firstRows = Array.from(first.root.querySelectorAll("[data-index]"));
    const firstObserver = MockResizeObserver.instances[0] as MockResizeObserver;
    expect(MockResizeObserver.instances).toHaveLength(1);
    expect(firstObserver.targets).toEqual([first.root]);

    scrollTo(first.root, 200);
    expect(indices(first.root)[0]).toBe(8);

    const removeSpy = vi.spyOn(first.root, "removeEventListener");
    first.handle.dispose();
    flush();
    expect(removeSpy).toHaveBeenCalledWith("scroll", expect.any(Function));
    expect(firstObserver.disconnected).toBe(1);
    expect(firstObserver.targets).toHaveLength(0);

    // Повторный dispose идемпотентен: слушатели снимаются один раз.
    first.handle.dispose();
    expect(firstObserver.disconnected).toBe(1);

    const second = mountListHandle(itemListProps());
    expect(MockResizeObserver.instances).toHaveLength(2);
    const secondObserver = MockResizeObserver.instances[1] as MockResizeObserver;
    expect(secondObserver).not.toBe(firstObserver);
    expect(secondObserver.targets).toEqual([second.root]);
    expect(secondObserver.disconnected).toBe(0);

    // Новый контроллер начинает с собственного смещения, а не с 200px старого.
    expect(indices(second.root)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    const secondRows = Array.from(second.root.querySelectorAll("[data-index]"));
    expect(secondRows).toHaveLength(firstRows.length);
    secondRows.forEach((row, index) => {
      expect(row).not.toBe(firstRows[index]);
    });

    scrollTo(second.root, 100);
    expect(indices(second.root)[0]).toBe(3);

    // Старый контейнер больше не управляется: scroll не меняет его строки.
    const staleBefore = indices(first.root)[0];
    first.root.scrollTop = 400;
    first.root.dispatchEvent(new Event("scroll"));
    flush();
    expect(indices(first.root)[0]).toBe(staleBefore);
    expect(firstObserver.disconnected).toBe(1);
  });

  it("снимает scroll, ResizeObserver, rAF и таймер; повторный dispose безопасен", () => {
    const frames: FrameRequestCallback[] = [];
    const cancelled: number[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      cancelled.push(id);
    });

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const root = document.createElement("div");
      defineSize(root, 100, 300);
      document.body.appendChild(root);

      const virtualizer = createVirtualizer({
        count: 100,
        estimateSize: () => 20,
        initialViewportSize: 100,
        overscan: 0,
        isScrollingResetDelay: 10,
      });
      virtualizer.setScrollElement(root);
      flush();

      const observer = MockResizeObserver.instances[0] as MockResizeObserver;
      expect(observer.targets).toEqual([root]);

      root.dispatchEvent(new Event("scroll"));
      expect(frames).toHaveLength(1);
      expect(virtualizer.isScrolling()).toBe(true);
      expect(vi.getTimerCount()).toBe(1);

      virtualizer.dispose();
      expect(cancelled).toEqual([1]);
      expect(observer.disconnected).toBe(1);
      expect(observer.targets).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
      expect(virtualizer.isScrolling()).toBe(false);

      // Запланированный до dispose кадр не должен воскрешать раскладку.
      frames[0]?.(0);
      flush();
      expect(frames).toHaveLength(1);

      // Слушатель снят: новый scroll не планирует ни кадр, ни таймер.
      root.dispatchEvent(new Event("scroll"));
      expect(frames).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(0);

      virtualizer.dispose();
      expect(cancelled).toEqual([1]);
      expect(observer.disconnected).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("не накапливает кадры и ResizeObserver при циклах mount/dispose", () => {
    const frames: FrameRequestCallback[] = [];
    const cancelled: number[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      cancelled.push(id);
    });

    for (let cycle = 0; cycle < 3; cycle += 1) {
      const view = mountListHandle(itemListProps());
      const observer = MockResizeObserver.instances[cycle] as MockResizeObserver;
      expect(observer.targets).toEqual([view.root]);

      view.root.dispatchEvent(new Event("scroll"));
      expect(frames).toHaveLength(cycle + 1);

      view.handle.dispose();
      flush();
      expect(observer.disconnected).toBe(1);
      expect(observer.targets).toHaveLength(0);
    }

    expect(frames).toHaveLength(3);
    expect(cancelled).toEqual([1, 2, 3]);
    expect(
      MockResizeObserver.instances.filter((observer) => observer.targets.length > 0),
    ).toHaveLength(0);
  });

  it("dispose до первого flush не подключает слушатели и observer", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => undefined);

    const root = document.createElement("div");
    defineSize(root, 100, 300);
    document.body.appendChild(root);

    const virtualizer = createVirtualizer({
      count: 100,
      estimateSize: () => 20,
      initialViewportSize: 100,
      overscan: 0,
    });
    virtualizer.setScrollElement(root);
    virtualizer.dispose();
    flush();

    expect(MockResizeObserver.instances).toHaveLength(0);
    expect(frames).toHaveLength(0);

    // Поздний ref-колбэк после dispose ничего не подключает.
    virtualizer.setScrollElement(root);
    flush();
    expect(MockResizeObserver.instances).toHaveLength(0);

    root.dispatchEvent(new Event("scroll"));
    expect(frames).toHaveLength(0);
  });

  it("освобождается владельцем рендера без явного dispose", () => {
    const root = document.createElement("div");
    defineSize(root, 100, 300);
    document.body.appendChild(root);

    let virtualizer!: Virtualizer;
    const disposeOwner = createRoot((dispose) => {
      virtualizer = createVirtualizer({
        count: 100,
        estimateSize: () => 20,
        initialViewportSize: 100,
        overscan: 0,
      });
      virtualizer.setScrollElement(root);
      return dispose;
    });
    flush();

    const observer = MockResizeObserver.instances[0] as MockResizeObserver;
    const removeSpy = vi.spyOn(root, "removeEventListener");
    expect(observer.targets).toEqual([root]);
    expect(virtualizer.range().startIndex).toBe(0);

    disposeOwner();
    flush();

    expect(removeSpy).toHaveBeenCalledWith("scroll", expect.any(Function));
    expect(observer.disconnected).toBe(1);
    expect(observer.targets).toHaveLength(0);

    virtualizer.dispose();
    expect(observer.disconnected).toBe(1);
  });

  it("не освобождает контроллер, которым не владеет", () => {
    const externalRoot = document.createElement("div");
    defineSize(externalRoot, 100, 300);
    document.body.appendChild(externalRoot);

    let external!: Virtualizer;
    const disposeOwner = createRoot((dispose) => {
      external = createVirtualizer({
        count: 10,
        estimateSize: () => 20,
        initialViewportSize: 100,
        overscan: 0,
      });
      external.setScrollElement(externalRoot);
      return dispose;
    });
    flush();

    const externalObserver = MockResizeObserver.instances[0] as MockResizeObserver;
    const list = mountListHandle(itemListProps());
    expect(MockResizeObserver.instances).toHaveLength(2);
    expect(indices(list.root)).toHaveLength(7);

    list.handle.dispose();
    flush();

    expect(externalObserver.disconnected).toBe(0);
    expect(externalObserver.targets).toEqual([externalRoot]);

    // Чужой контроллер продолжает работать: прокрутка двигает окно.
    external.scrollToIndex(4, { align: "start" });
    flush();
    expect(externalRoot.scrollTop).toBe(80);
    expect(external.range().startIndex).toBe(4);

    disposeOwner();
    expect(externalObserver.disconnected).toBe(1);
  });

  it("повторное монтирование сетки не переиспользует строки старого контроллера", () => {
    const first = mountGridHandle(gridProps());
    expect(rowIndices(first.root)).toEqual(["0", "1", "2"]);
    const firstRows = Array.from(first.root.querySelectorAll("[data-row]"));
    const firstObserver = MockResizeObserver.instances[0] as MockResizeObserver;

    scrollTo(first.root, 100);
    expect(rowIndices(first.root)).toEqual(["1", "2", "3", "4"]);

    first.handle.dispose();
    flush();
    expect(firstObserver.disconnected).toBe(1);
    expect(firstObserver.targets).toHaveLength(0);

    const second = mountGridHandle(gridProps());
    const secondObserver = MockResizeObserver.instances[1] as MockResizeObserver;
    expect(secondObserver).not.toBe(firstObserver);
    expect(secondObserver.disconnected).toBe(0);
    expect(rowIndices(second.root)).toEqual(["0", "1", "2"]);

    const secondRows = Array.from(second.root.querySelectorAll("[data-row]"));
    expect(secondRows).toHaveLength(firstRows.length);
    secondRows.forEach((row, index) => {
      expect(row).not.toBe(firstRows[index]);
    });

    scrollTo(second.root, 100);
    expect(rowIndices(second.root)).toEqual(["1", "2", "3", "4"]);
  });
});
