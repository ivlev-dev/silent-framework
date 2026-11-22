import { afterEach, describe, expect, it } from "vitest";
import {
  Head,
  applyProps,
  attr,
  createElement,
  spread,
  templateHoles,
  type AnyComponent,
} from "@ivlev-dev/silent-core";
import { renderToString } from "../src/render.js";
import { clearTemplateCache } from "../src/template-cache.js";
import { AttributesImpl } from "../src/dom/attributes.js";
import { ElementImpl, SvgElementImpl } from "../src/dom/node.js";
import { escapeRawText, serializeNode } from "../src/dom/serializer.js";

afterEach(() => {
  clearTemplateCache();
});

function view(): Node {
  return templateHoles("<p>body</p>")().node as unknown as Node;
}

describe("SSR: имена атрибутов", () => {
  it("не пропускает breakout через Head meta", async () => {
    function Page(): Node {
      Head({
        title: "safe",
        meta: [
          {
            name: "description",
            content: "ok",
            "x><script>alert(1)</script><meta y": "z",
            onload: "alert(2)",
          },
        ],
      });
      return view();
    }

    const { head } = await renderToString(Page as unknown as AnyComponent, {});

    expect(head).toContain('name="description"');
    expect(head).toContain('content="ok"');
    expect(head).not.toContain("<script");
    expect(head).not.toContain("onload");
    expect(head).not.toContain("alert(");
  });

  it("сохраняет валидные data-*, aria-* и namespace-атрибуты в Head", async () => {
    function Page(): Node {
      Head({
        meta: [
          {
            name: "x",
            content: "y",
            "data-custom": "1",
            "aria-label": "label",
            "aria-Label": "label-2",
            "xml:lang": "ru",
            xlinkHref: "#icon",
            onClick: "alert(1)",
          },
        ],
      });
      return view();
    }

    const { head } = await renderToString(Page as unknown as AnyComponent, {});

    expect(head).toContain('data-custom="1"');
    expect(head).toContain('aria-label="label-2"');
    expect(head).toContain('xml:lang="ru"');
    expect(head).toContain('xlink:href="#icon"');
    expect(head).not.toContain("aria--label");
    expect(head).not.toContain("xlink-href");
    expect(head).not.toContain("onclick");
    expect(head).not.toContain("on-click");
    expect(head).not.toContain("alert(");
  });

  it("отбрасывает breakout в spread на SSR", async () => {
    const page = (): Node => {
      const template = templateHoles('<span data-silent-a-0=""></span>')();
      spread(template.attrs[0]!, () => ({
        "x onmouseover=alert(1) y": "z",
        onerror: "alert(1)",
        onload: "alert(2)",
        ontoggle: "alert(3)",
        onClick: () => undefined,
        title: "ok",
        "data-x": "1",
      }));
      return template.node;
    };

    const { html } = await renderToString(page as unknown as AnyComponent, {});

    expect(html).toBe('<span data-silent-a-0="" title="ok" data-x="1"></span>');
  });

  it("отбрасывает небезопасные имена в attr и applyProps", async () => {
    const attrPage = (): Node => {
      const template = templateHoles('<i data-silent-a-0=""></i>')();
      attr(template.attrs[0]!, "x onmouseover=alert(1) y", () => "z");
      attr(template.attrs[0]!, "onerror", () => "alert(1)");
      attr(template.attrs[0]!, "data-ok", () => "1");
      return template.node;
    };

    const propsPage = (): Node => {
      const element = createElement("div");
      applyProps(element, {
        "x onmouseover=alert(1) y": "z",
        onerror: "alert(1)",
        "data-ok": "1",
        "aria-label": "a",
      });
      return element as unknown as Node;
    };

    expect((await renderToString(attrPage as unknown as AnyComponent, {})).html).toBe(
      '<i data-silent-a-0="" data-ok="1"></i>',
    );
    expect((await renderToString(propsPage as unknown as AnyComponent, {})).html).toBe(
      '<div data-ok="1" aria-label="a"></div>',
    );
  });

  it("не выводит события из spread на SSR", async () => {
    const page = (): Node => {
      const template = templateHoles('<b data-silent-a-0=""></b>')();
      spread(template.attrs[0]!, () => ({
        onclick: () => undefined,
        onerror: "alert(1)",
        onload: "alert(2)",
        ontoggle: "alert(3)",
        "on:custom": () => undefined,
        id: "ok",
      }));
      return template.node;
    };

    const { html } = await renderToString(page as unknown as AnyComponent, {});

    expect(html).toBe('<b data-silent-a-0="" id="ok"></b>');
  });
});

