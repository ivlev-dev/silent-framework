// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createRoot } from "@ivlev-dev/silent-reactivity";
import {
  normalizeStyle,
  styleDeclarations,
  styleValue,
} from "../src/class-style";
import { style } from "../src/dom";

function declarations(value: string): Record<string, string> {
  return Object.fromEntries(styleDeclarations(value));
}

describe("разбор строкового style", () => {
  it("не режет data-URI по точке с запятой", () => {
    const value = "background:url(data:image/svg+xml;base64,AAA)";
    expect(declarations(value)).toEqual({
      background: "url(data:image/svg+xml;base64,AAA)",
    });
    expect(normalizeStyle(value)).toBe(
      "background: url(data:image/svg+xml;base64,AAA);",
    );
  });

  it("учитывает кавычки в значении", () => {
    expect(declarations('content:"a;b"; color: red')).toEqual({
      content: '"a;b"',
      color: "red",
    });
    expect(declarations("font-family:'a;b', sans-serif; color: red")).toEqual({
      "font-family": "'a;b', sans-serif",
      color: "red",
    });
  });

  it("учитывает экранированные кавычки и точки с запятой", () => {
    expect(declarations('content: "a;\\"b"; color: red')).toEqual({
      content: '"a;\\"b"',
      color: "red",
    });
    expect(declarations("content: 'it\\'s; ok'; color: red")).toEqual({
      content: "'it\\'s; ok'",
      color: "red",
    });
  });

  it("учитывает вложенные скобки", () => {
    const value =
      "grid-template-areas: \"a b\" \"c d\"; filter: drop-shadow(0 0 calc(1px + var(--x, 2px)))";
    expect(declarations(value)).toEqual({
      "grid-template-areas": '"a b" "c d"',
      filter: "drop-shadow(0 0 calc(1px + var(--x, 2px)))",
    });
  });

  it("поддерживает CSS-переменные и двоеточие в значении", () => {
    expect(declarations("--main-color: #fff; --ratio: 16:9; color: var(--main-color)")).toEqual({
      "--main-color": "#fff",
      "--ratio": "16:9",
      color: "var(--main-color)",
    });
  });

  it("сохраняет !important", () => {
    expect(declarations("color: red !important; margin: 0")).toEqual({
      color: "red !important",
      margin: "0",
    });
  });

  it("пропускает пустые декларации и удаляет свойство с пустым значением", () => {
    expect(declarations(";; color: red;;")).toEqual({ color: "red" });
    expect(normalizeStyle("color: red", "color:")).toBe("");
    expect(normalizeStyle("color: red", "color")).toBe("");
    expect(normalizeStyle(";;;")).toBe("");
  });

  it("переживает round-trip normalizeStyle", () => {
    const source =
      'background: url("data:image/svg+xml;base64,AAA"); content: "a;b"; color: red !important';
    const once = normalizeStyle(source);
    const twice = normalizeStyle(once);
    expect(twice).toBe(once);
    expect(declarations(once)).toEqual({
      background: 'url("data:image/svg+xml;base64,AAA")',
      content: '"a;b"',
      color: "red !important",
    });
    expect(styleValue(source)).toBe(once);
  });

  it("применяет строковый style к элементу целиком", () => {
    const element = document.createElement("div");
    const dispose = createRoot((disposeRoot) => {
      style(
        element,
        () =>
          'background-image: url("data:image/svg+xml;base64,AAA"); font-family: "a;b"',
      );
      return disposeRoot;
    });
    expect(element.style.length).toBe(2);
    expect(element.style.getPropertyValue("background-image")).toContain("base64");
    expect(element.style.getPropertyValue("font-family")).toContain("a;b");
    dispose();
  });
});
