// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  createEffect,
  createSignal,
  flushSync,
} from "@ivlev-dev/silent-reactivity";
import { ErrorBoundary } from "../src/error-boundary";
import { getRuntimeOptions, setErrorHandler } from "../src/component";
import { mount } from "../src/mount";
import type { AnyComponent } from "../src/types";

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

function asComponent(fn: () => unknown): AnyComponent {
  return fn as unknown as AnyComponent;
}

function textsOf(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll("span")).map(
    (element) => element.textContent ?? "",
  );
}

describe("ErrorBoundary: изоляция поддеревьев", () => {
  it("ловит ошибку эффекта только своего поддерева", async () => {
    const [fail, setFail] = createSignal(false);

    function Broken(): HTMLElement {
      createEffect(() => {
        if (fail()) {
          throw new Error("boom");
        }
      });
      return label("A");
    }

    function App(): HTMLElement {
      const root = document.createElement("div");
      const first = document.createElement("section");
      first.appendChild(
        ErrorBoundary({
          fallback: () => label("A-fb"),
          children: () => Broken(),
        }),
      );
      const second = document.createElement("section");
      second.appendChild(
        ErrorBoundary({
          fallback: () => label("B-fb"),
          children: () => label("B"),
        }),
      );
      root.appendChild(first);
      root.appendChild(second);
      return root;
    }

    const host = install(document.createDocumentFragment());
    const handle = await mount(host, asComponent(App));
    flushSync();
    expect(textsOf(host)).toEqual(["A", "B"]);

    setFail(true);
    flushSync();

    expect(textsOf(host)).toEqual(["A-fb", "B"]);
    handle.dispose();
  });

  it("восстанавливается через reset после ошибки эффекта", async () => {
    const [fail, setFail] = createSignal(false);
    let reset: () => void = () => undefined;

    function Broken(): HTMLElement {
      createEffect(() => {
        if (fail()) {
          throw new Error("boom");
        }
      });
      return label("ok");
    }

    function App(): HTMLElement {
      const root = document.createElement("div");
      root.appendChild(
        ErrorBoundary({
          fallback: (_error, next) => {
            reset = next;
            return label("fb");
          },
          children: () => Broken(),
        }),
      );
      return root;
    }

    const host = install(document.createDocumentFragment());
    const handle = await mount(host, asComponent(App));
    flushSync();

    setFail(true);
    flushSync();
    expect(textsOf(host)).toEqual(["fb"]);

    setFail(false);
    reset();
    flushSync();
    expect(textsOf(host)).toEqual(["ok"]);
    handle.dispose();
  });

  it("отдаёт ошибку вне границ глобальному обработчику", async () => {
    const [fail, setFail] = createSignal(false);
    const errors: unknown[] = [];

    function App(): HTMLElement {
      createEffect(() => {
        if (fail()) {
          throw new Error("outer");
        }
      });
      return label("app");
    }

    setErrorHandler((error) => {
      errors.push(error);
    });
    try {
      const host = install(document.createDocumentFragment());
      const handle = await mount(host, asComponent(App));
      flushSync();

      setFail(true);
      flushSync();

      expect(errors.length).toBe(1);
      expect((errors[0] as Error).message).toBe("outer");
      handle.dispose();
    } finally {
      setErrorHandler(null);
    }
  });
});
