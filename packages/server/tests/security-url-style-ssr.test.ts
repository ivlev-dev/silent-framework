import { afterEach, describe, expect, it } from "vitest";
import {
  applyProps,
  attr,
  createElement,
  templateHoles,
  type AnyComponent,
} from "@ivlev-dev/silent-core";
import { renderToString } from "../src/render.js";
import { clearTemplateCache } from "../src/template-cache.js";
import { ElementImpl } from "../src/dom/node.js";
import { serializeNode } from "../src/dom/serializer.js";
import { StyleImpl } from "../src/dom/style.js";

afterEach(() => {
  clearTemplateCache();
});

function view(): Node {
  return templateHoles("<p>body</p>")().node as unknown as Node;
}

describe("SSR: URL-атрибуты", () => {
  it("не выводит javascript:/data: в attr", async () => {
    const page = (): Node => {
      const template = templateHoles('<a data-silent-a-0="">x</a>')();
      attr(template.attrs[0]!, "href", () => "javascript:alert(1)");
      attr(template.attrs[0]!, "data-ok", () => "1");
      return template.node;
    };

    const { html } = await renderToString(page as unknown as AnyComponent, {});
    expect(html).toBe('<a data-silent-a-0="" data-ok="1">x</a>');
    expect(html).not.toContain("javascript:");
  });

  it("не выводит обходы через регистр, табы и HTML-сущности", async () => {
    const values = [
      "JaVaScRiPt:alert(1)",
      "\tjava\nscript:alert(1)",
      "java\u0000script:alert(1)",
      "javascript&#x3a;alert(1)",
      "javascript&colon;alert(1)",
      "&amp;#106;avascript:alert(1)",
    ];
    for (const value of values) {
      const page = (): Node => {
        const template = templateHoles('<img data-silent-a-0="">')();
        attr(template.attrs[0]!, "src", () => value);
        return template.node;
      };
      const { html } = await renderToString(page as unknown as AnyComponent, {});
      expect(html, value).toBe('<img data-silent-a-0="">');
    }
  });

  it("фильтрует applyProps и ElementImpl.setAttribute", async () => {
    const propsPage = (): Node => {
      const anchor = createElement("a");
      applyProps(anchor, {
        href: "vbscript:msgbox(1)",
        action: "javascript:alert(1)",
        title: "ok",
      });
      return anchor as unknown as Node;
    };
    expect((await renderToString(propsPage as unknown as AnyComponent, {})).html).toBe(
      '<a title="ok"></a>',
    );

    const element = new ElementImpl("a");
    element.setAttribute("href", "javascript:alert(1)");
    element.setAttribute("href", "/safe");
    expect(serializeNode(element)).toBe('<a href="/safe"></a>');
  });
});

describe("SSR: CSS-инъекции", () => {
  it("фильтрует небезопасные значения style-объекта", async () => {
    const page = (): Node => {
      const box = createElement("div");
      applyProps(box, {
        style: {
          color: "red;background:url(//evil)",
          background: "blue",
        },
      });
      return box as unknown as Node;
    };
    const { html } = await renderToString(page as unknown as AnyComponent, {});
    expect(html).toBe('<div style="background: blue;"></div>');
    expect(html).not.toContain("evil");
  });

  it("фильтрует style-строку в RawAttr", async () => {
    const page = (): Node => {
      const template = templateHoles('<div data-silent-a-0=""></div>')();
      attr(template.attrs[0]!, "style", () => "color: red; {}: blue;");
      return template.node;
    };
    const { html } = await renderToString(page as unknown as AnyComponent, {});
    expect(html).toBe('<div data-silent-a-0="" style="color: red"></div>');
  });

  it("StyleImpl не принимает инъекцию в имя и значение", () => {
    const style = new StyleImpl();
    style.cssText = "color: red; {}: blue;";
    expect(style.getPropertyValue("color")).toBe("red");
    expect(style.cssText).toBe("color: red;");

    style.setProperty("background", "url(//evil) }");
    expect(style.getPropertyValue("background")).toBe("");
    style.setProperty("color;background", "url(//evil)");
    expect(style.getPropertyValue("color;background")).toBe("");
  });

  it("не ломает CSS-переменные, вендорные префиксы и url/calc", () => {
    const style = new StyleImpl();
    style.cssText =
      "--gap: 12px; -webkit-line-clamp: 2; width: calc(100% - 1px); background: url(data:image/svg+xml;base64,PHN2Zy8+);";
    expect(style.getPropertyValue("--gap")).toBe("12px");
    expect(style.getPropertyValue("-webkit-line-clamp")).toBe("2");
    expect(style.getPropertyValue("width")).toBe("calc(100% - 1px)");
    expect(style.getPropertyValue("background")).toBe(
      "url(data:image/svg+xml;base64,PHN2Zy8+)",
    );
  });
});

describe("SSR: metadata-заглушка", () => {
  it("не мешает обычному рендеру", async () => {
    function Page(): Node {
      return view();
    }
    const result = await renderToString(Page as unknown as AnyComponent, {});
    expect(result.html).toBe("<p>body</p>");
  });
});
