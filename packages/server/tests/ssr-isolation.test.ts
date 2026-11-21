import { describe, expect, it } from "vitest";
import { getRuntimeOptions } from "@ivlev-dev/silent-core";
import { renderToString } from "../src/index.js";

describe("SSR isolation", () => {
  it("не оставляет амбиентные runtime-опции после рендера", async () => {
    const app = (): Node => {
      const element = document.createElement("div");
      element.textContent = "ok";
      return element;
    };
    await renderToString(app);
    expect(getRuntimeOptions().container).toBeUndefined();
  });
});
