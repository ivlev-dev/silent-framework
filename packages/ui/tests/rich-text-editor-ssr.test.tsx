import { afterEach, describe, expect, it } from "vitest";
import { hydrate } from "@ivlev-dev/silent-core";
import { renderToString } from "@ivlev-dev/silent-server";
import { RichTextEditor } from "../src/components/rich-text-editor/index.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  document.body.replaceChildren();
});

const INITIAL_HTML = '<p>Hello <strong>world</strong></p><img src="x" onerror="alert(1)">';

function Editor(): Node {
  return (
    <RichTextEditor
      id="bio"
      name="bio"
      label="Биография"
      hint="Коротко о себе"
      defaultValue={INITIAL_HTML}
    />
  );
}

function TwoEditors(): Node {
  return (
    <div>
      <RichTextEditor label="Первый" hint="Подсказка 1" defaultValue="<p>A</p>" />
      <RichTextEditor label="Второй" hint="Подсказка 2" defaultValue="<p>B</p>" />
    </div>
  );
}

describe("RichTextEditor: SSR", () => {
  it("не вставляет HTML в contenteditable, но кладёт значение в hidden input", async () => {
    const { html } = await renderToString(Editor);
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);

    const content = container.querySelector<HTMLDivElement>(".sui-rte__content");
    expect(content).not.toBeNull();
    expect(content?.innerHTML).toBe("");
    expect(content?.childNodes).toHaveLength(0);
    expect(content?.textContent).toBe("");
    expect(content?.getAttribute("role")).toBe("textbox");
    expect(content?.getAttribute("aria-multiline")).toBe("true");

    const hidden = container.querySelector<HTMLInputElement>('input[type="hidden"]');
    expect(hidden?.getAttribute("name")).toBe("bio");
    expect(hidden?.value).toBe("<p>Hello <strong>world</strong></p>");

    const root = container.querySelector<HTMLElement>(".sui-rte");
    expect(root?.hasAttribute("data-mounted")).toBe(false);
    expect(html).not.toContain('data-mounted=""');
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("javascript:");
    expect(container.querySelector(".sui-rte__content strong")).toBeNull();
    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        ".sui-rte__toolbar .sui-rte__button",
      ),
    );
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button.querySelector("svg")).not.toBeNull();
      expect(button.textContent?.trim()).toBe("");
    }
    expect(container.querySelector('[aria-haspopup="menu"]')).toBeNull();
  });

  it("hydrate проходит без mismatch и заполняет редактор после монтирования", async () => {
    const { html } = await renderToString(Editor);
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);

    const mismatches: string[] = [];
    const handle = await hydrate(container, Editor, {
      onMismatch: (error) => {
        mismatches.push(error.message);
      },
    });
    cleanups.push(() => handle.dispose());

    expect(mismatches).toEqual([]);
    const content = container.querySelector<HTMLDivElement>(".sui-rte__content");
    expect(content?.innerHTML).toBe("<p>Hello <strong>world</strong></p>");
    expect(content?.textContent).toBe("Hello world");
    expect(container.querySelector<HTMLElement>(".sui-rte")?.hasAttribute("data-mounted")).toBe(
      true,
    );

    const hidden = container.querySelector<HTMLInputElement>('input[type="hidden"]');
    expect(hidden?.value).toBe("<p>Hello <strong>world</strong></p>");
  });

  it("два редактора без id получают разные auto-id, ARIA и hydrate без mismatch", async () => {
    const { html } = await renderToString(TwoEditors);
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);

    const contents = Array.from(
      container.querySelectorAll<HTMLDivElement>(".sui-rte__content"),
    );
    expect(contents).toHaveLength(2);
    const ids = contents.map((content) => content.id);
    expect(ids[0]).toMatch(/^sui-rte-\d+$/u);
    expect(ids[1]).toMatch(/^sui-rte-\d+$/u);
    expect(ids[0]).not.toBe(ids[1]);

    for (const content of contents) {
      expect(content.getAttribute("aria-labelledby")).toBe(`${content.id}-label`);
      expect(content.getAttribute("aria-describedby")).toBe(`${content.id}-hint`);
      expect(document.getElementById(`${content.id}-label`)?.getAttribute("for")).toBe(
        content.id,
      );
      const hidden = content
        .closest(".sui-rte")
        ?.querySelector<HTMLInputElement>('input[type="hidden"]');
      expect(hidden?.name).toBe(content.id);
    }

    const mismatches: string[] = [];
    const handle = await hydrate(container, TwoEditors, {
      onMismatch: (error) => {
        mismatches.push(error.message);
      },
    });
    cleanups.push(() => handle.dispose());

    expect(mismatches).toEqual([]);
    const hydrated = Array.from(
      container.querySelectorAll<HTMLDivElement>(".sui-rte__content"),
    );
    expect(hydrated.map((content) => content.id)).toEqual(ids);
    expect(container.querySelectorAll(".sui-rte__content")[0]?.innerHTML).toBe(
      "<p>A</p>",
    );
    expect(container.querySelectorAll(".sui-rte__content")[1]?.innerHTML).toBe(
      "<p>B</p>",
    );
  });
});
