import { describe, expect, it } from "vitest";
import {
  HTML_NAMESPACE,
  NODE_COMMENT,
  NODE_DOCUMENT_FRAGMENT,
  NODE_ELEMENT,
  NODE_TEXT,
  SVG_NAMESPACE,
} from "../src/dom/types";
import {
  CommentImpl,
  DocumentFragmentImpl,
  ElementImpl,
  NodeImpl,
  SvgElementImpl,
  TextImpl,
  isElementNode,
} from "../src/dom/node";

describe("NodeImpl", () => {
  it("создаёт узел с типом и пустыми связями", () => {
    const node = new NodeImpl(NODE_DOCUMENT_FRAGMENT);
    expect(node.nodeType).toBe(NODE_DOCUMENT_FRAGMENT);
    expect(node.parentNode).toBeNull();
    expect(node.firstChild).toBeNull();
    expect(node.lastChild).toBeNull();
    expect(node.nextSibling).toBeNull();
    expect(node.previousSibling).toBeNull();
    expect(node.childNodes).toHaveLength(0);
    expect(node.textContent).toBe("");
  });

  it("связывает детей при appendChild", () => {
    const parent = new ElementImpl("div");
    const first = new TextImpl("a");
    const second = new TextImpl("b");
    const third = new TextImpl("c");

    expect(parent.appendChild(first)).toBe(first);
    parent.appendChild(second);
    parent.appendChild(third);

    expect(parent.childNodes).toEqual([first, second, third]);
    expect(parent.firstChild).toBe(first);
    expect(parent.lastChild).toBe(third);
    expect(first.parentNode).toBe(parent);
    expect(first.nextSibling).toBe(second);
    expect(second.previousSibling).toBe(first);
    expect(third.nextSibling).toBeNull();
  });

  it("вставляет узел перед указанной ссылкой", () => {
    const parent = new ElementImpl("div");
    const first = new ElementImpl("i");
    const third = new ElementImpl("b");
    const second = new ElementImpl("em");
    parent.appendChild(first);
    parent.appendChild(third);

    expect(parent.insertBefore(second, third)).toBe(second);

    expect(parent.childNodes).toEqual([first, second, third]);
    expect(first.nextSibling).toBe(second);
    expect(second.previousSibling).toBe(first);
    expect(second.nextSibling).toBe(third);
    expect(third.previousSibling).toBe(second);
  });

  it("переносит узел из прежнего родителя", () => {
    const source = new ElementImpl("section");
    const target = new ElementImpl("div");
    const first = new ElementImpl("i");
    const second = new ElementImpl("b");
    source.appendChild(first);
    source.appendChild(second);

    target.appendChild(second);

    expect(source.childNodes).toEqual([first]);
    expect(target.childNodes).toEqual([second]);
    expect(second.parentNode).toBe(target);
    expect(first.nextSibling).toBeNull();
  });

  it("вставляет DocumentFragment по порядку и опустошает его", () => {
    const fragment = new DocumentFragmentImpl();
    const first = new TextImpl("a");
    const second = new TextImpl("b");
    fragment.appendChild(first);
    fragment.appendChild(second);
    const parent = new ElementImpl("div");
    const marker = new TextImpl("z");
    parent.appendChild(marker);

    expect(parent.insertBefore(fragment, marker)).toBe(fragment);

    expect(fragment.childNodes).toHaveLength(0);
    expect(fragment.firstChild).toBeNull();
    expect(parent.childNodes).toEqual([first, second, marker]);
    expect(first.parentNode).toBe(parent);
    expect(second.nextSibling).toBe(marker);
  });

  it("удаляет ребёнка и восстанавливает связи соседей", () => {
    const parent = new ElementImpl("div");
    const first = new ElementImpl("i");
    const second = new ElementImpl("b");
    const third = new ElementImpl("em");
    parent.appendChild(first);
    parent.appendChild(second);
    parent.appendChild(third);

    expect(parent.removeChild(second)).toBe(second);

    expect(parent.childNodes).toEqual([first, third]);
    expect(second.parentNode).toBeNull();
    expect(second.nextSibling).toBeNull();
    expect(second.previousSibling).toBeNull();
    expect(first.nextSibling).toBe(third);
    expect(third.previousSibling).toBe(first);
  });

  it("бросает NotFoundError при удалении чужого узла", () => {
    const parent = new ElementImpl("div");
    const other = new ElementImpl("section");
    const child = new ElementImpl("span");
    other.appendChild(child);

    expect(() => parent.removeChild(child)).toThrow("NotFoundError");
    expect(child.parentNode).toBe(other);
  });

  it("бросает NotFoundError при вставке перед чужим узлом", () => {
    const parent = new ElementImpl("div");
    const other = new ElementImpl("section");
    const reference = new ElementImpl("span");
    other.appendChild(reference);

    expect(() => parent.insertBefore(new ElementImpl("b"), reference)).toThrow("NotFoundError");
    expect(reference.parentNode).toBe(other);
  });

  it("собирает текст всех Text-потомков", () => {
    const root = new ElementImpl("div");
    const strong = new ElementImpl("strong");
    strong.appendChild(new TextImpl("inside"));
    root.appendChild(new TextImpl("start"));
    root.appendChild(strong);
    root.appendChild(new CommentImpl("ignored"));
    root.appendChild(new TextImpl("end"));

    expect(root.textContent).toBe("startinsideend");
  });

  it("заменяет детей одним Text при установке textContent", () => {
    const root = new ElementImpl("div");
    root.appendChild(new ElementImpl("span"));
    root.appendChild(new TextImpl("old"));

    root.textContent = "next";

    expect(root.childNodes).toHaveLength(1);
    expect(root.firstChild).toBeInstanceOf(TextImpl);
    expect(root.firstChild?.nodeType).toBe(NODE_TEXT);
    expect(root.textContent).toBe("next");

    root.textContent = null;

    expect(root.childNodes).toHaveLength(1);
    expect(root.firstChild).toBeInstanceOf(TextImpl);
    expect(root.textContent).toBe("");
  });

  it("клонирует элемент без детей при deep=false", () => {
    const element = new ElementImpl("div");
    element.setAttribute("ID", "root");
    element.style.setProperty("color", "red");
    element.appendChild(new TextImpl("child"));

    const clone = element.cloneNode() as ElementImpl;

    expect(clone).toBeInstanceOf(ElementImpl);
    expect(clone).not.toBe(element);
    expect(clone.tagName).toBe("DIV");
    expect(clone.getAttribute("id")).toBe("root");
    expect(clone.style.getPropertyValue("color")).toBe("red");
    expect(clone.style).not.toBe(element.style);
    expect(clone.childNodes).toHaveLength(0);
  });

  it("клонирует детей рекурсивно при deep=true", () => {
    const element = new ElementImpl("div");
    const child = new ElementImpl("span");
    child.setAttribute("title", "text");
    child.appendChild(new TextImpl("value"));
    element.appendChild(child);

    const clone = element.cloneNode(true) as ElementImpl;
    const clonedChild = clone.firstChild as ElementImpl;

    expect(clone.childNodes).toHaveLength(1);
    expect(clonedChild).toBeInstanceOf(ElementImpl);
    expect(clonedChild).not.toBe(child);
    expect(clonedChild.getAttribute("title")).toBe("text");
    expect(clonedChild.textContent).toBe("value");

    clonedChild.setAttribute("title", "changed");
    expect(child.getAttribute("title")).toBe("text");
  });

  it("клонирует DocumentFragment с детьми только при deep=true", () => {
    const fragment = new DocumentFragmentImpl();
    fragment.appendChild(new TextImpl("fragment"));

    const shallow = fragment.cloneNode() as DocumentFragmentImpl;
    const deep = fragment.cloneNode(true) as DocumentFragmentImpl;

    expect(shallow.nodeType).toBe(NODE_DOCUMENT_FRAGMENT);
    expect(shallow.childNodes).toHaveLength(0);
    expect(deep.textContent).toBe("fragment");
    expect(deep.firstChild).not.toBe(fragment.firstChild);
  });

  it("приводит имена атрибутов HTML к нижнему регистру", () => {
    const element = new ElementImpl("my-widget");

    expect(element.nodeType).toBe(NODE_ELEMENT);
    expect(element.tagName).toBe("MY-WIDGET");
    expect(element.nodeName).toBe("MY-WIDGET");
    expect(element.namespaceURI).toBe(HTML_NAMESPACE);

    element.setAttribute("Data-ID", "first");
    element.setAttribute("title", "second");

    expect(element.hasAttribute("data-id")).toBe(true);
    expect(element.hasAttribute("DATA-ID")).toBe(true);
    expect(element.getAttribute("DATA-id")).toBe("first");
    expect(element.attributes.item(0)?.name).toBe("data-id");
    expect(element.attributes.item(1)?.name).toBe("title");

    element.removeAttribute("DATA-ID");

    expect(element.hasAttribute("data-id")).toBe(false);
    expect(element.getAttribute("data-id")).toBeNull();
  });

  it("сохраняет регистр имён атрибутов SVG", () => {
    const path = new SvgElementImpl("path");

    expect(path.tagName).toBe("path");
    expect(path.namespaceURI).toBe(SVG_NAMESPACE);

    path.setAttribute("viewBox", "0 0 10 10");
    path.setAttribute("Data-X", "1");

    expect(path.hasAttribute("viewBox")).toBe(true);
    expect(path.hasAttribute("viewbox")).toBe(false);
    expect(path.getAttribute("Data-X")).toBe("1");
    expect(path.attributes.item(0)?.name).toBe("viewBox");
    expect(path.attributes.item(1)?.name).toBe("Data-X");
  });

  it("определяет типы текстовых узлов и комментариев", () => {
    const text = new TextImpl("text");
    const comment = new CommentImpl("comment");

    expect(text.nodeType).toBe(NODE_TEXT);
    expect(text.data).toBe("text");
    expect(comment.nodeType).toBe(NODE_COMMENT);
    expect(comment.data).toBe("comment");
    expect(comment.cloneNode() instanceof CommentImpl).toBe(true);
  });

  it("различает элементы и прочие узлы", () => {
    const element = new ElementImpl("div");
    const svg = new SvgElementImpl("svg");
    const text = new TextImpl("text");

    expect(isElementNode(element)).toBe(true);
    expect(isElementNode(svg)).toBe(true);
    expect(isElementNode(text)).toBe(false);
  });
});
