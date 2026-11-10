// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { hydrate } from "../src/mount";
import { templateHoles } from "../src/dom";
import { ErrorBoundary } from "../src/error-boundary";
import { Index } from "../src/index-list";
import { Match, Switch } from "../src/switch";
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
  for (const element of hosts.splice(0)) {
    element.remove();
  }
  document.body.replaceChildren();
});

describe("гидрация управляющих конструкций", () => {
  it("адоптирует серверную разметку Switch", async () => {
    class VM {}
    function View(this: { vm: VM }): Node {
      return Switch({
        when: true,
        children: () =>
          Match({
            when: true,
            children: () => templateHoles("<span>yes</span>")().node,
          }),
      });
    }
    attachMeta(View, VM);

    const target = host(
      "<!--silent-view--><span>yes</span><!--silent-switch--><!--silent-view-end-->",
    );
    const serverSpan = target.querySelector("span");

    await hydrate(target, View as unknown as AnyComponent, {
      onMismatch: () => undefined,
    });

    expect(target.querySelectorAll("span").length).toBe(1);
    expect(target.querySelector("span")).toBe(serverSpan);
  });

  it("адоптирует серверную разметку Index", async () => {
    class VM {}
    function View(this: { vm: VM }): Node {
      return Index({
        each: ["a", "b"],
        children: (item) =>
          templateHoles(item() === "a" ? "<span>a</span>" : "<span>b</span>")().node,
      });
    }
    attachMeta(View, VM);

    const target = host(
      "<!--silent-view--><!--silent-item--><span>a</span><!--silent-item--><span>b</span><!--silent-end--><!--silent-view-end-->",
    );
    const serverA = target.querySelectorAll("span")[0];
    const serverB = target.querySelectorAll("span")[1];

    await hydrate(target, View as unknown as AnyComponent, {
      onMismatch: () => undefined,
    });

    const spans = target.querySelectorAll("span");
    expect(spans.length).toBe(2);
    expect(spans[0]).toBe(serverA);
    expect(spans[1]).toBe(serverB);
  });

  it("адоптирует серверную разметку ErrorBoundary", async () => {
    class VM {}
    function View(this: { vm: VM }): Node {
      return ErrorBoundary({
        fallback: () => templateHoles("<span>error</span>")().node,
        children: () => templateHoles("<span>ok</span>")().node,
      });
    }
    attachMeta(View, VM);

    const target = host(
      "<!--silent-view--><span>ok</span><!--silent-error--><!--silent-view-end-->",
    );
    const serverSpan = target.querySelector("span");

    await hydrate(target, View as unknown as AnyComponent, {
      onMismatch: () => undefined,
    });

    expect(target.querySelectorAll("span").length).toBe(1);
    expect(target.querySelector("span")).toBe(serverSpan);
  });
});
