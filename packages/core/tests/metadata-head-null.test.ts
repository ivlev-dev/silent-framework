// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { hoistNode } from "../src/metadata.js";

function withoutHead<T>(run: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(document, "head");
  Object.defineProperty(document, "head", {
    configurable: true,
    value: undefined,
  });
  try {
    return run();
  } finally {
    if (descriptor === undefined) {
      Reflect.deleteProperty(document, "head");
    } else {
      Object.defineProperty(document, "head", descriptor);
    }
  }
}

describe("metadata вне сессии", () => {
  it("не падает на позднем hoistNode, если document.head === undefined", () => {
    withoutHead(() => {
      const title = document.createElement("title");
      title.textContent = "late";
      expect(() => hoistNode(title)).not.toThrow();
      expect(title.parentNode).toBeNull();
    });
  });

  it("не падает на meta без head", () => {
    withoutHead(() => {
      const meta = document.createElement("meta");
      meta.setAttribute("name", "description");
      expect(() => hoistNode(meta)).not.toThrow();
      expect(meta.parentNode).toBeNull();
    });
  });
});
