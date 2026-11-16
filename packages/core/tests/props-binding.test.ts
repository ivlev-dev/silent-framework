// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { createRoot, createSignal, flushSync } from "@ivlev-dev/silent-reactivity";
import { Show } from "../src/control-flow";
import { attr, insert, on } from "../src/dom";

beforeEach(() => {
  document.body.replaceChildren();
});

describe("attr: начальное чтение не создаёт ложных зависимостей", () => {
  it("Show не пересоздаёт input при изменении несвязанного поля", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const [text, setText] = createSignal("hello");
    const [other, setOther] = createSignal(0);

    createRoot(() => {
      insert(host, () =>
        Show({
          when: () => true,
          children: () => {
            const input = document.createElement("input");
            attr(input, "value", () => text());
            attr(input, "data-other", () => other());
            return input;
          },
        }),
      );
    });

    const input = host.querySelector("input");
    expect(input).not.toBeNull();
    expect(input?.value).toBe("hello");
    input!.value = "typed";

    setOther(1);
    flushSync();

    expect(host.querySelector("input")).toBe(input);
    expect(input?.getAttribute("data-other")).toBe("1");
    expect(input?.value).toBe("typed");

    setText("bye");
    flushSync();

    expect(host.querySelector("input")).toBe(input);
    expect(input?.value).toBe("bye");
  });

  it("children-функция Show, читающая сигнал, продолжает обновляться", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const [count, setCount] = createSignal(1);

    createRoot(() => {
      insert(host, () =>
        Show({
          when: () => true,
          children: () => `n=${count()}`,
        }),
      );
    });

    expect(host.textContent).toBe("n=1");
    setCount(2);
    flushSync();
    expect(host.textContent).toBe("n=2");
  });

  it("делегированный обработчик получает currentTarget элемента", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const input = document.createElement("input");
    host.appendChild(input);
    let seen: EventTarget | null = null;
    on(input, "onInput", () => (event: Event) => {
      seen = event.currentTarget;
    });
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(seen).toBe(input);
  });

  it("attr обновляет значение независимо от Show", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const [text, setText] = createSignal("a");

    createRoot(() => {
      const input = document.createElement("input");
      host.appendChild(input);
      attr(input, "value", () => text());
      attr(input, "placeholder", () => text());
    });

    const input = host.querySelector("input")!;
    expect(input.value).toBe("a");
    setText("b");
    flushSync();
    expect(input.value).toBe("b");
    expect(input.getAttribute("placeholder")).toBe("b");
  });
});
