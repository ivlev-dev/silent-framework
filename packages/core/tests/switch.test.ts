// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { createSignal, flushSync } from "@ivlev-dev/silent-reactivity";
import { component } from "../src/component";
import { Match, Switch } from "../src/switch";

function install(node: Node): HTMLElement {
  const host = document.createElement("div");
  host.appendChild(node);
  document.body.appendChild(host);
  return host;
}

function label(value: string): HTMLElement {
  const span = document.createElement("span");
  span.textContent = value;
  return span;
}

function current(host: HTMLElement): string {
  return host.querySelector("span")?.textContent ?? "";
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe("Switch", () => {
  it("выбирает первую правдивую ветку", () => {
    const [value] = createSignal(2);
    const host = install(
      Switch({
        fallback: () => label("none"),
        children: () => [
          Match({ when: () => value() > 1, children: () => label("big") }),
          Match({ when: () => value() > 0, children: () => label("small") }),
        ],
      }),
    );
    expect(current(host)).toBe("big");
  });

  it("переключает ветки по сигналу", () => {
    const [value, setValue] = createSignal(2);
    const host = install(
      Switch({
        fallback: () => label("none"),
        children: () => [
          Match({ when: () => value() > 1, children: () => label("big") }),
          Match({ when: () => value() > 0, children: () => label("small") }),
        ],
      }),
    );
    expect(current(host)).toBe("big");

    setValue(1);
    flushSync();
    expect(current(host)).toBe("small");

    setValue(0);
    flushSync();
    expect(current(host)).toBe("none");
  });

  it("считает falsy-значения ложными", () => {
    const [value, setValue] = createSignal<unknown>(0);
    const host = install(
      Switch({
        fallback: () => label("none"),
        children: () => Match({ when: value, children: () => label("yes") }),
      }),
    );
    expect(current(host)).toBe("none");

    for (const falsy of ["", false, null, undefined]) {
      setValue(falsy);
      flushSync();
      expect(current(host)).toBe("none");
    }

    setValue("text");
    flushSync();
    expect(current(host)).toBe("yes");
  });

  it("работает с Match, созданным через component", () => {
    const host = install(
      Switch({
        fallback: () => label("none"),
        children: () => [
          component(Match, { when: () => false, children: () => label("no") }),
          component(Match, { when: () => true, children: () => label("yes") }),
        ],
      }),
    );
    expect(current(host)).toBe("yes");
  });

  it("не оставляет маркеры Match в разметке", () => {
    const host = install(
      Switch({
        fallback: () => label("none"),
        children: () => [
          Match({ when: () => false, children: () => label("no") }),
          Match({ when: () => true, children: () => label("yes") }),
        ],
      }),
    );
    expect(host.innerHTML).not.toContain("silent-match");
  });

  it("показывает fallback без веток", () => {
    const host = install(Switch({ fallback: () => label("none"), children: [] }));
    expect(current(host)).toBe("none");
  });
});
