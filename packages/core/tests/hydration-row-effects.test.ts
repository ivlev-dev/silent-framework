// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { getReactivityStats } from "@ivlev-dev/silent-reactivity";
import { renderToString } from "@ivlev-dev/silent-server";
import { hydrate } from "../src/hydrate";
import { component } from "../src/component-lite";
import { For } from "../src/control-flow";

const ROWS = 20;
const items = Array.from({ length: ROWS }, (_, index) => `Item ${String(index)}`);

function List(): Node {
  return component(
    For as never,
    {
      get each() {
        return items;
      },
      get children() {
        return (label: string): Node => {
          const item = document.createElement("li");
          item.textContent = label;
          return item;
        };
      },
    } as never,
  );
}

describe("эффекты на строку списка при гидрации", () => {
  it("не создаёт render-эффект на каждую статическую строку", async () => {
    const { html } = await renderToString(List as never);
    const root = document.createElement("div");
    root.innerHTML = html;
    document.body.appendChild(root);

    const before = getReactivityStats().renderEffectsCreated;
    const handle = await hydrate(root, List as never);
    const created = getReactivityStats().renderEffectsCreated - before;

    expect(root.querySelectorAll("li").length).toBe(ROWS);
    expect(created).toBeLessThan(ROWS / 2);
    handle.dispose();
  });
});
