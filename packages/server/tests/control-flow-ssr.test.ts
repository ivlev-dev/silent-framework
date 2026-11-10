import { describe, expect, it } from "vitest";
import {
  ErrorBoundary,
  Index,
  Match,
  Switch,
  type AnyComponent,
} from "@ivlev-dev/silent-core";
import { renderToString } from "../src/render.js";

function text(value: string): Node {
  const element = document.createElement("span");
  element.textContent = value;
  return element;
}

describe("SSR управляющих конструкций", () => {
  it("рендерит Index", async () => {
    function View(): Node {
      return Index({
        each: ["a", "b"],
        children: (item) => text(item()),
      });
    }

    const { html } = await renderToString(View as unknown as AnyComponent, {});
    expect(html).toContain("<!--silent-item--><span>a</span><!--silent-item--><span>b</span>");
    expect(html).toContain("silent-end");
  });

  it("рендерит fallback Index при пустом списке", async () => {
    function View(): Node {
      return Index({
        each: [] as string[],
        children: (item) => text(item()),
        fallback: () => text("empty"),
      });
    }

    const { html } = await renderToString(View as unknown as AnyComponent, {});
    expect(html).toContain("<span>empty</span>");
  });

  it("рендерит выбранную ветку Switch", async () => {
    function View(): Node {
      return Switch({
        fallback: () => text("none"),
        children: () => [
          Match({ when: false, children: () => text("no") }),
          Match({ when: true, children: () => text("yes") }),
        ],
      });
    }

    const { html } = await renderToString(View as unknown as AnyComponent, {});
    expect(html).toContain("<span>yes</span>");
    expect(html).not.toContain("<span>no</span>");
    expect(html).toContain("silent-switch");
  });

  it("рендерит fallback Switch без правдивых веток", async () => {
    function View(): Node {
      return Switch({
        fallback: () => text("none"),
        children: () => Match({ when: 0, children: () => text("no") }),
      });
    }

    const { html } = await renderToString(View as unknown as AnyComponent, {});
    expect(html).toContain("<span>none</span>");
  });

  it("рендерит fallback ErrorBoundary при ошибке", async () => {
    function View(): Node {
      return ErrorBoundary({
        fallback: (error) => text(`err:${(error as Error).message}`),
        children: () => {
          throw new Error("boom");
        },
      });
    }

    const { html } = await renderToString(View as unknown as AnyComponent, {});
    expect(html).toContain("err:boom");
    expect(html).toContain("silent-error");
  });
});
