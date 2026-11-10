import { describe, expect, it } from "vitest";
import {
  HTML_NAMESPACE,
  NODE_COMMENT,
  NODE_DOCUMENT,
  NODE_DOCUMENT_FRAGMENT,
  NODE_ELEMENT,
  NODE_TEXT,
  SHOW_ALL,
  SHOW_COMMENT,
  SHOW_ELEMENT,
  SVG_NAMESPACE,
} from "../src/dom/types";
import type { DomCharacterData, DomNode, DomTreeWalker } from "../src/dom/types";
import {
  CommentImpl,
  DocumentFragmentImpl,
  ElementImpl,
  NodeImpl,
  SvgElementImpl,
  TextImpl,
} from "../src/dom/node";
import { TreeWalkerImpl, createDocument, installDomGlobals } from "../src/dom/document";
import { TemplateElementImpl } from "../src/dom/parser";
import { serializeNode } from "../src/dom/serializer";

const GLOBAL_NAMES = [
  "document",
  "Node",
  "Element",
  "SVGElement",
  "DocumentFragment",
  "Text",
  "Comment",
  "HTMLTemplateElement",
  "NodeFilter",
] as const;

function buildTree(document: ReturnType<typeof createDocument>): ElementImpl {
  const root = document.createElement("div");
  const heading = document.createElement("h1");
  heading.appendChild(document.createTextNode("title"));
  const button = document.createElement("button");
  root.appendChild(document.createComment("silent-hole-0"));
  root.appendChild(heading);
  root.appendChild(button);
  root.appendChild(document.createComment("silent-hole-1"));
  return root;
}

function walkLikeTemplateHoles(walker: DomTreeWalker): string[] {
  const labels: string[] = [];
  let current: DomNode | null = walker.currentNode;
  while (current !== null) {
    if (current.nodeType === NODE_COMMENT) {
      labels.push(`#${(current as DomCharacterData).data}`);
    } else if (current.nodeType === NODE_ELEMENT) {
      labels.push((current as ElementImpl).tagName);
    }
    current = walker.nextNode();
  }
  return labels;
}

describe("DocumentImpl", () => {
  it("создаёт документ с типом узла", () => {
    const document = createDocument();

    expect(document).toBeInstanceOf(Object);
    expect(document.nodeType).toBe(NODE_DOCUMENT);
    expect(createDocument()).not.toBe(createDocument());
  });

  it("создаёт элементы HTML, template и SVG", () => {
    const document = createDocument();

    const div = document.createElement("div");
    expect(div).toBeInstanceOf(ElementImpl);
    expect(div.tagName).toBe("DIV");
    expect(div.namespaceURI).toBe(HTML_NAMESPACE);

    const template = document.createElement("template");
    expect(template).toBeInstanceOf(TemplateElementImpl);
    expect(template.tagName).toBe("TEMPLATE");

    const svg = document.createElementNS(SVG_NAMESPACE, "linearGradient");
    expect(svg).toBeInstanceOf(SvgElementImpl);
    expect(svg.tagName).toBe("linearGradient");
    expect(svg.namespaceURI).toBe(SVG_NAMESPACE);

    const custom = document.createElementNS("urn:custom", "Widget");
    expect(custom).toBeInstanceOf(ElementImpl);
    expect(custom).not.toBeInstanceOf(SvgElementImpl);
    expect(custom.tagName).toBe("Widget");
    expect(custom.namespaceURI).toBe("urn:custom");
  });

  it("создаёт текстовые узлы, комментарии и фрагменты", () => {
    const document = createDocument();

    const text = document.createTextNode("value");
    expect(text).toBeInstanceOf(TextImpl);
    expect(text.nodeType).toBe(NODE_TEXT);
    expect(text.data).toBe("value");

    const comment = document.createComment("note");
    expect(comment).toBeInstanceOf(CommentImpl);
    expect(comment.nodeType).toBe(NODE_COMMENT);
    expect(comment.data).toBe("note");

    const fragment = document.createDocumentFragment();
    expect(fragment).toBeInstanceOf(DocumentFragmentImpl);
    expect(fragment.nodeType).toBe(NODE_DOCUMENT_FRAGMENT);
    expect(fragment.childNodes).toHaveLength(0);
  });

  it("создаёт TreeWalker с текущим узлом root", () => {
    const document = createDocument();
    const root = document.createElement("div");

    const walker = document.createTreeWalker(root, SHOW_ELEMENT);

    expect(walker).toBeInstanceOf(TreeWalkerImpl);
    expect(walker.currentNode).toBe(root);
  });
});

