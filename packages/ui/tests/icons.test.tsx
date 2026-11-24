import { afterEach, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createComponent, hydrate, type AnyComponent } from "@ivlev-dev/silent-core";
import { renderToString } from "@ivlev-dev/silent-server";
import * as icons from "../src/icons/index.js";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const iconsDirectory = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "icons");

const GLYPHS = {
  AddIcon: icons.AddIcon,
  ArrowBackIcon: icons.ArrowBackIcon,
  ArrowForwardIcon: icons.ArrowForwardIcon,
  CheckIcon: icons.CheckIcon,
  ChevronDownIcon: icons.ChevronDownIcon,
  ChevronEndIcon: icons.ChevronEndIcon,
  ChevronStartIcon: icons.ChevronStartIcon,
  ChevronUpIcon: icons.ChevronUpIcon,
  CloseIcon: icons.CloseIcon,
  DownloadIcon: icons.DownloadIcon,
  ErrorIcon: icons.ErrorIcon,
  ExpandLessIcon: icons.ExpandLessIcon,
  ExpandMoreIcon: icons.ExpandMoreIcon,
  InfoIcon: icons.InfoIcon,
  LoadingIcon: icons.LoadingIcon,
  MenuIcon: icons.MenuIcon,
  MoreHorizIcon: icons.MoreHorizIcon,
  MoreVertIcon: icons.MoreVertIcon,
  RefreshIcon: icons.RefreshIcon,
  RemoveIcon: icons.RemoveIcon,
  SearchIcon: icons.SearchIcon,
  StarFilledIcon: icons.StarFilledIcon,
  StarIcon: icons.StarIcon,
  SuccessIcon: icons.SuccessIcon,
  UploadIcon: icons.UploadIcon,
  VisibilityIcon: icons.VisibilityIcon,
  VisibilityOffIcon: icons.VisibilityOffIcon,
  WarningIcon: icons.WarningIcon,
} as const;

interface Handle {
  readonly node: Node;
  dispose(): void;
}

const handles: Handle[] = [];

function mount(component: AnyComponent, props: Record<string, unknown> = {}): Element {
  const result = createComponent(component, props);
  document.body.appendChild(result.node);
  handles.push(result);
  if (result.node.nodeType !== Node.ELEMENT_NODE) {
    throw new Error(`ожидался элемент, получен nodeType=${result.node.nodeType}`);
  }
  return result.node as Element;
}

function elementsOf(svg: Element): Element[] {
  return [svg, ...Array.from(svg.querySelectorAll("*"))];
}

afterEach(() => {
  for (const handle of handles.splice(0)) handle.dispose();
  document.body.replaceChildren();
});

