// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { templateHoles } from "../src/dom.js";
import { hydrate } from "../src/hydrate.js";
import type { AnyComponent } from "../src/types.js";

const MULTI_ROOT = templateHoles("<p>a</p><p>b</p>", {
  roots: 2,
  holes: [],
  attrs: [],
  strips: [],
});

function App(): Node {
  return MULTI_ROOT().node;
}

describe("multi-root статический компонент", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("сохраняет серверные узлы после hydrate", async () => {
    const host = document.createElement("div");
    host.innerHTML = "<p>a</p><p>b</p>";
    document.body.appendChild(host);
    const serverNodes = Array.from(host.childNodes);

    const mismatches: string[] = [];
    const handle = await hydrate(host, App as unknown as AnyComponent, {
      onMismatch: (error) => {
        mismatches.push(error.message);
      },
    });

    expect(mismatches).toEqual([]);
    expect(Array.from(host.childNodes)).toEqual(serverNodes);
    expect(host.textContent).toBe("ab");
    handle.dispose();
  });
});
