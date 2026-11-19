// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { hydrate, insert, templateHoles } from "@ivlev-dev/silent-core";
import type { AnyComponent } from "@ivlev-dev/silent-core";
import { renderToString } from "../src/render.js";

const hosts: HTMLElement[] = [];
const handles: { dispose(): void }[] = [];

afterEach(() => {
  for (const handle of handles.splice(0)) {
    handle.dispose();
  }
  for (const host of hosts.splice(0)) {
    host.remove();
  }
  document.body.replaceChildren();
  for (const title of Array.from(document.head.querySelectorAll("title"))) {
    title.remove();
  }
});

function host(html: string): HTMLElement {
  const element = document.createElement("div");
  element.innerHTML = html;
  document.body.appendChild(element);
  hosts.push(element);
  return element;
}

describe("кеш разбора шаблонов между SSR и гидрацией", () => {
  it("не переиспользует серверный мини-DOM для metadata-шаблона", async () => {
    function View(): Node {
      const clone = templateHoles(
        "<main><title>Привет</title><p><!--silent-hole-0--></p></main><footer>end</footer>",
      )();
      const hole = clone.holes[0];
      if (hole === undefined || !(hole instanceof Comment)) {
        throw new Error("не найдена дыра шаблона");
      }
      insert(hole.parentNode ?? clone.node, () => "world", hole);
      return clone.node;
    }
    const { html, head } = await renderToString(View as unknown as AnyComponent, {});
    expect(head).toContain("<title>Привет</title>");
    expect(html).not.toContain("<title");

    const target = host(html);
    const paragraph = target.querySelector("p");
    const footer = target.querySelector("footer");
    const mismatches: string[] = [];
    const handle = await hydrate(target, View as unknown as AnyComponent, {
      onMismatch: (error) => mismatches.push(error.message),
    });
    handles.push(handle);

    expect(mismatches).toEqual([]);
    expect(target.querySelector("p")).toBe(paragraph);
    expect(target.querySelector("footer")).toBe(footer);
    expect(target.textContent).toContain("world");
    expect(target.textContent).toContain("end");
    expect(document.title).toBe("Привет");
  });
});
