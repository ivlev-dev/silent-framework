import { describe, expect, it } from "vitest";
import {
  plainTextToHtml,
  sanitizeHtml,
  sanitizeHref,
} from "../src/components/rich-text-editor/internal/sanitize.js";

describe("RichTextEditor: санитайзер", () => {
  it("удаляет script/style/iframe/object вместе с содержимым", () => {
    expect(
      sanitizeHtml(
        '<script>alert(1)</script><style>p{color:red}</style><iframe src="x"></iframe><object data="x">o</object><p>ok</p>',
      ),
    ).toBe("<p>ok</p>");
  });

  it("не пропускает img с onerror и прочие опасные теги", () => {
    expect(sanitizeHtml('<img src=x onerror="alert(1)"><p>t</p>')).toBe("<p>t</p>");
    expect(sanitizeHtml('<svg><script>alert(1)</script></svg><p>t</p>')).toBe("<p>t</p>");
    expect(sanitizeHtml('<video src="x"></video><p>t</p>')).toBe("<p>t</p>");
  });

  it("срезает javascript: и data: URL", () => {
    expect(sanitizeHtml('<a href="javascript:alert(1)">x</a>')).toBe("<a>x</a>");
    expect(sanitizeHtml('<a href="data:text/html,<script>alert(1)</script>">x</a>')).toBe(
      "<a>x</a>",
    );
    expect(sanitizeHtml('<a href="java\nscript:alert(1)">x</a>')).toBe("<a>x</a>");
    expect(sanitizeHtml('<a href="vbscript:msgbox(1)">x</a>')).toBe("<a>x</a>");
    expect(sanitizeHtml('<a href=" file:///etc/passwd ">x</a>')).toBe("<a>x</a>");
  });

  it("оставляет безопасные схемы и относительные ссылки", () => {
    expect(sanitizeHtml('<a href="https://example.com/a?b=1#c">x</a>')).toBe(
      '<a href="https://example.com/a?b=1#c">x</a>',
    );
    expect(sanitizeHtml('<a href="mailto:a@example.com">x</a>')).toBe(
      '<a href="mailto:a@example.com">x</a>',
    );
    expect(sanitizeHtml('<a href="tel:+79000000000">x</a>')).toBe(
      '<a href="tel:+79000000000">x</a>',
    );
    expect(sanitizeHtml('<a href="/docs/page">x</a>')).toBe('<a href="/docs/page">x</a>');
    expect(sanitizeHtml('<a href="#section">x</a>')).toBe('<a href="#section">x</a>');
  });

  it("добавляет rel для target=_blank и не трогает _self", () => {
    expect(
      sanitizeHtml('<a href="https://example.com" target="_blank" onclick="x">x</a>'),
    ).toBe(
      '<a href="https://example.com" target="_blank" rel="noopener noreferrer">x</a>',
    );
    expect(sanitizeHtml('<a href="https://example.com" target="_self" rel="noopener">x</a>')).toBe(
      '<a href="https://example.com" target="_self" rel="noopener">x</a>',
    );
  });

  it("оставляет только allowlist тегов и атрибуты a/data-align", () => {
    expect(
      sanitizeHtml(
        '<div class="x"><span style="color:red" onclick="evil()">t</span></div>',
      ),
    ).toBe("t");
    expect(
      sanitizeHtml(
        '<p style="color:red" data-align="center" class="x" id="p">t</p>',
      ),
    ).toBe('<p data-align="center">t</p>');
    expect(sanitizeHtml('<h2 data-align="right">t</h2>')).toBe(
      '<h2 data-align="right">t</h2>',
    );
    expect(sanitizeHtml('<div data-align="center">t</div>')).toBe("t");
    expect(sanitizeHtml('<p data-align="justify">t</p>')).toBe("<p>t</p>");
    expect(sanitizeHtml("<button>Click</button>")).toBe("Click");
  });

  it("сохраняет разрешённую разметку", () => {
    const html =
      "<h1>H</h1><h2>H2</h2><h3>H3</h3><p><strong>s</strong><em>e</em><u>u</u><s>x</s><code>c</code></p><blockquote>q</blockquote><pre>p</pre><ul><li>i</li></ul><ol><li>j</li></ol><hr><br>";
    expect(sanitizeHtml(html)).toBe(html);
  });

  it("sanitizeHref отбрасывает опасные значения", () => {
    expect(sanitizeHref("javascript:alert(1)")).toBeNull();
    expect(sanitizeHref("JaVaScRiPt:alert(1)")).toBeNull();
    expect(sanitizeHref("data:text/html,x")).toBeNull();
    expect(sanitizeHref("https://example.com")).toBe("https://example.com");
    expect(sanitizeHref("mailto:a@b.c")).toBe("mailto:a@b.c");
    expect(sanitizeHref("/relative")).toBe("/relative");
    expect(sanitizeHref("docs/page")).toBe("docs/page");
  });

  it("plainTextToHtml экранирует и переводит строки в br", () => {
    expect(plainTextToHtml('<b>&"x"</b>\nnext')).toBe(
      "&lt;b&gt;&amp;&quot;x&quot;&lt;/b&gt;<br>next",
    );
  });
});
