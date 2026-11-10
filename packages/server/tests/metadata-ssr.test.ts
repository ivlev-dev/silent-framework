import { describe, expect, it } from "vitest";
import { templateHoles, type AnyComponent } from "@ivlev-dev/silent-core";
import { renderToString } from "../src/render.js";

describe("SSR метаданных", () => {
  it("выносит title, meta и link в head", async () => {
    function Page(): Node {
      return templateHoles(
        '<div class="page"><title>Page</title><meta name="description" content="desc"><link rel="stylesheet" href="/page.css"><h1>Body</h1></div>',
      )().node;
    }

    const { html, head } = await renderToString(Page as unknown as AnyComponent, {});

    expect(head).toContain("<title>Page</title>");
    expect(head).toContain('name="description"');
    expect(head).toContain('content="desc"');
    expect(head).toContain('href="/page.css"');
    expect(html).not.toContain("<title");
    expect(html).not.toContain("<meta");
    expect(html).not.toContain("<link");
    expect(html).toContain("<h1>Body</h1>");
  });

  it("не выносит meta и link с itemprop", async () => {
    function Page(): Node {
      return templateHoles(
        '<div class="book"><meta itemprop="name" content="Book"><link itemprop="url" href="/book"><h1>Body</h1></div>',
      )().node;
    }

    const { html, head } = await renderToString(Page as unknown as AnyComponent, {});

    expect(head).not.toContain("itemprop");
    expect(html).toContain('itemprop="name"');
    expect(html).toContain('itemprop="url"');
  });
});
