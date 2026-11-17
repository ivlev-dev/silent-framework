// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createSignal, flushSync } from "@ivlev-dev/silent-reactivity";
import { component, createComponent } from "../src/component";
import { Match, Switch } from "../src/switch";
import type { AnyComponent } from "../src/types";

function label(value: string): HTMLElement {
  const span = document.createElement("span");
  span.textContent = value;
  return span;
}

describe("Switch: реактивный when из issue #1", () => {
  it("переключает ветку в light-компоненте за один flush", () => {
    const [status, setStatus] = createSignal("idle");

    function Demo(): Node {
      return Switch({
        fallback: () => label("loading"),
        children: () => [
          Match({
            when: () => status() === "ready",
            children: () => label("ready"),
          }),
        ],
      });
    }

    const host = document.createElement("div");
    document.body.appendChild(host);
    const result = createComponent(Demo as unknown as AnyComponent, {});
    host.appendChild(result.node);

    setStatus("ready");
    flushSync();

    expect(host.querySelector("span")?.textContent).toBe("ready");
  });
});

describe("Switch: Match через component с реактивным when", () => {
  it("переключает ветку без бесконечного flush", () => {
    const [status, setStatus] = createSignal("idle");

    function Demo(): Node {
      return Switch({
        fallback: () => label("loading"),
        children: () => [
          component(Match as never, {
            when: () => status() === "ready",
            children: () => label("ready"),
          } as never),
        ],
      });
    }

    const host = document.createElement("div");
    document.body.appendChild(host);
    const result = createComponent(Demo as unknown as AnyComponent, {});
    host.appendChild(result.node);

    setStatus("ready");
    flushSync();
    expect(host.querySelector("span")?.textContent).toBe("ready");

    setStatus("idle");
    flushSync();
    expect(host.querySelector("span")?.textContent).toBe("loading");
  });

  it("поддерживает геттеры props как в скомпилированном JSX", () => {
    const [status, setStatus] = createSignal("idle");

    function Demo(): Node {
      return Switch({
        fallback: () => label("loading"),
        children: () => [
          component(Match as never, {
            get when() {
              return () => status() === "ready";
            },
            get children() {
              return () => label("ready");
            },
          } as never),
        ],
      });
    }

    const host = document.createElement("div");
    document.body.appendChild(host);
    const result = createComponent(Demo as unknown as AnyComponent, {});
    host.appendChild(result.node);

    setStatus("ready");
    flushSync();
    expect(host.querySelector("span")?.textContent).toBe("ready");
  });
});
