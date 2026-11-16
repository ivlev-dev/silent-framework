// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { templateHoles, type TemplatePlan } from "../src/dom";
import "../src/dom-hydration";
import { shapeMatches } from "../src/hydration";

const SVG_NS = "http://www.w3.org/2000/svg";
const HTML_NS = "http://www.w3.org/1999/xhtml";

function namespaceOf(node: Node): string | null {
  return node instanceof Element ? node.namespaceURI : null;
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe("templateHoles: SVG namespace", () => {
  it("парсит одиночный path в SVG namespace при явной подсказке", () => {
    const clone = templateHoles(`<path d="M0 0h8"></path>`, undefined, "svg")();
    expect(namespaceOf(clone.node)).toBe(SVG_NS);
    expect((clone.node as Element).tagName).toBe("path");
    expect((clone.node as Element).getAttribute("d")).toBe("M0 0h8");
  });

  it("автоопределяет SVG по первому корневому тегу", () => {
    const clone = templateHoles(`<circle r="4"></circle>`)();
    expect(namespaceOf(clone.node)).toBe(SVG_NS);
    expect((clone.node as Element).tagName).toBe("circle");
  });

  it("автоопределяет camelCase SVG-теги по нижнему регистру", () => {
    const clone = templateHoles(
      `<lineargradient><stop offset="0"></stop></lineargradient>`,
    )();
    expect(namespaceOf(clone.node)).toBe(SVG_NS);
    expect((clone.node as Element).tagName).toBe("linearGradient");
    expect(namespaceOf(clone.node.firstChild as Node)).toBe(SVG_NS);
  });

  it("оставляет HTML namespace для обычных тегов", () => {
    const clone = templateHoles(`<div class="box"></div>`)();
    expect(namespaceOf(clone.node)).toBe(HTML_NS);
  });

  it("не включает svg в автоопределение: корневой svg остаётся svg", () => {
    const clone = templateHoles(`<svg><path d="M0 0h8"></path></svg>`)();
    expect(namespaceOf(clone.node)).toBe(SVG_NS);
    expect(namespaceOf(clone.node.firstChild as Node)).toBe(SVG_NS);
  });

  it("разрешает roots, holes, attrs и strips без обёртки", () => {
    const html =
      `<g data-silent-a-0=""><path d="M0 0h8"></path><!--silent-hole-0--></g>`;
    const plan: TemplatePlan = {
      roots: 1,
      holes: [{ path: [0, 1], counts: [1, 2] }],
      attrs: [{ path: [0], counts: [1] }],
      strips: [{ path: [0], counts: [1], names: ["data-silent-a-0"] }],
    };
    const clone = templateHoles(html, plan, "svg")();
    expect(namespaceOf(clone.node)).toBe(SVG_NS);
    expect((clone.node as Element).tagName).toBe("g");
    expect(clone.attrs[0]).toBe(clone.node);
    expect((clone.node as Element).hasAttribute("data-silent-a-0")).toBe(false);
    expect(clone.holes[0]?.parentNode).toBe(clone.node);
    expect(namespaceOf(clone.node.firstChild as Node)).toBe(SVG_NS);
  });

  it("возвращает DocumentFragment для нескольких SVG-корней", () => {
    const clone = templateHoles(
      `<path d="M0 0h8"></path><circle r="2"></circle>`,
      undefined,
      "svg",
    )();
    expect(clone.node.nodeType).toBe(Node.DOCUMENT_FRAGMENT_NODE);
    expect(clone.node.childNodes.length).toBe(2);
    for (const child of Array.from(clone.node.childNodes)) {
      expect(namespaceOf(child)).toBe(SVG_NS);
    }
  });

  it("совпадает с серверной разметкой по namespaceURI", () => {
    const fresh = templateHoles(`<path d="M0 0h8"></path>`)();
    const svgNode = document.createElementNS(SVG_NS, "path");
    svgNode.setAttribute("d", "M0 0h8");
    const htmlNode = document.createElement("path");
    htmlNode.setAttribute("d", "M0 0h8");
    expect(shapeMatches(fresh.node, svgNode, true)).toBe(true);
    expect(shapeMatches(fresh.node, htmlNode, true)).toBe(false);
  });

  it("вставляет SVG-узел внутрь svg с корректным parent и namespace", () => {
    const svg = document.createElementNS(SVG_NS, "svg");
    document.body.appendChild(svg);
    const clone = templateHoles(`<path d="M0 0h8"></path>`, undefined, "svg")();
    svg.appendChild(clone.node);
    expect(clone.node.parentNode).toBe(svg);
    expect(namespaceOf(clone.node)).toBe(SVG_NS);
    expect(namespaceOf(svg.firstChild as Node)).toBe(SVG_NS);
  });
});
