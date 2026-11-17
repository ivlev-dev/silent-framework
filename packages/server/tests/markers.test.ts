import { describe, expect, it } from "vitest";
import { templateHoles } from "@ivlev-dev/silent-core";
import { renderToString } from "../src/render.js";

function App(): Node {
  return templateHoles(
    '<div data-silent-a-0=""><span><!--silent-hole-0--></span></div>',
  )().node;
}

describe("renderToString: markers", () => {
  it("по умолчанию оставляет hydration-маркеры", async () => {
    const { html } = await renderToString(App);
    expect(html).toContain("silent-hole-");
    expect(html).toContain("data-silent-");
  });

  it("markers: false убирает маркеры и атрибуты", async () => {
    const { html } = await renderToString(App, { markers: false });
    expect(html).not.toContain("silent-");
    expect(html).not.toContain("data-silent-");
    expect(html).toContain("<span></span>");
  });
});
