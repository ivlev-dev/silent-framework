// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderToString } from "@ivlev-dev/silent-server";
import { hydrate } from "../src/hydrate";

function LightView(): HTMLElement {
  const node = document.createElement("p");
  node.textContent = "client";
  return node;
}

describe("гидрация light-компонента", () => {
  it("заменяет серверную разметку, а не дублирует её", async () => {
    const { html } = await renderToString(LightView as never);
    const root = document.createElement("div");
    root.innerHTML = html;
    document.body.appendChild(root);

    const mismatches: string[] = [];
    const handle = await hydrate(root, LightView as never, {
      onMismatch: (error) => {
        mismatches.push(error.message);
      },
    });
    await handle.ready;

    expect(root.querySelectorAll("p").length).toBe(1);
    expect(root.textContent).toBe("client");
    expect(mismatches).toEqual([]);
    handle.dispose();
  });
});
