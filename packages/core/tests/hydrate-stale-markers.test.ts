import { afterEach, describe, expect, it } from "vitest";
import { createRoot, flushSync } from "@ivlev-dev/silent-reactivity";
import { createComponent, whenIdle as waitIdle } from "../src/component.js";
import {
  attr,
  insert,
  setServerMode,
  templateHoles,
  type TemplatePlan,
} from "../src/dom.js";
import { hydrate } from "../src/hydrate.js";
import type { HydrationMismatchError } from "../src/hydration.js";
import type { MountHandle } from "../src/mount.js";
import type { AnyComponent } from "../src/types.js";

const VIEW = Symbol.for("silent.view");
const hosts: HTMLElement[] = [];
const handles: MountHandle[] = [];

const TEMPLATE = '<button class="btn" data-silent-a-0="">click</button>';
const PLAN: TemplatePlan = {
  roots: 1,
  holes: [],
  attrs: [{ path: [0], counts: [1] }],
  strips: [{ path: [0], counts: [1], names: ["data-silent-a-0"] }],
};

class MarkerVM {}
function MarkerView(this: { vm: MarkerVM }): Node {
  void this.vm;
  const template = templateHoles(TEMPLATE, PLAN)();
  attr(template.attrs[0]!, "title", () => "hint");
  return template.node;
}
attachMeta(MarkerView, MarkerVM);

function attachMeta(target: unknown, vm: unknown): void {
  (target as Record<PropertyKey, unknown>)[VIEW] = { vm, name: "Markers" };
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
      throw new Error("компонент не создан");
    }
    await result.ready;
    await waitIdle();
    flushSync();
    await waitIdle();
    flushSync();
    const container = document.createElement("div");
    container.appendChild(result.node);
    const html = container.innerHTML;
    result.dispose();
    return html;
  } finally {
    setServerMode(false);
  }
}

function host(markup = ""): HTMLElement {
  const element = document.createElement("div");
  element.innerHTML = markup;
  document.body.appendChild(element);
  hosts.push(element);
  return element;
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

describe("лишние серверные маркеры", () => {
  it("снимает маркеры, которых нет в клиентском плане", async () => {
    const serverHtml = await renderServer(MarkerView as unknown as AnyComponent);
    expect(serverHtml).toContain("data-silent-a-0");
    const staleHtml = serverHtml.replace(
      'data-silent-a-0=""',
      'data-silent-a-0="" data-silent-a-1="" data-silent-text=""',
    );
    expect(staleHtml).toContain("data-silent-a-1");

    const target = host(staleHtml);
    const serverButton = target.querySelector("button.btn");
    const mismatches: HydrationMismatchError[] = [];
    const handle = await hydrate(target, MarkerView as unknown as AnyComponent, {
      onMismatch: (error) => mismatches.push(error),
    });
    handles.push(handle);

    expect(mismatches).toEqual([]);
    expect(target.querySelector("button.btn")).toBe(serverButton);
    expect(target.innerHTML.includes("data-silent-a-")).toBe(false);
    expect(target.innerHTML.includes("data-silent-text")).toBe(false);
    expect(serverButton?.getAttribute("title")).toBe("hint");
  });
});
