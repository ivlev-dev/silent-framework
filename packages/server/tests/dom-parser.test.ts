import { describe, expect, it } from "vitest";
import {
  HtmlParseError,
  TemplateElementImpl,
  parseHtmlFragment,
} from "../src/dom/parser";
import { createDocument } from "../src/dom/document";
import { serializeNode } from "../src/dom/serializer";
import {
  HTML_NAMESPACE,
  NODE_COMMENT,
  NODE_ELEMENT,
  NODE_TEXT,
  SVG_NAMESPACE,
} from "../src/dom/types";
import { CommentImpl, ElementImpl, TextImpl } from "../src/dom/node";
import type { DomNode } from "../src/dom/types";

const document = createDocument();

function nodeAt(nodes: readonly DomNode[], index: number): DomNode {
  const node = nodes[index];
  if (node === undefined) {
    throw new Error(`Нет узла с индексом ${index}`);
  }
  return node;
}

function elementAt(nodes: readonly DomNode[], index: number): ElementImpl {
  const node = nodeAt(nodes, index);
  if (!(node instanceof ElementImpl)) {
    throw new Error(`Узел ${index} не является элементом`);
  }
  return node;
}

function parseError(source: string): HtmlParseError {
  try {
    parseHtmlFragment(document, source);
  } catch (error) {
    if (error instanceof HtmlParseError) {
      return error;
    }
    throw error;
  }
  throw new Error("Ожидалась HtmlParseError");
}

