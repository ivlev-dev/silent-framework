import { afterEach, describe, expect, it, vi } from "vitest";
import {
  For,
  Show,
  createComponent,
  createSignal,
  flushSync,
  type AnyComponent,
} from "@ivlev-dev/silent-core";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
  rectIntersection,
  sortableKeyboardCoordinates,
  useDndContext,
  useDndMonitor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  useSortable,
} from "../src/index.js";

interface Handle {
  readonly node: Node;
  dispose(): void;
}

const handles: Handle[] = [];

function mount(component: AnyComponent, props: Record<string, unknown> = {}): Handle {
  const result = createComponent(component, props);
  document.body.appendChild(result.node);
  handles.push(result);
  flushSync();
  return result;
}

afterEach(() => {
  for (const handle of handles.splice(0)) handle.dispose();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

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

function pointer(
  target: EventTarget,
  type: string,
  x: number,
  y: number,
): void {
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

function key(target: EventTarget, value: string, init: KeyboardEventInit = {}): void {
  target.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: value,
      bubbles: true,
      cancelable: true,
      ...init,
    }),
  );
}

function byTestId(id: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  if (element === null) {
    throw new Error(`не найден [data-testid="${id}"]`);
  }
  return element;
}

interface DraggableItemProps {
  readonly id: string;
  readonly disabled?: boolean;
}

function DraggableItem(props: DraggableItemProps): Node {
  const draggable = useDraggable({
    id: props.id,
    ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
    data: { kind: "item" },
  });
  const itemStyle = () => {
    const transform = draggable.transform();
    return transform === null
      ? {}
      : { transform: `translate(${transform.x}px, ${transform.y}px)` };
  };
  return (
    <div
      ref={draggable.setNodeRef}
      {...draggable.attributes}
      {...draggable.listeners}
      data-testid={`drag-${props.id}`}
      data-dragging={() => String(draggable.isDragging())}
      style={itemStyle()}
    />
  );
}

function DroppableTarget(props: { readonly id: string }): Node {
  const droppable = useDroppable({ id: props.id, data: { kind: "target" } });
  return (
    <div
      ref={droppable.setNodeRef}
      data-testid={`drop-${props.id}`}
      data-over={() => String(droppable.isOver())}
    />
  );
}

