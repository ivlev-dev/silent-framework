// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { renderToString } from "@ivlev-dev/silent-server";
import { hydrate } from "../src/hydrate";
import { insert, templateHoles } from "../src/dom";
import type { AnyComponent } from "../src/types.js";

const VIEW = Symbol.for("silent.view");

function LightChild(): HTMLElement {
  const node = document.createElement("span");
  node.textContent = "client";
  return node;
}

const appTemplate = templateHoles("<main><!--silent-hole-0--></main>");

class AppVM {}

function AppView(this: { vm: AppVM }): Node {
  void this.vm;
  const root = appTemplate();
  insert(
    root.holes[0]?.parentNode ?? root.node,
    () => LightChild(),
    root.holes[0],
  );
  return root.node;
}

(AppView as unknown as Record<PropertyKey, unknown>)[VIEW] = {
  vm: AppVM,
  name: "AppView",
};

afterEach(() => {
  document.body.replaceChildren();
});

describe("гидрация light-компонента в слоте view", () => {
  it("не дублирует серверную разметку слота", async () => {
    const { html } = await renderToString(AppView as unknown as AnyComponent);
    if (process.env["SILENT_DEBUG"] === "1") {
      console.log("SERVER", html);
    }
    const root = document.createElement("div");
    root.innerHTML = html;
    document.body.appendChild(root);

    const mismatches: string[] = [];
    const handle = await hydrate(root, AppView as unknown as AnyComponent, {
      onMismatch: (error) => {
        mismatches.push(error.message);
      },
    });
    await handle.ready;

    if (process.env["SILENT_DEBUG"] === "1") {
      console.log("AFTER", root.innerHTML);
    }
    expect(root.querySelectorAll("span").length).toBe(1);
    expect(root.textContent).toBe("client");
    expect(mismatches).toEqual([]);
    handle.dispose();
  });
});