describe("parseHtmlFragment", () => {
  it("парсит простое дерево", () => {
    const nodes = parseHtmlFragment(document, "<div><p>hello</p></div>");

    expect(nodes).toHaveLength(1);
    const root = elementAt(nodes, 0);
    expect(root.nodeType).toBe(NODE_ELEMENT);
    expect(root.tagName).toBe("DIV");
    expect(root.namespaceURI).toBe(HTML_NAMESPACE);
    expect(root.childNodes).toHaveLength(1);

    const paragraph = root.firstChild;
    expect(paragraph).toBeInstanceOf(ElementImpl);
    expect((paragraph as ElementImpl).tagName).toBe("P");
    expect(paragraph?.textContent).toBe("hello");
    expect(paragraph?.firstChild?.nodeType).toBe(NODE_TEXT);
  });

  it("возвращает несколько верхнеуровневых узлов", () => {
    const nodes = parseHtmlFragment(document, "<span>a</span><span>b</span>");

    expect(nodes).toHaveLength(2);
    expect(serializeNode(nodeAt(nodes, 0))).toBe("<span>a</span>");
    expect(serializeNode(nodeAt(nodes, 1))).toBe("<span>b</span>");
  });

  it("сохраняет вложенность и порядок детей", () => {
    const nodes = parseHtmlFragment(document, "<ul><li>one</li><li><b>two</b></li></ul>");
    const list = elementAt(nodes, 0);

    expect(list.childNodes).toHaveLength(2);
    const second = list.childNodes[1];
    expect(second).toBeInstanceOf(ElementImpl);
    expect((second as ElementImpl).tagName).toBe("LI");
    expect(second?.firstChild?.nodeType).toBe(NODE_ELEMENT);
    expect(second?.textContent).toBe("two");
    expect(serializeNode(list)).toBe("<ul><li>one</li><li><b>two</b></li></ul>");
  });

  it("сохраняет пробелы в текстовых узлах", () => {
    const nodes = parseHtmlFragment(document, "<div> a  b </div>");

    expect(nodeAt(nodes, 0).textContent).toBe(" a  b ");
  });

  it("приводит имена HTML-тегов к нижнему регистру", () => {
    const nodes = parseHtmlFragment(document, "<DIV><SPAN>x</SPAN></DIV>");
    const root = elementAt(nodes, 0);

    expect(root.tagName).toBe("DIV");
    expect(serializeNode(root)).toBe("<div><span>x</span></div>");
  });

  it("парсит атрибуты в кавычках, пустые и boolean", () => {
    const nodes = parseHtmlFragment(
      document,
      "<div id=\"main\" class='app' data-empty=\"\" hidden data-x=1></div>",
    );
    const root = elementAt(nodes, 0);

    expect(root.getAttribute("id")).toBe("main");
    expect(root.getAttribute("class")).toBe("app");
    expect(root.getAttribute("data-empty")).toBe("");
    expect(root.hasAttribute("hidden")).toBe(true);
    expect(root.getAttribute("hidden")).toBe("");
    expect(root.getAttribute("data-x")).toBe("1");
    expect(root.attributes.length).toBe(5);
  });

  it("приводит имена HTML-атрибутов к нижнему регистру", () => {
    const nodes = parseHtmlFragment(document, "<div DATA-X=\"1\"></div>");
    const root = elementAt(nodes, 0);

    expect(root.hasAttribute("data-x")).toBe(true);
    expect(root.attributes.item(0)?.name).toBe("data-x");
  });

  it("декодирует сущности в тексте", () => {
    const nodes = parseHtmlFragment(
      document,
      "<p>&amp; &lt; &gt; &quot; &#39; &#x27; &#123; &#x1F600;</p>",
    );
    const paragraph = nodeAt(nodes, 0);

    expect(paragraph.textContent).toBe("& < > \" ' ' { \u{1F600}");
    expect(paragraph.firstChild).toBeInstanceOf(TextImpl);
  });

  it("декодирует сущности в значениях атрибутов", () => {
    const nodes = parseHtmlFragment(
      document,
      "<div title=\"a &amp; b &quot;c&quot; &lt;d&gt;\"></div>",
    );
    const root = elementAt(nodes, 0);

    expect(root.getAttribute("title")).toBe("a & b \"c\" <d>");
  });

  it("парсит комментарии как есть", () => {
    const nodes = parseHtmlFragment(document, "<div><!--silent-hole-0--><!-- <b> --></div>");
    const root = elementAt(nodes, 0);

    expect(root.childNodes).toHaveLength(2);
    const first = root.childNodes[0];
    expect(first).toBeInstanceOf(CommentImpl);
    expect(first?.nodeType).toBe(NODE_COMMENT);
    expect((first as CommentImpl).data).toBe("silent-hole-0");
    expect((root.childNodes[1] as CommentImpl).data).toBe(" <b> ");
    expect(serializeNode(root)).toBe("<div><!--silent-hole-0--><!-- <b> --></div>");
  });

  it("не требует закрывающих тегов для void-элементов", () => {
    const nodes = parseHtmlFragment(
      document,
      "<div><br><img src=\"a.png\"><input disabled><hr/></div>",
    );
    const root = elementAt(nodes, 0);

    expect(root.childNodes).toHaveLength(4);
    expect(serializeNode(root)).toBe(
      "<div><br><img src=\"a.png\"><input disabled=\"\"><hr></div>",
    );
  });

  it("игнорирует закрывающий тег void-элемента", () => {
    const nodes = parseHtmlFragment(document, "<div><br></br><span>x</span></div>");
    const root = elementAt(nodes, 0);

    expect(root.childNodes).toHaveLength(2);
    expect(serializeNode(root)).toBe("<div><br><span>x</span></div>");
  });

  it("создаёт SVG-элементы с namespace и сохраняет регистр", () => {
    const nodes = parseHtmlFragment(
      document,
      "<svg viewBox=\"0 0 10 10\"><linearGradient id=\"g\"><stop offset=\"0\" /></linearGradient></svg>",
    );
    const svg = elementAt(nodes, 0);

    expect(svg.namespaceURI).toBe(SVG_NAMESPACE);
    expect(svg.tagName).toBe("svg");
    expect(svg.getAttribute("viewBox")).toBe("0 0 10 10");
    expect(svg.hasAttribute("viewbox")).toBe(false);

    const gradient = svg.childNodes[0];
    expect(gradient).toBeInstanceOf(ElementImpl);
    expect((gradient as ElementImpl).namespaceURI).toBe(SVG_NAMESPACE);
    expect((gradient as ElementImpl).tagName).toBe("linearGradient");
    expect(gradient?.childNodes).toHaveLength(1);
    expect((gradient?.childNodes[0] as ElementImpl).tagName).toBe("stop");
    expect(serializeNode(svg)).toBe(
      "<svg viewBox=\"0 0 10 10\"><linearGradient id=\"g\"><stop offset=\"0\"></stop></linearGradient></svg>",
    );
  });

  it("возвращает HTML-режим после закрытия svg", () => {
    const nodes = parseHtmlFragment(document, "<svg><g></g></svg><p>text</p>");
    const svg = elementAt(nodes, 0);
    const paragraph = elementAt(nodes, 1);

    expect(svg.namespaceURI).toBe(SVG_NAMESPACE);
    expect(svg.childNodes[0]).toBeInstanceOf(ElementImpl);
    expect((svg.childNodes[0] as ElementImpl).namespaceURI).toBe(SVG_NAMESPACE);
    expect(paragraph.namespaceURI).toBe(HTML_NAMESPACE);
    expect(paragraph.tagName).toBe("P");
  });

  it("бросает HtmlParseError на незакрытом теге", () => {
    const error = parseError("<div><span>text");

    expect(error).toBeInstanceOf(HtmlParseError);
    expect(error.position).toBe(5);
    expect(error.message).toContain("span");
  });

  it("бросает HtmlParseError на неверном закрывающем теге", () => {
    const error = parseError("<div><b></div>");

    expect(error).toBeInstanceOf(HtmlParseError);
    expect(error.position).toBe(8);
    expect(error.message).toContain("</div>");
  });

  it("бросает HtmlParseError на закрывающем теге без открытого", () => {
    const error = parseError("<div></div></div>");

    expect(error).toBeInstanceOf(HtmlParseError);
    expect(error.position).toBe(11);
  });

  it("бросает HtmlParseError на незавершённом комментарии", () => {
    const error = parseError("<div><!-- x</div>");

    expect(error).toBeInstanceOf(HtmlParseError);
    expect(error.position).toBe(5);
  });
});

