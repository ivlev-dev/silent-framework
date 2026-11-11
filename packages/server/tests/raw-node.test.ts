import { afterEach, describe, expect, it } from "vitest";
import { RawNode } from "../src/dom/raw.js";
import type { RawHole } from "../src/dom/raw.js";
import { installDomGlobals, createDocument } from "../src/dom/document.js";
import { serializeNode } from "../src/dom/serializer.js";
import type { DomNode } from "../src/dom/types.js";
import { createServerBackend } from "../src/string-backend.js";

interface RawHoleProtocol {
  __silentServerHoleSetValue(value: unknown): boolean;
}

function rawHole(hole: RawHole | undefined): RawHole & RawHoleProtocol {
  if (hole === undefined) {
    throw new Error("Ожидался слот");
  }
  return hole as RawHole & RawHoleProtocol;
}

function buildNode(tails?: readonly string[]): RawNode {
  const parts: readonly string[] = ["<ul>", "<li>", "</li></ul>"];
  const markers: readonly string[] = ["<!--silent-hole-0-->", "<!--silent-hole-1-->"];
  const indexes: readonly number[] = [0, 1];
  return new RawNode(parts, indexes, markers, tails);
}

function buildBareNode(): RawNode {
  const parts: readonly string[] = ["<ul>", "</ul>"];
  const markers: readonly string[] = ["<!--silent-hole-0-->"];
  const indexes: readonly number[] = [0];
  return new RawNode(parts, indexes, markers, undefined, [true]);
}

describe("RawNode", () => {
  it("пишет части в общий буфер без промежуточной строки", () => {
    const node = buildNode();
    node.holes[0]?.set("first");
    node.holes[1]?.set("second");

    const parts: string[] = ["prefix:"];
    node.renderInto(parts);

    expect(parts.join("")).toBe(
      "prefix:<ul>first<!--silent-hole-0--><li>second<!--silent-hole-1--></li></ul>",
    );
    expect(node.render()).toBe(parts.join("").slice("prefix:".length));
  });

  it("совмещает маркеры с хвостовыми частями", () => {
    const parts: readonly string[] = ["<ul>", "<li>", "</li></ul>"];
    const markers: readonly string[] = ["<!--silent-hole-0-->", "<!--silent-hole-1-->"];
    const tails: readonly string[] = [
      `${markers[0] ?? ""}${parts[1] ?? ""}`,
      `${markers[1] ?? ""}${parts[2] ?? ""}`,
    ];
    const withTails = buildNode(tails);
    const withoutTails = buildNode();
    withTails.holes[0]?.set("first");
    withTails.holes[1]?.set("second");
    withoutTails.holes[0]?.set("first");
    withoutTails.holes[1]?.set("second");

    expect(withTails.render()).toBe(withoutTails.render());
  });

  it("сериализуется через общий сериализатор", () => {
    const node = buildNode();
    node.holes[0]?.set("first");

    expect(serializeNode(node as unknown as DomNode)).toBe(
      "<ul>first<!--silent-hole-0--><li><!--silent-hole-1--></li></ul>",
    );
  });

  it("клонирует слоты и не делит их с оригиналом", () => {
    const node = buildNode();
    node.holes[0]?.set("original");
    const clone = node.cloneNode(true);
    if (!(clone instanceof RawNode)) {
      throw new Error("Ожидался RawNode");
    }

    expect(clone.render()).toBe(node.render());
    clone.holes[0]?.set("clone");
    expect(node.render()).toContain("original");
    expect(clone.render()).toContain("clone");
  });
});

