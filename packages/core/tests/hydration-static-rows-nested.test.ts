// @vitest-environment jsdom
import {
  createRoot,
  createSignal,
  deepReactive,
  flushSync,
} from "@ivlev-dev/silent-reactivity";
import { afterEach, describe, expect, it } from "vitest";
import { For } from "../src/control-flow.js";
import {
  insert,
  setServerMode,
  templateHoles,
  type TemplateClone,
  type TemplatePlan,
} from "../src/dom.js";
import { createComponent, whenIdle } from "../src/component.js";
import { hydrate } from "../src/hydrate.js";
import type { AnyComponent } from "../src/types.js";

const LIST_HTML = "<ul><!--silent-hole-0--></ul>";
const LIST_PLAN: TemplatePlan = {
  roots: 1,
  holes: [{ path: [0, 0], counts: [1, 1], key: "silent-hole-0" }],
  attrs: [],
  strips: [],
};

const ROW_HTML = "<li><!--silent-hole-0--></li>";
const ROW_PLAN: TemplatePlan = {
  roots: 1,
  holes: [{ path: [0, 0], counts: [1, 1], key: "silent-hole-0" }],
  attrs: [],
  strips: [],
};

function holeOf(clone: TemplateClone): Comment {
  const hole = clone.holes[0];
  if (hole === undefined || !(hole instanceof Comment)) {
    throw new Error("не найдена дыра шаблона");
  }
  return hole;
}

function parentOf(clone: TemplateClone, hole: Comment): Node {
  return hole.parentNode ?? clone.node;
}

async function renderServer(
  app: AnyComponent,
  props: Record<string, unknown> = {},
): Promise<string> {
  setServerMode(true);
  try {
    let result: ReturnType<typeof createComponent> | null = null;
    createRoot(() => {
      result = createComponent(app, props);
      return null;
    });
    const created = result as ReturnType<typeof createComponent> | null;
    if (created === null) {
      throw new Error("компонент не создан");
    }
    await created.ready;
    await whenIdle();
    flushSync();
    await whenIdle();
    flushSync();
    const container = document.createElement("div");
    container.appendChild(created.node);
    const html = container.innerHTML;
    created.dispose();
    return html;
  } finally {
    setServerMode(false);
  }
}

const hosts: HTMLElement[] = [];
const handles: { dispose(): void }[] = [];

afterEach(() => {
  for (const handle of handles.splice(0)) {
    handle.dispose();
  }
  for (const host of hosts.splice(0)) {
    host.remove();
  }
  document.body.replaceChildren();
});

function host(html: string): HTMLElement {
  const element = document.createElement("div");
  element.innerHTML = html;
  document.body.appendChild(element);
  hosts.push(element);
  return element;
}

interface Row {
  readonly id: string;
  readonly child: unknown;
}

function rowApp(items: () => readonly Row[], text: (row: Row) => unknown): AnyComponent {
  function App(): Node {
    const clone = templateHoles(LIST_HTML, LIST_PLAN)();
    const hole = holeOf(clone);
    insert(
      parentOf(clone, hole),
      () =>
        For({
          each: items,
          keyOf: (row: Row) => row.id,
          staticRows: true,
          children: (row: Row) => {
            const rowClone = templateHoles(ROW_HTML, ROW_PLAN)();
            const rowHole = holeOf(rowClone);
            insert(parentOf(rowClone, rowHole), () => text(row), rowHole);
            return rowClone.node;
          },
        }),
      hole,
    );
    return clone.node;
  }
  return App as unknown as AnyComponent;
}

describe("staticRows и вложенная реактивность", () => {
  it("вложенный сигнал обновляет строку без пересоздания For", async () => {
    const [value, setValue] = createSignal("one");
    const row: Row = { id: "0", child: deepReactive({ read: value }) };
    const items = (): readonly Row[] => [row];
    const app = rowApp(items, (current) => {
      const child = current.child as { readonly read: () => string };
      return child.read();
    });
    const html = await renderServer(app);
    const target = host(html);
    const mismatches: string[] = [];
    const handle = await hydrate(target, app, {
      onMismatch: (error) => mismatches.push(error.message),
    });
    handles.push(handle);

    expect(mismatches).toEqual([]);
    expect(target.textContent).toBe("one");

    setValue("two");
    flushSync();
    expect(target.textContent).toBe("two");
    expect(target.querySelectorAll("li").length).toBe(1);
  });

  it("не падает на revoked proxy в строке", async () => {
    const revocable = Proxy.revocable({}, {});
    revocable.revoke();
    const row: Row = { id: "safe", child: revocable.proxy };
    const app = rowApp(
      () => [row],
      (current) => current.id,
    );
    const html = await renderServer(app);
    const target = host(html);
    const mismatches: string[] = [];
    const handle = await hydrate(target, app, {
      onMismatch: (error) => mismatches.push(error.message),
    });
    handles.push(handle);

    expect(mismatches).toEqual([]);
    expect(target.textContent).toBe("safe");
    expect(target.querySelectorAll("li").length).toBe(1);
  });
});
