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

  it("разбирает шаблон с серверными атрибутами и отдаёт null для метаданных", () => {
    const backend = createServerBackend();

    const template = requireTemplate(backend.createTemplate('<div data-silent-a-0=""></div>'));
    expect(template.attrs.length).toBe(1);
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

  it("вставляет примитив текстом без региона в bare-позиции", () => {
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

    expect(hole.__silentServerHoleSetValue("a&b")).toBe(true);
    expect(serializeNode(template.node as DomNode)).toBe(
      '<ul class="x">a&amp;b<!--silent-hole-0--></ul>',
    );
  });

  it("оставляет регион, если перед дырой есть статический текст", () => {
    const backend = createServerBackend();
    const template = requireTemplate(
      backend.createTemplate("<p>Hello <!--silent-hole-0--></p>"),
    );
    const hole = template.holes[0] as
      | (ServerHole & { __silentServerHoleSetValue(value: unknown): boolean })
      | undefined;
    if (hole === undefined) {
      throw new Error("Ожидался слот");
    }

    expect(hole.__silentServerHoleSetValue("world")).toBe(true);
    expect(serializeNode(template.node as DomNode)).toBe(
      "<p>Hello <!--silent-insert-->world<!--silent-insert-end--><!--silent-hole-0--></p>",
    );
  });
});

describe("серверные атрибуты", () => {
  interface ServerAttributeLike {
    setAttribute(name: string, value: unknown): void;
  }

  function attributeOf(template: ServerTemplate, index: number): ServerAttributeLike {
    const attribute = template.attrs[index];
    if (attribute === undefined) {
      throw new Error("Ожидался серверный атрибут");
    }
    return attribute as ServerAttributeLike;
  }

  function htmlOf(template: ServerTemplate): string {
    return serializeNode(template.node as DomNode);
  }

  it("дописывает динамические атрибуты после статических", () => {
    const template = requireTemplate(
      createServerBackend().createTemplate(
        '<div data-silent-a-0="" class="card"><span>body</span></div>',
      ),
    );
    attributeOf(template, 0).setAttribute("data-state", "ready");

    expect(htmlOf(template)).toBe(
      '<div data-silent-a-0="" class="card" data-state="ready"><span>body</span></div>',
    );
  });

  it("не обрывает тег на > внутри значения статического атрибута", () => {
    const template = requireTemplate(
      createServerBackend().createTemplate('<div title="a>b" data-silent-a-0=""></div>'),
    );
    attributeOf(template, 0).setAttribute("data-state", "ready");

    expect(htmlOf(template)).toBe('<div title="a>b" data-silent-a-0="" data-state="ready"></div>');
  });

  it("дописывает несколько атрибутов в порядке id", () => {
    const template = requireTemplate(
      createServerBackend().createTemplate('<div data-silent-a-0="" data-silent-a-1=""></div>'),
    );
    attributeOf(template, 1).setAttribute("b", "2");
    attributeOf(template, 0).setAttribute("a", "1");

    expect(htmlOf(template)).toBe(
      '<div data-silent-a-0="" data-silent-a-1="" a="1" b="2"></div>',
    );
  });

  it("дописывает атрибут в самозакрывающийся тег", () => {
    const template = requireTemplate(
      createServerBackend().createTemplate('<input data-silent-a-0=""/>'),
    );
    attributeOf(template, 0).setAttribute("type", "text");

    expect(htmlOf(template)).toBe('<input data-silent-a-0="" type="text"/>');
  });

  it("рендерит value и textContent RCDATA-элемента как экранированный текст", () => {
    const backend = createServerBackend();
    const byValue = requireTemplate(
      backend.createTemplate('<textarea data-silent-a-0="" data-silent-text=""></textarea>'),
    );
    attributeOf(byValue, 0).setAttribute("value", "<b>&");

    expect(htmlOf(byValue)).toBe(
      '<textarea data-silent-a-0="" data-silent-text="">&lt;b&gt;&amp;</textarea>',
    );

    const byContent = requireTemplate(
      backend.createTemplate('<textarea data-silent-a-0="" data-silent-text=""></textarea>'),
    );
    attributeOf(byContent, 0).setAttribute("textContent", "plain");

    expect(htmlOf(byContent)).toBe(
      '<textarea data-silent-a-0="" data-silent-text="">plain</textarea>',
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
