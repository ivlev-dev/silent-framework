// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { createSignal, flushSync } from "@ivlev-dev/silent-reactivity";
import { component } from "../src/component";
import { For, Show } from "../src/control-flow";

function host(): HTMLElement {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return element;
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe("прямые control-flow компоненты", () => {
  it("For через component остаётся реактивным", () => {
    const [items, setItems] = createSignal<readonly string[]>(["a"]);
    const target = host();
    target.appendChild(
      component(For as never, {
        get each() {
          return items();
        },
        get children() {
          return (item: string): Node => {
            const span = document.createElement("span");
            span.textContent = item;
            return span;
          };
        },
      } as never),
    );

    expect(target.querySelectorAll("span").length).toBe(1);

    setItems(["a", "b"]);
    flushSync();
    expect(
      Array.from(target.querySelectorAll("span"), (span) => span.textContent ?? ""),
    ).toEqual(["a", "b"]);
  });

  it("Show через component переключает ветку", () => {
    const [visible, setVisible] = createSignal(false);
    const target = host();
    target.appendChild(
      component(Show as never, {
        get when() {
          return visible();
        },
        get children() {
          return (): Node => {
            const span = document.createElement("span");
            span.textContent = "yes";
            return span;
          };
        },
      } as never),
    );

    expect(target.querySelector("span")).toBeNull();

    setVisible(true);
    flushSync();
    expect(target.querySelector("span")?.textContent).toBe("yes");
  });
});
