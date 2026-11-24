import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import buttonMeta, { Playground as ButtonPlayground } from "../src/button.stories.js";
import alertMeta, { Playground as AlertPlayground } from "../src/feedback.stories.js";
import dialogMeta, { Playground as DialogPlayground } from "../src/dialog.stories.js";
import tableMeta, { Playground as TablePlayground } from "../src/table.stories.js";
import textFieldMeta, { Playground as TextFieldPlayground } from "../src/text-field.stories.js";
import patternsMeta, { Dashboard, Form } from "../src/patterns.stories.js";
import { disposeStory, mountStory } from "../src/silent-story.js";

const here = dirname(fileURLToPath(import.meta.url));
const packageDir = join(here, "..");

function canvas(): HTMLElement {
  const element = document.createElement("section");
  document.body.appendChild(element);
  return element;
}

afterEach(() => {
  disposeStory();
  document.body.replaceChildren();
});

describe("витрина: autodocs", () => {
  const componentMetas = [
    ["Button", buttonMeta],
    ["TextField", textFieldMeta],
    ["Alert", alertMeta],
    ["Dialog", dialogMeta],
    ["Table", tableMeta],
  ] as const;

  it("эталонные компоненты помечены autodocs и описывают себя", () => {
    for (const [name, meta] of componentMetas) {
      const value = meta as Record<string, unknown>;
      expect(value["tags"], `${name}: tags`).toContain("autodocs");
      const parameters = value["parameters"] as {
        docs?: { description?: { component?: unknown }; canvas?: unknown };
      };
      expect(typeof parameters.docs?.description?.component, `${name}: description`).toBe(
        "string",
      );
      expect(parameters.docs?.canvas, `${name}: canvas`).toBeTypeOf("object");
    }
  });

  it("у каждой эталонной story есть controls и args по умолчанию", () => {
    for (const [name, meta] of componentMetas) {
      const value = meta as Record<string, unknown>;
      expect(Object.keys(value["argTypes"] as object).length, `${name}: argTypes`).toBeGreaterThan(
        2,
      );
      expect(value["args"], `${name}: args`).toBeTypeOf("object");
    }
  });

  it("действия подключены через fn()", () => {
    const buttonArgs = (buttonMeta as { args: Record<string, unknown> }).args;
    const alertArgs = (alertMeta as { args: Record<string, unknown> }).args;
    const dialogArgs = (dialogMeta as { args: Record<string, unknown> }).args;
    expect(buttonArgs["onClick"]).toBeTypeOf("function");
    expect(alertArgs["onClose"]).toBeTypeOf("function");
    expect(dialogArgs["onOpenChange"]).toBeTypeOf("function");
  });
});

describe("витрина: Docs-инфраструктура", () => {
  it("main.ts включает addon-docs и MDX", () => {
    const main = readFileSync(join(packageDir, ".storybook", "main.ts"), "utf8");
    expect(main).toContain('"@storybook/addon-docs"');
    expect(main).toContain('"../src/**/*.mdx"');
    expect(main).toContain("@storybook/html-vite");
  });

  it("intro-страница описывает палитру, темы, брейкпоинты и controls", () => {
    const intro = readFileSync(join(packageDir, "src", "introduction.mdx"), "utf8");
    expect(intro).toContain('<Meta title="Introduction" />');
    for (const section of ["Палитра", "Темы", "Брейкпоинты", "controls", "docs/guides/ui.md"]) {
      expect(intro, `нет раздела ${section}`).toContain(section);
    }
  });

  it("preview настраивает controls и viewport'ы", () => {
    const preview = readFileSync(join(packageDir, ".storybook", "preview.tsx"), "utf8");
    expect(preview).toContain('sort: "requiredFirst"');
    expect(preview).toContain('"360px"');
    expect(preview).toContain('"2560px"');
    expect(preview).toContain("preview-docs.css");
  });
});

describe("витрина: несколько Canvas на Docs", () => {
  it("mountStory не гасит предыдущий Canvas", () => {
    const firstCanvas = canvas();
    const secondCanvas = canvas();
    const first = mountStory(ButtonPlayground.render, { label: "Первый" }, firstCanvas);
    const second = mountStory(ButtonPlayground.render, { label: "Второй" }, secondCanvas);
    expect(first?.node.isConnected).toBe(true);
    expect(second?.node.isConnected).toBe(true);
    expect(firstCanvas.textContent).toContain("Первый");
    expect(secondCanvas.textContent).toContain("Второй");
  });

  it("повторный монтаж в тот же Canvas освобождает предыдущий", () => {
    const element = canvas();
    const first = mountStory(ButtonPlayground.render, { label: "Старый" }, element);
    const firstNode = first?.node;
    mountStory(AlertPlayground.render, { title: "Новый" }, element);
    expect(firstNode?.isConnected).toBe(false);
    expect(element.querySelector(".sui-alert")).not.toBeNull();
    expect(element.querySelector(".sui-button")).toBeNull();
  });
});

describe("витрина: Patterns", () => {
  it("meta задаёт категорию Patterns и отключает controls", () => {
    const value = patternsMeta as Record<string, unknown>;
    expect(value["title"]).toBe("Patterns");
    expect((value["parameters"] as { controls?: { disable?: boolean } }).controls?.disable).toBe(
      true,
    );
  });

  it("форма и dashboard монтируются без остатков предыдущей story", () => {
    const formCanvas = canvas();
    mountStory(Form.render, {}, formCanvas);
    expect(formCanvas.querySelector("form")).not.toBeNull();
    expect(formCanvas.querySelector(".sui-alert")).toBeNull();

    const dashboardCanvas = canvas();
    mountStory(Dashboard.render, {}, dashboardCanvas);
    expect(dashboardCanvas.querySelector(".sui-navigation-rail")).not.toBeNull();
    expect(dashboardCanvas.querySelector(".sui-table")).not.toBeNull();
    expect(formCanvas.querySelector("form")).not.toBeNull();
  });
});
