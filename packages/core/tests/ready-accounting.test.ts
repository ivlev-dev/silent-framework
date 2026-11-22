// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { createComponent } from "../src/component";
import { RESOLVED_READY, getReadyStats } from "../src/component-state";
import { mount } from "../src/mount";
import type { AnyComponent } from "../src/types";

const VIEW = Symbol.for("silent.view");

class ViewModel {}

function View(this: { vm: ViewModel }): HTMLElement {
  void this.vm;
  const element = document.createElement("span");
  element.textContent = "view";
  return element;
}
(View as unknown as Record<PropertyKey, unknown>)[VIEW] = { vm: ViewModel, name: "View" };

function Light(): HTMLElement {
  const element = document.createElement("i");
  element.textContent = "light";
  return element;
}

function host(): HTMLElement {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return element;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("учёт ready-узлов", () => {
  it("уменьшает счётчик при dispose и сохраняет fast-path для light", async () => {
    const baseline = getReadyStats();
    const target = host();
    const handle = await mount(target, View as unknown as AnyComponent);
    await handle.settled;
    expect(getReadyStats().nodes).toBe(baseline.nodes + 1);

    handle.dispose();
    expect(getReadyStats().nodes).toBe(baseline.nodes);

    const traversals = getReadyStats().traversals;
    for (let index = 0; index < 1000; index += 1) {
      const result = createComponent(Light as unknown as AnyComponent);
      expect(result.settled).toBe(RESOLVED_READY);
      result.dispose();
    }
    expect(getReadyStats().traversals).toBe(traversals);
    expect(getReadyStats().nodes).toBe(baseline.nodes);
  });
});
