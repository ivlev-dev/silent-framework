import { describe, expect, it } from "vitest";
import { createDocument } from "../src/dom/document.js";
import { TemplateElementImpl } from "../src/dom/parser.js";
import { serializeNode } from "../src/dom/serializer.js";

describe("сериализация <template>", () => {
  it("обходит content, а не только childNodes", () => {
    const template = createDocument().createElement("template");
    expect(template).toBeInstanceOf(TemplateElementImpl);
    if (!(template instanceof TemplateElementImpl)) {
      throw new Error("Ожидался TemplateElementImpl");
    }
    template.innerHTML = '<div class="x"><b>hi</b><!--c--></div>';

    expect(template.childNodes).toHaveLength(0);
    expect(serializeNode(template)).toBe(
      '<template><div class="x"><b>hi</b><!--c--></div></template>',
    );
  });

  it("сериализует вложенный template", () => {
    const template = createDocument().createElement("template");
    if (!(template instanceof TemplateElementImpl)) {
      throw new Error("Ожидался TemplateElementImpl");
    }
    template.innerHTML = "<template><span>inner</span></template>";

    expect(serializeNode(template)).toBe(
      "<template><template><span>inner</span></template></template>",
    );
  });

  it("сохраняет содержимое в renderToString", () => {
    // Проверяется косвенно: serializer не теряет content в дереве документа.
    const document = createDocument();
    const template = document.createElement("template");
    if (!(template instanceof TemplateElementImpl)) {
      throw new Error("Ожидался TemplateElementImpl");
    }
    template.innerHTML = "<p>later</p>";
    const root = document.createElement("div");
    root.appendChild(template);

    expect(serializeNode(root)).toBe(
      '<div><template><p>later</p></template></div>',
    );
  });
});
