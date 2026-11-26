// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  sanitizeHtml,
  sanitizeHtmlStructure,
} from "../src/components/rich-text-editor/internal/sanitize.js";

describe("RichTextEditor: санитайзер без DOM (node)", () => {
  it("работает без document/DOMParser", () => {
    expect(typeof document).toBe("undefined");
    expect(sanitizeHtml("<div>a</div>")).toBe("<p>a</p>");
  });

  it("удаляет опасные контейнеры вместе с содержимым", () => {
    const html =
      '<script>alert(1)</script><style>p{}</style><iframe src="x">i</iframe><object data="x">o</object><svg><script>x</script></svg><math><mi>x</mi></math><img src=x onerror="x"><video src=x></video><audio src=x></audio><form><input value=x></form><p>ok</p>';
    expect(sanitizeHtml(html)).toBe("<p>ok</p>");
  });

  it("срезает опасные href, включая entity-обходы", () => {
    expect(sanitizeHtml('<a href="javascript:alert(1)" onclick="x">x</a>')).toBe(
      "<p><a>x</a></p>",
    );
    expect(sanitizeHtml('<a href="data:text/html,x">x</a>')).toBe(
      "<p><a>x</a></p>",
    );
    expect(sanitizeHtml('<a href="java&#x09;script:alert(1)">x</a>')).toBe(
      "<p><a>x</a></p>",
    );
    expect(sanitizeHtml('<a href="java&#58;script:alert(1)">x</a>')).toBe(
      "<p><a>x</a></p>",
    );
  });

  it("нормализует блоки и оборачивает верхний inline в p", () => {
    expect(sanitizeHtml("<div>a</div><div>b</div>")).toBe(
      "<p>a</p><p>b</p>",
    );
    expect(sanitizeHtml("<div><p>x</p></div>")).toBe("<p>x</p>");
    expect(sanitizeHtml("plain <strong>text</strong>")).toBe(
      "<p>plain <strong>text</strong></p>",
    );
  });

  it("структурный санитайз сохраняет пустые блоки для истории", () => {
    expect(
      sanitizeHtmlStructure(
        '<p><br></p><div onclick="x">t</div><script>x</script>',
      ),
    ).toBe("<p><br></p><div>t</div>");
  });

  it("сохраняет вложенные списки и кавычки атрибутов", () => {
    const nested =
      "<ul><li>A<ul><li>B<ol><li>C</li></ol></li></ul></li></ul>";
    expect(sanitizeHtml(nested)).toBe(nested);
    expect(
      sanitizeHtml('<p title="a>b" data-align="center" onclick="x">t</p>'),
    ).toBe('<p data-align="center">t</p>');
  });
});
