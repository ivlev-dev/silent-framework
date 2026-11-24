import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sourceRoot = join(here, "..", "src");

function walk(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const absolute = join(directory, entry);
    if (statSync(absolute).isDirectory()) {
      files.push(...walk(absolute));
    } else {
      files.push(absolute);
    }
  }
  return files;
}

const manifest = readFileSync(join(sourceRoot, "styles.css"), "utf8");
const imports = [...manifest.matchAll(/@import\s+"([^"]+)";/gu)].map((match) => match[1] ?? "");

const cssFiles = walk(sourceRoot)
  .map((file) => relative(sourceRoot, file).split("\\").join("/"))
  .filter((file) => file.endsWith(".css") && file !== "styles.css")
  .sort((left, right) => left.localeCompare(right, "en"));

describe("CSS-манифест", () => {
  it("импортирует каждый CSS-файл ровно один раз", () => {
    const normalized = imports.map((path) => path.replace(/^\.\//u, ""));
    const sorted = [...normalized].sort((left, right) => left.localeCompare(right, "en"));
    expect(sorted).toEqual(cssFiles);
    expect(new Set(normalized).size).toBe(normalized.length);
  });

  it("держит порядок слоёв: layers → reset → tokens → themes → base → layout → компоненты → формы", () => {
    expect(imports[0]).toBe("./styles/layers.css");
    expect(imports[1]).toBe("./styles/reset.css");
    expect(imports[2]).toBe("./tokens/tokens.css");
    expect(imports[3]).toBe("./styles/themes.css");
    expect(imports[4]).toBe("./styles/base.css");
    expect(imports[5]).toBe("./layout/layout.css");
    expect(
      imports.slice(6).every((path) => path.startsWith("./components/") || path.startsWith("./form/")),
    ).toBe(true);
    const firstForm = imports.findIndex((path) => path.startsWith("./form/"));
    if (firstForm !== -1) {
      expect(imports.slice(6, firstForm).every((path) => path.startsWith("./components/"))).toBe(true);
      expect(imports.slice(firstForm).every((path) => path.startsWith("./form/"))).toBe(true);
    }
  });

  it("каждый файл обёрнут в ожидаемый слой", () => {
    const expected: Readonly<Record<string, string>> = {
      "styles/reset.css": "sui.reset",
      "tokens/tokens.css": "sui.tokens",
      "styles/themes.css": "sui.tokens",
      "styles/base.css": "sui.base",
      "layout/layout.css": "sui.layout",
      "components/text/text.css": "sui.components",
      "components/button/button.css": "sui.components",
      "form/field/field.css": "sui.components",
      "form/text-field/text-field.css": "sui.components",
    };
    for (const [file, layer] of Object.entries(expected)) {
      const css = readFileSync(join(sourceRoot, file), "utf8");
      expect(css, file).toContain(`@layer ${layer} {`);
    }
  });

  it("компонентные стили не задают !important и не импортируют CSS", () => {
    for (const file of cssFiles) {
      const css = readFileSync(join(sourceRoot, file), "utf8");
      expect(css.includes("!important") && !file.startsWith("styles/"), file).toBe(false);
      expect(css.includes("@import"), file).toBe(false);
    }
  });
});
