// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { attr, insert, prop, templateHoles } from "../src/dom.js";

describe("сборка приложения с hydrate: false", () => {
  it("снимает attr-маркеры и data-silent-text, привязывает значения", () => {
    const label = "Заголовок";
    const value = "значение";
    const template = templateHoles(
      '<div class="box" data-silent-a-0=""><!--silent-hole-0-->' +
        '<textarea class="field" data-silent-a-1="" data-silent-text=""></textarea></div>',
    );
    const clone = template();
    const root = clone.node as Element;

    expect(clone.attrs).toHaveLength(2);
    expect(clone.attrs[0]).toBe(root);
    expect(clone.attrs[1]?.tagName).toBe("TEXTAREA");
    expect(root.hasAttribute("data-silent-a-0")).toBe(false);
    expect(clone.attrs[1]?.hasAttribute("data-silent-a-1")).toBe(false);
    expect(clone.attrs[1]?.hasAttribute("data-silent-text")).toBe(false);

    attr(clone.attrs[0] as Element, "title", () => label);
    prop(clone.attrs[1] as Element, "value", () => value);
    const hole = clone.holes[0];
    if (hole === undefined) {
      throw new Error("не найдена дыра шаблона");
    }
    insert(hole.parentNode ?? root, () => "вставка", hole);

    expect(root.getAttribute("title")).toBe(label);
    expect((clone.attrs[1] as HTMLTextAreaElement).value).toBe(value);
    expect(hole.parentNode?.textContent).toBe("вставка");
  });

  it("не обходит дерево статического шаблона (негоцированный false)", () => {
    const template = templateHoles(
      '<section class="static"><h2>Заголовок</h2><p>Текст</p></section>',
      false,
    );
    const clone = template();
    const root = clone.node as Element;

    expect(root.tagName).toBe("SECTION");
    expect(root.querySelector("h2")?.textContent).toBe("Заголовок");
    expect(clone.holes).toHaveLength(0);
    expect(clone.attrs).toHaveLength(0);
    expect(root.outerHTML).toBe(
      '<section class="static"><h2>Заголовок</h2><p>Текст</p></section>',
    );
  });

  it("передаёт namespace svg вместе со static-маркером", () => {
    const template = templateHoles(
      '<svg viewBox="0 0 10 10"><path d="M0 0" /></svg>',
      false,
      "svg",
    );
    const clone = template();
    const root = clone.node as Element;

    expect(root.namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(root.firstElementChild?.getAttribute("d")).toBe("M0 0");
    expect(clone.holes).toHaveLength(0);
    expect(clone.attrs).toHaveLength(0);
  });
});
