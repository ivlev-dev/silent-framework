import { afterEach, describe, expect, it } from "vitest";
import { For, Index, type AnyComponent } from "@ivlev-dev/silent-core";
import { renderToString } from "../src/render.js";
import { clearTemplateCache } from "../src/template-cache.js";

afterEach(() => {
  clearTemplateCache();
});

function metadataItem(label: string): Node {
  const fragment = document.createDocumentFragment();
  const title = document.createElement("title");
  title.textContent = `Title ${label}`;
  const meta = document.createElement("meta");
  meta.setAttribute("name", `item-${label}`);
  meta.setAttribute("content", label);
  const span = document.createElement("span");
  span.textContent = label;
  fragment.appendChild(title);
  fragment.appendChild(meta);
  fragment.appendChild(span);
  return fragment as unknown as Node;
}

describe("metadata внутри For/Index на SSR", () => {
  it("выносит title/meta из For в head, а не в body", async () => {
    function Page(): Node {
      return For({
        each: ["a", "b"],
        children: (item: string) => metadataItem(item),
      }) as Node;
    }

    const { html, head } = await renderToString(Page as unknown as AnyComponent, {});

    expect(head).toContain("<title>Title a</title>");
    expect(head).toContain("<title>Title b</title>");
    expect(head).toContain('name="item-a"');
    expect(html).not.toContain("<title");
    expect(html).not.toContain("<meta");
    expect(html).toContain("<span>a</span>");
    expect(html).toContain("<span>b</span>");
  });

  it("выносит title/meta из Index в head", async () => {
    function Page(): Node {
      return Index({
        each: ["x"],
        children: () => metadataItem("x"),
      }) as Node;
    }

    const { html, head } = await renderToString(Page as unknown as AnyComponent, {});

    expect(head).toContain("<title>Title x</title>");
    expect(head).toContain('name="item-x"');
    expect(html).not.toContain("<title");
    expect(html).not.toContain("<meta");
    expect(html).toContain("<span>x</span>");
  });
});