describe("TreeWalkerImpl", () => {
  it("обходит элементы и комментарии в pre-order", () => {
    const document = createDocument();
    const root = buildTree(document);
    const walker = document.createTreeWalker(root, SHOW_ELEMENT | SHOW_COMMENT);

    expect(walkLikeTemplateHoles(walker)).toEqual([
      "DIV",
      "#silent-hole-0",
      "H1",
      "BUTTON",
      "#silent-hole-1",
    ]);
  });

  it("пропускает текстовые узлы при SHOW_ELEMENT", () => {
    const document = createDocument();
    const root = buildTree(document);
    const walker = document.createTreeWalker(root, SHOW_ELEMENT);

    expect(walkLikeTemplateHoles(walker)).toEqual(["DIV", "H1", "BUTTON"]);
  });

  it("находит только комментарии при SHOW_COMMENT", () => {
    const document = createDocument();
    const root = buildTree(document);
    const walker = document.createTreeWalker(root, SHOW_COMMENT);
    const found: string[] = [];

    let current = walker.nextNode();
    while (current !== null) {
      found.push((current as DomCharacterData).data);
      current = walker.nextNode();
    }

    expect(found).toEqual(["silent-hole-0", "silent-hole-1"]);
  });

  it("возвращает текстовые узлы при SHOW_ALL", () => {
    const document = createDocument();
    const root = buildTree(document);
    const walker = document.createTreeWalker(root, SHOW_ALL);
    const types: number[] = [];

    let current = walker.nextNode();
    while (current !== null) {
      types.push(current.nodeType);
      current = walker.nextNode();
    }

    expect(types).toEqual([NODE_COMMENT, NODE_ELEMENT, NODE_TEXT, NODE_ELEMENT, NODE_COMMENT]);
  });

  it("не меняет currentNode, когда обход закончен", () => {
    const document = createDocument();
    const leaf = document.createElement("span");
    const walker = document.createTreeWalker(leaf, SHOW_ELEMENT);

    expect(walker.nextNode()).toBeNull();
    expect(walker.currentNode).toBe(leaf);
  });

  it("начинает обход с детей root-фрагмента", () => {
    const document = createDocument();
    const fragment = document.createDocumentFragment();
    const child = document.createElement("div");
    fragment.appendChild(child);
    const walker = document.createTreeWalker(fragment, SHOW_ELEMENT);

    expect(walker.currentNode).toBe(fragment);
    expect(walker.nextNode()).toBe(child);
    expect(walker.currentNode).toBe(child);
    expect(walker.nextNode()).toBeNull();
  });

  it("не выходит за пределы root", () => {
    const document = createDocument();
    const outer = document.createElement("div");
    const root = document.createElement("h1");
    const sibling = document.createElement("p");
    outer.appendChild(root);
    outer.appendChild(sibling);
    const walker = document.createTreeWalker(root, SHOW_ELEMENT);

    expect(walker.nextNode()).toBeNull();
    expect(walker.currentNode).toBe(root);
  });

  it("поднимается к родителям до root включительно", () => {
    const document = createDocument();
    const root = document.createElement("div");
    const section = document.createElement("section");
    const span = document.createElement("span");
    const text = document.createTextNode("x");
    span.appendChild(text);
    section.appendChild(span);
    root.appendChild(section);

    const walker = document.createTreeWalker(root, SHOW_ELEMENT);
    walker.currentNode = text;

    expect(walker.parentNode()).toBe(span);
    expect(walker.currentNode).toBe(span);
    expect(walker.parentNode()).toBe(section);
    expect(walker.parentNode()).toBe(root);
    expect(walker.currentNode).toBe(root);
    expect(walker.parentNode()).toBeNull();
    expect(walker.currentNode).toBe(root);
  });

  it("не находит родителей при неподходящем фильтре", () => {
    const document = createDocument();
    const root = document.createElement("div");
    const span = document.createElement("span");
    const text = document.createTextNode("x");
    span.appendChild(text);
    root.appendChild(span);

    const walker = document.createTreeWalker(root, SHOW_COMMENT);
    walker.currentNode = text;

    expect(walker.parentNode()).toBeNull();
    expect(walker.currentNode).toBe(text);
  });

  it("находит комментарии-якоря как templateHoles", () => {
    const document = createDocument();
    const template = document.createElement("template");
    if (!(template instanceof TemplateElementImpl)) {
      throw new Error("Ожидался TemplateElementImpl");
    }
    template.innerHTML =
      "<div><h1><!--silent-hole-0--></h1><p><span><!--silent-hole-1--></span></p></div>";

    const content = template.content.cloneNode(true);
    if (!(content instanceof DocumentFragmentImpl)) {
      throw new Error("Ожидался DocumentFragmentImpl");
    }
    const root = content.childNodes[0];
    if (!(root instanceof ElementImpl)) {
      throw new Error("Ожидался корневой элемент");
    }

    const walker = document.createTreeWalker(root, SHOW_ELEMENT | SHOW_COMMENT);
    const holes: string[] = [];
    let current: DomNode | null = walker.currentNode;
    while (current !== null) {
      if (current instanceof CommentImpl) {
        const match = /^silent-hole-(\d+)$/.exec(current.data);
        if (match !== null) {
          holes.push(match[0]);
        }
      }
      current = walker.nextNode();
    }

    expect(holes).toEqual(["silent-hole-0", "silent-hole-1"]);
  });
});