describe("регистрация и события", () => {
  it("draggable/droppable: over, события start/move/over/end", () => {
    const events: string[] = [];
    const pairs: string[] = [];

    function App(): Node {
      return (
        <DndContext
          collisionDetection={rectIntersection}
          onDragStart={(event) => events.push(`start:${String(event.active.id)}`)}
          onDragMove={() => events.push("move")}
          onDragOver={(event) => {
            events.push("over");
            pairs.push(`${String(event.active.id)}>${String(event.over?.id)}`);
          }}
          onDragEnd={(event) => {
            events.push("end");
            pairs.push(`${String(event.active.id)}>${String(event.over?.id)}`);
          }}
        >
          <DraggableItem id="item" />
          <DroppableTarget id="target" />
        </DndContext>
      );
    }

    mount(App);
    const item = byTestId("drag-item");
    const target = byTestId("drop-target");
    stubRect(item, { left: 0, top: 0, width: 20, height: 20 });
    stubRect(target, { left: 30, top: 0, width: 80, height: 80 });

    expect(item.getAttribute("role")).toBe("button");
    expect(item.getAttribute("aria-describedby")).toMatch(/-instructions$/);
    expect(item.getAttribute("aria-pressed")).toBe("false");

    pointer(item, "pointerdown", 5, 5);
    flushSync();
    expect(events[0]).toBe("start:item");
    expect(item.getAttribute("data-dragging")).toBe("true");
    expect(item.getAttribute("aria-pressed")).toBe("true");

    pointer(document, "pointermove", 60, 40);
    flushSync();
    expect(target.getAttribute("data-over")).toBe("true");
    expect(pairs).toContain("item>target");

    pointer(document, "pointerup", 60, 40);
    flushSync();
    expect(events.at(-1)).toBe("end");
    expect(pairs.at(-1)).toBe("item>target");
    expect(item.getAttribute("data-dragging")).toBe("false");
    expect(item.getAttribute("aria-pressed")).toBe("false");
  });

  it("useDndMonitor получает все события контекста", () => {
    const seen: string[] = [];

    function Monitor(): Node {
      useDndMonitor({
        onDragStart: () => seen.push("start"),
        onDragMove: () => seen.push("move"),
        onDragEnd: () => seen.push("end"),
        onDragCancel: () => seen.push("cancel"),
      });
      return <span />;
    }

    function App(): Node {
      return (
        <DndContext>
          <Monitor />
          <DraggableItem id="item" />
          <DroppableTarget id="target" />
        </DndContext>
      );
    }

    mount(App);
    const item = byTestId("drag-item");
    stubRect(item, { left: 0, top: 0, width: 20, height: 20 });
    stubRect(byTestId("drop-target"), { left: 30, top: 0, width: 80, height: 80 });

    pointer(item, "pointerdown", 5, 5);
    pointer(document, "pointermove", 20, 5);
    flushSync();
    pointer(document, "pointerup", 20, 5);
    flushSync();

    expect(seen).toContain("start");
    expect(seen).toContain("move");
    expect(seen).toContain("end");
  });

  it("useDndContext бросает понятную ошибку вне провайдера", () => {
    function Outside(): Node {
      useDndContext();
      return <div />;
    }

    expect(() => mount(Outside)).toThrow(/вне <DndContext>/u);
  });

  it("disabled draggable не запускает drag", () => {
    let started = 0;

    function App(): Node {
      return (
        <DndContext onDragStart={() => (started += 1)}>
          <DraggableItem id="item" disabled />
        </DndContext>
      );
    }

    mount(App);
    const item = byTestId("drag-item");
    stubRect(item, { left: 0, top: 0, width: 20, height: 20 });
    pointer(item, "pointerdown", 5, 5);
    flushSync();
    expect(started).toBe(0);
  });
});

describe("PointerSensor", () => {
  it("distance не стартует до порога и стартует после", () => {
    let started = 0;

    function App(): Node {
      const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 10 } }),
      );
      return (
        <DndContext sensors={sensors} onDragStart={() => (started += 1)}>
          <DraggableItem id="item" />
        </DndContext>
      );
    }

    mount(App);
    const item = byTestId("drag-item");
    stubRect(item, { left: 0, top: 0, width: 20, height: 20 });

    pointer(item, "pointerdown", 5, 5);
    pointer(document, "pointermove", 12, 6);
    flushSync();
    expect(started).toBe(0);

    pointer(document, "pointermove", 20, 5);
    flushSync();
    expect(started).toBe(1);
  });

  it("Escape отменяет перетаскивание", () => {
    const events: string[] = [];

    function App(): Node {
      return (
        <DndContext
          onDragStart={() => events.push("start")}
          onDragCancel={() => events.push("cancel")}
          onDragEnd={() => events.push("end")}
        >
          <DraggableItem id="item" />
        </DndContext>
      );
    }

    mount(App);
    const item = byTestId("drag-item");
    stubRect(item, { left: 0, top: 0, width: 20, height: 20 });

    pointer(item, "pointerdown", 5, 5);
    pointer(document, "pointermove", 40, 40);
    flushSync();
    key(document, "Escape");
    flushSync();

    expect(events).toEqual(["start", "cancel"]);
    expect(item.getAttribute("data-dragging")).toBe("false");
  });

  it("pointercancel отменяет перетаскивание", () => {
    let cancelled = 0;

    function App(): Node {
      return (
        <DndContext onDragCancel={() => (cancelled += 1)}>
          <DraggableItem id="item" />
        </DndContext>
      );
    }

    mount(App);
    const item = byTestId("drag-item");
    stubRect(item, { left: 0, top: 0, width: 20, height: 20 });

    pointer(item, "pointerdown", 5, 5);
    pointer(document, "pointermove", 30, 30);
    pointer(document, "pointercancel", 30, 30);
    flushSync();
    expect(cancelled).toBe(1);
  });

  it("PоinterSensor: delay-констрейнт срабатывает по таймеру", () => {
    vi.useFakeTimers();
    let started = 0;

    function App(): Node {
      const sensors = useSensors(
        useSensor(PointerSensor, {
          activationConstraint: { delay: 100, tolerance: 5 },
        }),
      );
      return (
        <DndContext sensors={sensors} onDragStart={() => (started += 1)}>
          <DraggableItem id="item" />
        </DndContext>
      );
    }

    mount(App);
    const item = byTestId("drag-item");
    stubRect(item, { left: 0, top: 0, width: 20, height: 20 });

    pointer(item, "pointerdown", 5, 5);
    flushSync();
    expect(started).toBe(0);
    vi.advanceTimersByTime(100);
    flushSync();
    expect(started).toBe(1);
  });
});

