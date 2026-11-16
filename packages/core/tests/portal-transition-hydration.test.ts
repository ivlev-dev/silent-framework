// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { hydrate } from "../src/hydrate";
import { createSignal, flushSync } from "@ivlev-dev/silent-reactivity";
import { Portal } from "../src/portal";
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
    const [show, setShow] = createSignal(true);
    class VM {}
    function View(this: { vm: VM }): Node {
      return Transition({
        show,
        children: document.createElement("span"),
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
