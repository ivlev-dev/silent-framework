import { afterEach, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import buttonMeta, { Playground, States, Variants } from "../src/button.stories.js";
import layoutMeta, { Grid_ } from "../src/layout.stories.js";
import typographyMeta from "../src/typography.stories.js";
import themeMeta, { SideBySide } from "../src/theme.stories.js";
import { disposeStory, mountStory } from "../src/silent-story.js";
import preview from "../.storybook/preview.js";
import { Button } from "@ivlev-dev/silent-ui";

const here = dirname(fileURLToPath(import.meta.url));
const storyDir = join(here, "..", "src");

function canvas(): Element {
  const element = document.createElement("section");
  document.body.appendChild(element);
  return element;
}

/** Рекурсивно собирает все story-файлы, которые подхватывает glob из main.ts. */
function storyFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...storyFiles(full));
    else if (entry.name.endsWith(".stories.tsx")) found.push(full);
  }
  return found.sort();
}

afterEach(() => {
  disposeStory();
  document.body.replaceChildren();
});

describe("stories", () => {
  it("каждый meta описывает controls через argTypes", () => {
    for (const meta of [buttonMeta, layoutMeta, typographyMeta, themeMeta] as Array<Record<string, unknown>>) {
      expect(typeof meta["title"]).toBe("string");
      expect(Object.keys(meta["argTypes"] as object).length).toBeGreaterThan(0);
      expect(meta["args"]).toBeTypeOf("object");
    }
  });

  it("Playground монтируется и получает args", () => {
    const element = canvas();
    mountStory(Playground.render, { ...buttonMeta.args, label: "Тест" } as Record<string, unknown>, element);
    const button = element.querySelector("button.sui-button");
    expect(button).not.toBeNull();
    expect(button?.textContent).toBe("Тест");
    expect(button?.getAttribute("data-variant")).toBe("filled");
  });

  it("перемонтирование освобождает предыдущую story", () => {
    const element = canvas();
    const first = mountStory(Playground.render, buttonMeta.args as Record<string, unknown>, element);
    const firstNode = first?.node;
    expect(firstNode?.parentNode).not.toBeNull();

    const second = mountStory(States.render, {}, element);
    expect(second).not.toBeNull();
    expect(firstNode?.parentNode).toBeNull();
    expect(element.querySelectorAll("button").length).toBeGreaterThan(3);
  });

  it("renderToCanvas-контейнер получает тему", () => {
    const element = canvas();
    mountStory(Variants.render, {}, element, { theme: "dark", density: "compact" });
    const wrapper = element.querySelector(".sui-story-canvas");
    expect(wrapper?.getAttribute("data-theme")).toBe("dark");
    expect(wrapper?.getAttribute("data-density")).toBe("compact");
  });

  it("layout и theme stories рендерят компоненты", () => {
    const element = canvas();
    mountStory(Grid_.render, layoutMeta.args as Record<string, unknown>, element);
    expect(element.querySelector(".sui-grid")).not.toBeNull();
    expect(element.querySelectorAll(".sui-surface").length).toBeGreaterThan(0);

    mountStory(SideBySide.render, {}, element);
    expect(element.querySelectorAll('[data-theme="dark"]').length).toBeGreaterThan(0);
  });

  it("preview.renderToCanvas читает render-context Storybook 10", () => {
    const element = document.createElement("section");
    document.body.appendChild(element);
    const renderToCanvas = preview.renderToCanvas;
    expect(typeof renderToCanvas).toBe("function");

    let showMainCalls = 0;
    const context = {
      componentId: "components-button",
      showMain: () => {
        showMainCalls += 1;
      },
      forceRemount: true,
      storyContext: {
        args: { label: "Из preview" },
        globals: { theme: "dark", density: "compact" },
      },
      storyFn: (args: Record<string, unknown>) => <Button>{String(args["label"])}</Button>,
    };
    renderToCanvas?.(context as never, element, undefined as never);
    expect(showMainCalls).toBe(1);
    const wrapper = element.querySelector(".sui-story-canvas");
    expect(wrapper?.getAttribute("data-theme")).toBe("dark");
    expect(wrapper?.getAttribute("data-density")).toBe("compact");
    expect(element.querySelector("button.sui-button")?.textContent).toBe("Из preview");

    const first = element.querySelector("button");
    renderToCanvas?.(
      {
        ...context,
        storyContext: { ...context.storyContext, args: { label: "Вторая" } },
      } as never,
      element,
      undefined as never,
    );
    expect(showMainCalls).toBe(2);
    expect(first?.isConnected).toBe(false);
    expect(element.querySelector("button.sui-button")?.textContent).toBe("Вторая");
  });

  it("glob stories находит каждый story-файл с meta и историями", () => {
    const files = storyFiles(storyDir);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const name = relative(storyDir, file);
      const contents = readFileSync(file, "utf8");
      expect(contents, `${name}: нет default meta`).toMatch(/export\s+default\b/);
      expect(contents, `${name}: нет именованных историй`).toMatch(/export\s+const\s+[A-Z]/);
    }
    const main = readFileSync(join(here, "..", ".storybook", "main.ts"), "utf8");
    expect(main).toContain('"../src/**/*.stories.tsx"');
    expect(main).toContain("@storybook/html-vite");
    expect(main).toContain("silent({ root: repoRoot, hmr: false })");
  });
});
