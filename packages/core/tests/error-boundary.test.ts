// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { ErrorBoundary } from "../src/error-boundary";
import { getRuntimeOptions } from "../src/component";

function install(node: Node): HTMLElement {
  const host = document.createElement("div");
  host.appendChild(node);
  document.body.appendChild(host);
  return host;
}

function label(value: string): HTMLElement {
  const span = document.createElement("span");
  span.textContent = value;
  return span;
}

function current(host: HTMLElement): string {
  return host.querySelector("span")?.textContent ?? "";
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe("ErrorBoundary", () => {
  it("рендерит children, если ошибки нет", () => {
    let fallbackCalls = 0;
    const host = install(
      ErrorBoundary({
        fallback: () => {
          fallbackCalls += 1;
          return label("error");
        },
        children: () => label("ok"),
      }),
    );
    expect(current(host)).toBe("ok");
    expect(fallbackCalls).toBe(0);
  });

  it("ловит синхронную ошибку рендера", () => {
    const host = install(
      ErrorBoundary({
        fallback: (error) => label(`err:${(error as Error).message}`),
        children: () => {
          throw new Error("boom");
        },
      }),
    );
    expect(current(host)).toBe("err:boom");
  });

  it("передаёт ошибку из onError дочерних компонентов", () => {
    const host = install(
      ErrorBoundary({
        fallback: (error) => label(`err:${(error as Error).message}`),
        children: () => {
          getRuntimeOptions().onError?.(new Error("async"));
          return label("ok");
        },
      }),
    );
    expect(current(host)).toBe("err:async");
  });

  it("сбрасывается через reset", () => {
    let attempts = 0;
    const host = install(
      ErrorBoundary({
        fallback: (error, reset) => {
          const button = document.createElement("button");
          button.textContent = `retry:${(error as Error).message}`;
          button.addEventListener("click", reset);
          return button;
        },
        children: () => {
          attempts += 1;
          if (attempts === 1) {
            throw new Error("first");
          }
          return label("ok");
        },
      }),
    );

    expect(host.querySelector("button")?.textContent).toBe("retry:first");

    host.querySelector("button")?.dispatchEvent(new Event("click"));

    expect(current(host)).toBe("ok");
    expect(attempts).toBe(2);
  });

  it("не перерисовывает children после ошибки", () => {
    let calls = 0;
    install(
      ErrorBoundary({
        fallback: () => label("error"),
        children: () => {
          calls += 1;
          throw new Error("boom");
        },
      }),
    );
    expect(calls).toBe(1);
  });
});