describe("иконки Material Symbols", () => {
  for (const [name, Glyph] of Object.entries(GLYPHS)) {
    it(`${name}: рендерит декоративный SVG 24×24`, () => {
      const svg = mount(Glyph);
      expect(svg.tagName.toLowerCase()).toBe("svg");
      expect(svg.namespaceURI).toBe(SVG_NAMESPACE);
      expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
      expect(svg.getAttribute("width")).toBe("24");
      expect(svg.getAttribute("height")).toBe("24");
      expect(svg.getAttribute("fill")).toBe("currentColor");
      expect(svg.getAttribute("focusable")).toBe("false");
      expect(svg.getAttribute("aria-hidden")).toBe("true");
      expect(svg.getAttribute("role")).toBeNull();
      expect(svg.getAttribute("aria-label")).toBeNull();
      expect(svg.classList.contains("sui-icon")).toBe(true);
      expect(svg.getAttribute("data-size")).toBe("md");

      const paths = Array.from(svg.querySelectorAll("path"));
      expect(paths.length).toBeGreaterThan(0);
      for (const path of paths) {
        const d = path.getAttribute("d");
        expect(d, `${name}: пустой path`).toBeTruthy();
        expect(d, `${name}: недопустимые символы в path`).toMatch(/^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+$/u);
      }
      for (const child of Array.from(svg.children)) {
        expect(child.tagName.toLowerCase(), `${name}: посторонний узел`).toBe("path");
      }
      expect(svg.querySelector("title")).toBeNull();
    });

    it(`${name}: не содержит опасных атрибутов`, () => {
      const svg = mount(Glyph);
      for (const element of elementsOf(svg)) {
        for (const attribute of Array.from(element.attributes)) {
          expect(attribute.name.startsWith("on"), `${name}: обработчик ${attribute.name}`).toBe(false);
          expect(attribute.name.toLowerCase()).not.toBe("innerhtml");
        }
      }
      const markup = svg.outerHTML;
      expect(markup).not.toMatch(/<script|javascript:|data:text\/html/iu);
    });
  }

  it("DismissIcon — алиас CloseIcon, без дублирования глифа", () => {
    expect(icons.DismissIcon).toBe(icons.CloseIcon);
    const svg = mount(icons.DismissIcon, { title: "Закрыть" });
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe("Закрыть");
  });

  it("title: role=img, aria-label и SVG <title> в неймспейсе SVG", () => {
    const svg = mount(icons.InfoIcon, { title: "Информация" });
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe("Информация");
    expect(svg.hasAttribute("aria-hidden")).toBe(false);

    const title = svg.querySelector("title");
    expect(title).not.toBeNull();
    expect(title?.namespaceURI).toBe(SVG_NAMESPACE);
    expect(title?.textContent).toBe("Информация");
  });

  it("label — совместимый алиас title; title приоритетнее", () => {
    const labeled = mount(icons.SearchIcon, { label: "Поиск" });
    expect(labeled.getAttribute("aria-label")).toBe("Поиск");
    expect(labeled.querySelector("title")?.textContent).toBe("Поиск");

    const titled = mount(icons.SearchIcon, { label: "Поиск", title: "Найти" });
    expect(titled.getAttribute("aria-label")).toBe("Найти");
    expect(titled.querySelector("title")?.textContent).toBe("Найти");
  });

  it("размер берётся из шкалы Icon, классы и attrs мержатся", () => {
    for (const size of ["sm", "md", "lg", "xl"] as const) {
      const svg = mount(icons.WarningIcon, { size });
      expect(svg.getAttribute("data-size")).toBe(size);
    }

    const svg = mount(icons.WarningIcon, {
      class: "custom-icon",
      attrs: { "data-testid": "warning", "aria-describedby": "hint" },
    });
    expect(svg.classList.contains("sui-icon")).toBe(true);
    expect(svg.classList.contains("custom-icon")).toBe(true);
    expect(svg.getAttribute("data-testid")).toBe("warning");
    expect(svg.getAttribute("aria-describedby")).toBe("hint");
  });

  it("attrs не могут подменить fill по умолчанию, но могут его переопределить", () => {
    expect(mount(icons.AddIcon).getAttribute("fill")).toBe("currentColor");
    expect(mount(icons.AddIcon, { attrs: { fill: "#ff0000" } }).getAttribute("fill")).toBe("#ff0000");
  });

  it("исходники иконок не используют innerHTML, eval и CSS-импорты", () => {
    const files = readdirSync(iconsDirectory).filter(
      (file) => file.endsWith(".tsx") || file === "glyph.ts",
    );
    expect(files.length).toBeGreaterThanOrEqual(Object.keys(GLYPHS).length);

    for (const file of files) {
      const source = readFileSync(join(iconsDirectory, file), "utf8");
      expect(source, `${file}: innerHTML`).not.toContain("innerHTML");
      expect(source, `${file}: dangerouslySetInnerHTML`).not.toContain("dangerouslySetInnerHTML");
      expect(source, `${file}: script`).not.toMatch(/<script/iu);
      expect(source, `${file}: eval`).not.toMatch(/\beval\s*\(/u);
      expect(source, `${file}: CSS-импорт`).not.toMatch(/\.css["']/u);
    }
  });
});

describe("SSR", () => {
  it("каждый глиф сериализуется в svg без заглушек и скриптов", async () => {
    for (const [name, Glyph] of Object.entries(GLYPHS)) {
      const { html } = await renderToString(Glyph as AnyComponent);
      expect(html, name).toContain("<svg");
      expect(html, name).toContain('viewBox="0 0 24 24"');
      expect(html, name).toContain('fill="currentColor"');
      expect(html, name).toContain('aria-hidden="true"');
      expect(html, name).not.toContain("<title");
      expect(html, name).not.toContain("aria-label");
      expect(html, name).not.toContain("<script");
      expect(html, name).not.toContain("undefined");
      expect(html, name).not.toContain("[object Object]");
    }
  });

  it("гидрация иконки с title проходит без mismatch", async () => {
    function Titled(): Node {
      return <icons.InfoIcon title="Информация" />;
    }

    const { html } = await renderToString(Titled);
    expect(html).toContain("<title>Информация</title>");

    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);

    const mismatches: string[] = [];
    const handle = await hydrate(container, Titled, {
      onMismatch: (error) => {
        mismatches.push(error.message);
      },
    });
    expect(mismatches).toEqual([]);
    expect(container.querySelector("title")?.namespaceURI).toBe(SVG_NAMESPACE);
    expect(container.querySelector("svg")?.getAttribute("role")).toBe("img");
    handle.dispose();
  });
});
