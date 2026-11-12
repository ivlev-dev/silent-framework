import { afterEach, describe, expect, it } from "vitest";
import { isServerMode, templateHoles, type AnyComponent } from "@ivlev-dev/silent-core";
import { ssr } from "@ivlev-dev/silent-core/jsx-runtime";
import { renderToString } from "../src/render.js";
import { clearTemplateCache } from "../src/template-cache.js";

afterEach(() => {
  clearTemplateCache();
});

describe("строковый шаблон компилятора", () => {
  it("склеивает части и экранирует значения", async () => {
    function View(): Node {
      return ssr(
        {
          parts: ['<div class="x"><span>', "<!--silent-hole-0--></span></div>"],
          bare: [true],
        },
        ["a&b"],
      );
    }

    const { html } = await renderToString(View as unknown as AnyComponent, {});

    expect(html).toBe('<div class="x"><span>a&amp;b<!--silent-hole-0--></span></div>');
    expect(isServerMode()).toBe(false);
  });

  it("оборачивает нестроковые значения регионом", async () => {
    function View(): Node {
      const inner = templateHoles("<b>bold</b>")();
      return ssr(
        {
          parts: ["<p>", "<!--silent-hole-0--></p>"],
          bare: [true],
        },
        [inner.node],
      );
    }

    const { html } = await renderToString(View as unknown as AnyComponent, {});

    expect(html).toBe(
      "<p><!--silent-insert--><b>bold</b><!--silent-insert-end--><!--silent-hole-0--></p>",
    );
  });

  it("оставляет регион для текста в не-bare позиции", async () => {
    function View(): Node {
      return ssr(
        {
          parts: ["<p>Hello ", "<!--silent-hole-0--></p>"],
          bare: [false],
        },
        ["world"],
      );
    }

    const { html } = await renderToString(View as unknown as AnyComponent, {});

    expect(html).toBe(
      "<p>Hello <!--silent-insert-->world<!--silent-insert-end--><!--silent-hole-0--></p>",
    );
  });

  it("не оставляет пробелов при пустых значениях", async () => {
    function View(): Node {
      return ssr({ parts: ["<i>", "</i>"], bare: [true] }, [null]);
    }

    const { html } = await renderToString(View as unknown as AnyComponent, {});

    expect(html).toBe("<i></i>");
  });
});
