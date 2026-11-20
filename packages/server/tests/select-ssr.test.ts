import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";
import {
  prop,
  templateHoles,
  type AnyComponent,
} from "@ivlev-dev/silent-core";
import { renderToString } from "../src/render.js";
import { renderToStream } from "../src/stream.js";
import { clearTemplateCache } from "../src/template-cache.js";

afterEach(() => {
  clearTemplateCache();
});

const OPTIONS_TEMPLATE =
  '<select data-silent-a-0=""><option value="a">a</option><option value="b">b</option></select>';

function templateSelect(value: string): AnyComponent {
  return function Page(): Node {
    const template = templateHoles(OPTIONS_TEMPLATE)();
    prop(template.attrs[0]!, "value", () => value);
    return template.node;
  } as unknown as AnyComponent;
}

function domSelect(value: string): AnyComponent {
  return function Page(): Node {
    const select = document.createElement("select");
    for (const optionValue of ["a", "b"]) {
      const option = document.createElement("option");
      option.value = optionValue;
      option.textContent = optionValue;
      select.appendChild(option);
    }
    prop(select, "value", () => value);
    return select;
  } as unknown as AnyComponent;
}

async function streamHtml(app: AnyComponent): Promise<string> {
  const chunks: string[] = [];
  for await (const chunk of renderToStream(app)) {
    chunks.push(chunk);
  }
  return chunks.join("");
}

function browserValue(html: string): string | undefined {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
  const select = dom.window.document.querySelector("select");
  const value = select?.value;
  dom.window.close();
  return value;
}

describe("select value на SSR", () => {
  it("помечает selected у совпавшей option в шаблонном select", async () => {
    const html = (await renderToString(templateSelect("b"))).html;

    expect(html).toContain('<option value="b" selected>b</option>');
    expect(html).not.toContain('<option value="a" selected>');
    expect(html.startsWith('<select data-silent-a-0="">')).toBe(true);
    expect(html.slice(0, html.indexOf(">") + 1)).not.toContain("value=");
  });

  it("снимает selected, если значение не совпало ни с одной option", async () => {
    const html = (await renderToString(templateSelect("z"))).html;

    expect(html).not.toContain("selected");
  });

  it("помечает selected и в стриме", async () => {
    const html = await streamHtml(templateSelect("b"));

    expect(html).toContain('<option value="b" selected>b</option>');
    expect(browserValue(html)).toBe("b");
  });

  it("работает для select, созданного через DOM", async () => {
    const html = (await renderToString(domSelect("b"))).html;

    expect(html).toContain('<option value="b" selected="">b</option>');
    expect(html).not.toContain('<option value="a" selected="">');
    expect(html).not.toContain("<select value=");
    expect(browserValue(html)).toBe("b");
  });

  it("учитывает multiple и снимает лишний selected", async () => {
    const view = (): Node => {
      const template = templateHoles(
        '<select multiple data-silent-a-0=""><option value="a" selected>a</option><option value="b" selected>b</option></select>',
      )();
      prop(template.attrs[0]!, "value", () => "b");
      return template.node;
    };

    const html = (await renderToString(view as unknown as AnyComponent)).html;
    expect(html).toContain('<option value="a">a</option>');
    expect(html).toContain('<option value="b" selected>b</option>');
  });
});
