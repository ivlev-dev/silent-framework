// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { renderToString } from "@ivlev-dev/silent-server";
import { Context, ContextMissingError, Provider } from "../src/context.js";
import { createId, resetIds } from "../src/id.js";
import { hydrate } from "../src/hydrate.js";
import type { AnyComponent } from "../src/types.js";

const Theme = new Context({ defaultValue: "light", name: "Theme" });

function Field(): Node {
  const id = createId("field");
  const wrapper = document.createElement("div");
  wrapper.setAttribute("class", "field");
  const label = document.createElement("label");
  label.setAttribute("for", id);
  label.textContent = Theme.get();
  const input = document.createElement("input");
  input.setAttribute("id", id);
  wrapper.appendChild(label);
  wrapper.appendChild(input);
  return wrapper;
}

function App(): Node {
  return Provider({
    context: Theme,
    value: "dark",
    children: () => Field(),
  });
}

afterEach(() => {
  resetIds();
  document.body.replaceChildren();
});

describe("SSR контекста и id", () => {
  it("рендерит Provider и детерминированные id", async () => {
    resetIds();
    const first = await renderToString(App as unknown as AnyComponent);
    resetIds();
    const second = await renderToString(App as unknown as AnyComponent);

    expect(first.html).toBe(second.html);
    expect(first.html).toContain('for="field-1"');
    expect(first.html).toContain('id="field-1"');
    expect(first.html).toContain(">dark<");
  });

  it("вкладывает провайдеры на сервере", async () => {
    function Nested(): Node {
      return Provider({
        context: Theme,
        value: "outer",
        children: () =>
          Provider({
            context: Theme,
            value: "inner",
            children: () => Field(),
          }),
      });
    }

    const { html } = await renderToString(Nested as unknown as AnyComponent);
    expect(html).toContain(">inner<");
    expect(html).not.toContain(">outer<");
  });

  it("применяет значение по умолчанию и падает без него", async () => {
    const optional = new Context({ defaultValue: "fallback" });
    function Optional(): Node {
      return document.createTextNode(optional.get());
    }
    const { html } = await renderToString(Optional as unknown as AnyComponent);
    expect(html).toContain("fallback");

    const required = new Context<string>({ name: "Required" });
    function Required(): Node {
      return document.createTextNode(required.get());
    }
    await expect(
      renderToString(Required as unknown as AnyComponent),
    ).rejects.toBeInstanceOf(ContextMissingError);
  });

  it("совпадает по id и контексту при гидрации", async () => {
    resetIds();
    const { html } = await renderToString(App as unknown as AnyComponent);

    const target = document.createElement("div");
    target.innerHTML = html;
    document.body.appendChild(target);
    const serverLabel = target.querySelector("label");

    resetIds();
    const mismatches: unknown[] = [];
    const handle = await hydrate(target, App as unknown as AnyComponent, {
      onMismatch: (error) => {
        mismatches.push(error);
      },
    });

    expect(mismatches).toEqual([]);
    expect(target.querySelectorAll("label").length).toBe(1);
    expect(target.querySelectorAll(".field").length).toBe(1);
    expect(target.querySelector("label")).not.toBe(serverLabel);
    expect(target.querySelector("label")?.getAttribute("for")).toBe("field-1");
    expect(target.querySelector("input")?.getAttribute("id")).toBe("field-1");
    expect(target.querySelector("label")?.textContent).toBe("dark");
    handle.dispose();
  });
});
