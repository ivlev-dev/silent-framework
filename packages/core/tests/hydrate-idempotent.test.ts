import { afterEach, describe, expect, it } from "vitest";
import { createRoot, createSignal, flushSync } from "@ivlev-dev/silent-reactivity";
import {
  attr,
  insert,
  setServerMode,
  templateHoles,
  type TemplatePlan,
  type TemplateClone,
} from "../src/dom.js";
import { createComponent, whenIdle as waitIdle } from "../src/component.js";
import { hydrate } from "../src/hydrate.js";
import type { HydrationMismatchError } from "../src/hydration.js";
import type { MountHandle } from "../src/mount.js";
import type { AnyComponent } from "../src/types.js";

const VIEW = Symbol.for("silent.view");
const hosts: HTMLElement[] = [];
const handles: MountHandle[] = [];

const TEMPLATE =
  '<p class="value" data-silent-a-0=""><!--silent-hole-0--></p>';
const PLAN: TemplatePlan = {
  roots: 1,
  holes: [{ path: [0, 1], counts: [1, 2] }],
  attrs: [{ path: [0], counts: [1] }],
  strips: [{ path: [0], counts: [1], names: ["data-silent-a-0"] }],
};

function host(markup = ""): HTMLElement {
  const element = document.createElement("div");
  element.innerHTML = markup;
  document.body.appendChild(element);
  hosts.push(element);
  return element;
}

function attachMeta(target: unknown, vm: unknown): void {
  (target as Record<PropertyKey, unknown>)[VIEW] = { vm, name: "Idempotent" };
}

function holeParent(template: TemplateClone, index: number): Node {
  return (template.holes[index]?.parentNode as Node | undefined) ?? template.node;
}

const value = createSignal("hydrated");
let runs = 0;

class IdempotentVM {}

function IdempotentView(this: { vm: IdempotentVM }): Node {
  void this.vm;
  const template = templateHoles(TEMPLATE, PLAN)();
  attr(template.attrs[0]!, "title", () => "hint");
  insert(
    holeParent(template, 0),
    () => {
      runs += 1;
      return value[0]();
    },
    template.holes[0]!,
  );
  return template.node;
}
attachMeta(IdempotentView, IdempotentVM);

async function renderServer(app: AnyComponent): Promise<string> {
  setServerMode(true);
  try {
    const slot: { result: ReturnType<typeof createComponent> | null } = { result: null };
    createRoot(() => {
      slot.result = createComponent(app, {});
      return null;
    });
    const result = slot.result;
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

afterEach(() => {
  for (const handle of handles.splice(0)) {
    handle.dispose();
  }
  for (const element of hosts.splice(0)) {
    element.remove();
  }
  document.body.replaceChildren();
});

describe("идемпотентная гидрация", () => {
  it("повторный hydrate возвращает рабочий handle и не перерендеривает остров", async () => {
    value[1]("hydrated");
    runs = 0;
    const target = host(await renderServer(IdempotentView as unknown as AnyComponent));
    const serverParagraph = target.querySelector("p.value");
    const mismatches: HydrationMismatchError[] = [];
    const first = await hydrate(target, IdempotentView as unknown as AnyComponent, {
      onMismatch: (error) => mismatches.push(error),
    });
    handles.push(first);

    expect(mismatches).toEqual([]);
    expect(target.querySelector("p.value")).toBe(serverParagraph);

    runs = 0;
    const second = await hydrate(target, IdempotentView as unknown as AnyComponent, {
      onMismatch: (error) => mismatches.push(error),
    });
    handles.push(second);

    // Второй вызов не должен ни гидрировать заново, ни создавать второй эффект.
    expect(mismatches).toEqual([]);
    expect(runs).toBe(0);
    expect(target.querySelector("p.value")).toBe(serverParagraph);
    expect(second).not.toBe(first);

    value[1]("updated");
    flushSync();
    expect(runs).toBe(1);
    expect(target.querySelector("p.value")?.textContent).toBe("updated");

    // dispose первого handle не должен гасить общий корень.
    first.dispose();
    value[1]("after-dispose");
    flushSync();
    expect(target.querySelector("p.value")?.textContent).toBe("after-dispose");
    expect(target.querySelector("p.value")).toBe(serverParagraph);

    second.dispose();
    expect(target.textContent).toBe("");
  });

  it("не повторяет mismatch и полный перерендер после фолбэка", async () => {
    value[1]("hydrated");
    runs = 0;
    const target = host(
      '<!--silent-view--><span class="stale">old</span><!--silent-view-end-->',
    );
    const mismatches: HydrationMismatchError[] = [];

    const first = await hydrate(target, IdempotentView as unknown as AnyComponent, {
      onMismatch: (error) => mismatches.push(error),
    });
    handles.push(first);

    expect(mismatches.length).toBe(1);
    const rendered = target.querySelector("p.value");
    expect(rendered?.textContent).toBe("hydrated");

    const second = await hydrate(target, IdempotentView as unknown as AnyComponent, {
      onMismatch: (error) => mismatches.push(error),
    });
    handles.push(second);

    // Повторный вызов не должен ни снова сообщать о mismatch, ни перерисовывать.
    expect(mismatches.length).toBe(1);
    expect(target.querySelector("p.value")).toBe(rendered);
    expect(target.textContent).toBe("hydrated");
  });
});
