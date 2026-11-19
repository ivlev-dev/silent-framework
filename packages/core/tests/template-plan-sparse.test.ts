// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { templateHoles, type TemplatePlan } from "../src/dom.js";

describe("разреженный план шаблона", () => {
  it("откатывается на сбор частей вместо TypeError", () => {
    const plan = {
      roots: 1,
      holes: [undefined, { path: [0, 0], counts: [1, 1], key: "silent-hole-0" }],
      attrs: [],
      strips: [],
    } as unknown as TemplatePlan;
    const clone = templateHoles("<div><!--silent-hole-0--></div>", plan)();
    expect(clone.holes.length).toBe(1);
    expect(clone.holes[0]).toBeInstanceOf(Comment);
    expect(clone.attrs.length).toBe(0);
  });

  it("поддерживает отсутствующий список strips", () => {
    const plan = {
      roots: 1,
      holes: [{ path: [0, 0], counts: [1, 1], key: "silent-hole-0" }],
      attrs: [],
    } as unknown as TemplatePlan;
    const clone = templateHoles("<div><!--silent-hole-0--></div>", plan)();
    expect(clone.holes.length).toBe(1);
    expect(clone.holes[0]).toBeInstanceOf(Comment);
  });

  it("откатывается на сбор частей при дыре в разреженном attrs", () => {
    const plan = {
      roots: 1,
      holes: [{ path: [0, 0], counts: [1, 1], key: "silent-hole-0" }],
      attrs: [undefined, { path: [0], counts: [1], key: "data-silent-a-0" }],
      strips: [],
    } as unknown as TemplatePlan;
    const clone = templateHoles(
      '<div data-silent-a-0=""><!--silent-hole-0--></div>',
      plan,
    )();
    expect(clone.holes.length).toBe(1);
    expect(clone.attrs.length).toBe(1);
  });
});