describe("KeyboardSensor", () => {
  it("Space стартует, стрелки двигают, Escape отменяет", () => {
    const events: string[] = [];
    let moved = 0;

    function App(): Node {
      return (
        <DndContext
          onDragStart={() => events.push("start")}
          onDragMove={() => (moved += 1)}
          onDragCancel={() => events.push("cancel")}
        >
          <DraggableItem id="item" />
        </DndContext>
      );
    }

    mount(App);
    const item = byTestId("drag-item");
    stubRect(item, { left: 0, top: 0, width: 20, height: 20 });

    key(item, " ");
    flushSync();
    expect(events).toEqual(["start"]);
    expect(item.getAttribute("aria-pressed")).toBe("true");

    key(document, "ArrowDown", { shiftKey: true });
    flushSync();
    expect(moved).toBe(1);
    expect(item.style.transform).toContain("translate(0px, 50px)");

    key(document, "Escape");
    flushSync();
    expect(events).toEqual(["start", "cancel"]);
    expect(item.style.transform).toBe("");
  });

  it("Space завершает перетаскивание и возвращает фокус", async () => {
    let ended = 0;

    function App(): Node {
      return (
        <DndContext onDragEnd={() => (ended += 1)}>
          <DraggableItem id="item" />
        </DndContext>
      );
    }

    mount(App);
    const item = byTestId("drag-item");
    stubRect(item, { left: 0, top: 0, width: 20, height: 20 });
    item.focus();

    key(item, "Enter");
    key(document, "ArrowRight");
    key(document, "Enter");
    flushSync();

    expect(ended).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync();
    expect(document.activeElement).toBe(item);
  });
});

describe("auto-scroll", () => {
  it("прокручивает контейнер по rAF при указателе у края", () => {
    let frame: FrameRequestCallback | null = null;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {
      frame = null;
    });

    function ScrollItem(): Node {
      const draggable = useDraggable({ id: "item" });
      return (
        <div
          ref={draggable.setNodeRef}
          {...draggable.attributes}
          {...draggable.listeners}
          data-testid="drag-item"
        />
      );
    }

    function App(): Node {
      return (
        <DndContext>
          <div
            data-testid="scroll"
            style={{ overflow: "auto", height: "100px", width: "100px" }}
          >
            <ScrollItem />
          </div>
        </DndContext>
      );
    }

    mount(App);
    const scroll = byTestId("scroll");
    const item = byTestId("drag-item");
    stubRect(scroll, { left: 0, top: 0, width: 100, height: 100 });
    stubRect(item, { left: 0, top: 0, width: 20, height: 20 });
    Object.defineProperty(scroll, "scrollHeight", { configurable: true, value: 1000 });
    Object.defineProperty(scroll, "clientHeight", { configurable: true, value: 100 });
    scroll.scrollTop = 0;

    pointer(item, "pointerdown", 10, 10);
    pointer(document, "pointermove", 10, 95);
    flushSync();

    expect(frame).not.toBeNull();
    const callback = frame as unknown as FrameRequestCallback;
    callback(0);
    expect(scroll.scrollTop).toBeGreaterThan(0);

    pointer(document, "pointerup", 10, 95);
    flushSync();
  });
});

