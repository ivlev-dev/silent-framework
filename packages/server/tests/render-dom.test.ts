import { describe, expect, it } from "vitest";
import { renderToString } from "../src/render.js";
import { attr, on, prop, spread, style, templateHoles } from "@ivlev98/silent-core";

function componentWithEvents(): Node {
  const wrapper = document.createElement("div");
  const button = document.createElement("button");
  on(button, "click", () => undefined);
  button.textContent = "click";
  wrapper.appendChild(button);
  return wrapper;
}

describe("SSR DOM compatibility", () => {
  it("рендерит компонент с обработчиками событий", async () => {
    const { html } = await renderToString(componentWithEvents);
    expect(html).toBe("<div><button>click</button></div>");
  });

  it("рендерит spread с событиями и атрибутами", async () => {
    const View = (): Node => {
      const span = document.createElement("span");
      spread(span, () => ({ class: "label", title: "t", onClick: () => undefined }));
      return span;
    };
    const { html } = await renderToString(View);
    expect(html).toBe('<span class="label" title="t"></span>');
  });

  it("отражает value в атрибут", async () => {
    const View = (): Node => {
      const input = document.createElement("input");
      prop(input, "value", () => "hello");
      return input;
    };
    const { html } = await renderToString(View);
    expect(html).toBe('<input value="hello">');
  });

  it("сериализует объект style в атрибут", async () => {
    const View = (): Node => {
      const box = document.createElement("div");
      style(box, () => ({ color: "red", "font-size": "12px" }));
      return box;
    };
    const { html } = await renderToString(View);
    expect(html).toBe('<div style="color: red; font-size: 12px;"></div>');
  });

  it("обновляет style при повторном рендере атрибута", async () => {
    const View = (): Node => {
      const box = document.createElement("div");
      attr(box, "style", () => "color: blue;");
      return box;
    };
    const { html } = await renderToString(View);
    expect(html).toBe('<div style="color: blue;"></div>');
  });

  it("рендерит dangerouslySetInnerHTML через innerHTML", async () => {
    const View = (): Node => {
      const box = document.createElement("div");
      prop(box, "innerHTML", () => "<b>raw</b>");
      return box;
    };
    const { html } = await renderToString(View);
    expect(html).toBe("<div><b>raw</b></div>");
  });
});

describe("RCDATA и метаданные", () => {
  it("выносит title в head и убирает из body", async () => {
    const View = (): Node => {
      const template = templateHoles(
        '<div class="page"><title data-silent-a-0="" data-silent-text=""></title><h1>Body</h1></div>',
      )();
      prop(template.attrs[0]!, "textContent", () => "Page title");
      return template.node;
    };
    const { html, head } = await renderToString(View);
    expect(head).toBe("<title>Page title</title>");
    expect(html).not.toContain("<title>");
    expect(html).toContain("<h1>Body</h1>");
  });

  it("рендерит значение textarea как текст", async () => {
    const View = (): Node => {
      const template = templateHoles(
        '<textarea data-silent-a-0="" data-silent-text=""></textarea>',
      )();
      prop(template.attrs[0]!, "value", () => "hello");
      return template.node;
    };
    const { html } = await renderToString(View);
    expect(html).toContain("hello</textarea>");
    expect(html).not.toContain('value="hello"');
  });
});
