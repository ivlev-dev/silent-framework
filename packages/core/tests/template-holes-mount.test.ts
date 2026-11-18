// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { templateHoles, type TemplatePlan } from "../src/dom.js";

const plan: TemplatePlan = {
  roots: 1,
  holes: [{ path: [9, 9], counts: [1, 1], key: "silent-hole-0" }],
  attrs: [{ path: [9, 9], counts: [1, 1], key: "data-silent-a-0" }],
  strips: [
    { path: [9, 9], counts: [1, 1], names: ["data-silent-a-0"] },
  ],
};

describe("templateHoles в клиентском mount", () => {
  it("собирает дыры и атрибуты по маркерам, не используя пути плана", () => {
    const template = templateHoles(
      '<div class="box"><span data-silent-a-0=""><!--silent-hole-0--></span></div>',
      plan,
    );
    const clone = template();

    expect(clone.holes).toHaveLength(1);
    expect(clone.holes[0]?.data).toBe("silent-hole-0");
    expect(clone.attrs).toHaveLength(1);
    expect(clone.attrs[0]?.tagName).toBe("SPAN");
    expect(clone.attrs[0]?.hasAttribute("data-silent-a-0")).toBe(false);
    expect(clone.holes[0]?.parentNode).toBe(clone.attrs[0]);
  });

  it("оставляет маркеры дыр и снимает служебные атрибуты", () => {
    const template = templateHoles(
      '<p data-silent-a-0="" data-silent-text="">text<!--silent-hole-0--></p>',
      plan,
    );
    const clone = template();

    expect(clone.attrs[0]?.hasAttribute("data-silent-a-0")).toBe(false);
    expect(clone.attrs[0]?.hasAttribute("data-silent-text")).toBe(false);
    expect(clone.holes[0]?.parentNode).toBe(clone.attrs[0]);
  });
});
