// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { on, setErrorHandler } from "../src/index.js";

const hosts: HTMLElement[] = [];

function host(): HTMLElement {
  const element = document.createElement("div");
  document.body.appendChild(element);
  hosts.push(element);
  return element;
}

afterEach(() => {
  setErrorHandler(null);
  for (const element of hosts.splice(0)) {
    element.remove();
  }
  document.body.replaceChildren();
});

describe("делегированные обработчики", () => {
  it("репортит ошибку и не прерывает всплытие", () => {
    const parent = host();
    const child = document.createElement("button");
    parent.appendChild(child);

    const errors: unknown[] = [];
    setErrorHandler((error) => errors.push(error));
    const outer: string[] = [];
    on(parent, "onClick", () => () => outer.push("outer"));
    on(child, "onClick", () => () => {
      throw new Error("handler failed");
    });

    child.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe("handler failed");
    expect(outer).toEqual(["outer"]);
  });

  it("не падает, если глобальный обработчик ошибок сам бросает", () => {
    const element = host();
    setErrorHandler(() => {
      throw new Error("error handler failed");
    });
    const calls: number[] = [];
    on(element, "onClick", () => () => {
      calls.push(1);
      throw new Error("handler failed");
    });

    expect(() => {
      element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }).not.toThrow();
    expect(calls).toEqual([1]);
  });
});
