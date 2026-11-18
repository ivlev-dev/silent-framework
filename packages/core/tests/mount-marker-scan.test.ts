// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { templateHoles, type TemplatePlan } from "../src/dom.js";

function countAttributeReads(run: () => void): number {
  const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, "attributes");
  const original = descriptor?.get;
  if (original === undefined) {
    throw new Error("Element.prototype.attributes недоступен для подсчёта");
  }
  let reads = 0;
  Object.defineProperty(Element.prototype, "attributes", {
    configurable: true,
    enumerable: descriptor?.enumerable ?? true,
    get(this: Element) {
      reads += 1;
      return original.call(this);
    },
  });
  try {
    run();
  } finally {
    Object.defineProperty(Element.prototype, "attributes", descriptor);
  }
  return reads;
}

function holePlan(path: readonly number[]): TemplatePlan {
  return {
    roots: 1,
    holes: [{ path, counts: [1, 1], key: "silent-hole-0" }],
    attrs: [],
    strips: [],
  };
}

describe("клиентский mount шаблона: части ищутся по маркерам", () => {
  it("игнорирует пути плана и находит дыру по маркеру", () => {
    const clone = templateHoles(
      "<span><!--silent-hole-0--></span>",
      holePlan([9, 9]),
    )();

    expect(clone.holes).toHaveLength(1);
    expect(clone.holes[0]?.data).toBe("silent-hole-0");
    expect(clone.attrs).toHaveLength(0);
  });

  it("обходит дерево, когда план содержит дыры", () => {
    const template = templateHoles(
      "<div><span><!--silent-hole-0--></span></div>",
      holePlan([0, 0, 0]),
    );

    expect(countAttributeReads(() => template())).toBeGreaterThan(0);
    expect(template().holes[0]?.data).toBe("silent-hole-0");
  });

  it("не обходит дерево при пустом плане", () => {
    const template = templateHoles(
      '<div class="box"><span class="label">static</span></div>',
      { roots: 1, holes: [], attrs: [], strips: [] },
    );

    const reads = countAttributeReads(() => template());
    const first = template();
    const second = template();

    expect(reads).toBe(0);
    expect(first.holes).toHaveLength(0);
    expect(first.attrs).toHaveLength(0);
    expect(first.holes).toBe(second.holes);
    expect(first.attrs).toBe(second.attrs);
  });

  it("false отключает обход дерева для статических шаблонов", () => {
    const template = templateHoles(
      '<div class="box"><span class="label">static</span></div>',
      false,
    );

    const reads = countAttributeReads(() => template());
    const first = template();
    const second = template();

    expect(reads).toBe(0);
    expect(first.node.nodeType).toBe(Node.ELEMENT_NODE);
    expect(first.holes).toHaveLength(0);
    expect(first.attrs).toHaveLength(0);
    expect(first.holes).toBe(second.holes);
    expect(first.attrs).toBe(second.attrs);
  });

  it("false сохраняет namespace svg", () => {
    const template = templateHoles(
      '<svg viewBox="0 0 10 10"><path d="M0 0" /></svg>',
      false,
      "svg",
    );
    const clone = template();
    const svg = clone.node as Element;

    expect(svg.namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(svg.firstElementChild?.namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(clone.attrs).toHaveLength(0);
  });
});
