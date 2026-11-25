import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createComponent,
  flushSync,
  type AnyComponent,
} from "@ivlev-dev/silent-core";
import {
  CSS,
  DndContext,
  DragOverlay,
  KeyboardCode,
  TraversalOrder,
  defaultAnimateLayoutChanges,
  defaultDropAnimation,
  defaultDropAnimationSideEffects,
  defaultNewIndexGetter,
  getScrollableAncestors,
  hasSortableData,
  rectIntersection,
  sortableKeyboardCoordinates,
  useDraggable,
  useDroppable,
} from "../src/index.js";
import type {
  Active,
  ClientRect,
  Coordinates,
  DroppableContainer,
  KeyboardCoordinateGetterContext,
  UniqueIdentifier,
} from "../src/index.js";

const handles: Array<{ dispose(): void }> = [];

function mount(component: AnyComponent, props: Record<string, unknown> = {}): void {
  const result = createComponent(component, props);
  document.body.appendChild(result.node);
  handles.push(result);
  flushSync();
}

afterEach(() => {
  for (const handle of handles.splice(0)) {
    handle.dispose();
  }
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function rect(left: number, top: number, width: number, height: number): ClientRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  };
}

function stubRect(
  element: Element,
  value: { left: number; top: number; width: number; height: number },
): void {
  const full = {
    ...value,
    x: value.left,
    y: value.top,
    right: value.left + value.width,
    bottom: value.top + value.height,
    toJSON() {
      return full;
    },
  };
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => full,
  });
}

function byTestId(id: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  if (element === null) {
    throw new Error(`не найден [data-testid="${id}"]`);
  }
  return element;
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

function keyEvent(value: string): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    key: value,
    bubbles: true,
    cancelable: true,
  });
}

interface GetterOptions {
  readonly activeId?: UniqueIdentifier;
  readonly current: Coordinates;
  readonly rects: ReadonlyArray<readonly [UniqueIdentifier, ClientRect]>;
  readonly overId?: UniqueIdentifier | null;
  readonly collisionRect?: ClientRect;
}

function getterArgs(options: GetterOptions): {
  active: Active;
  currentCoordinates: Coordinates;
  context: KeyboardCoordinateGetterContext;
} {
  const rects = new Map<UniqueIdentifier, ClientRect>(options.rects);
  const containers: DroppableContainer[] = options.rects.map(([id]) => ({
    id,
    data: {},
    disabled: false,
    rect: rects.get(id) ?? null,
  }));
  const activeId = options.activeId ?? "active";
  const fakeActiveRect = rects.get(activeId) ?? null;
  const active: Active = {
    id: activeId,
    data: {},
    rect: fakeActiveRect,
  };
  return {
    active,
    currentCoordinates: options.current,
    context: {
      active,
      currentCoordinates: options.current,
      collisionRect: options.collisionRect ?? fakeActiveRect,
      droppableRects: rects,
      droppableContainers: containers,
      over:
        options.overId === undefined || options.overId === null
          ? null
          : {
              id: options.overId,
              data: {},
              rect: rects.get(options.overId) ?? null,
              disabled: false,
            },
      activeNodeRect: fakeActiveRect,
    },
  };
}

