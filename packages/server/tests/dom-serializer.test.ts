import { describe, expect, it } from "vitest";
import {
  CommentImpl,
  DocumentFragmentImpl,
  ElementImpl,
  SvgElementImpl,
  TextImpl,
} from "../src/dom/node";
import { serializeChildren, serializeNode } from "../src/dom/serializer";

describe("serializer", () => {
  it("сериализует вложенные элементы и текст", () => {
    const root = new ElementImpl("div");
    const paragraph = new ElementImpl("p");
    const span = new ElementImpl("span");
    paragraph.appendChild(new TextImpl("Hello"));
    span.appendChild(new TextImpl("world"));
    paragraph.appendChild(span);
    root.appendChild(paragraph);

    expect(serializeNode(root)).toBe("<div><p>Hello<span>world</span></p></div>");
    expect(serializeChildren(root)).toBe("<p>Hello<span>world</span></p>");
  });

  it("не пишет закрывающий тег для HTML void-элементов", () => {
    const root = new ElementImpl("div");
    const image = new ElementImpl("img");
    image.setAttribute("src", "image.png");
    root.appendChild(new ElementImpl("br"));
    root.appendChild(image);
    root.appendChild(new ElementImpl("input"));
    root.appendChild(new ElementImpl("wbr"));

    expect(serializeNode(root)).toBe(
      '<div><br><img src="image.png"><input><wbr></div>',
    );
  });

  it("сериализует пустой атрибут как name=\"\"", () => {
    const input = new ElementImpl("input");
    input.setAttribute("disabled", "");
    input.setAttribute("data-empty", "");

    expect(serializeNode(input)).toBe('<input disabled="" data-empty="">');
  });

  it("сохраняет порядок атрибутов", () => {
    const element = new ElementImpl("div");
    element.setAttribute("data-third", "3");
    element.setAttribute("id", "first");
    element.setAttribute("class", "second");

    expect(serializeNode(element)).toBe(
      '<div data-third="3" id="first" class="second"></div>',
    );
  });

  it("экранирует специальные символы в тексте", () => {
    const element = new ElementImpl("p");
    element.appendChild(new TextImpl('5 < 6 & 7 > 4 "quoted"'));

    expect(serializeNode(element)).toBe('<p>5 &lt; 6 &amp; 7 &gt; 4 "quoted"</p>');
  });

  it("экранирует специальные символы в значениях атрибутов", () => {
    const element = new ElementImpl("div");
    element.setAttribute("title", 'a&b<c>d"e');

    expect(serializeNode(element)).toBe('<div title="a&amp;b&lt;c&gt;d&quot;e"></div>');
  });

  it("сериализует комментарии", () => {
    const root = new ElementImpl("div");
    root.appendChild(new CommentImpl("todo"));
    root.appendChild(new CommentImpl("<&>"));

    expect(serializeNode(root)).toBe("<div><!--todo--><!--<&>--></div>");
    expect(serializeNode(new CommentImpl("only"))).toBe("<!--only-->");
  });

  it("сериализует SVG-элементы с закрывающим тегом и исходным регистром", () => {
    const svg = new SvgElementImpl("svg");
    const gradient = new SvgElementImpl("linearGradient");
    const path = new SvgElementImpl("path");
    path.setAttribute("viewBox", "0 0 10 10");
    path.setAttribute("d", "M0 0L10 10");
    gradient.appendChild(new SvgElementImpl("stop"));
    svg.appendChild(gradient);
    svg.appendChild(path);

    expect(serializeNode(svg)).toBe(
      '<svg><linearGradient><stop></stop></linearGradient><path viewBox="0 0 10 10" d="M0 0L10 10"></path></svg>',
    );
  });

  it("сериализует DocumentFragment через его детей", () => {
    const fragment = new DocumentFragmentImpl();
    const paragraph = new ElementImpl("p");
    paragraph.appendChild(new TextImpl("one"));
    fragment.appendChild(paragraph);
    fragment.appendChild(new TextImpl("two"));

    expect(serializeNode(fragment)).toBe("<p>one</p>two");
    expect(serializeChildren(fragment)).toBe("<p>one</p>two");
  });

  it("приводит имена HTML-тегов к нижнему регистру", () => {
    const element = new ElementImpl("DIV");
    element.appendChild(new ElementImpl("SPAN"));

    expect(serializeNode(element)).toBe("<div><span></span></div>");
  });
});
