import { describe, expect, it } from "vitest";
import { createDocument } from "../src/dom/document.js";
import { serializeNode } from "../src/dom/serializer.js";
import { StyleImpl } from "../src/dom/style.js";

const CSS =
  'background: url(data:image/svg+xml;base64,PHN2Zy8+); content: "a;b"; color: red;';

describe("StyleImpl.cssText", () => {
  it("не режет по ; внутри data-URI и строк", () => {
    const style = new StyleImpl();
    style.cssText = CSS;

    expect(style.getPropertyValue("background")).toBe(
      "url(data:image/svg+xml;base64,PHN2Zy8+)",
    );
    expect(style.getPropertyValue("content")).toBe('"a;b"');
    expect(style.getPropertyValue("color")).toBe("red");
  });

  it("делает round-trip cssText с data-URI и content", () => {
    const first = new StyleImpl();
    first.cssText = CSS;

    const second = new StyleImpl();
    second.cssText = first.cssText;

    expect(second.getPropertyValue("background")).toBe(
      "url(data:image/svg+xml;base64,PHN2Zy8+)",
    );
    expect(second.getPropertyValue("content")).toBe('"a;b"');
    expect(second.getPropertyValue("color")).toBe("red");
    expect(second.cssText).toBe(first.cssText);
  });

  it("учитывает экранирование и вложенные скобки", () => {
    const style = new StyleImpl();
    style.cssText = 'content: "a\\";b"; background: url("x;(y);z");';

    expect(style.getPropertyValue("content")).toBe('"a\\";b"');
    expect(style.getPropertyValue("background")).toBe('url("x;(y);z")');
  });

  it("работает через атрибут style мини-DOM", () => {
    const element = createDocument().createElement("div");
    element.setAttribute("style", CSS);

    expect(element.style.getPropertyValue("background")).toBe(
      "url(data:image/svg+xml;base64,PHN2Zy8+)",
    );
    expect(element.style.getPropertyValue("content")).toBe('"a;b"');
    expect(serializeNode(element)).toContain(
      "data:image/svg+xml;base64,PHN2Zy8+",
    );
  });
});
