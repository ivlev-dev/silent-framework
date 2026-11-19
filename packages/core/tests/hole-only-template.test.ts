// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { createRoot, createSignal, flushSync } from "@ivlev-dev/silent-reactivity";
import { For } from "../src/control-flow.js";
import { insert, templateHoles, type TemplateClone } from "../src/dom.js";

const HOLE_PLAN = {
  roots: 1,
  holes: [{ path: [0], counts: [1], key: "silent-hole-0" }],
  attrs: [],
  strips: [],
} as const;

function rootTemplate(): TemplateClone {
  return templateHoles("<!--silent-hole-0-->", HOLE_PLAN)();
}

function holeOf(clone: TemplateClone): Comment {
  const hole = clone.holes[0];
  if (hole === undefined || !(hole instanceof Comment)) {
    throw new Error("не найдена дыра шаблона");
  }
  return hole;
}

describe("шаблон, единственный корень которого — дыра", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("вставляет текст в корень и отдаёт вставляемый контейнер", () => {
    const clone = rootTemplate();
    const hole = holeOf(clone);
    expect(clone.node).toBeInstanceOf(DocumentFragment);
    expect(hole.parentNode).toBe(clone.node);

    insert(hole.parentNode ?? clone.node, () => "Заголовок", hole);

    const host = document.createElement("div");
    host.appendChild(clone.node);
    expect(host.textContent).toBe("Заголовок");
    expect(host.querySelector("div")).toBeNull();
  });

  it("рендерит корневой && и тернарник", () => {
    const show = createSignal(true);
    const host = document.createElement("div");
    const dispose = createRoot((disposeRoot) => {
      const clone = rootTemplate();
      const hole = holeOf(clone);
      insert(
        hole.parentNode ?? clone.node,
        () => show[0]() && templateHoles("<span>on</span>")().node,
        hole,
      );
      host.appendChild(clone.node);
      return disposeRoot;
    });

    expect(host.textContent).toBe("on");
    expect(host.querySelector("span")).not.toBeNull();

    show[1](false);
    flushSync();
    expect(host.textContent).toBe("");

    show[1](true);
    flushSync();
    expect(host.textContent).toBe("on");
    dispose();
  });

  it("рендерит строку For, возвращающую дыру-корень", () => {
    const [items, setItems] = createSignal<readonly string[]>(["a", "b"]);
    const host = document.createElement("ul");
    const dispose = createRoot((disposeRoot) => {
      insert(
        host,
        () =>
          For({
            each: items,
            children: (item: string) => {
              const clone = rootTemplate();
              const hole = holeOf(clone);
              insert(hole.parentNode ?? clone.node, () => item, hole);
              return clone.node;
            },
          }),
        null,
      );
      return disposeRoot;
    });

    expect(host.textContent).toBe("ab");

    setItems(["a", "b", "c"]);
    flushSync();
    expect(host.textContent).toBe("abc");
    dispose();
  });
});
