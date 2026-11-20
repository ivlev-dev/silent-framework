import { afterEach, describe, expect, it } from "vitest";
import { prop, templateHoles, type AnyComponent } from "@ivlev-dev/silent-core";
import { renderToStream } from "../src/stream.js";
import { clearTemplateCache } from "../src/template-cache.js";

afterEach(() => {
  clearTemplateCache();
});

const TEMPLATE =
  '<div data-silent-a-0=""><script data-silent-a-1="" data-silent-text=""></script><span><!--silent-hole-0--></span></div>';
const SCRIPT_TEXT = "const literal = data-silent-a-0;";

function scriptPage(): AnyComponent {
  return function Page(): Node {
    const template = templateHoles(TEMPLATE)();
    prop(template.attrs[1]!, "textContent", () => SCRIPT_TEXT);
    return template.node;
  } as unknown as AnyComponent;
}

async function collect(
  app: AnyComponent,
  options: { markers?: boolean } = {},
): Promise<string> {
  const chunks: string[] = [];
  for await (const chunk of renderToStream(app, options)) {
    chunks.push(chunk);
  }
  return chunks.join("");
}

describe("renderToStream: markers", () => {
  it("по умолчанию пишет hydration-маркеры", async () => {
    const html = await collect(scriptPage());

    expect(html).toContain("<!--silent-hole-0-->");
    expect(html).toContain("data-silent-");
    expect(html).toContain(SCRIPT_TEXT);
  });

  it("markers: false убирает маркеры и не трогает литерал внутри script", async () => {
    const html = await collect(scriptPage(), { markers: false });

    expect(html).toBe(
      `<div><script>${SCRIPT_TEXT}</script><span></span></div>`,
    );
    expect(html).not.toContain("<!--silent-");
    expect(html).not.toContain("data-silent-text");
    expect(html).not.toMatch(/\sdata-silent-a-\d+=""/);
  });

  it("markers: false не пишет патчи и runtime-скрипт", async () => {
    const html = await collect(scriptPage(), { markers: false });

    expect(html).not.toContain("data-silent-stream");
    expect(html).not.toContain("__silentStream");
    expect(html).not.toContain("silent-stream:");
  });
});
