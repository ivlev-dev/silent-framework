// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { hydrate } from "../src/hydrate";
import { createSignal, flushSync } from "@ivlev-dev/silent-reactivity";
import { Portal } from "../src/portal";
import { insert, templateHoles, type TemplatePlan } from "../src/dom";
import { Transition } from "../src/transition";
import type { AnyComponent } from "../src/types";

const VIEW = Symbol.for("silent.view");
const hosts: HTMLElement[] = [];
function host(markup: string): HTMLElement {
  const element = document.createElement("div");
  element.innerHTML = markup;
  document.body.appendChild(element);
  hosts.push(element);
  return element;
}
function attachMeta(component: unknown, vm: unknown): void {
  (component as Record<PropertyKey, unknown>)[VIEW] = { vm, name: "Test" };
}
afterEach(() => {
  for (const element of hosts.splice(0)) element.remove();
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe("hydration", () => {
  it("Portal claims marker", async () => {
    const portalTarget = host("");
    const content = document.createElement("span");
    content.textContent = "portal";
    class VM {}
    function View(this: { vm: VM }): Node {
      return Portal({ target: portalTarget, children: content });
    }
    attachMeta(View, VM);
    const target = host("<!--silent-view--><!--silent-portal--><!--silent-view-end-->");
    const mismatches: unknown[] = [];
    await hydrate(target, View as unknown as AnyComponent, {
      onMismatch: (error) => mismatches.push(error),
    });
    expect(mismatches).toEqual([]);
    expect(portalTarget.contains(content)).toBe(true);
  });

  it("Transition adopts server DOM", async () => {
    vi.useFakeTimers();
    const plan: TemplatePlan = { roots: 1, holes: [], attrs: [], strips: [] };
    const [show, setShow] = createSignal(true);
    class VM {}
    function View(this: { vm: VM }): Node {
      return Transition({
        show,
        children: templateHoles("<span>content</span>", plan)().node,
        leaveClass: "leave",
        duration: 100,
      });
    }
    attachMeta(View, VM);
    const target = host(
      "<!--silent-view--><span>content</span><!--silent-transition--><!--silent-view-end-->",
    );
    const serverSpan = target.querySelector("span");
    const mismatches: unknown[] = [];
    await hydrate(target, View as unknown as AnyComponent, {
      onMismatch: (error) => mismatches.push(error),
    });
    expect(mismatches).toEqual([]);
    expect(target.querySelector("span")).toBe(serverSpan);
    setShow(false);
    flushSync();
    expect(serverSpan?.classList.contains("leave")).toBe(true);
    vi.advanceTimersByTime(100);
    flushSync();
    expect(target.querySelector("span")).toBeNull();
  });
});

describe("Transition: сверка ветки при гидрации", () => {
  it("не адоптирует ветку, расходящуюся с серверной разметкой", async () => {
    class VM {}
    function View(this: { vm: VM }): Node {
      return Transition({
        show: true,
        fallback: "loading",
        children: () => {
          const span = document.createElement("span");
          span.textContent = "content";
          return span;
        },
      });
    }
    attachMeta(View, VM);
    const target = host(
      "<!--silent-view-->loading<!--silent-transition--><!--silent-view-end-->",
    );
    const mismatches: unknown[] = [];
    await hydrate(target, View as unknown as AnyComponent, {
      onMismatch: (error) => mismatches.push(error),
    });
    expect(mismatches.length).toBe(1);
    expect(target.textContent).toBe("content");
  });

  it("адоптирует совпадающую ветку без потери обработчиков", async () => {
    const plan: TemplatePlan = { roots: 1, holes: [], attrs: [], strips: [] };
    const [show] = createSignal(true);
    let clicks = 0;
    class VM {}
    function View(this: { vm: VM }): Node {
      return Transition({
        show,
        get children() {
          return templateHoles("<button>go</button>", plan)().node;
        },
      });
    }
    attachMeta(View, VM);
    const target = host(
      "<!--silent-view--><button>go</button><!--silent-transition--><!--silent-view-end-->",
    );
    const serverButton = target.querySelector("button");
    serverButton?.addEventListener("click", () => {
      clicks += 1;
    });
    const mismatches: unknown[] = [];
    await hydrate(target, View as unknown as AnyComponent, {
      onMismatch: (error) => mismatches.push(error),
    });
    expect(mismatches).toEqual([]);
    expect(target.querySelector("button")).toBe(serverButton);
    serverButton?.dispatchEvent(new Event("click"));
    expect(clicks).toBe(1);
  });
});

describe("Portal с JSX children", () => {
  it("рендерит детей вне окна гидрации и не забирает соседей", async () => {
    const EMPTY_PLAN: TemplatePlan = { roots: 1, holes: [], attrs: [], strips: [] };
    const OUTER_HTML = '<div><!--silent-hole-0--><i>after</i></div>';
    const OUTER_PLAN: TemplatePlan = {
      roots: 1,
      holes: [{ path: [0, 0], counts: [1, 1], key: "silent-hole-0" }],
      attrs: [],
      strips: [],
    };
    const portalTarget = host("");
    let reads = 0;
    function View(): Node {
      const clone = templateHoles(OUTER_HTML, OUTER_PLAN)();
      const hole = clone.holes[0];
      if (hole === undefined || !(hole instanceof Comment)) {
        throw new Error("не найдена дыра шаблона");
      }
      insert(
        hole.parentNode ?? clone.node,
        () =>
          Portal({
            target: portalTarget,
            get children() {
              reads += 1;
              return templateHoles("<span>portal</span>", EMPTY_PLAN)().node;
            },
          }),
        hole,
      );
      return clone.node;
    }
    const target = host(
      '<div><!--silent-insert--><!--silent-portal--><!--silent-insert-end--><!--silent-hole-0--><i>after</i></div>',
    );
    const serverAfter = target.querySelector("i");
    const mismatches: unknown[] = [];
    const handle = await hydrate(target, View as unknown as AnyComponent, {
      onMismatch: (error) => mismatches.push(error),
    });
    expect(mismatches).toEqual([]);
    expect(reads).toBeGreaterThanOrEqual(1);
    expect(portalTarget.textContent).toBe("portal");
    expect(target.querySelector("i")).toBe(serverAfter);
    expect(target.querySelector("span")).toBeNull();
    handle.dispose();
  });
});
