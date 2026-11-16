import { describe, expect, it } from "vitest";
import { Head, templateHoles, type AnyComponent } from "@ivlev-dev/silent-core";
import { renderToString } from "../src/render.js";

describe("SSR Head", () => {
  it("выносит title, meta, link и style в head", async () => {
    function Page(): Node {
      Head({
        title: "SSR",
        meta: [
          { name: "description", content: "ssr desc" },
          { charset: "utf-8" },
        ],
        link: [{ rel: "stylesheet", href: "/ssr.css" }],
        style: [{ css: "body{margin:0}" }],
      });
      return templateHoles("<main><h1>Body</h1></main>")().node;
    }

    const { html, head } = await renderToString(Page as unknown as AnyComponent, {});

    expect(head).toContain("<title>SSR</title>");
    expect(head).toContain('name="description"');
    expect(head).toContain('content="ssr desc"');
    expect(head).toContain('href="/ssr.css"');
    expect(head).toContain("body{margin:0}");
    expect(html).not.toContain("<title");
    expect(html).not.toContain("<meta");
    expect(html).not.toContain("<link");
    expect(html).not.toContain("<style");
    expect(html).toContain("<h1>Body</h1>");
  });

  it("дедуплицирует несколько Head: побеждает последний", async () => {
    function Inner(): Node {
      Head({
        title: "Inner",
        meta: [{ name: "description", content: "inner" }],
      });
      return templateHoles("<span>inner</span>")().node;
    }
    function Page(): Node {
      Head({
        title: "Outer",
        meta: [{ name: "description", content: "outer" }],
      });
      const main = document.createElement("main");
      main.appendChild(Inner());
      return main;
    }

    const { head, html } = await renderToString(Page as unknown as AnyComponent, {});

    expect(head.match(/<title>/g)).toHaveLength(1);
    expect(head).toContain("<title>Inner</title>");
    expect(head.match(/name="description"/g)).toHaveLength(1);
    expect(head).toContain('content="inner"');
    expect(html).not.toContain("<title");
    expect(html).toContain("<span>inner</span>");
  });

  it("дедуплицирует одинаковые link и style между запросами через общий ключ", async () => {
    function Page(): Node {
      Head({
        link: [{ rel: "stylesheet", href: "/shared.css" }],
        style: [{ css: ".x{color:red}" }],
      });
      return templateHoles("<p>x</p>")().node;
    }

    const first = await renderToString(Page as unknown as AnyComponent, {});
    const second = await renderToString(Page as unknown as AnyComponent, {});

    expect(first.head).toBe(second.head);
    expect((first.head.match(/href="\/shared.css"/g) ?? []).length).toBe(1);
    expect((first.head.match(/<style/g) ?? []).length).toBe(1);
  });

  it("не смешивает head между запросами", async () => {
    function First(): Node {
      Head({ title: "First-request" });
      return templateHoles("<p>first</p>")().node;
    }
    function Second(): Node {
      return templateHoles("<p>second</p>")().node;
    }

    const first = await renderToString(First as unknown as AnyComponent, {});
    const second = await renderToString(Second as unknown as AnyComponent, {});

    expect(first.head).toContain("First-request");
    expect(second.head).toBe("");
  });
});
