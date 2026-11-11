import { afterEach, describe, expect, it } from "vitest";
import {
  templateHoles,
  type AnyComponent,
  type ServerHole,
  type ServerTemplate,
} from "@ivlev-dev/silent-core";
import { createServerBackend } from "../src/string-backend.js";
import { serializeNode } from "../src/dom/serializer.js";
import { renderToString } from "../src/render.js";
import { clearTemplateCache, templateCacheSize } from "../src/template-cache.js";
import type { DomNode } from "../src/dom/types.js";

function requireTemplate(template: ServerTemplate | null): ServerTemplate {
  if (template === null) {
    throw new Error("Ожидался разобранный шаблон");
  }
  return template;
}

afterEach(() => {
  clearTemplateCache();
});

describe("createServerBackend", () => {
  it("разбирает шаблон один раз и создаёт новый RawNode на каждый вызов", () => {
    const first = requireTemplate(
      createServerBackend().createTemplate("<div><!--silent-hole-0--></div>"),
    );
    const second = requireTemplate(
      createServerBackend().createTemplate("<div><!--silent-hole-0--></div>"),
    );

    expect(serializeNode(first.node as DomNode)).toBe("<div><!--silent-hole-0--></div>");
    expect(serializeNode(second.node as DomNode)).toBe("<div><!--silent-hole-0--></div>");
    expect(first.node).not.toBe(second.node);
    expect(templateCacheSize()).toBe(1);
  });

  it("не делит слоты между повторными вызовами", () => {
    const backend = createServerBackend();
    const first = requireTemplate(backend.createTemplate('<p class="x"><!--silent-hole-0--></p>'));
    const second = requireTemplate(backend.createTemplate('<p class="x"><!--silent-hole-0--></p>'));

    const firstHole = first.holes[0] as ServerHole | undefined;
    const secondHole = second.holes[0] as ServerHole | undefined;
    firstHole?.set("one");
    secondHole?.set("two");

    expect(serializeNode(first.node as DomNode)).toBe(
      '<p class="x">one<!--silent-hole-0--></p>',
    );
    expect(serializeNode(second.node as DomNode)).toBe(
      '<p class="x">two<!--silent-hole-0--></p>',
    );
  });

  it("возвращает null для шаблонов с серверными атрибутами и метаданными", () => {
    const backend = createServerBackend();

    expect(backend.createTemplate('<div data-silent-a-0=""></div>')).toBeNull();
    expect(backend.createTemplate("<title>t</title>")).toBeNull();
    expect(templateCacheSize()).toBe(2);
  });

  it("возвращает null для шаблона без дыр", () => {
    expect(createServerBackend().createTemplate("<div>static</div>")).toBeNull();
  });

  it("экранирует значения и разворачивает массивы", () => {
    const backend = createServerBackend();

    expect(backend.serialize('<a href="x">')).toBe('&lt;a href="x"&gt;');
    expect(backend.serialize([1, "a&b", null])).toBe("1a&amp;b");
  });

  it("принимает сырые значения через протокол слотов", () => {
    const backend = createServerBackend();
    const template = requireTemplate(
      backend.createTemplate('<ul class="x"><!--silent-hole-0--></ul>'),
    );
    const hole = template.holes[0] as
      | (ServerHole & { __silentServerHoleSetValue(value: unknown): boolean })
      | undefined;
    if (hole === undefined) {
      throw new Error("Ожидался слот");
    }

    expect(hole.__silentServerHoleSetValue(["a&b", null, 1])).toBe(true);
    expect(serializeNode(template.node as DomNode)).toBe(
      '<ul class="x"><!--silent-insert-->a&amp;b1<!--silent-insert-end--><!--silent-hole-0--></ul>',
    );
  });
});

describe("повторный рендер", () => {
  it("переиспользует разбор шаблона и сохраняет маркеры дыр", async () => {
    function View(): Node {
      return templateHoles('<ul class="list"><!--silent-hole-0--></ul>')().node;
    }

    const first = await renderToString(View as unknown as AnyComponent);
    const second = await renderToString(View as unknown as AnyComponent);

    expect(first.html).toBe('<ul class="list"><!--silent-hole-0--></ul>');
    expect(second.html).toBe(first.html);
    expect(templateCacheSize()).toBe(1);
  });
});