describe("публичные значения паритета", () => {
  it("defaultDropAnimation совпадает с эталоном dnd-kit", () => {
    expect(defaultDropAnimation).toEqual({ duration: 250, easing: "ease" });
  });

  it("KeyboardCode и TraversalOrder содержат ожидаемые члены", () => {
    expect(KeyboardCode.Space).toBe("Space");
    expect(KeyboardCode.Down).toBe("ArrowDown");
    expect(KeyboardCode.Right).toBe("ArrowRight");
    expect(KeyboardCode.Left).toBe("ArrowLeft");
    expect(KeyboardCode.Up).toBe("ArrowUp");
    expect(KeyboardCode.Esc).toBe("Escape");
    expect(KeyboardCode.Enter).toBe("Enter");
    expect(KeyboardCode.Tab).toBe("Tab");
    expect(KeyboardCode.Home).toBe("Home");
    expect(KeyboardCode.End).toBe("End");

    expect(TraversalOrder.BreadthFirst).not.toBe(TraversalOrder.DepthFirst);
    expect(Object.keys(TraversalOrder)).toContain("BreadthFirst");
    expect(Object.keys(TraversalOrder)).toContain("DepthFirst");
  });

  it("defaultDropAnimationSideEffects применяет и восстанавливает стили", () => {
    const activeNode = document.createElement("div");
    activeNode.style.opacity = "0.5";
    const overlayNode = document.createElement("div");

    const sideEffects = defaultDropAnimationSideEffects({
      styles: {
        active: { opacity: "0", backgroundColor: "red" },
        dragOverlay: { opacity: "0.25" },
      },
    });
    const cleanup = sideEffects({
      active: { id: "item", data: {}, rect: null },
      activeNode,
      dragOverlay: {
        node: { current: overlayNode },
        rect: null,
      },
    });

    expect(activeNode.style.opacity).toBe("0");
    expect(activeNode.style.getPropertyValue("background-color")).toBe("red");
    expect(overlayNode.style.opacity).toBe("0.25");

    expect(typeof cleanup).toBe("function");
    cleanup?.();

    expect(activeNode.style.opacity).toBe("0.5");
    expect(activeNode.style.getPropertyValue("background-color")).toBe("");
    expect(overlayNode.style.opacity).toBe("");
  });

  it("CSS сериализует transform и transition как dnd-kit", () => {
    expect(CSS.Transform.toString(null)).toBeUndefined();
    expect(CSS.Translate.toString(undefined)).toBeUndefined();
    expect(CSS.Transform.toString({ x: 10, y: -20 })).toBe(
      "translate3d(10px, -20px, 0) scaleX(1) scaleY(1)",
    );
    expect(CSS.Transform.toString({ x: 1, y: 2, scaleX: 2, scaleY: 0.5 })).toBe(
      "translate3d(1px, 2px, 0) scaleX(2) scaleY(0.5)",
    );
    expect(CSS.Translate.toString({ x: 3, y: 4, scaleX: 2 })).toBe(
      "translate3d(3px, 4px, 0)",
    );
    expect(
      CSS.Transition.toString({
        property: "transform",
        duration: 250,
        easing: "ease",
      }),
    ).toBe("transform 250ms ease");
    expect(
      CSS.Transition.toString({
        property: "opacity",
        duration: 100,
        easing: "linear",
        delay: 50,
      }),
    ).toBe("opacity 100ms linear 50ms");
    expect(CSS.Transition.toString(null)).toBeUndefined();
  });

  it("hasSortableData распознаёт форму data.current.sortable", () => {
    expect(
      hasSortableData({
        data: { current: { sortable: { containerId: "list", index: 0 } } },
      }),
    ).toBe(true);
    expect(hasSortableData({ data: { current: { sortable: {} } } })).toBe(false);
    expect(hasSortableData({ data: { current: {} } })).toBe(false);
    expect(hasSortableData({ data: {} })).toBe(false);
    expect(hasSortableData({ data: { current: { sortable: null } } })).toBe(false);
    expect(hasSortableData(null)).toBe(false);
    expect(hasSortableData(undefined)).toBe(false);
  });

  it("defaultNewIndexGetter возвращает позицию после arrayMove", () => {
    const items = ["a", "b", "c"] as const;
    expect(
      defaultNewIndexGetter({ id: "b", items, activeIndex: 2, overIndex: 0 }),
    ).toBe(2);
    expect(
      defaultNewIndexGetter({ id: "a", items, activeIndex: 0, overIndex: 2 }),
    ).toBe(2);
    expect(
      defaultNewIndexGetter({ id: "c", items, activeIndex: 1, overIndex: 1 }),
    ).toBe(2);
  });

  it("defaultAnimateLayoutChanges повторяет эталонные правила", () => {
    const items = ["a", "b", "c"];
    const base = {
      active: null,
      containerId: "list",
      isDragging: false,
      isSorting: false,
      id: "b",
      index: 1,
      items,
      previousItems: items,
      previousContainerId: "list",
      newIndex: 2,
      transition: { duration: 200, easing: "ease" },
      wasDragging: true,
    };

    expect(defaultAnimateLayoutChanges({ ...base, transition: null })).toBe(false);
    expect(defaultAnimateLayoutChanges({ ...base, wasDragging: false })).toBe(false);
    expect(defaultAnimateLayoutChanges({ ...base, isSorting: true })).toBe(true);
    expect(defaultAnimateLayoutChanges(base)).toBe(true);
    expect(defaultAnimateLayoutChanges({ ...base, newIndex: 1 })).toBe(false);
    expect(
      defaultAnimateLayoutChanges({ ...base, containerId: "other" }),
    ).toBe(false);
    expect(
      defaultAnimateLayoutChanges({
        ...base,
        previousItems: ["a", "b", "c"],
        newIndex: 1,
      }),
    ).toBe(false);
  });
});

