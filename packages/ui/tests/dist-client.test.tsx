import { afterEach, describe, expect, it } from "vitest";
import { createComponent } from "@ivlev-dev/silent-core";
import { Button, CloseIcon, IconButton, Stack } from "../dist/index.js";

const handles: Array<{ dispose(): void }> = [];

function mount(component: Parameters<typeof createComponent>[0], props: Record<string, unknown> = {}) {
  const result = createComponent(component, props);
  document.body.appendChild(result.node);
  handles.push(result);
  return result.node as Element;
}

afterEach(() => {
  for (const handle of handles.splice(0)) handle.dispose();
  document.body.replaceChildren();
});

/** Клиентский путь precompiled-пакета: dist в jsdom, без src. */
describe("dist в браузерном рантайме", () => {
  it("монтирует Button и обрабатывает клики", () => {
    let clicks = 0;
    const button = mount(Button, {
      variant: "tonal",
      children: "Кнопка",
      onClick: () => {
        clicks += 1;
      },
    });
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("data-variant")).toBe("tonal");
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(clicks).toBe(1);
  });

  it("loading блокирует клик и включает aria-busy", () => {
    let clicks = 0;
    const button = mount(Button, {
      loading: true,
      children: "Ждём",
      onClick: () => {
        clicks += 1;
      },
    });
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.querySelector('[role="progressbar"]')?.getAttribute("aria-label")).toBe("Загрузка");
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(clicks).toBe(0);
  });

  it("IconButton и вложенные иконки", () => {
    const button = mount(IconButton, { label: "Закрыть", children: <CloseIcon /> });
    expect(button.getAttribute("aria-label")).toBe("Закрыть");
    expect(button.querySelector("svg path")).not.toBeNull();
  });

  it("attrs и style применяются к корню", () => {
    const stack = mount(Stack, {
      gap: 2,
      attrs: { "data-testid": "stack" },
      style: { padding: "8px" },
      children: "x",
    });
    expect(stack.getAttribute("data-testid")).toBe("stack");
    expect((stack as HTMLElement).style.padding).toBe("8px");
    expect(stack.getAttribute("data-gap")).toBe("2");
  });
});
