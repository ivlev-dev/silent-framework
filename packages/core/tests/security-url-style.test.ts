import { describe, expect, it } from "vitest";
import {
  applyProps,
  attr,
  createElement,
  spread,
  style,
} from "../src/dom.js";
import { normalizeStyle, styleDeclarations } from "../src/class-style.js";
import { isSafeStyleValue, isSafeUrlAttributeValue } from "../src/attribute-name.js";

function host(tag = "a"): HTMLElement {
  const element = document.createElement(tag);
  document.body.appendChild(element);
  return element;
}

describe("URL-атрибуты: allow-list", () => {
  it("разрешает относительные пути и безопасные схемы", () => {
    for (const value of [
      "",
      "#anchor",
      "/path",
      "./path",
      "../path",
      "?q=1",
      "http://example.com",
      "https://example.com/a?b=c",
      "mailto:user@example.com",
      "tel:+10000000000",
      "//cdn.example.com/a.js",
    ]) {
      expect(isSafeUrlAttributeValue("href", value)).toBe(true);
    }
  });

  it("блокирует javascript/data/vbscript/file и неизвестные схемы", () => {
    for (const value of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      " javascript:alert(1)",
      "\tjavascript:alert(1)",
      "java\nscript:alert(1)",
      "java\u0000script:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "foo:bar",
      "javascript&#x3a;alert(1)",
      "javascript&colon;alert(1)",
      "java&#115;cript:alert(1)",
      "&amp;#106;avascript:alert(1)",
    ]) {
      expect(isSafeUrlAttributeValue("href", value), value).toBe(false);
    }
  });

  it("применяет allow-list в attr, applyProps и spread", () => {
    const attrEl = host();
    attr(attrEl, "href", () => "javascript:alert(1)");
    expect(attrEl.hasAttribute("href")).toBe(false);

    const propsEl = host("img");
    applyProps(propsEl, {
      src: "data:text/html,<script>alert(1)</script>",
      alt: "ok",
    });
    expect(propsEl.hasAttribute("src")).toBe(false);
    expect(propsEl.getAttribute("alt")).toBe("ok");

    const spreadEl = host("form");
    spread(spreadEl, () => ({
      action: "\tjava\nscript:alert(1)",
      method: "post",
    }));
    expect(spreadEl.hasAttribute("action")).toBe(false);
    expect(spreadEl.getAttribute("method")).toBe("post");
  });

  it("не трогает Link-подобные безопасные href и обновляет значение", () => {
    const element = host();
    attr(element, "href", () => "javascript:alert(1)");
    expect(element.hasAttribute("href")).toBe(false);
    attr(element, "href", () => "/safe");
    expect(element.getAttribute("href")).toBe("/safe");
  });
});

describe("CSS-значения: запрет инъекции", () => {
  it("не пропускает ; { } @import в значении style-объекта", () => {
    const element = host("div");
    style(element, () => ({
      color: "red;background:url(//evil)",
      background: "url(//evil) } body { color: red",
      "border-color": "red; @import url(//evil)",
    }));
    expect(element.getAttribute("style")).toBeNull();

    const second = host("div");
    applyProps(second, {
      style: {
        color: "red",
        "--injected": "red;background:url(//evil)",
      },
    });
    expect(second.style.color).toBe("red");
    expect(second.style.getPropertyValue("--injected")).toBe("");
  });

  it("сохраняет CSS-переменные, вендорные префиксы и url/calc", () => {
    const declarations = styleDeclarations({
      "--gap": "12px",
      "-webkit-line-clamp": "2",
      background: "url(data:image/svg+xml;base64,PHN2Zy8+)",
      width: "calc(100% - 1px)",
      content: "\"a;b\"",
    });
    expect(declarations.get("--gap")).toBe("12px");
    expect(declarations.get("-webkit-line-clamp")).toBe("2");
    expect(declarations.get("background")).toBe(
      "url(data:image/svg+xml;base64,PHN2Zy8+)",
    );
    expect(declarations.get("width")).toBe("calc(100% - 1px)");
    expect(declarations.get("content")).toBe("\"a;b\"");
  });

  it("фильтрует небезопасные имена свойств в CSS-строке", () => {
    const element = host("div");
    applyProps(element, { style: "color: red; {}: blue; background: green;" });
    expect(element.style.color).toBe("red");
    expect(element.style.background).toBe("green");

    const text = normalizeStyle({
      color: "red",
      "color;background": "blue",
    });
    expect(text).toContain("color: red;");
    expect(text).not.toContain("background");
  });

  it("createElement + attr(style) фильтрует инъекцию", () => {
    const element = createElement("div") as HTMLElement;
    attr(element, "style", () => ({
      color: "red;background:url(//evil)",
    }));
    expect(element.getAttribute("style")).toBeNull();
  });
});

describe("CSS-значения: url и кавычки", () => {
  it("разрешает @ и expression( внутри url(...) и кавычек", () => {
    for (const value of [
      "url(https://cdn.example.com/font@2x.woff2)",
      'url("https://cdn.example.com/font@2x.woff2")',
      "url(expression(1))",
      '"expression("',
      "'a@b'",
      "calc(100% - 1px)",
    ]) {
      expect(isSafeStyleValue(value), value).toBe(true);
    }
  });

  it("запрещает top-level @, expression(, ; и {}", () => {
    for (const value of [
      "@import url(//evil)",
      "red; background: url(//evil)",
      "red} body { color: red",
      "expression(alert(1))",
      "\\expression(alert(1))",
      "url(x) expression(alert(1))",
      'url("x") @import url(//evil)',
    ]) {
      expect(isSafeStyleValue(value), value).toBe(false);
    }
  });

  it("сохраняет валидные url с @ и content с expression( в стилях", () => {
    const declarations = styleDeclarations({
      background: "url(https://cdn/font@2x.woff2)",
      content: '"expression("',
    });

    expect(declarations.get("background")).toBe("url(https://cdn/font@2x.woff2)");
    expect(declarations.get("content")).toBe('"expression("');
  });

  it("по-прежнему отбрасывает инъекции в стилях", () => {
    const declarations = styleDeclarations({
      background: "url(//evil) } body { color: red",
      content: '"x"; background: url(//evil)',
      width: "expression(alert(1))",
    });

    expect(declarations.size).toBe(0);
  });
});
