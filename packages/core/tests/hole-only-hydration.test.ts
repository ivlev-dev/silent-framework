// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { renderToString } from "@ivlev-dev/silent-server";
import { insert, templateHoles } from "../src/dom.js";
import { hydrate } from "../src/hydrate.js";
import type { AnyComponent } from "../src/types.js";

describe("гидрация шаблона, единственный корень которого — дыра", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("гидратирует серверный текст дыры-корня", async () => {
    function App(props: Record<string, unknown>): Node {
      const clone = templateHoles("<!--silent-hole-0-->", {
        roots: 1,
        holes: [{ path: [0], counts: [1], key: "silent-hole-0" }],
        attrs: [],
        strips: [],
      })();
      const hole = clone.holes[0];
      if (hole === undefined) {
        throw new Error("не найдена дыра шаблона");
      }
      insert((hole.parentNode as Node | null) ?? clone.node, () => props["title"], hole);
      return clone.node;
    }

    const server = await renderToString(App as unknown as AnyComponent, {
      props: { title: "Сервер" },
    });
    expect(server.html).toContain("Сервер");

    const host = document.createElement("div");
    host.innerHTML = server.html;
    document.body.appendChild(host);

    const mismatches: string[] = [];
    const handle = await hydrate(host, App as unknown as AnyComponent, {
      props: { title: "Сервер" },
      onMismatch: (error) => {
        mismatches.push(error.message);
      },
    });

    expect(mismatches).toEqual([]);
    expect(host.textContent).toBe("Сервер");
    handle.dispose();
  });
});
