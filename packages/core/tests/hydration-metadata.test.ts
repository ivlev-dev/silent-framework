import { afterEach, describe, expect, it } from "vitest";
import { createSignal, flushSync } from "@ivlev-dev/silent-reactivity";
import { insert, templateHoles, type TemplateClone } from "../src/dom.js";
import { hydrate } from "../src/hydrate.js";
import { HydrationMismatchError } from "../src/hydration.js";
import type { MountHandle } from "../src/mount.js";
import type { AnyComponent } from "../src/types.js";

const hosts: HTMLElement[] = [];
const handles: MountHandle[] = [];

function host(markup = ""): HTMLElement {
  const element = document.createElement("div");
  element.innerHTML = markup;
  document.body.appendChild(element);
  hosts.push(element);
  return element;
}

function holeParent(template: TemplateClone, index: number): Node {
  const hole = template.holes[index];
  return hole?.parentNode ?? template.node;
}

afterEach(() => {
  for (const handle of handles.splice(0)) {
    handle.dispose();
  }
  for (const element of hosts.splice(0)) {
    element.remove();
  }
  document.body.replaceChildren();
});

describe("гидрация metadata-шаблона", () => {
  it("адоптирует title и текст с префиксом и суффиксом вокруг дыры", async () => {
    const name = createSignal("world");
    function View(): Node {
      const template = templateHoles(
        "<main><title>Привет</title><p>Hello <!--silent-hole-0-->!</p></main>",
      )();
      insert(holeParent(template, 0), () => name[0](), template.holes[0]);
      return template.node;
    }

    const target = host("<main><p>Hello world<!--silent-hole-0-->!</p></main>");
    const serverParagraph = target.querySelector("p");
    const mismatches: HydrationMismatchError[] = [];

    const handle = await hydrate(target, View as unknown as AnyComponent, {
      onMismatch: (error) => mismatches.push(error),
    });
    handles.push(handle);

    expect(mismatches).toEqual([]);
    expect(target.querySelector("p")).toBe(serverParagraph);
    expect(target.textContent).toBe("Hello world!");
    expect(document.title).toBe("Привет");

    name[1]("there");
    flushSync();
    expect(target.textContent).toBe("Hello there!");
    expect(target.querySelector("p")).toBe(serverParagraph);
  });

  it("не адоптирует metadata-шаблон при другом статическом префиксе", async () => {
    function View(): Node {
      const template = templateHoles(
        "<main><title>Привет</title><p>Hello <!--silent-hole-0-->!</p></main>",
      )();
      insert(holeParent(template, 0), () => "world", template.holes[0]);
      return template.node;
    }

    const target = host("<main><p>Hi world<!--silent-hole-0-->!</p></main>");
    const mismatches: HydrationMismatchError[] = [];
    const handle = await hydrate(target, View as unknown as AnyComponent, {
      onMismatch: (error) => mismatches.push(error),
    });
    handles.push(handle);

    expect(mismatches.length).toBeGreaterThan(0);
    expect(mismatches[0]).toBeInstanceOf(HydrationMismatchError);
    expect(target.textContent).toBe("Hello world!");
    expect(document.title).toBe("Привет");
  });
});