describe("installDomGlobals", () => {
  it("устанавливает и восстанавливает глобалы", () => {
    const document = createDocument();
    const previous = new Map<string, PropertyDescriptor | undefined>();
    for (const name of GLOBAL_NAMES) {
      previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    }

    const restore = installDomGlobals(document);

    expect(globalThis.document).toBe(document);
    expect(globalThis.Node).toBe(NodeImpl);
    expect(globalThis.Element).toBe(ElementImpl);
    expect(globalThis.SVGElement).toBe(SvgElementImpl);
    expect(globalThis.DocumentFragment).toBe(DocumentFragmentImpl);
    expect(globalThis.Text).toBe(TextImpl);
    expect(globalThis.Comment).toBe(CommentImpl);
    expect(globalThis.HTMLTemplateElement).toBe(TemplateElementImpl);
    expect(globalThis.NodeFilter.SHOW_ALL).toBe(SHOW_ALL);
    expect(globalThis.NodeFilter.SHOW_ELEMENT).toBe(SHOW_ELEMENT);
    expect(globalThis.NodeFilter.SHOW_COMMENT).toBe(SHOW_COMMENT);
    expect(globalThis.Node.ELEMENT_NODE).toBe(NODE_ELEMENT);
    expect(globalThis.Node.COMMENT_NODE).toBe(NODE_COMMENT);

    restore();

    for (const name of GLOBAL_NAMES) {
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
      const before = previous.get(name);
      if (before === undefined) {
        expect(descriptor).toBeUndefined();
      } else {
        expect(descriptor?.value).toBe(before.value);
      }
    }

    expect(() => restore()).not.toThrow();
  });

  it("создаёт документ по умолчанию", () => {
    const restore = installDomGlobals();

    expect(globalThis.document).toBeInstanceOf(Object);
    expect(globalThis.document.createElement("div")).toBeInstanceOf(ElementImpl);

    restore();
  });

  it("работает с templateHoles из @ivlev-dev/silent-core", async () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
    const restore = installDomGlobals();
    try {
      const core = await import("@ivlev-dev/silent-core");
      const factory = core.templateHoles(
        "<div class=\"app\"><h1><!--silent-hole-0--></h1><button data-silent-a-0=\"\"></button></div>",
      );
      const clone = factory();

      expect(clone.holes).toHaveLength(1);
      expect(clone.holes[0]?.data).toBe("silent-hole-0");
      expect(clone.attrs).toHaveLength(1);
      expect(clone.attrs[0]?.hasAttribute("data-silent-a-0")).toBe(false);

      const html = serializeNode(clone.node as unknown as DomNode);
      expect(html).toContain("<div class=\"app\">");
      expect(html).toContain("<button></button>");
    } finally {
      restore();
    }

    expect(Object.getOwnPropertyDescriptor(globalThis, "document")).toEqual(previous);
  });
});
