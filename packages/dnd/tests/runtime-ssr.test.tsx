// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  createComponent,
  flushSync,
  hydrate,
  type AnyComponent,
} from "@ivlev-dev/silent-core";
import { renderToString } from "@ivlev-dev/silent-server";
import {
  DndContext,
  DragOverlay,
  SortableContext,
  useDraggable,
  useSortable,
  verticalListSortingStrategy,
} from "../src/index.js";

const handles: Array<{ dispose(): void }> = [];

afterEach(() => {
  for (const handle of handles.splice(0)) handle.dispose();
  document.body.replaceChildren();
});

function Draggable(): Node {
  const draggable = useDraggable({ id: "item" });
  return (
    <div
      ref={draggable.setNodeRef}
      {...draggable.attributes}
      {...draggable.listeners}
      data-testid="server-item"
    />
  );
}

function Sortable(): Node {
  const sortable = useSortable({ id: "a" });
  return (
    <div
      ref={sortable.setNodeRef}
      {...sortable.attributes}
      {...sortable.listeners}
      data-testid="server-sortable"
    />
  );
}

function Page(): Node {
  return (
    <DndContext id="server-dnd">
      <SortableContext items={["a"]} strategy={verticalListSortingStrategy}>
        <Sortable />
      </SortableContext>
      <Draggable />
      <DragOverlay>
        <span data-testid="server-overlay">overlay</span>
      </DragOverlay>
    </DndContext>
  );
}

describe("SSR и гидрация", () => {
  it("серверная разметка без overlay, обработчиков и с пустым live-region", async () => {
    const { html } = await renderToString(Page);
    expect(html).toContain('id="server-dnd-announcements"');
    expect(html).toContain('id="server-dnd-instructions"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="assertive"');
    expect(html).toContain('aria-describedby="server-dnd-instructions"');
    expect(html).not.toContain("server-overlay");
    expect(html).not.toContain("data-dnd-overlay");
    expect(html.toLowerCase()).not.toContain("onpointerdown");
    expect(html.toLowerCase()).not.toContain("onkeydown");
  });

  it("гидрация проходит без mismatch и сохраняет id/атрибуты", async () => {
    const { html } = await renderToString(Page);
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);

    const mismatches: string[] = [];
    const handle = await hydrate(container, Page, {
      onMismatch: (error) => {
        mismatches.push(error.message);
      },
    });
    handles.push(handle);
    flushSync();

    expect(mismatches).toEqual([]);
    const item = container.querySelector<HTMLElement>('[data-testid="server-item"]');
    expect(item?.getAttribute("aria-describedby")).toBe("server-dnd-instructions");
    expect(item?.getAttribute("role")).toBe("button");
    expect(container.querySelector("[data-dnd-overlay]")).toBeNull();
  });

  it("клиентский рендер не создаёт глобальных слушателей до drag", () => {
    const result: { dispose(): void; node: Node } = createComponent(
      Page as AnyComponent,
      {},
    );
    handles.push(result);
    document.body.appendChild(result.node);
    flushSync();
    expect(document.querySelector("[data-dnd-overlay]")).toBeNull();
  });
});
