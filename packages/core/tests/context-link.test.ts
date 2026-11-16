// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { Context } from "../src/context.js";
import {
  adoptContextValues,
  captureContextValues,
} from "../src/context-link.js";

describe("context-link", () => {
  it("остаётся пустым без активных провайдеров", () => {
    expect(captureContextValues()).toBeNull();
    expect(() => adoptContextValues(null, null)).not.toThrow();
  });

  it("проксирует значения после создания Context", () => {
    const context = new Context<string>({ name: "Link" });
    let captured: Map<object, unknown> | null = null;

    context.provide("value", () => {
      captured = captureContextValues();
    });

    expect(captured).not.toBeNull();
    expect(captured?.get(context)).toBe("value");
  });
});