describe("DragOverlay", () => {
  it("рендерится только при активном drag и удаляется после end", () => {
    function App(): Node {
      return (
        <DndContext>
          <DraggableItem id="item" />
          <DragOverlay dropAnimation={null}>
            {(source) => <div data-testid="overlay-content">{String(source.id)}</div>}
          </DragOverlay>
        </DndContext>
      );
    }

    mount(App);
    const item = byTestId("drag-item");
    stubRect(item, { left: 10, top: 20, width: 30, height: 40 });
    expect(document.querySelector("[data-dnd-overlay]")).toBeNull();

    pointer(item, "pointerdown", 15, 25);
    flushSync();
    const overlay = document.querySelector<HTMLElement>("[data-dnd-overlay]");
    expect(overlay).not.toBeNull();
    expect(overlay?.getAttribute("aria-hidden")).toBe("true");
    expect(overlay?.style.position).toBe("fixed");
    expect(overlay?.style.pointerEvents).toBe("none");
    expect(byTestId("overlay-content").textContent).toBe("item");

    pointer(document, "pointermove", 45, 65);
    flushSync();
    expect(document.querySelector<HTMLElement>("[data-dnd-overlay]")?.style.transform)
      .toContain("translate3d(30px, 40px, 0px)");

    pointer(document, "pointerup", 45, 65);
    flushSync();
    expect(document.querySelector("[data-dnd-overlay]")).toBeNull();
  });

  it("dropAnimation с длительностью оставляет оверлей до таймера", () => {
    vi.useFakeTimers();

    function App(): Node {
      return (
        <DndContext>
          <DraggableItem id="item" />
          <DragOverlay dropAnimation={{ duration: 100 }}>
            <span>overlay</span>
          </DragOverlay>
        </DndContext>
      );
    }

    mount(App);
    const item = byTestId("drag-item");
    stubRect(item, { left: 0, top: 0, width: 20, height: 20 });

    pointer(item, "pointerdown", 5, 5);
    flushSync();
    pointer(document, "pointerup", 5, 5);
    flushSync();
    expect(document.querySelector("[data-dnd-overlay]")).not.toBeNull();

    vi.advanceTimersByTime(100);
    flushSync();
    expect(document.querySelector("[data-dnd-overlay]")).toBeNull();
  });
});

describe("доступность", () => {
  it("live-region сообщает о старте, aria-атрибуты и инструкции на месте", () => {
    function App(): Node {
      return (
        <DndContext>
          <DraggableItem id="item" />
        </DndContext>
      );
    }

    mount(App);
    const item = byTestId("drag-item");
    stubRect(item, { left: 0, top: 0, width: 20, height: 20 });
    const instructions = document.querySelector<HTMLElement>("[id$='-instructions']");
    expect(instructions?.textContent).toContain("пробел");
    expect(item.getAttribute("aria-describedby")).toBe(instructions?.id);

    const live = document.querySelector<HTMLElement>("[role='status']");
    expect(live?.getAttribute("aria-live")).toBe("assertive");
    expect(live?.textContent).toBe("");

    pointer(item, "pointerdown", 5, 5);
    flushSync();
    expect(live?.textContent).toContain("Захвачен элемент item");
  });

  it("cancelDrop=true превращает end в cancel", () => {
    const events: string[] = [];

    function App(): Node {
      return (
        <DndContext
          cancelDrop={() => true}
          onDragEnd={() => events.push("end")}
          onDragCancel={() => events.push("cancel")}
        >
          <DraggableItem id="item" />
        </DndContext>
      );
    }

    mount(App);
    const item = byTestId("drag-item");
    stubRect(item, { left: 0, top: 0, width: 20, height: 20 });

    pointer(item, "pointerdown", 5, 5);
    pointer(document, "pointerup", 5, 5);
    flushSync();
    expect(events).toEqual(["cancel"]);
  });
});

