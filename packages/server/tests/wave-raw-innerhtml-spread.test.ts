import { afterEach, describe, expect, it } from "vitest";
import {
  attr,
  innerHtml,
  prop,
  spread,
  templateHoles,
  type AnyComponent,
} from "@ivlev-dev/silent-core";
import { renderToString } from "../src/render.js";
import { clearTemplateCache } from "../src/template-cache.js";

function render(view: () => Node): Promise<string> {
  return renderToString(view as unknown as AnyComponent).then((result) => result.html);
}

afterEach(() => {
  clearTemplateCache();
});

describe("raw-text SSR", () => {
  it("не экранирует HTML-сущности в <style> и <script>", async () => {
    const styleView = (): Node => {
      const template = templateHoles(
        '<style data-silent-a-0="" data-silent-text=""></style>',
      )();
      prop(template.attrs[0]!, "textContent", () => "a > b && c < d");
      return template.node;
    };
    expect(await render(styleView)).toBe(
      '<style data-silent-a-0="" data-silent-text="">a > b && c < d</style>',
    );

    const scriptView = (): Node => {
      const template = templateHoles(
        '<script data-silent-a-0="" data-silent-text=""></script>',
      )();
      prop(template.attrs[0]!, "textContent", () => "if (a > b && c) run();");
      return template.node;
    };
    expect(await render(scriptView)).toBe(
      '<script data-silent-a-0="" data-silent-text="">if (a > b && c) run();</script>',
    );
  });

  it("безопасно заменяет закрывающую последовательность в raw-text", async () => {
    const view = (): Node => {
      const template = templateHoles(
        '<script data-silent-a-0="" data-silent-text=""></script>',
      )();
      prop(
        template.attrs[0]!,
        "textContent",
        () => 'const html = "</script><b>x</b>";',
      );
      return template.node;
    };
    expect(await render(view)).toBe(
      '<script data-silent-a-0="" data-silent-text="">const html = "<\\/script><b>x</b>";</script>',
    );
  });

  it("сохраняет экранирование в textarea и title", async () => {
    const view = (): Node => {
      const template = templateHoles(
        '<textarea data-silent-a-0="" data-silent-text=""></textarea>',
      )();
      prop(template.attrs[0]!, "value", () => "<b>&");
      return template.node;
    };
    expect(await render(view)).toBe(
      '<textarea data-silent-a-0="" data-silent-text="">&lt;b&gt;&amp;</textarea>',
    );
  });
});

describe("dangerouslySetInnerHTML на SSR", () => {
  it("выводит сырой HTML в содержимое элемента", async () => {
    const view = (): Node => {
      const template = templateHoles(
        '<div data-silent-a-0="" data-silent-text=""></div>',
      )();
      innerHtml(template.attrs[0]!, () => "<b>x</b>");
      return template.node;
    };
    expect(await render(view)).toBe(
      '<div data-silent-a-0="" data-silent-text=""><b>x</b></div>',
    );
  });

  it("не выводит innerHTML атрибутом", async () => {
    const view = (): Node => {
      const template = templateHoles(
        '<section data-silent-a-0="" data-silent-text=""></section>',
      )();
      innerHtml(template.attrs[0]!, () => "<i>raw</i>");
      return template.node;
    };
    const html = await render(view);
    expect(html).not.toContain("innerHTML=");
    expect(html).toContain("<i>raw</i>");
  });
});

describe("spread на SSR", () => {
  it("фильтрует события, ref, children и innerHTML", async () => {
    const view = (): Node => {
      const template = templateHoles('<span data-silent-a-0=""></span>')();
      spread(template.attrs[0]!, () => ({
        class: "label",
        title: "t",
        onClick: () => undefined,
        "on:custom": () => undefined,
        ref: () => undefined,
        children: "ignored",
        innerHTML: "<b>ignored</b>",
        dangerouslySetInnerHTML: { __html: "<b>ignored</b>" },
      }));
      return template.node;
    };
    expect(await render(view)).toBe('<span data-silent-a-0="" class="label" title="t"></span>');
  });

  it("заменяет статические class и style, а не дублирует их", async () => {
    const view = (): Node => {
      const template = templateHoles(
        '<button class="static" style="color: red;" data-silent-a-0=""></button>',
      )();
      spread(template.attrs[0]!, () => ({
        class: "dyn",
        style: { margin: "1px", width: 10, zIndex: 2 },
        onClick: () => undefined,
      }));
      return template.node;
    };
    const html = await render(view);
    expect(html).toBe(
      '<button data-silent-a-0="" class="dyn" style="margin: 1px; width: 10px; z-index: 2"></button>',
    );
    expect(html.match(/class=/g)?.length).toBe(1);
    expect(html.match(/style=/g)?.length).toBe(1);
    expect(html).not.toContain("onClick");
  });

  it("сохраняет статические class и style, если spread их не переопределяет", async () => {
    const view = (): Node => {
      const template = templateHoles(
        '<button class="static" style="color: red;" data-silent-a-0=""></button>',
      )();
      spread(template.attrs[0]!, () => ({ type: "button", onClick: () => undefined }));
      return template.node;
    };
    expect(await render(view)).toBe(
      '<button data-silent-a-0="" class="static" style="color: red;" type="button"></button>',
    );
  });
});

describe("select на SSR", () => {
  it("не выводит value атрибутом у select", async () => {
    const view = (): Node => {
      const template = templateHoles(
        '<select data-silent-a-0=""><option value="a">a</option><option value="b">b</option></select>',
      )();
      prop(template.attrs[0]!, "value", () => "b");
      return template.node;
    };
    const html = await render(view);
    expect(html.startsWith('<select data-silent-a-0="">')).toBe(true);
    const select = html.slice(0, html.indexOf(">") + 1);
    expect(select).not.toContain("value=");
  });

  it("выводит selected на статической option", async () => {
    const view = (): Node => {
      const template = templateHoles(
        '<select><option value="a">a</option><option value="b" selected>b</option></select>',
      )();
      return template.node;
    };
    expect(await render(view)).toContain('<option value="b" selected>b</option>');
  });

  it("не выводит value для select, созданного через DOM", async () => {
    const view = (): Node => {
      const select = document.createElement("select");
      const first = document.createElement("option");
      first.value = "a";
      first.textContent = "a";
      const second = document.createElement("option");
      second.value = "b";
      second.textContent = "b";
      select.appendChild(first);
      select.appendChild(second);
      attr(select, "value", () => "b");
      return select;
    };
    const html = await render(view);
    expect(html.startsWith("<select>")).toBe(true);
    expect(html.slice(0, html.indexOf(">") + 1)).not.toContain("value=");
    expect(html).not.toContain("selected");
  });
});
