import { afterEach, describe, expect, it } from "vitest";
import {
  applyProps,
  attr,
  createElement,
  templateHoles,
  type AnyComponent,
} from "@ivlev-dev/silent-core";
import { renderToString } from "../src/render.js";
import { clearTemplateCache } from "../src/template-cache.js";

afterEach(() => {
  clearTemplateCache();
});

describe("boolean-атрибуты на SSR", () => {
  it("сериализует false у aria-*/data-* и не создаёт обычные boolean-атрибуты", async () => {
    const page = (): Node => {
      const input = createElement("input");
      applyProps(input, {
        "aria-hidden": false,
        "data-active": false,
        disabled: false,
        required: false,
      });
      return input as unknown as Node;
    };

    const { html } = await renderToString(page as unknown as AnyComponent, {});
    expect(html).toBe('<input aria-hidden="false" data-active="false">');
  });

  it("сохраняет true как пустой boolean-атрибут, а aria-*/data-* как строку", async () => {
    const page = (): Node => {
      const template = templateHoles('<input data-silent-a-0="">')();
      attr(template.attrs[0]!, "disabled", () => true);
      attr(template.attrs[0]!, "aria-pressed", () => true);
      attr(template.attrs[0]!, "data-enabled", () => true);
      return template.node;
    };

    const { html } = await renderToString(page as unknown as AnyComponent, {});
    expect(html).toContain("disabled");
    expect(html).not.toContain('disabled="true"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('data-enabled="true"');
  });

  it("не пишет false у обычных boolean-атрибутов в RawAttr", async () => {
    const page = (): Node => {
      const template = templateHoles('<input data-silent-a-0="">')();
      attr(template.attrs[0]!, "disabled", () => false);
      attr(template.attrs[0]!, "aria-disabled", () => false);
      return template.node;
    };

    const { html } = await renderToString(page as unknown as AnyComponent, {});
    expect(html).not.toMatch(/(?:^|\s)disabled(?:=|\s|>)/);
    expect(html).toContain('aria-disabled="false"');
  });
});