describe("sortable", () => {
  function SortableItem(props: { readonly id: string }): Node {
    const sortable = useSortable({ id: props.id });
    const itemStyle = () => {
      const transform = sortable.transform();
      return transform === null
        ? {}
        : {
            transform: `translate(${transform.x}px, ${transform.y}px)`,
            transition: sortable.transition() ?? undefined,
          };
    };
    return (
      <div
        ref={sortable.setNodeRef}
        {...sortable.attributes}
        {...sortable.listeners}
        data-testid={`sort-${props.id}`}
        data-index={() => String(sortable.index())}
        data-new-index={() => String(sortable.newIndex())}
        data-over={() => String(sortable.isOver())}
        style={itemStyle()}
      />
    );
  }

  it("стратегия сдвигает соседей, индексы переставляются", () => {
    function App(): Node {
      return (
        <DndContext>
          <SortableContext items={["a", "b", "c"]} strategy={verticalListSortingStrategy}>
            <SortableItem id="a" />
            <SortableItem id="b" />
            <SortableItem id="c" />
          </SortableContext>
        </DndContext>
      );
    }

    mount(App);
    const a = byTestId("sort-a");
    const b = byTestId("sort-b");
    const c = byTestId("sort-c");
    stubRect(a, { left: 0, top: 0, width: 100, height: 20 });
    stubRect(b, { left: 0, top: 30, width: 100, height: 20 });
    stubRect(c, { left: 0, top: 60, width: 100, height: 20 });

    pointer(a, "pointerdown", 10, 10);
    pointer(document, "pointermove", 10, 70);
    flushSync();

    expect(Number(b.getAttribute("data-new-index"))).toBe(2);
    expect(b.style.transform).toContain("translate(0px, -30px)");
    expect(c.style.transform).toContain("translate(0px, -30px)");

    pointer(document, "pointerup", 10, 70);
    flushSync();
    expect(b.style.transform).toBe("");
  });

  it("клавиатура двигает по sortableKeyboardCoordinates", () => {
    let endedOver: string | null = null;

    function App(): Node {
      const sensors = useSensors(
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
      );
      return (
        <DndContext
          sensors={sensors}
          onDragEnd={(event) => {
            endedOver = event.over === null ? null : String(event.over.id);
          }}
        >
          <SortableContext items={["a", "b", "c"]} strategy={verticalListSortingStrategy}>
            <SortableItem id="a" />
            <SortableItem id="b" />
            <SortableItem id="c" />
          </SortableContext>
        </DndContext>
      );
    }

    mount(App);
    const a = byTestId("sort-a");
    const b = byTestId("sort-b");
    const c = byTestId("sort-c");
    stubRect(a, { left: 0, top: 0, width: 100, height: 20 });
    stubRect(b, { left: 0, top: 30, width: 100, height: 20 });
    stubRect(c, { left: 0, top: 60, width: 100, height: 20 });

    key(a, " ");
    key(document, "ArrowDown");
    flushSync();
    expect(a.style.transform).toContain("translate(0px, 30px)");

    key(document, "ArrowDown");
    flushSync();
    key(document, " ");
    flushSync();
    expect(endedOver).toBe("c");
  });
});

