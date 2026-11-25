import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createComponent,
  flushSync,
  type AnyComponent,
} from "@ivlev-dev/silent-core";
import {
  DndContext,
  MeasuringStrategy,
  MouseSensor,
  TouchSensor,
  rectIntersection,
  restrictToVerticalAxis,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "../src/index.js";

interface Handle {
  readonly node: Node;
  dispose(): void;
}

const handles: Handle[] = [];

function mount(component: AnyComponent): Handle {
  const result = createComponent(component, {});
  document.body.appendChild(result.node);
  handles.push(result);
  flushSync();
  return result;
}

afterEach(() => {
  for (const handle of handles.splice(0)) handle.dispose();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function stubRect(element: Element, getRect: () => Rect): void {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => {
      const rect = getRect();
      return {
        ...rect,
        x: rect.left,
        y: rect.top,
        right: rect.left + rect.width,
        bottom: rect.top + rect.height,
        toJSON() {
          return rect;
        },
      };
    },
  });
}

function byTestId(id: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  if (element === null) {
    throw new Error(`не найден [data-testid="${id}"]`);
  }
  return element;
}

function mouse(target: EventTarget, type: string, x: number, y: number): void {
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

interface TouchLikeEvent extends Event {
  touches?: Array<{ clientX: number; clientY: number }>;
  changedTouches?: Array<{ clientX: number; clientY: number }>;
}

function touch(
  target: EventTarget,
  type: string,
  x: number,
  y: number,
): void {
  const event = new Event(type, { bubbles: true, cancelable: true }) as TouchLikeEvent;
  const point = { clientX: x, clientY: y };
  if (type === "touchend" || type === "touchcancel") {
    event.touches = [];
    event.changedTouches = [point];
  } else {
    event.touches = [point];
    event.changedTouches = [point];
  }
  target.dispatchEvent(event);
}

function Item(props: { readonly id: string }): Node {
  const draggable = useDraggable({ id: props.id });
  return (
    <div
      ref={draggable.setNodeRef}
      {...draggable.attributes}
      {...draggable.listeners}
      data-testid={`drag-${props.id}`}
      data-transform={() => JSON.stringify(draggable.transform())}
    />
  );
}

function Target(props: { readonly id: string }): Node {
  const droppable = useDroppable({ id: props.id });
  return (
    <div
      ref={droppable.setNodeRef}
      data-testid={`drop-${props.id}`}
      data-over={() => String(droppable.isOver())}
    />
  );
}

describe("MouseSensor", () => {
  it("активируется мышью и завершается mouseup", () => {
    const events: string[] = [];

    function App(): Node {
      const sensors = useSensors(useSensor(MouseSensor));
      return (
        <DndContext
          sensors={sensors}
          onDragStart={() => events.push("start")}
          onDragEnd={() => events.push("end")}
        >
          <Item id="item" />
        </DndContext>
      );
    }

    mount(App);
    const item = byTestId("drag-item");
    stubRect(item, () => ({ left: 0, top: 0, width: 20, height: 20 }));

    mouse(item, "mousedown", 5, 5);
    flushSync();
    expect(events).toEqual(["start"]);

    mouse(document, "mousemove", 40, 40);
    flushSync();
    expect(JSON.parse(item.getAttribute("data-transform") ?? "null")).toEqual({
      x: 35,
      y: 35,
    });

    mouse(document, "mouseup", 40, 40);
    flushSync();
    expect(events).toEqual(["start", "end"]);
  });
});

describe("TouchSensor", () => {
  it("по умолчанию ждёт 250 мс и отменяется при сдвиге больше допуска", () => {
    vi.useFakeTimers();
    const states: string[] = [];

    function App(): Node {
      const sensors = useSensors(useSensor(TouchSensor));
      return (
        <DndContext
          sensors={sensors}
          onDragPending={() => states.push("pending")}
          onDragAbort={() => states.push("abort")}
          onDragStart={() => states.push("start")}
        >
          <Item id="item" />
        </DndContext>
      );
    }

    mount(App);
    const item = byTestId("drag-item");
    stubRect(item, () => ({ left: 0, top: 0, width: 20, height: 20 }));

    touch(item, "touchstart", 5, 5);
    flushSync();
    expect(states).toEqual(["pending"]);

    touch(document, "touchmove", 30, 5);
    flushSync();
    expect(states).toEqual(["pending", "abort"]);

    vi.advanceTimersByTime(250);
    flushSync();
    expect(states).toEqual(["pending", "abort"]);
  });

  it("удержание 250 мс запускает drag", () => {
    vi.useFakeTimers();
    const events: string[] = [];

    function App(): Node {
      const sensors = useSensors(useSensor(TouchSensor));
      return (
        <DndContext
          sensors={sensors}
          onDragStart={() => events.push("start")}
          onDragEnd={() => events.push("end")}
        >
          <Item id="item" />
        </DndContext>
      );
    }

    mount(App);
    const item = byTestId("drag-item");
    stubRect(item, () => ({ left: 0, top: 0, width: 20, height: 20 }));

    touch(item, "touchstart", 5, 5);
    flushSync();
    expect(events).toEqual([]);
    vi.advanceTimersByTime(250);
    flushSync();
    expect(events).toEqual(["start"]);

    touch(document, "touchend", 5, 5);
    flushSync();
    expect(events).toEqual(["start", "end"]);
  });
});

describe("ожидание активации", () => {
  it("pointerup до порога даёт pending+abort и не стартует drag", () => {
    const states: string[] = [];

    function App(): Node {
      const sensors = useSensors(
        useSensor(MouseSensor, { activationConstraint: { distance: 20 } }),
      );
      return (
        <DndContext
          sensors={sensors}
          onDragPending={() => states.push("pending")}
          onDragAbort={() => states.push("abort")}
          onDragStart={() => states.push("start")}
        >
          <Item id="item" />
        </DndContext>
      );
    }

    mount(App);
    const item = byTestId("drag-item");
    stubRect(item, () => ({ left: 0, top: 0, width: 20, height: 20 }));

    mouse(item, "mousedown", 5, 5);
    mouse(document, "mousemove", 10, 5);
    mouse(document, "mouseup", 10, 5);
    flushSync();

    expect(states).toEqual(["pending", "abort"]);
  });
});

describe("модификаторы", () => {
  it("restrictToVerticalAxis обнуляет x", () => {
    function App(): Node {
      const sensors = useSensors(useSensor(MouseSensor));
      return (
        <DndContext sensors={sensors} modifiers={[restrictToVerticalAxis]}>
          <Item id="item" />
        </DndContext>
      );
    }

    mount(App);
    const item = byTestId("drag-item");
    stubRect(item, () => ({ left: 0, top: 0, width: 20, height: 20 }));

    mouse(item, "mousedown", 5, 5);
    mouse(document, "mousemove", 80, 45);
    flushSync();

    expect(JSON.parse(item.getAttribute("data-transform") ?? "null")).toEqual({
      x: 0,
      y: 40,
    });
  });
});

describe("измерения", () => {
  function App(props: { readonly strategy: "always" | "beforeDragging" }): Node {
    const sensors = useSensors(useSensor(MouseSensor));
    return (
      <DndContext
        sensors={sensors}
        collisionDetection={rectIntersection}
        measuring={{
          droppable: { strategy: props.strategy === "always" ? MeasuringStrategy.Always : MeasuringStrategy.BeforeDragging },
        }}
      >
        <Item id="item" />
        <Target id="target" />
      </DndContext>
    );
  }

  it("BeforeDragging не пересчитывает rect после старта", () => {
    mount(() => <App strategy="beforeDragging" />);
    const item = byTestId("drag-item");
    const target = byTestId("drop-target");
    let targetRect: Rect = { left: 200, top: 200, width: 20, height: 20 };
    stubRect(item, () => ({ left: 0, top: 0, width: 20, height: 20 }));
    stubRect(target, () => targetRect);

    mouse(item, "mousedown", 5, 5);
    flushSync();
    targetRect = { left: 0, top: 0, width: 80, height: 80 };
    mouse(document, "mousemove", 40, 40);
    flushSync();
    expect(target.getAttribute("data-over")).toBe("false");
  });

  it("Always пересчитывает rect во время drag", () => {
    mount(() => <App strategy="always" />);
    const item = byTestId("drag-item");
    const target = byTestId("drop-target");
    let targetRect: Rect = { left: 200, top: 200, width: 20, height: 20 };
    stubRect(item, () => ({ left: 0, top: 0, width: 20, height: 20 }));
    stubRect(target, () => targetRect);

    mouse(item, "mousedown", 5, 5);
    flushSync();
    targetRect = { left: 0, top: 0, width: 80, height: 80 };
    mouse(document, "mousemove", 40, 40);
    flushSync();
    expect(target.getAttribute("data-over")).toBe("true");
  });
});
