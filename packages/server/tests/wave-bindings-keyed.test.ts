import { afterEach, describe, expect, it } from "vitest";
import {
  bindChecked,
  bindValue,
  For,
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

describe("bindValue на SSR", () => {
  it("выводит value атрибутом у input", async () => {
    const view = (): Node => {
      const template = templateHoles('<input data-silent-a-0="">')();
      bindValue(template.attrs[0]!, () => "text");
      return template.node;
    };
    expect(await render(view)).toBe('<input data-silent-a-0="" value="text">');
  });

  it("выводит значение textarea текстом, а не атрибутом", async () => {
    const view = (): Node => {
      const template = templateHoles(
        '<textarea data-silent-a-0="" data-silent-text=""></textarea>',
      )();
      bindValue(template.attrs[0]!, () => "<b>&");
      return template.node;
    };
    const html = await render(view);
    expect(html).toBe(
      '<textarea data-silent-a-0="" data-silent-text="">&lt;b&gt;&amp;</textarea>',
    );
    expect(html).not.toContain("value=");
  });

  it("не выводит value атрибутом у select", async () => {
    const view = (): Node => {
      const template = templateHoles(
        '<select data-silent-a-0=""><option value="a">a</option><option value="b">b</option></select>',
      )();
      bindValue(template.attrs[0]!, () => "b");
      return template.node;
    };
    const html = await render(view);
    const select = html.slice(0, html.indexOf(">") + 1);
    expect(select).not.toContain("value=");
  });
});

describe("bindChecked на SSR", () => {
  it("выводит checked только для истинного значения", async () => {
    const view = (): Node => {
      const template = templateHoles('<input type="checkbox" data-silent-a-0="">')();
      bindChecked(template.attrs[0]!, () => true);
      return template.node;
    };
    expect(await render(view)).toBe('<input type="checkbox" data-silent-a-0="" checked>');
  });

  it("не выводит checked для false и mixed", async () => {
    const view = (): Node => {
      const template = templateHoles(
        '<input type="checkbox" data-silent-a-0=""><input type="checkbox" data-silent-a-1="">',
      )();
      bindChecked(template.attrs[0]!, () => false);
      bindChecked(template.attrs[1]!, () => "mixed");
      return template.node;
    };
    const html = await render(view);
    expect(html).not.toContain("checked");
  });
});

describe("keyed For на SSR", () => {
  it("сохраняет маркеры элементов и не выводит ключи", async () => {
    const items = [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ];
    const view = (): Node =>
      For({
        each: items,
        keyOf: (item) => item.id,
        children: (item) => {
          const template = templateHoles('<span data-silent-a-0=""></span>')();
          bindValue(template.attrs[0]!, () => item.label);
          return template.node;
        },
      });
    const html = await render(view);
    expect(html).toContain("<!--silent-item-->");
    expect(html.match(/<!--silent-item-->/g)?.length).toBe(2);
    expect(html).toContain("<!--silent-end-->");
    expect(html).not.toContain('key="');
  });
});