describe("восстановление фокуса после controlled reorder", () => {
  function FocusRow(props: {
    readonly id: string;
    readonly generation: () => number;
  }): Node {
    const sortable = useSortable({ id: props.id });
    const rowNode = () => {
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
          style={rowStyle()}
        >
          {props.id}
        </div>
      );
    };
    // После controlled-reorder приложение может пересоздать DOM-узел строки,
    // сохранив компонент и идентификатор. Это и ломало возврат фокуса.
    return (
      <div data-row="">
        <Show
          when={() => props.generation() % 2 === 0}
          fallback={() => rowNode()}
        >
          {() => rowNode()}
        </Show>
      </div>
    );
  }

  interface ReorderAppProps {
    readonly reorder: boolean;
    readonly restoreFocus?: boolean;
  }

  function ReorderApp(props: ReorderAppProps): Node {
    const [items, setItems] = createSignal(["a", "b", "c"]);
    const [generation, setGeneration] = createSignal(0);
    const sensors = useSensors(
      useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );
    return (
      <DndContext
        autoScroll={false}
        sensors={sensors}
        accessibility={props.restoreFocus === false ? { restoreFocus: false } : {}}
        onDragEnd={(event) => {
          if (!props.reorder || event.over === null) {
            return;
          }
          const list = items();
          const from = list.indexOf(String(event.active.id));
          const to = list.indexOf(String(event.over.id));
          if (from !== -1 && to !== -1) {
            setItems(arrayMove(list, from, to));
            setGeneration((value) => value + 1);
          }
        }}
      >
        <SortableContext items={items} strategy={verticalListSortingStrategy}>
          <For each={items} keyOf={(id) => id}>
            {(id) => <FocusRow id={id} generation={generation} />}
          </For>
        </SortableContext>
      </DndContext>
    );
  }

  function rowsById(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>("[data-dnd-id]"));
  }

  function row(id: string): HTMLElement {
    const found = rowsById().find((element) => element.getAttribute("data-dnd-id") === id);
    if (found === undefined) {
      throw new Error(`не найдена draggable-строка ${id}`);
    }
    return found;
  }

  function startKeyboardDrag(first: string): void {
    stubRect(row("a"), { left: 0, top: 0, width: 100, height: 20 });
    stubRect(row("b"), { left: 0, top: 30, width: 100, height: 20 });
    stubRect(row("c"), { left: 0, top: 60, width: 100, height: 20 });
    row(first).focus();
    key(row(first), " ");
    flushSync();
    key(document, "ArrowDown");
    flushSync();
  }

  it("keyboard drag + arrayMove переносит фокус на новую строку", () => {
    vi.useFakeTimers();
    mount(() => <ReorderApp reorder />);
    const oldA = row("a");
    startKeyboardDrag("a");

    key(document, " ");
    flushSync();
    flushSync();

    expect(oldA.isConnected).toBe(false);
    expect(rowsById().map((element) => element.getAttribute("data-dnd-id"))).toEqual([
      "b",
      "a",
      "c",
    ]);

    vi.runAllTimers();
    flushSync();

    const active = document.activeElement;
    expect(active).not.toBe(document.body);
    expect(active).toBe(row("a"));
    expect((active as HTMLElement).getAttribute("data-dnd-id")).toBe("a");
  });

  it("Escape возвращает фокус на исходный активатор", () => {
    vi.useFakeTimers();
    mount(() => <ReorderApp reorder={false} />);
    const original = row("a");
    startKeyboardDrag("a");

    key(document, "Escape");
    flushSync();
    vi.runAllTimers();
    flushSync();

    expect(original.isConnected).toBe(true);
    expect(document.activeElement).toBe(original);
    expect(original.getAttribute("data-dnd-id")).toBe("a");
  });

  it("находит новый узел по data-dnd-id, если реестр указывает на отключённый", () => {
    vi.useFakeTimers();
    mount(() => (
      <DndContext autoScroll={false}>
        <DraggableItem id="item" />
      </DndContext>
    ));
    const original = byTestId("drag-item");
    stubRect(original, { left: 0, top: 0, width: 20, height: 20 });
    original.focus();

    key(original, " ");
    flushSync();

    const replacement = original.cloneNode(true) as HTMLElement;
    original.replaceWith(replacement);
    expect(original.isConnected).toBe(false);

    key(document, " ");
    flushSync();
    vi.runAllTimers();
    flushSync();

    expect(document.activeElement).toBe(replacement);
    expect(replacement.getAttribute("data-dnd-id")).toBe("item");
  });

  it("restoreFocus=false не возвращает фокус после drag", () => {
    vi.useFakeTimers();
    mount(() => <ReorderApp reorder={false} restoreFocus={false} />);
    const original = row("a");
    startKeyboardDrag("a");
    original.blur();
    expect(document.activeElement).toBe(document.body);

    key(document, " ");
    flushSync();
    vi.runAllTimers();
    flushSync();

    expect(document.activeElement).toBe(document.body);
  });
});