describe("getScrollableAncestors", () => {
  it("возвращает прокручиваемых предков от ближайшего к документу", () => {
    const outer = document.createElement("div");
    outer.style.overflow = "auto";
    const inner = document.createElement("div");
    inner.style.overflow = "scroll";
    const leaf = document.createElement("span");
    inner.appendChild(leaf);
    outer.appendChild(inner);
    document.body.appendChild(outer);

    const result = getScrollableAncestors(leaf);
    expect(result).toEqual([inner, outer, document.documentElement]);
  });

  it("включает сам узел, если он прокручивается, и не дублирует корень", () => {
    const node = document.createElement("div");
    node.style.overflowY = "auto";
    document.body.appendChild(node);

    expect(getScrollableAncestors(node)).toEqual([
      node,
      document.documentElement,
    ]);
  });

  it("возвращает только корень и безопасен на сервере/null", () => {
    const node = document.createElement("div");
    document.body.appendChild(node);
    expect(getScrollableAncestors(node)).toEqual([document.documentElement]);
    expect(getScrollableAncestors(null)).toEqual([]);
  });
});

describe("sortableKeyboardCoordinates", () => {
  it("в вертикальном списке двигает по центрам соседей", () => {
    const args = getterArgs({
      activeId: "a",
      current: { x: 50, y: 10 },
      rects: [
        ["a", rect(0, 0, 100, 20)],
        ["b", rect(0, 30, 100, 20)],
        ["c", rect(0, 60, 100, 20)],
      ],
      collisionRect: rect(0, 0, 100, 20),
    });

    expect(sortableKeyboardCoordinates(keyEvent("ArrowDown"), args)).toEqual({
      x: 50,
      y: 40,
    });

    const fromC = getterArgs({
      activeId: "c",
      current: { x: 50, y: 70 },
      rects: [
        ["a", rect(0, 0, 100, 20)],
        ["b", rect(0, 30, 100, 20)],
        ["c", rect(0, 60, 100, 20)],
      ],
      collisionRect: rect(0, 60, 100, 20),
    });

    expect(sortableKeyboardCoordinates(keyEvent("ArrowUp"), fromC)).toEqual({
      x: 50,
      y: 40,
    });
  });

  it("Home/End ведут к первому и последнему элементу", () => {
    const args = getterArgs({
      activeId: "b",
      current: { x: 50, y: 40 },
      rects: [
        ["a", rect(0, 0, 100, 20)],
        ["b", rect(0, 30, 100, 20)],
        ["c", rect(0, 60, 100, 20)],
      ],
      collisionRect: rect(0, 30, 100, 20),
    });

    expect(sortableKeyboardCoordinates(keyEvent("Home"), args)).toEqual({
      x: 50,
      y: 10,
    });
    expect(sortableKeyboardCoordinates(keyEvent("End"), args)).toEqual({
      x: 50,
      y: 70,
    });
  });

  it("Home/End на крайнем активном элементе остаются на его позиции", () => {
    const first = getterArgs({
      activeId: "a",
      current: { x: 50, y: 10 },
      rects: [
        ["a", rect(0, 0, 100, 20)],
        ["b", rect(0, 30, 100, 20)],
        ["c", rect(0, 60, 100, 20)],
      ],
      collisionRect: rect(0, 0, 100, 20),
    });

    expect(sortableKeyboardCoordinates(keyEvent("Home"), first)).toEqual({
      x: 50,
      y: 10,
    });

    const last = getterArgs({
      activeId: "c",
      current: { x: 50, y: 70 },
      rects: [
        ["a", rect(0, 0, 100, 20)],
        ["b", rect(0, 30, 100, 20)],
        ["c", rect(0, 60, 100, 20)],
      ],
      collisionRect: rect(0, 60, 100, 20),
    });

    expect(sortableKeyboardCoordinates(keyEvent("End"), last)).toEqual({
      x: 50,
      y: 70,
    });
  });

  it("в 2D-сетке приоритет у основной оси и своей колонки/строки", () => {
    const args = getterArgs({
      activeId: "a",
      current: { x: 50, y: 40 },
      rects: [
        ["a", rect(0, 0, 100, 80)],
        ["b", rect(110, 0, 100, 80)],
        ["c", rect(220, 0, 100, 80)],
        ["d", rect(0, 100, 100, 80)],
        ["e", rect(110, 100, 100, 80)],
        ["f", rect(220, 100, 100, 80)],
      ],
      collisionRect: rect(0, 0, 100, 80),
    });

    expect(sortableKeyboardCoordinates(keyEvent("ArrowDown"), args)).toEqual({
      x: 50,
      y: 140,
    });
    expect(sortableKeyboardCoordinates(keyEvent("ArrowRight"), args)).toEqual({
      x: 160,
      y: 40,
    });
  });

  it("не прыгает на текущий over и устойчив при равных расстояниях", () => {
    const withOver = getterArgs({
      activeId: "a",
      current: { x: 50, y: 10 },
      overId: "b",
      rects: [
        ["a", rect(0, 0, 100, 20)],
        ["b", rect(0, 30, 100, 20)],
        ["c", rect(0, 60, 100, 20)],
      ],
      collisionRect: rect(0, 0, 100, 20),
    });

    expect(
      sortableKeyboardCoordinates(keyEvent("ArrowDown"), withOver),
    ).toEqual({ x: 50, y: 70 });

    const equal = getterArgs({
      activeId: "a",
      current: { x: 50, y: 40 },
      rects: [
        ["a", rect(0, 0, 100, 80)],
        ["right", rect(60, 100, 40, 40)],
        ["left", rect(0, 100, 40, 40)],
      ],
      collisionRect: rect(0, 0, 100, 80),
    });

    expect(sortableKeyboardCoordinates(keyEvent("ArrowDown"), equal)).toEqual({
      x: 80,
      y: 120,
    });
  });

  it("возвращает undefined для не-навигационных клавиш и пустого набора", () => {
    const args = getterArgs({
      activeId: "a",
      current: { x: 50, y: 10 },
      rects: [["a", rect(0, 0, 100, 20)]],
      collisionRect: rect(0, 0, 100, 20),
    });

    expect(sortableKeyboardCoordinates(keyEvent("Enter"), args)).toBeUndefined();
    expect(sortableKeyboardCoordinates(keyEvent("ArrowDown"), args)).toBeUndefined();
  });
});