describe("TemplateElementImpl", () => {
  it("создаётся через document.createElement", () => {
    const template = document.createElement("template");

    expect(template).toBeInstanceOf(TemplateElementImpl);
    expect(template.tagName).toBe("TEMPLATE");
    expect(template.nodeType).toBe(NODE_ELEMENT);
  });

  it("парсит innerHTML в content и сериализует обратно", () => {
    const template = document.createElement("template");
    expect(template).toBeInstanceOf(TemplateElementImpl);
    if (!(template instanceof TemplateElementImpl)) {
      throw new Error("Ожидался TemplateElementImpl");
    }

    template.innerHTML = "<div class=\"app\"><b>hi</b><!--silent-hole-0--></div>";

    expect(template.childNodes).toHaveLength(0);
    expect(template.content.childNodes).toHaveLength(1);
    const root = template.content.childNodes[0];
    expect(root).toBeInstanceOf(ElementImpl);
    expect((root as ElementImpl).tagName).toBe("DIV");
    expect((root as ElementImpl).getAttribute("class")).toBe("app");
    expect(root?.childNodes).toHaveLength(2);
    expect(root?.childNodes[1]?.nodeType).toBe(NODE_COMMENT);
    expect(template.innerHTML).toBe("<div class=\"app\"><b>hi</b><!--silent-hole-0--></div>");
  });

  it("очищает content при повторной записи innerHTML", () => {
    const template = document.createElement("template");
    if (!(template instanceof TemplateElementImpl)) {
      throw new Error("Ожидался TemplateElementImpl");
    }
    const content = template.content;

    template.innerHTML = "<span>first</span>";
    template.innerHTML = "<p>second</p><p>third</p>";

    expect(template.content).toBe(content);
    expect(content.childNodes).toHaveLength(2);
    expect(content.textContent).toBe("secondthird");
    expect(template.innerHTML).toBe("<p>second</p><p>third</p>");
  });

  it("сериализует пустой content как пустую строку", () => {
    const template = document.createElement("template");
    if (!(template instanceof TemplateElementImpl)) {
      throw new Error("Ожидался TemplateElementImpl");
    }

    expect(template.innerHTML).toBe("");
  });
});