describe("сырые слоты RawNode", () => {
  it("вставляет примитив текстом без региона в bare-слоте", () => {
    const node = buildBareNode();
    const hole = rawHole(node.holes[0]);

    expect(hole.__silentServerHoleSetValue("a&b")).toBe(true);
    expect(node.render()).toBe("<ul>a&amp;b<!--silent-hole-0--></ul>");
  });

  it("оставляет регион для не-примитива в bare-слоте", () => {
    const node = buildBareNode();
    rawHole(node.holes[0]).__silentServerHoleSetValue(["a&b"]);

    expect(node.render()).toBe(
      "<ul><!--silent-insert-->a&amp;b<!--silent-insert-end--><!--silent-hole-0--></ul>",
    );
  });

  it("сохраняет сырое значение и сообщает об успехе", () => {
    const node = buildNode();
    const hole = rawHole(node.holes[0]);

    expect(hole.__silentServerHoleSetValue("value")).toBe(true);
    expect(node.render()).toContain(
      "<ul><!--silent-insert-->value<!--silent-insert-end--><!--silent-hole-0-->",
    );
  });

  it("экранирует сырые строки, но не строки из set", () => {
    const escaped = buildNode();
    const raw = buildNode();
    escaped.holes[0]?.set("<b>");
    rawHole(raw.holes[0]).__silentServerHoleSetValue("<b>");

    expect(escaped.render()).toContain("<ul><b><!--silent-hole-0-->");
    expect(raw.render()).toContain(
      "<ul><!--silent-insert-->&lt;b&gt;<!--silent-insert-end--><!--silent-hole-0-->",
    );
  });

  it("разворачивает массивы и функции без промежуточной строки", () => {
    const node = buildNode();
    rawHole(node.holes[0]).__silentServerHoleSetValue([
      () => 1,
      ["a", null, undefined, true],
      2n,
      "<x>",
    ]);

    expect(node.render()).toBe(
      "<ul><!--silent-insert-->1a2&lt;x&gt;<!--silent-insert-end--><!--silent-hole-0--><li><!--silent-hole-1--></li></ul>",
    );
  });

  it("рендерит вложенные RawNode напрямую", () => {
    const legacy = buildNode();
    const nested = buildNode();
    legacy.holes[0]?.set(`<!--silent-insert-->${nested.render()}<!--silent-insert-end-->`);

    const raw = buildNode();
    rawHole(raw.holes[0]).__silentServerHoleSetValue(nested);

    expect(raw.render()).toBe(legacy.render());
  });

  it("смешивает сырые и строковые слоты, сохраняя порядок маркеров", () => {
    const node = buildNode();
    node.holes[0]?.set("legacy");
    rawHole(node.holes[1]).__silentServerHoleSetValue("raw&");

    expect(node.render()).toBe(
      "<ul>legacy<!--silent-hole-0--><li><!--silent-insert-->raw&amp;<!--silent-insert-end--><!--silent-hole-1--></li></ul>",
    );
  });

  it("сохраняет регион вставки для пустых сырых значений", () => {
    const node = buildNode();
    rawHole(node.holes[0]).__silentServerHoleSetValue(null);
    rawHole(node.holes[1]).__silentServerHoleSetValue(false);

    expect(node.render()).toBe(
      "<ul><!--silent-insert--><!--silent-insert-end--><!--silent-hole-0--><li><!--silent-insert--><!--silent-insert-end--><!--silent-hole-1--></li></ul>",
    );
  });

  it("клонирует сырые слоты", () => {
    const node = buildNode();
    rawHole(node.holes[0]).__silentServerHoleSetValue("<raw>");
    const clone = node.cloneNode(true);
    if (!(clone instanceof RawNode)) {
      throw new Error("Ожидался RawNode");
    }

    expect(clone.render()).toBe(node.render());
    rawHole(clone.holes[0]).__silentServerHoleSetValue("next");
    expect(node.render()).toContain("&lt;raw&gt;");
    expect(clone.render()).toContain("next");
  });

  it("сериализует DOM-узлы через общий буфер", () => {
    const restore = installDomGlobals(createDocument());
    try {
      const document = globalThis.document;
      const element = document.createElement("span");
      element.appendChild(document.createTextNode("a&b"));

      const node = buildNode();
      rawHole(node.holes[0]).__silentServerHoleSetValue(element);

      expect(node.render()).toBe(
        "<ul><!--silent-insert--><span>a&amp;b</span><!--silent-insert-end--><!--silent-hole-0--><li><!--silent-hole-1--></li></ul>",
      );
    } finally {
      restore();
    }
  });
});

describe("сериализация значений", () => {
  it("обрабатывает примитивы без промежуточных массивов", () => {
    const backend = createServerBackend();

    expect(backend.serialize(42)).toBe("42");
    expect(backend.serialize(10n)).toBe("10");
    expect(backend.serialize(true)).toBe("");
    expect(backend.serialize(false)).toBe("");
    expect(backend.serialize(undefined)).toBe("");
    expect(backend.serialize(null)).toBe("");
    expect(backend.serialize("a&b")).toBe("a&amp;b");
  });

  it("разворачивает вложенные массивы и функции", () => {
    const backend = createServerBackend();

    expect(backend.serialize([["a"], null, 3, "<x>"])).toBe("a3&lt;x&gt;");
    expect(backend.serialize([() => "value"])).toBe("value");
    expect(backend.serialize(() => ["a", "b"])).toBe("ab");
    expect(backend.serialize([])).toBe("");
  });
});