describe("dropAnimation", () => {
  function Item(): Node {
    const draggable = useDraggable({ id: "item" });
    return (
      <div
        ref={draggable.setNodeRef}
        {...draggable.attributes}
        {...draggable.listeners}
        data-testid="drag-item"
        data-dragging={() => String(draggable.isDragging())}
      />
    );
  }

  function Target(): Node {
    const droppable = useDroppable({ id: "target" });
    return <div ref={droppable.setNodeRef} data-testid="drop-target" />;
  }

  it("интерполирует в rect цели и очищает sideEffects по завершении", () => {
    vi.useFakeTimers();
    let ended = 0;
    const calls: Array<{ active: HTMLElement | null; overlay: HTMLElement | null }> = [];

    function nodeOf(
      value: HTMLElement | { readonly current: HTMLElement | null } | null | undefined,
    ): HTMLElement | null {
      if (value === null || value === undefined) {
        return null;
      }
      return "current" in value ? value.current : value;
    }

    function App(): Node {
      return (
        <DndContext
          collisionDetection={rectIntersection}
          onDragEnd={() => (ended += 1)}
        >
          <Item />
          <Target />
          <DragOverlay
            dropAnimation={{
              duration: 100,
              easing: "linear",
              sideEffects: (args) => {
                calls.push({
                  active: nodeOf(args.activeNode),
                  overlay: nodeOf(args.dragOverlay.node),
                });
                return defaultDropAnimationSideEffects({
                  styles: { active: { opacity: "0" } },
                })(args);
              },
            }}
          >
            <span>overlay</span>
          </DragOverlay>
        </DndContext>
      );
    }

    mount(App);
    const item = byTestId("drag-item");
    const target = byTestId("drop-target");
    stubRect(item, { left: 0, top: 0, width: 20, height: 20 });
    stubRect(target, { left: 60, top: 0, width: 40, height: 40 });

    pointer(item, "pointerdown", 5, 5);
    pointer(document, "pointermove", 75, 10);
    flushSync();
    pointer(document, "pointerup", 75, 10);
    flushSync();

    // Завершение drag не блокируется анимацией.
    expect(ended).toBe(1);
    expect(item.getAttribute("data-dragging")).toBe("false");

    // sideEffects вызваны на старте, стили применены.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.active).toBe(item);
    expect(item.style.opacity).toBe("0");

    const overlay = document.querySelector<HTMLElement>("[data-dnd-overlay]");
    expect(overlay).not.toBeNull();
    expect(overlay?.style.transform).toContain("translate3d(60px, 0px, 0px)");
    expect(overlay?.style.opacity).toBe("0");

    vi.advanceTimersByTime(100);
    flushSync();

    expect(document.querySelector("[data-dnd-overlay]")).toBeNull();
    expect(item.style.opacity).toBe("");
  });

  it("dropAnimation=null убирает оверлей без задержки", () => {
    vi.useFakeTimers();

    function App(): Node {
      return (
        <DndContext>
          <Item />
          <DragOverlay dropAnimation={null}>
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

    expect(document.querySelector("[data-dnd-overlay]")).toBeNull();
  });

  it("dropAnimation-функция получает active/over и задаёт длительность", () => {
    vi.useFakeTimers();
    const seen: Array<{ active: string; over: string | null }> = [];

    function App(): Node {
      return (
        <DndContext collisionDetection={rectIntersection}>
          <Item />
          <Target />
          <DragOverlay
            dropAnimation={({ active, over }) => {
              seen.push({
                active: String(active.id),
                over: over === null ? null : String(over.id),
              });
              return { duration: 50, easing: "ease" };
            }}
          >
            <span>overlay</span>
          </DragOverlay>
        </DndContext>
      );
    }

    mount(App);
    const item = byTestId("drag-item");
    const target = byTestId("drop-target");
    stubRect(item, { left: 0, top: 0, width: 20, height: 20 });
    stubRect(target, { left: 60, top: 0, width: 40, height: 40 });

    pointer(item, "pointerdown", 5, 5);
    pointer(document, "pointermove", 75, 10);
    flushSync();
    pointer(document, "pointerup", 75, 10);
    flushSync();

    expect(seen).toEqual([{ active: "item", over: "target" }]);
    expect(document.querySelector("[data-dnd-overlay]")).not.toBeNull();

    vi.advanceTimersByTime(50);
    flushSync();
    expect(document.querySelector("[data-dnd-overlay]")).toBeNull();
  });

  it("при поддержке Web Animations API анимирует от текущего transform к цели", () => {
    vi.useFakeTimers();
    const animate = vi.fn(() => ({
      cancel: vi.fn(),
    }));
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "animate",
    );
    Object.defineProperty(HTMLElement.prototype, "animate", {
      configurable: true,
      writable: true,
      value: animate,
    });

    try {
      function App(): Node {
        return (
          <DndContext collisionDetection={rectIntersection}>
            <Item />
            <Target />
            <DragOverlay dropAnimation={{ duration: 120, easing: "ease-in" }}>
              <span>overlay</span>
            </DragOverlay>
          </DndContext>
        );
      }

      mount(App);
      const item = byTestId("drag-item");
      const target = byTestId("drop-target");
      stubRect(item, { left: 0, top: 0, width: 20, height: 20 });
      stubRect(target, { left: 60, top: 0, width: 40, height: 40 });

      pointer(item, "pointerdown", 5, 5);
      pointer(document, "pointermove", 75, 10);
      flushSync();
      pointer(document, "pointerup", 75, 10);
      flushSync();

      expect(animate).toHaveBeenCalledTimes(1);
      const call = animate.mock.calls[0] as unknown as [
        Array<{ transform: string; opacity: string }>,
        { duration: number; easing: string; fill: string },
      ];
      const [keyframes, options] = call;
      expect(keyframes[0]?.transform).toContain("translate3d(70px, 5px, 0)");
      expect(keyframes[1]?.transform).toContain("translate3d(60px, 0px, 0)");
      expect(options).toEqual({
        duration: 120,
        easing: "ease-in",
        fill: "forwards",
      });
      expect(
        document.querySelector<HTMLElement>("[data-dnd-overlay]")?.style.transition,
      ).toBe("none");

      vi.advanceTimersByTime(120);
      flushSync();
      expect(document.querySelector("[data-dnd-overlay]")).toBeNull();
    } finally {
      if (descriptor === undefined) {
        Reflect.deleteProperty(HTMLElement.prototype, "animate");
      } else {
        Object.defineProperty(HTMLElement.prototype, "animate", descriptor);
      }
    }
  });
});
