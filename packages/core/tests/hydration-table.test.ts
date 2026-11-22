import { afterEach, describe, expect, it } from "vitest";
import { createRoot, createSignal, flushSync } from "@ivlev-dev/silent-reactivity";
import { For } from "../src/control-flow.js";
import {
  insert,
  setServerMode,
  templateHoles,
  type TemplateClone,
} from "../src/dom.js";
import { createComponent, whenIdle } from "../src/component.js";
import { hydrate } from "../src/hydrate.js";
import { HydrationMismatchError } from "../src/hydration.js";
import type { MountHandle } from "../src/mount.js";
import type { AnyComponent } from "../src/types.js";

const hosts: HTMLElement[] = [];
const handles: MountHandle[] = [];

function host(markup = ""): HTMLElement {
  const element = document.createElement("div");
  element.innerHTML = markup;
  document.body.appendChild(element);
  hosts.push(element);
  return element;
}

function holeParent(template: TemplateClone, index: number): Node {
  const hole = template.holes[index];
  return (hole?.parentNode as Node | undefined) ?? template.node;
}

async function renderServer(app: AnyComponent): Promise<string> {
  setServerMode(true);
  try {
    let result: ReturnType<typeof createComponent> | null = null;
    createRoot(() => {
      result = createComponent(app, {});
      return null;
    });
    if (result === null) {
      throw new Error("component was not created");
    }
    const created = result as ReturnType<typeof createComponent>;
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

afterEach(() => {
  for (const handle of handles.splice(0)) {
    handle.dispose();
  }
  for (const element of hosts.splice(0)) {
    element.remove();
  }
  document.body.replaceChildren();
});

const rows = createSignal(["a", "b"]);

function TableView(): Node {
  const template = templateHoles('<table class="grid"><!--silent-hole-0--></table>')();
  insert(
    holeParent(template, 0),
    () =>
      For({
        each: rows[0],
        children: (value: string) => {
          const row = templateHoles("<tr><!--silent-hole-0--></tr>")();
          insert(holeParent(row, 0), () => value, row.holes[0]);
          return row.node;
        },
      }),
    template.holes[0],
  );
  return template.node;
}

describe("гидрация таблицы", () => {
  it("не теряет строки, если парсер добавил tbody вокруг динамических строк", async () => {
    rows[1](["a", "b"]);
    const html = await renderServer(TableView as unknown as AnyComponent);
    expect(html).toContain("<table");

    const target = host(html);
    const mismatches: HydrationMismatchError[] = [];
    const handle = await hydrate(target, TableView as unknown as AnyComponent, {
      onMismatch: (error) => mismatches.push(error),
    });
    handles.push(handle);

    expect(mismatches.length).toBeLessThanOrEqual(1);
    expect(target.textContent).toBe("ab");
    expect(target.querySelectorAll("table").length).toBe(1);
    expect(target.querySelectorAll("tr").length).toBe(2);

    rows[1](["a", "b", "c"]);
    flushSync();
    expect(target.querySelectorAll("tr").length).toBe(3);
    expect(target.textContent).toBe("abc");
  });
});