describe("SSR: сериализатор атрибутов", () => {
  it("игнорирует небезопасные имена в ElementImpl.setAttribute", () => {
    const element = new ElementImpl("div");
    element.setAttribute("x onmouseover=alert(1) y", "z");
    element.setAttribute("onerror", "alert(1)");
    element.setAttribute("data-ok", "1");
    element.setAttribute("aria-label", "a");

    expect(serializeNode(element)).toBe('<div data-ok="1" aria-label="a"></div>');
    expect(element.attributeCount).toBe(2);
  });

  it("игнорирует небезопасные имена в AttributesImpl.set", () => {
    const attributes = new AttributesImpl();
    attributes.set("x onmouseover=alert(1) y", "z");
    attributes.set("onerror", "alert(1)");
    attributes.set("data-ok", "1");

    expect(attributes.length).toBe(1);
    expect(attributes.get("data-ok")).toBe("1");
  });

  it("сохраняет namespace-атрибуты у SVG", () => {
    const use = new SvgElementImpl("use");
    use.setAttribute("xlink:href", "#icon");
    use.setAttribute("viewBox", "0 0 10 10");

    expect(serializeNode(use)).toBe('<use xlink:href="#icon" viewBox="0 0 10 10"></use>');
  });
});

describe("SSR: raw-text <style>/<script>", () => {
  it("нейтрализует breakout через Head style", async () => {
    function Page(): Node {
      Head({ style: [{ css: "a{}</style><script>alert(1)</script>" }] });
      return view();
    }

    const { head } = await renderToString(Page as unknown as AnyComponent, {});

    expect(head).toContain("<\\/style>");
    expect(head.match(/<\/style>/g)).toHaveLength(1);
    expect(head).not.toContain("</style><script>");
  });

  it("нейтрализует breakout в style через createElement + textContent", async () => {
    const page = (): Node => {
      const style = createElement("style");
      style.textContent = "a{}</style><script>alert(1)</script>";
      return style as unknown as Node;
    };

    const { html } = await renderToString(page as unknown as AnyComponent, {});

    expect(html).toBe("<style>a{}<\\/style><script>alert(1)</script></style>");
    expect(html.match(/<\/style>/g)).toHaveLength(1);
    expect(html).not.toContain("</style><script>");
  });

  it("нейтрализует breakout в script через createElement + textContent", async () => {
    const page = (): Node => {
      const script = createElement("script");
      script.textContent = 'const html = "</script><b>x</b>";';
      return script as unknown as Node;
    };

    const { html } = await renderToString(page as unknown as AnyComponent, {});

    expect(html).toBe(
      '<script>const html = "<\\/script><b>x</b>";</script>',
    );
    expect(html).not.toContain("</script><b>");
  });

  it("не трогает похожий, но не закрывающий тег", () => {
    const script = new ElementImpl("script");
    script.textContent = 'var s = "</scriptx>";';

    expect(serializeNode(script)).toBe('<script>var s = "</scriptx>";</script>');
  });

  it("сохраняет <!-- в JSON-LD и CSS, не ломая их", () => {
    const jsonLd = new ElementImpl("script");
    jsonLd.setAttribute("type", "application/ld+json");
    jsonLd.textContent = '{"x":"<!--"}';
    expect(serializeNode(jsonLd)).toBe(
      '<script type="application/ld+json">{"x":"<!--"}</script>',
    );

    const style = new ElementImpl("style");
    style.textContent = 'a::before{content:"<!--"}';
    expect(serializeNode(style)).toBe('<style>a::before{content:"<!--"}</style>');
  });

  it("не ломает уже экранированный закрывающий тег и не трогает </scriptx>", () => {
    expect(escapeRawText("script", 'var s = "<\\/script>";')).toBe(
      'var s = "<\\/script>";',
    );
    expect(escapeRawText("script", "</SCRIPT >")).toBe("<\\/SCRIPT >");
    expect(escapeRawText("script", "</scriptx>")).toBe("</scriptx>");
    expect(escapeRawText("style", "</style/")).toBe("<\\/style/");
  });

  it("не сериализует невалидное имя тега", () => {
    const forged = new ElementImpl("div><script>alert(1)</script>");

    expect(() => serializeNode(forged)).toThrow(/Недопустимое имя тега/);
  });

  it("пишет xlink:href через attr на SSR без падения", async () => {
    const page = (): Node => {
      const use = createElement("use");
      attr(use, "xlink:href", () => "#icon");
      attr(use, "viewBox", () => "0 0 10 10");
      return use as unknown as Node;
    };

    const { html } = await renderToString(page as unknown as AnyComponent, {});

    expect(html).toBe('<use xlink:href="#icon" viewBox="0 0 10 10"></use>');
  });
});
