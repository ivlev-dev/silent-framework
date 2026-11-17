// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { templateHoles } from "../src/dom";

describe("клиентский план шаблона без hydration-рантайма", () => {
  it("находит дыры по путям при mount-only сборке", () => {
    const clone = templateHoles("<span><!--silent-hole-0--></span>", {
      roots: 1,
      holes: [{ path: [0, 0], counts: [1, 1], key: "silent-hole-0" }],
      attrs: [],
      strips: [],
    })();

    expect(clone.holes[0]?.data).toBe("silent-hole-0");
  });
});
