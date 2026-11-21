// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushSync } from "@ivlev-dev/silent-reactivity";
import { Portal } from "../src/portal";
import { mount } from "../src/mount";
import { hydrate } from "../src/hydrate";
import type { AnyComponent } from "../src/types";

const VIEW = Symbol.for("silent.view");

function host(markup = ""): HTMLElement {
  const element = document.createElement("div");
  element.innerHTML = markup;
  document.body.appendChild(element);
  return element;
}

function label(text: string): HTMLElement {
  const span = document.createElement("span");
  span.textContent = text;
  return span;
}

function asComponent(fn: () => unknown): AnyComponent {
  return fn as unknown as AnyComponent;
}

async function tick(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("Portal: ожидание target", () => {
  it("завершает mount без target и не крутит очередь", async () => {
    const reads = { count: 0 };
    const target = host();
    const handle = await mount(target, asComponent(() => {
      // Маркер не попадает в разметку: портал обязан ждать без прокрутки
      // microtask-очереди.
      Portal({
        target: () => {
          reads.count += 1;
          return null;
        },
        children: () => label("portal"),
      });
      return document.createElement("div");
    }));
    await tick();
    expect(reads.count).toBeLessThan(50);
    expect(target.textContent).toBe("");
    handle.dispose();
  });

  it("завершает гидрацию без target", async () => {
    class VM {}
    function View(this: { vm: VM }): Node {
      return Portal({ target: "#missing-target", children: label("hydrated") });
    }
    (View as Record<PropertyKey, unknown>)[VIEW] = { vm: VM, name: "Test" };
    const target = host(
      "<!--silent-view--><!--silent-portal--><!--silent-view-end-->",
    );
    const mismatches: unknown[] = [];
    const handle = await hydrate(target, View as unknown as AnyComponent, {
      onMismatch: (error) => mismatches.push(error),
    });
    await tick();
    expect(mismatches).toEqual([]);
    expect(target.textContent).toBe("hydrated");
    handle.dispose();
  });

  it("переносит контент в target, появившийся позже", async () => {
    const content = label("portal");
    const target = host();
    const handle = await mount(target, asComponent(() => {
      const root = document.createElement("div");
      root.appendChild(Portal({ target: "#late-target", children: content }));
      return root;
    }));
    const span = target.querySelector("span");
    expect(span).not.toBeNull();

    const late = document.createElement("section");
    late.id = "late-target";
    document.body.appendChild(late);
    await tick();
    flushSync();

    expect(late.querySelector("span")).toBe(span);
    expect(target.querySelector("span")).toBeNull();
    handle.dispose();
  });

  it("рендерит контент, когда маркер подключают позже", async () => {
    let marker: Node | null = null;
    const target = host();
    const handle = await mount(target, asComponent(() => {
      const root = document.createElement("div");
      marker = Portal({ target: "#none-target", children: () => label("portal") });
      return root;
    }));
    expect(target.querySelector("span")).toBeNull();
    expect(marker).not.toBeNull();

    document.body.appendChild(marker as Node);
    await tick();
    flushSync();

    expect(document.body.querySelector("span")?.textContent).toBe("portal");
    handle.dispose();
  });

  it("отключает observer после переноса контента в target", async () => {
    const disconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
    let reads = 0;
    const content = label("portal");
    const target = host();
    const handle = await mount(target, asComponent(() => {
      const root = document.createElement("div");
      root.appendChild(
        Portal({
          target: () => {
            reads += 1;
            return document.getElementById("late-target");
          },
          children: content,
        }),
      );
      return root;
    }));
    disconnect.mockClear();

    const late = document.createElement("section");
    late.id = "late-target";
    document.body.appendChild(late);
    await tick();
    flushSync();

    expect(late.contains(content)).toBe(true);
    expect(disconnect).toHaveBeenCalled();

    const afterMove = reads;
    document.body.appendChild(document.createElement("i"));
    await tick();
    flushSync();
    expect(reads).toBe(afterMove);
    handle.dispose();
  });

  it("снимает наблюдение при dispose до появления target", async () => {
    const disconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
    const target = host();
    const handle = await mount(target, asComponent(() => {
      const root = document.createElement("div");
      root.appendChild(
        Portal({ target: "#late-target", children: () => label("portal") }),
      );
      return root;
    }));
    disconnect.mockClear();
    handle.dispose();
    expect(disconnect).toHaveBeenCalled();

    const late = document.createElement("section");
    late.id = "late-target";
    document.body.appendChild(late);
    await tick();
    flushSync();
    expect(late.childNodes.length).toBe(0);
    expect(target.textContent).toBe("");
  });
});
